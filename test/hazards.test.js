import { test } from "node:test";
import assert from "node:assert/strict";
import { HAZARDS, protection, roundTick, hourTick, vacuumTick, puncture, oxygenState, oxygenDay, settle, hazardDamage, normalizeHazards, penalties, withDisadvantage, eventNeeds } from "../hazards.js";
import { sanitizeCrew, newCond } from "../crew.js";
import { armorFrom } from "../weapons.js";
import { CAMPAIGNS } from "../campaign.js";
import { Session } from "../session.js";

const pc = (className, items, extra = {}) => sanitizeCrew([{ name: "Test", className, items, health: { current: 12, max: 12 }, ...extra }])[0];
const fixed = (n) => () => n;
const win = { success: true, critical: false };
const loss = { success: false, critical: false };

test("vacuum: unconscious after 15 seconds, dead 1d5 minutes later", () => {
  const c = newCond();
  assert.deepEqual(vacuumTick(c, 10, fixed(3)), []);
  assert.equal(c.out, false);
  vacuumTick(c, 10, fixed(3));
  assert.equal(c.out, true);
  assert.equal(c.deadAt, 15 + 3 * 60);
  vacuumTick(c, 60, fixed(3));
  assert.equal(c.dead, "");
  vacuumTick(c, 120, fixed(3));
  assert.equal(c.dead, "no air");
});

test("vacuum rounds: two rounds unconscious, then dead after the rolled minutes", () => {
  const p = pc("Teamster", ["Standard crew attire"]);
  const here = [{ type: "vacuum", level: null }];
  roundTick(p, here, fixed(1));
  assert.equal(p.cond.out, false);
  roundTick(p, here, fixed(1));
  assert.equal(p.cond.out, true);
  for (let i = 0; i < 6; i++) roundTick(p, here, fixed(1));
  assert.equal(p.cond.dead, "no air");
});

test("a vaccsuit protects against vacuum and radiation; crew attire does not", () => {
  const suited = pc("Teamster", ["Vaccsuit", "Crowbar"]);
  const plain = pc("Teamster", ["Standard crew attire"]);
  assert.ok(protection(suited, "vacuum"));
  assert.ok(protection(suited, "radiation"));
  assert.equal(protection(plain, "vacuum"), "");
  assert.equal(protection(plain, "radiation"), "");
  roundTick(suited, [{ type: "vacuum" }], fixed(1));
  roundTick(suited, [{ type: "vacuum" }], fixed(1));
  assert.equal(suited.cond.vac, 0);
  assert.equal(suited.cond.out, false);
  roundTick(plain, [{ type: "vacuum" }], fixed(1));
  roundTick(plain, [{ type: "vacuum" }], fixed(1));
  assert.equal(plain.cond.out, true);
  assert.equal(roundTick(suited, [{ type: "radiation", level: 2 }]).needs.length, 0);
  assert.equal(suited.cond.rad, 0);
});

test("hazard suit and advanced battle dress have 1 hour of air; a vaccsuit 12", () => {
  const hazard = pc("Marine", ["Hazard suit"]);
  hazardTicks(hazard, 1);
  assert.equal(hazard.cond.vac, 0);
  hazardTicks(hazard, 1);
  assert.equal(protection(hazard, "vacuum"), "", "air used up");
  const vacc = pc("Marine", ["Vaccsuit"]);
  hazardTicks(vacc, 12);
  assert.ok(vacc.cond.air >= 12 * 3600 - 1);
  assert.equal(protection(vacc, "vacuum"), "");
});
function hazardTicks(p, hours) {
  for (let i = 0; i < hours; i++) hourTick(p, [{ type: "vacuum" }], fixed(1));
}

test("a punctured vaccsuit decompresses within 1d5 rounds", () => {
  const p = pc("Teamster", ["Vaccsuit"]);
  puncture(p.cond, fixed(2));
  roundTick(p, [{ type: "vacuum" }], fixed(1));
  assert.equal(p.cond.leak, false);
  assert.ok(protection(p, "vacuum"));
  const res = roundTick(p, [{ type: "vacuum" }], fixed(1));
  assert.equal(p.cond.leak, true);
  assert.ok(res.events.includes("suit decompressed"));
  assert.equal(protection(p, "vacuum"), "");
  assert.ok(protection(p, "radiation"), "shielding is not the seal");
});

