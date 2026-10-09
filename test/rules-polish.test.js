import { test } from "node:test";
import assert from "node:assert/strict";
import { Session } from "../session.js";
import { sanitizeCrew, applyDamage, gainWound, newCond } from "../crew.js";
import { sanitizeStats } from "../combat.js";
import { weaponByName, weaponDamage, checkAdvantage } from "../weapons.js";
import { HAZARDS, hazardTag, hazardBrief, protection, roundTick, settle, conditionText, hazardDamage } from "../hazards.js";
import { PANIC_TABLE, panicEntry } from "../cast.js";
import { parseReply } from "../agent.js";

const seq = (...vals) => { let i = 0; return () => vals[Math.min(i++, vals.length - 1)]; };
const fixed = (n) => () => n;
const person = (className, items, extra = {}) => sanitizeCrew([{ name: "Test", className, items, health: { current: 12, max: 12 }, ...extra }])[0];

function game(placement) {
  Session.prototype.usesNeural = () => false;
  const s = new Session({ code: "TESTPOLISH" }, { onChange() {}, onEnd() {} });
  s.touch = () => {};
  s.syncDm = () => {};
  for (const [character, terminal] of Object.entries(placement)) s.sockets.add({ role: "player", character, terminal, readyState: 1, send() {} });
  return s;
}
const call = (s, roll) => s.handleDm({ t: "rollRequest", roll });
const texts = (s) => s.state.log.map((e) => e.text);
const adversary = (s, attacks = [], extra = {}) => {
  s.state.config.voices.push({ id: "dummy", name: "Dummy", adversary: { revealed: true, stats: sanitizeStats({ combat: 99, instinct: 30, woundsMax: 20, healthPerWound: 999, attacks, ...extra }) } });
  return s.state.config.voices.at(-1);
};

// ---- Ticket 22

test("a creature's attack can be Anti-Armor: it keeps the aa flag and destroys armor that would have ignored it", () => {
  const stats = sanitizeStats({ combat: 99, instinct: 30, woundsMax: 1, healthPerWound: 10, attacks: [{ name: "Rend", damage: "1d1", woundType: "gore", aa: true }, { name: "Claw", damage: "1d1", woundType: "gore" }] });
  assert.deepEqual(stats.attacks.map((a) => a.aa), [true, false]);
  const s = game({ rusk: "airlock" });
  const rusk = s.crewById("rusk");
  rusk.armor = { name: "Standard Battle Dress", ap: 7, dr: 0, destroyed: false };
  rusk.health.current = rusk.health.max = 50;
  adversary(s, stats.attacks);
  for (let i = 0; i < 60 && !rusk.armor.destroyed; i++) s.creatureAttack({ by: "Dummy", attack: "Rend", target: "Rusk" });
  assert.equal(rusk.armor.destroyed, true, "AA ignores and destroys armor on a hit");
  assert.ok(texts(s).some((t) => /ANTI-ARMOR/.test(t) && /DESTROYED/.test(t)));
  assert.equal(rusk.health.current, 49, "1 damage went through");
  const plain = person("Marine", ["Standard Battle Dress"]);
  applyDamage(plain, 1);
  assert.equal(plain.armor.destroyed, false, "the same damage without AA is ignored");
});

test("a creature's DR-free Anti-Armor hit still applies DR first (PSG 28.3)", () => {
  const p = person("Marine", ["Advanced Battle Dress"]);
  const r = applyDamage(p, 5, { aa: true });
  assert.equal(r.dr, 3);
  assert.equal(r.dealt, 2);
  assert.equal(r.armorDestroyed, true);
});

test("the Combat Shotgun does 1d10 at Long Range or further and 4d10 nearer or unstated", () => {
  const gun = weaponByName("Combat Shotgun");
  for (const [range, dmg] of [["", "4d10"], ["adjacent", "4d10"], ["close", "4d10"], ["long", "1d10"], ["extreme", "1d10"]]) assert.equal(weaponDamage(gun, 40, range), dmg, range);
  assert.equal(weaponDamage(weaponByName("Pulse Rifle"), 40, "extreme"), "3d10");
  const s = game({ rusk: "airlock" });
  const rusk = s.crewById("rusk");
  rusk.items = ["Combat shotgun", "Ammo (combat shotgun)"];
  rusk.ammo = {};
  adversary(s);
  s.crewAttack({ pc: rusk, weapon: "Combat Shotgun", target: "Dummy", range: "long" });
  assert.match(texts(s).find((t) => /HITS DUMMY/.test(t)), /AT LONG RANGE \(1D10 AT LONG RANGE OR FURTHER\)\n1d10: /);
  s.crewAttack({ pc: rusk, weapon: "Combat Shotgun", target: "Dummy", range: "close" });
  assert.match(texts(s).findLast((t) => /HITS DUMMY/.test(t)), /AT CLOSE RANGE\n4d10: /);
});

