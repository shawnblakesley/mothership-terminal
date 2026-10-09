import { test } from "node:test";
import assert from "node:assert/strict";
import { judge, resolve, sanitizeRequest, effectiveAdvantage, combineAdvantage, resultText } from "../rolls.js";
import { DEFAULT_CREW, sanitizeCrew, setVital, gainStress, raiseMinStress, closeCrew, freshen, traumaResponse, maxWoundsFor } from "../crew.js";
import { PANIC_TABLE, panicEntry } from "../cast.js";
import { Session } from "../session.js";

const check = (stat, d, bonus = 0) => resolve({ check: "intellect", advantage: "none", bonus }, stat, [d]);
const crew = () => sanitizeCrew(structuredClone(DEFAULT_CREW));
const pcOf = (id) => crew().find((c) => c.id === id);

test("90-99 always fail, at any target", () => {
  for (const target of [50, 99, 105, 140]) for (let d = 90; d <= 99; d++) assert.equal(judge(d, target).success, false, `${d} vs ${target}`);
  assert.equal(judge(89, 105).success, true);
  assert.equal(check(60, 92, 45).success, false);
});

test("99 is a critical failure at any target; 00 a critical success", () => {
  const r = check(99, 99, 21);
  assert.equal(r.target, 120);
  assert.equal(r.outcome, "critical failure");
  assert.equal(r.panicCheck, true);
  assert.equal(check(1, 0).outcome, "critical success");
  assert.equal(check(50, 0).panicCheck, false);
});

test("doubles are criticals either way", () => {
  assert.equal(check(60, 55).outcome, "critical success");
  assert.equal(check(50, 55).outcome, "critical failure");
  assert.equal(check(50, 55).panicCheck, true);
  assert.equal(check(50, 56).panicCheck, false);
  assert.match(resultText({ check: "intellect", advantage: "none", skill: "" }, check(50, 55)), /CRITICAL FAILURE: PANIC CHECK/);
});

test("minimum stress is a floor for Stress", () => {
  const pc = pcOf("rusk");
  pc.minStress = 4;
  assert.deepEqual(setVital(pc, "stress", 1), [2, 4]);
  assert.equal(pc.stress, 4);
  pc.stress = 9;
  raiseMinStress(pc, 2);
  assert.equal(pc.minStress, 6);
  assert.equal(pc.stress, 9);
  pc.startStress = 2;
  freshen(pc);
  assert.equal(pc.stress, 6);
});

test("saved crews without minStress get 2", () => {
  const old = structuredClone(DEFAULT_CREW).map(({ minStress, ...c }) => c);
  assert.ok(sanitizeCrew(old).every((c) => c.minStress === 2));
  assert.equal(sanitizeCrew([{ name: "X", stress: 0 }])[0].stress, 2);
});

test("Stress stops at 20 and reports the overflow", () => {
  const pc = pcOf("varga");
  pc.stress = 19;
  assert.deepEqual(gainStress(pc, 4), { from: 19, to: 20, over: 3 });
  assert.equal(pc.stress, 20);
  assert.deepEqual(gainStress(pc, 1), { from: 20, to: 20, over: 1 });
  assert.equal(setVital(pc, "stress", 50)[1], 20);
});

test("Panic Table entries follow the Player's Survival Guide", () => {
  const name = (n) => PANIC_TABLE[n].name;
  assert.equal(name(2), "Nervous");
  assert.equal(name(11), "Suspicious");
  assert.match(PANIC_TABLE[14].effect, /Minimum Stress goes up by 2/);
  assert.equal(PANIC_TABLE[14].minStress, 2);
  assert.match(PANIC_TABLE[16].effect, /\[\+\] on every Damage roll for 1d10 hours.*every crewmember gains 1 Stress/);
  assert.equal(name(18), "Compounding problems");
  assert.match(PANIC_TABLE[18].effect, /roll twice on this table/);
  assert.equal(name(20), "Retire");
  assert.match(PANIC_TABLE[20].effect, /rolls up a new character/);
  assert.deepEqual([4, 14, 18, 19].map((n) => PANIC_TABLE[n].minStress > 0), [true, true, true, true]);
  assert.ok(panicEntry(18).minStress >= 1);
  assert.equal(PANIC_TABLE.length, 21);
});