test("radiation level 2 takes 1 from all Stats and Saves every round; level 1 nothing; level 3 asks for a Body Save", () => {
  const p = pc("Teamster", ["Standard crew attire"]);
  roundTick(p, [{ type: "radiation", level: 1 }]);
  assert.equal(p.cond.rad, 0);
  roundTick(p, [{ type: "radiation", level: 2 }]);
  roundTick(p, [{ type: "radiation", level: 2 }]);
  assert.equal(p.cond.rad, 2);
  const res = roundTick(p, [{ type: "radiation", level: 3 }]);
  assert.equal(res.needs[0].check, "body");
  assert.equal(p.cond.rad, 2);
  const lethal = settle(p, res.needs[0], loss, fixed(4));
  assert.equal(p.cond.lethal, 24 * 4);
  assert.match(lethal.text, /4 days/);
  const q = pc("Teamster", ["Standard crew attire"]);
  settle(q, res.needs[0], win, fixed(4));
  assert.equal(q.cond.lethal, 0);
});

test("oxygen supply thresholds for a crew of 4", () => {
  assert.deepEqual(oxygenState(7, 4), { low: true, save: false, gone: false });
  assert.deepEqual(oxygenState(3, 4), { low: true, save: true, gone: false });
  assert.deepEqual(oxygenState(8, 4), { low: false, save: false, gone: false });
  assert.deepEqual(oxygenState(0, 4), { low: true, save: true, gone: true });
});

test("oxygen: every 24 hours subtract breathing crew, 2 more each for strenuous activity; androids and cryosleepers use none", () => {
  const crew = ["Teamster", "Scientist", "Marine", "Android"].map((k) => pc(k, []));
  assert.equal(oxygenDay(20, crew).supply, 17);
  crew[0].cond.strenuous = true;
  assert.equal(oxygenDay(20, crew).supply, 15);
  crew[1].cond.cryosleep = true;
  assert.equal(oxygenDay(20, crew).use, 4);
});

test("an android needs no oxygen; a breather does", () => {
  const android = pc("Android", []);
  const human = pc("Marine", []);
  assert.ok(protection(android, "oxygen"));
  assert.ok(protection(android, "vacuum"));
  assert.equal(protection(human, "oxygen"), "");
  assert.equal(protection(pc("Marine", ["Oxygen tank"]), "oxygen"), "oxygen tank");
  const out = roundTick(android, [{ type: "oxygen", supply: 0 }], fixed(1));
  roundTick(android, [{ type: "oxygen", supply: 0 }], fixed(1));
  assert.equal(android.cond.out, false);
  assert.deepEqual(out.needs, []);
  roundTick(human, [{ type: "oxygen", supply: 0 }], fixed(1));
  roundTick(human, [{ type: "oxygen", supply: 0 }], fixed(1));
  assert.equal(human.cond.out, true);
});

test("toxic atmosphere: 1d10 per round, halved by a successful Body Save", () => {
  const p = pc("Teamster", ["Standard crew attire"]);
  const { needs } = roundTick(p, [{ type: "toxic" }], fixed(7));
  assert.equal(needs[0].dmg, 7);
  assert.equal(needs[0].check, "body");
  assert.equal(settle(p, needs[0], win).damage, 4);
  assert.equal(settle(p, needs[0], loss).damage, 7);
  assert.equal(roundTick(pc("Teamster", ["Rebreather"]), [{ type: "toxic" }], fixed(7)).needs.length, 0);
});

test("corrosive atmosphere: Damage per round equals its level", () => {
  const p = pc("Teamster", []);
  assert.deepEqual(roundTick(p, [{ type: "corrosive", level: 6 }]).damage.map((d) => d.n), [6]);
});

test("exhaustion: nothing before 12 hours, a Body Save every hour after, [-] from 24 hours", () => {
  const p = pc("Teamster", []);
  for (let h = 1; h <= 12; h++) assert.equal(hourTick(p, []).needs.length, 0, `hour ${h}`);
  const res = hourTick(p, []);
  assert.equal(res.needs.length, 1);
  assert.equal(res.needs[0].kind, "exhaustion");
  assert.equal(settle(p, res.needs[0], loss).damage, 1);
  assert.equal(settle(p, res.needs[0], win).damage, 0);
  assert.deepEqual(penalties(p), []);
  for (let h = 14; h <= 24; h++) hourTick(p, []);
  assert.equal(p.cond.active, 24);
  assert.equal(withDisadvantage("none", penalties(p)), "disadvantage");
  assert.equal(withDisadvantage("advantage", penalties(p)), "none");
});