test("the agent's crew_attacks carry a range, and the range of the Combat roll is used when it gives none", () => {
  const r = parseReply(JSON.stringify({ lines: [], crew_attacks: [{ by: "Rusk", weapon: "Combat Shotgun", target: "Dummy", range: "Extreme" }, { by: "Rusk", weapon: "Revolver", target: "Dummy", range: "far away" }] }), []);
  assert.deepEqual(r.crew_attacks.map((a) => a.range), ["extreme", ""]);
  const s = game({ rusk: "airlock" });
  const rusk = s.crewById("rusk");
  rusk.items = ["Combat shotgun", "Ammo (combat shotgun)"];
  rusk.ammo = {};
  rusk.stats.combat = 80;
  adversary(s);
  call(s, { pc: "rusk", check: "combat", weapon: "Combat Shotgun", range: "long" });
  s.rollFor(rusk, [10]);
  s.applyAttacks({ crew_attacks: [{ by: "Rusk", weapon: "Combat Shotgun", target: "Dummy", range: "" }] });
  assert.match(texts(s).find((t) => /HITS DUMMY/.test(t)), /1D10 AT LONG RANGE OR FURTHER/);
});

test("a Smart Rifle at Close Range has [-] on the Combat check, and only there", () => {
  const rifle = weaponByName("Smart Rifle");
  assert.equal(checkAdvantage(rifle, "close"), "-");
  assert.equal(checkAdvantage(rifle, "long"), "");
  assert.equal(checkAdvantage(weaponByName("Pulse Rifle"), "close"), "");
  assert.equal(rifle.aa, true);
  const s = game({ rusk: "airlock", moll: "airlock" });
  const rusk = s.crewById("rusk");
  rusk.items = ["Smart Rifle"];
  call(s, { pc: "rusk", check: "combat", weapon: "Smart Rifle", range: "close" });
  let mine = s.publicRoll().pcs[0];
  assert.equal(mine.advantage, "disadvantage");
  assert.ok(mine.why.some((w) => /Smart Rifle at Close Range \(\[-\]\)/.test(w)));
  s.state.roll = null;
  call(s, { pc: "rusk", check: "combat", weapon: "Smart Rifle", range: "long" });
  mine = s.publicRoll().pcs[0];
  assert.equal(mine.advantage, "none");
  s.state.roll = null;
  call(s, { pc: "rusk", check: "combat", weapon: "Unarmed", range: "close" });
  assert.equal(s.publicRoll().pcs[0].advantage, "none");
  s.state.roll = null;
  call(s, { pc: "all", check: "combat", weapon: "Smart Rifle", range: "close" });
  assert.equal(s.state.roll.range, undefined, "a roll for everyone names no weapon");
});

// ---- Ticket 23

test("Fire is labelled a house rule, not a Mothership rule", () => {
  assert.equal(HAZARDS.fire.kind, "house");
  assert.equal(hazardTag(HAZARDS.fire), "house rule");
  assert.equal(hazardTag(HAZARDS.vacuum), "Mothership rule");
  assert.equal(hazardTag(HAZARDS.darkness), "story hazard");
  const line = hazardBrief({ hazards: { lab: { type: "fire", level: null } } }, []).lines[0];
  assert.match(line, /\(house rule\)/);
  assert.doesNotMatch(line, /Mothership rule/);
  const s = game({});
  s.state.station ||= {};
  s.setHazard("lab", "fire");
  assert.ok(texts(s).some((t) => /Fire.*\(house rule\)/.test(t)));
});

test("a room fire asks for a Body Save [-]; only a failure sets the character on fire", () => {
  const p = person("Teamster", ["Crowbar"]);
  const res = roundTick(p, [{ type: "fire" }], fixed(5));
  assert.equal(p.cond.fire, false, "nobody catches fire without the save");
  assert.equal(res.damage.length, 0);
  assert.equal(res.needs.length, 1);
  assert.deepEqual([res.needs[0].kind, res.needs[0].check, res.needs[0].advantage], ["fire", "body", "disadvantage"]);
  assert.match(res.needs[0].reason, /HOUSE RULE/);
  settle(p, res.needs[0], { success: true, critical: false });
  assert.equal(p.cond.fire, false);
  const out = settle(p, res.needs[0], { success: false, critical: false });
  assert.equal(p.cond.fire, true);
  assert.match(out.text, /set on fire/);
  const next = roundTick(p, [{ type: "fire" }], fixed(5));
  assert.equal(next.needs.length, 0, "already burning: no more saves");
  assert.deepEqual(next.damage.map((d) => [d.n, d.type, d.armor]), [[10, "fire", true]]);
});