test("an Android close by puts Fear Saves at [-]", () => {
  const [rusk, , moll] = crew();
  assert.equal(moll.className, "Android");
  const fear = { check: "fear", advantage: "none" };
  const room = { rusk: "airlock_a", moll: "airlock_a", varga: "med_bay" };
  const roomOf = (id) => room[id] || "";
  const near = (pc) => closeCrew(pc, crew(), roomOf);
  assert.equal(effectiveAdvantage(fear, rusk, { close: near(rusk) }), "disadvantage");
  assert.equal(effectiveAdvantage({ ...fear, advantage: "advantage" }, rusk, { close: near(rusk) }), "none");
  assert.equal(effectiveAdvantage(fear, pcOf("varga"), { close: near(pcOf("varga")) }), "none");
  assert.equal(effectiveAdvantage({ check: "intellect", advantage: "none" }, rusk, { close: near(rusk) }), "none");
  assert.equal(effectiveAdvantage(fear, moll, { close: near(moll) }), "none");
  assert.equal(combineAdvantage(["advantage", "disadvantage"]), "none");
});

function game(placement) {
  const s = new Session({ code: "TESTCORE" }, { onChange() {}, onEnd() {} });
  for (const [character, terminal] of Object.entries(placement)) s.sockets.add({ role: "player", character, terminal, readyState: 1, send() {} });
  return s;
}
const call = (s, roll) => s.handleDm({ t: "rollRequest", roll });
const notes = (s) => s.state.log.filter((e) => e.kind === "note").map((e) => e.text);

test("the server makes an Android's neighbour roll Fear at [-]", () => {
  const s = game({ rusk: "airlock", moll: "airlock", varga: "medbay" });
  const rusk = s.crewById("rusk");
  call(s, { pc: "rusk", check: "fear" });
  assert.throws(() => s.rollFor(rusk, [10]), /two d100/);
  s.rollFor(rusk, [10, 80]);
  assert.match(s.state.log.findLast((e) => e.kind === "roll").text, /FEAR SAVE \[-\]/);
  call(s, { pc: "varga", check: "fear" });
  s.rollFor(s.crewById("varga"), [10]);
});

test("a Scientist who fails a Sanity Save gives 1 Stress to others in the room", () => {
  const s = game({ varga: "medbay", rusk: "medbay", moll: "airlock" });
  call(s, { pc: "varga", check: "sanity" });
  s.rollFor(s.crewById("varga"), [97]);
  assert.equal(s.crewById("rusk").stress, 3);
  assert.equal(s.crewById("moll").stress, 2);
  assert.equal(s.crewById("varga").stress, 3);
});

test("a critical failure offers a Panic check, and a Marine's panic offers Fear Saves", () => {
  const s = game({ rusk: "airlock", oyelaran: "airlock" });
  call(s, { pc: "rusk", check: "strength" });
  s.rollFor(s.crewById("rusk"), [99]);
  assert.match(s.state.log.findLast((e) => e.kind === "roll").text, /CRITICAL FAILURE: PANIC CHECK/);
  assert.equal(s.state.offers.length, 1);
  assert.deepEqual(s.state.offers[0].roll, { pc: "rusk", check: "panic", reason: "Critical failure" });
  s.state.roll = null;
  call(s, { pc: "oyelaran", check: "panic" });
  s.rollFor(s.crewById("oyelaran"), [1]);
  assert.ok(notes(s).some((t) => /Marine trauma response: every Close friendly player makes a Fear Save/.test(t)));
  assert.deepEqual(s.state.offers.at(-1).roll, { pc: ["rusk"], check: "fear", reason: "Marine trauma response" });
});

test("a Teamster takes [+] on a Panic Check once per session", () => {
  const s = game({ rusk: "airlock" });
  const rusk = s.crewById("rusk");
  call(s, { pc: "rusk", check: "panic", plus: true });
  s.rollFor(rusk, [15, 3]);
  assert.equal(s.state.panicPlus.rusk, true);
  s.state.roll = null;
  call(s, { pc: "rusk", check: "panic", plus: true });
  assert.throws(() => s.rollFor(rusk, [15, 3]), /one d20/);
  assert.equal(s.plusAvailable(rusk), false);
});

test("stress over 20 is noted for the Warden", () => {
  const s = game({ rusk: "airlock" });
  const rusk = s.crewById("rusk");
  rusk.stress = 20;
  s.stressFromRoll(rusk, 1);
  assert.ok(notes(s).some((t) => /Stress over 20: reduce the most relevant Stat or Save by 1 \(PSG 20\.1\)/.test(t)));
});

test("trauma responses and class Max Wounds", () => {
  assert.match(traumaResponse({ className: "Android" }), /Fear Saves made by Close friendly players are at \[-\]/);
  assert.deepEqual(["Marine", "Android", "Scientist", "Teamster"].map(maxWoundsFor), [3, 3, 2, 2]);
  assert.equal(sanitizeRequest({ pc: ["rusk", "varga"], check: "fear" }, crew()).pcs.length, 2);
});