test("cold and heat: a Body Save every hour unless in a hazard suit; failure is a Death Save", () => {
  const p = pc("Teamster", []);
  const res = hourTick(p, [{ type: "cold" }]);
  assert.equal(res.needs[0].check, "body");
  assert.ok(settle(p, res.needs[0], loss).deathSave);
  assert.equal(hourTick(pc("Teamster", ["Hazard suit"]), [{ type: "heat" }]).needs.length, 0);
  assert.equal(hourTick(pc("Teamster", ["Vaccsuit"]), [{ type: "cold" }]).needs.length, 1);
});

test("food and cryosickness", () => {
  const p = pc("Teamster", []);
  for (let h = 0; h < 23; h++) hourTick(p, []);
  assert.deepEqual(penalties(p).filter((x) => /food/.test(x)), []);
  hourTick(p, []);
  assert.ok(penalties(p).some((x) => /food/.test(x)));
  p.cond.cryo = 168;
  assert.ok(penalties(p).includes("cryosickness"));
});

test("hazard Damage: Health, then a Wound with the carryover", () => {
  const p = pc("Teamster", [], { wounds: { current: 0, max: 2 } });
  assert.equal(hazardDamage(p, 5, "fire").wound, false);
  assert.equal(p.health.current, 7);
  const hit = hazardDamage(p, 10, "fire");
  assert.equal(hit.wound, true);
  assert.equal(p.wounds.current, 1);
  assert.equal(p.health.current, 12 - 3);
  assert.equal(hazardDamage(p, 99, "fire").atMax, true);
});

test("story hazards are labelled and use the generic rule", () => {
  for (const [k, h] of Object.entries(HAZARDS)) {
    assert.ok(h.name && h.rule && h.source && ["psg", "story"].includes(h.kind), k);
    if (h.kind === "story") assert.equal(h.source, "story hazard", k);
  }
  const p = pc("Teamster", []);
  const [n] = eventNeeds(p, { type: "machinery", level: 2 }, fixed(5));
  assert.equal(n.check, "speed");
  assert.equal(n.dmg, 10);
  assert.equal(settle(p, n, loss).damage, 10);
  assert.equal(eventNeeds(p, { type: "entanglement" })[0].advantage, "disadvantage");
  assert.equal(settle(p, eventNeeds(p, { type: "infohazard" })[0], loss).stress, 1);
});

test("hull breach: Body Save or 1 Wound; a Critical Failure is sucked into space", () => {
  const p = pc("Teamster", []);
  const [n] = eventNeeds(p, { type: "breach" });
  assert.equal(settle(p, n, win).wounds, 0);
  assert.equal(settle(p, n, loss).wounds, 1);
  assert.equal(p.cond.spaced, false);
  settle(p, n, { success: false, critical: true });
  assert.equal(p.cond.spaced, true);
});

test("hazards on a station are normalised", () => {
  const hz = normalizeHazards({ Cargo_Spine: { type: "radiation", level: "9" }, nowhere: { type: "bogus" }, bay: { type: "vacuum", level: 5 } });
  assert.equal(hz.cargo_spine.level, 3);
  assert.equal(hz.nowhere, undefined);
  assert.equal(hz.bay.level, null);
});

test("every hazard a campaign story lists is known", () => {
  for (const c of CAMPAIGNS) for (const s of c.stories) for (const h of s.hazards) assert.ok(HAZARDS[h], `${s.id}: ${h}`);
});

function session() {
  Session.prototype.usesNeural = () => false;
  const s = new Session({ code: "TEST", tokenHash: "x", game: {} }, { onChange() {}, onEnd() {} });
  s.touch = () => {};
  s.syncDm = () => {};
  s.toPlayers = () => {};
  s.send = () => {};
  return s;
}
const screen = (s, pcId, termId) => s.sockets.add({ role: "player", character: pcId, terminal: termId, send() {} });