test("burning damage goes through armor and DR like any damage; Bleeding is the only thing the Guide lets skip them", () => {
  const p = person("Marine", ["Vaccsuit"]);
  const r = hazardDamage(p, 8, "fire", { direct: false });
  assert.equal(r.result.armorDestroyed, true);
  assert.equal(r.result.dealt, 5);
  const q = person("Marine", ["Vaccsuit"]);
  assert.equal(hazardDamage(q, 2, "fire", { direct: false }).result.armorIgnored, true);
});

test("a Body on fire Wound burns at 3d10 a round, a Limb on fire at 2d10", () => {
  const p = person("Marine", ["Crowbar"]);
  const w = gainWound(p, "fire", { rng: seq(8) });
  assert.equal(w.roll, 8);
  assert.equal(p.cond.fire, true);
  assert.equal(p.cond.burn, 3);
  assert.match(conditionText(p).join("|"), /ON FIRE: 3d10 Damage per round/);
  assert.equal(roundTick(p, [], fixed(2)).damage[0].n, 6);
  const q = person("Marine", ["Crowbar"]);
  gainWound(q, "fire", { rng: seq(7) });
  assert.equal(q.cond.burn, 2);
  assert.equal(roundTick(q, [], fixed(2)).damage[0].n, 4);
  gainWound(q, "fire", { rng: seq(8) });
  assert.equal(q.cond.burn, 3, "a worse burn replaces a lesser one");
});

// ---- Ticket 24

test("only the armor on their back seals them in: a suit in the pack protects nothing", () => {
  const mensah = person("Marine", ["Vaccsuit", "Crowbar"]);
  mensah.armor = { name: "Standard Battle Dress", ap: 7, dr: 0, destroyed: false };
  for (const type of ["vacuum", "radiation", "temperature", "toxic", "oxygen"]) assert.equal(protection(mensah, type), "", type);
  const air = { type: "vacuum" };
  roundTick(mensah, [air], fixed(1));
  roundTick(mensah, [air], fixed(1));
  assert.equal(mensah.cond.out, true, "unconscious at 20 s");
  assert.ok(!conditionText(mensah).some((t) => /OWN AIR/.test(t)));
  mensah.armor = { name: "Vaccsuit", ap: 3, dr: 0, destroyed: false };
  assert.equal(protection(mensah, "vacuum"), "vaccsuit");
  assert.equal(protection(mensah, "radiation"), "vaccsuit");
  mensah.armor.destroyed = true;
  assert.equal(protection(mensah, "vacuum"), "", "a destroyed suit protects nothing while its item is still carried");
  assert.equal(protection(mensah, "radiation"), "");
});

test("a worn hazard suit still protects against cold; a carried oxygen tank is gear, not a suit", () => {
  const p = person("Teamster", ["Hazard suit"]);
  assert.equal(protection(p, "temperature"), "hazard suit");
  const q = person("Teamster", ["Hazard suit", "Oxygen tank"]);
  q.armor = { name: "Standard Crew Attire", ap: 1, dr: 0, destroyed: false };
  assert.equal(protection(q, "temperature"), "");
  assert.equal(protection(q, "vacuum"), "", "a tank does not protect from vacuum");
  assert.equal(protection(q, "toxic"), "oxygen tank");
});

test("an Android in vacuum is not shown 'OWN AIR USED UP'", () => {
  const droid = person("Android", ["Standard crew attire"]);
  const air = { type: "vacuum" };
  for (let i = 0; i < 3; i++) roundTick(droid, [air], fixed(1));
  assert.equal(droid.cond.out, false, "androids need no oxygen");
  assert.ok(droid.cond.air > 0);
  assert.ok(!conditionText(droid).some((t) => /OWN AIR/.test(t)));
  const human = person("Marine", ["Standard crew attire"]);
  human.cond.air = 100;
  assert.ok(conditionText(human).some((t) => /OWN AIR USED UP/.test(t)));
});

// ---- Ticket 25

const panic = (s, id, roll) => {
  s.state.roll = null;
  call(s, { pc: id, check: "panic" });
  s.rollFor(s.crewById(id), [roll]);
};

test("Nervous adds 1 Stress and nothing else; the failed Panic Check adds none of its own", () => {
  const s = game({ rusk: "airlock", moll: "airlock" });
  const rusk = s.crewById("rusk");
  rusk.stress = 10;
  panic(s, "rusk", 2);
  assert.equal(rusk.stress, 11);
  assert.equal(s.crewById("moll").stress, 2);
});

test("Jumpy: +1 Stress, and every Close crewmember +2", () => {
  const s = game({ rusk: "airlock", moll: "airlock", varga: "medbay" });
  const rusk = s.crewById("rusk");
  rusk.stress = 10;
  panic(s, "rusk", 3);
  assert.equal(rusk.stress, 11);
  assert.equal(s.crewById("moll").stress, 4);
  assert.equal(s.crewById("varga").stress, 2, "not Close");
});

test("Rage: every crewmember gains 1 Stress", () => {
  const s = game({ rusk: "airlock", moll: "airlock", varga: "medbay" });
  const rusk = s.crewById("rusk");
  rusk.stress = 17;
  const before = Object.fromEntries(s.state.config.crew.map((c) => [c.id, c.stress]));
  panic(s, "rusk", 16);
  for (const c of s.state.config.crew) assert.equal(c.stress, before[c.id] + 1, c.name);
});

test("Adrenaline Rush and Catatonic lower Stress, never below Minimum Stress", () => {
  const s = game({ rusk: "airlock" });
  const rusk = s.crewById("rusk");
  rusk.stress = 10;
  panic(s, "rusk", 1);
  assert.ok(rusk.stress < 10 && rusk.stress >= 5, `1d5 off 10 is 5-9, got ${rusk.stress}`);
  rusk.stress = 16;
  rusk.minStress = 16;
  panic(s, "rusk", 15);
  assert.equal(rusk.stress, 16);
  assert.ok(texts(s).some((t) => /never goes below Minimum Stress 16/.test(t)));
});

test("Heart Attack / Short Circuit: Maximum Wounds -1 and Minimum Stress +1", () => {
  const s = game({ rusk: "airlock" });
  const rusk = s.crewById("rusk");
  rusk.stress = 19;
  rusk.wounds.max = 3;
  const min = rusk.minStress ?? 2;
  panic(s, "rusk", 19);
  assert.equal(rusk.wounds.max, 2);
  assert.equal(rusk.minStress, min + 1);
  assert.equal(s.state.deathSaves?.[rusk.id], undefined);
  rusk.wounds.current = 2;
  panic(s, "rusk", 19);
  assert.equal(rusk.wounds.max, 1);
  assert.notEqual(s.state.deathSaves?.[rusk.id], undefined, "at Maximum Wounds: a Death Save");
  panic(s, "rusk", 19);
  assert.equal(rusk.wounds.max, 1, "never below 1");
});

test("Retire sets the character to Retired so their player rolls up a new one", () => {
  const s = game({ rusk: "airlock", moll: "airlock" });
  const rusk = s.crewById("rusk");
  rusk.stress = 20;
  panic(s, "rusk", 20);
  assert.equal(rusk.retired, true);
  assert.ok(texts(s).some((t) => /Rusk retires.*rolls up a new character/.test(t)));
  assert.equal(s.crewById("moll").retired, false);
});

test("Compounding Problems applies the effects of both of its rolls", () => {
  const real = Math.random;
  Math.random = seq(0.1, 0.7); // 3 then 15
  try {
    const e = panicEntry(18);
    assert.deepEqual(e.fx, { stress: 1, close: 2, drop: ["1d10"] });
    assert.equal(e.minStress, 1);
  } finally {
    Math.random = real;
  }
  assert.deepEqual(panicEntry(2).fx, { stress: 1 });
  assert.deepEqual(panicEntry(4).fx, {});
  assert.ok(PANIC_TABLE[16].effect.includes("every crewmember gains 1 Stress"));
});

test("Stress above 20 lowers the Stat or Save of the check that failed, by the excess", () => {
  const s = game({ rusk: "airlock" });
  const rusk = s.crewById("rusk");
  rusk.stress = 20;
  const was = rusk.stats.combat;
  call(s, { pc: "rusk", check: "combat" });
  s.rollFor(rusk, [97]);
  assert.equal(rusk.stress, 20);
  assert.equal(rusk.stats.combat, was - 1);
  assert.ok(texts(s).some((t) => /Stress over 20 by 1, so Combat/.test(t)));
  s.state.roll = null;
  const body = rusk.saves.body;
  call(s, { pc: "rusk", check: "body" });
  s.rollFor(rusk, [95]);
  assert.equal(rusk.saves.body, body - 1);
});