test("a room's vacuum reaches only the characters at terminals in it; Next round runs it", () => {
  const s = session();
  s.state.config.terminals = [{ id: "t1", name: "A", room: "cargo_spine" }, { id: "t2", name: "B", room: "cab" }];
  const [a, b] = s.state.config.crew;
  screen(s, a.id, "t1");
  screen(s, b.id, "t2");
  a.items = ["Standard crew attire"]; a.armor = armorFrom(a.items);
  s.setHazard("cargo_spine", "vacuum");
  assert.equal(s.state.station.hazards.cargo_spine.type, "vacuum");
  s.advanceRound();
  s.advanceRound();
  assert.equal(a.cond.out, true);
  assert.equal(b.cond.out, false);
  s.setHazard("cargo_spine", "none");
  assert.equal(s.state.station.hazards, undefined);
});

test("a suited character takes nothing from vacuum, and Retcon-style snapshots keep the condition", () => {
  const s = session();
  s.state.config.terminals = [{ id: "t1", name: "A", room: "cargo_spine" }];
  const [a] = s.state.config.crew;
  a.items = ["Vaccsuit"]; a.armor = armorFrom(a.items);
  screen(s, a.id, "t1");
  s.setHazard("cargo_spine", "vacuum");
  s.advanceRound();
  s.advanceRound();
  assert.equal(a.cond.out, false);
  assert.ok(a.cond.air > 0);
});

test("Pass time: cold asks the exposed character for a Body Save each hour; the roll settles it", () => {
  const s = session();
  s.state.config.terminals = [{ id: "t1", name: "A", room: "hold" }];
  const [a] = s.state.config.crew;
  a.items = []; a.armor = armorFrom(a.items);
  screen(s, a.id, "t1");
  s.setHazard("hold", "cold");
  s.passTime(2);
  assert.equal(s.state.roll.status, "waiting");
  assert.equal(s.state.roll.check, "body");
  assert.deepEqual(s.state.roll.pcs.map((p) => p.id), [a.id]);
  s.rollAllHazard();
  assert.equal(s.hazardWork(), 0);
  assert.equal(s.state.station.hazards.hold.hours, 2);
});

test("Restart story clears hazards and conditions", () => {
  const s = session();
  s.setHazard("hold", "radiation", 2);
  s.state.config.crew[0].cond.rad = 5;
  s.restartStory();
  assert.equal(s.state.station.hazards, undefined);
  assert.equal(s.state.config.crew[0].cond.rad, 0);
});

test("an agent reply starts a hazard, and Retcon undoes it with the crew conditions", () => {
  const s = session();
  s.initPlayers = () => {};
  s.state.config.terminals = [{ id: "t1", name: "A", room: "hold" }];
  const [a] = s.state.config.crew;
  a.items = []; a.armor = armorFrom(a.items);
  screen(s, a.id, "t1");
  s.deliver({ lines: [], hazards: [{ room: "hold", type: "radiation", level: 2 }], time_passes: { hours: 0 } }, "agent");
  assert.equal(s.state.station.hazards.hold.level, 2);
  s.advanceRound();
  assert.equal(a.cond.rad, 1);
  s.retcon();
  assert.equal(a.cond.rad, 0);
  assert.equal(s.state.station.hazards, undefined);
});

test("Android-close [-] and condition [-] combine once, per character, with every reason shown", () => {
  const s = session();
  s.state.config.terminals = [{ id: "t1", name: "A", room: "hold" }];
  const [a, , android] = s.state.config.crew;
  screen(s, a.id, "t1");
  screen(s, android.id, "t1");
  a.cond.cryo = 100;
  a.cond.rad = 2;
  s.handleDm({ t: "rollRequest", roll: { pc: "all", check: "fear", advantage: "advantage" } });
  const mine = s.publicRoll().pcs.find((p) => p.id === a.id);
  assert.equal(mine.advantage, "none");
  assert.deepEqual(mine.why, ["an Android is close", "cryosickness"]);
  s.state.roll.advantage = "none";
  assert.equal(s.publicRoll().pcs.find((p) => p.id === a.id).advantage, "disadvantage");
  s.rollFor(a, [10, 80]);
  assert.equal(s.state.roll.results[a.id].result.target, a.saves.fear - 2);
});
