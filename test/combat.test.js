import { test } from "node:test";
import assert from "node:assert/strict";
import { applyDamage, applyDeathSave, gainWound, deathSaveCountdown, sanitizeCrew, newCond, DEFAULT_CREW } from "../crew.js";
import { roundTick, hazardDamage, hazardWound } from "../hazards.js";
import { mitigate, damageAdversary, sanitizeStats, deathSaveOutcome } from "../combat.js";
import { rollWound, WOUNDS } from "../wounds.js";
import { weaponsOf, weaponDamage, UNARMED, armorFrom } from "../weapons.js";
import { CAMPAIGNS, composeDraft } from "../campaign.js";
import { normalizeDraft, applyDraft } from "../builder.js";

const seq = (...vals) => { let i = 0; return () => vals[Math.min(i++, vals.length - 1)]; };
const pc = (over = {}) => ({
  id: "t", name: "Test", health: { current: 15, max: 15 }, wounds: { current: 0, max: 2 }, stress: 2,
  stats: { strength: 40, speed: 30, intellect: 30, combat: 30 }, saves: { sanity: 30, fear: 30, body: 30 },
  armor: { name: "Vaccsuit", ap: 3, dr: 0, destroyed: false }, cond: newCond(), ...over,
});

test("armor: damage under AP is ignored and the armor stays", () => {
  const p = pc();
  const r = applyDamage(p, 2);
  assert.equal(r.dealt, 0);
  assert.equal(r.armorIgnored, true);
  assert.equal(p.armor.destroyed, false);
  assert.equal(p.health.current, 15);
});

test("armor: damage equal to AP destroys it and nothing goes through", () => {
  const p = pc();
  const r = applyDamage(p, 3);
  assert.equal(r.dealt, 0);
  assert.equal(r.armorDestroyed, true);
  assert.equal(p.armor.destroyed, true);
  assert.equal(p.health.current, 15);
});

test("armor: damage 10 against AP 3 destroys it and 7 goes through", () => {
  const p = pc();
  const r = applyDamage(p, 10);
  assert.equal(r.dealt, 7);
  assert.equal(p.armor.destroyed, true);
  assert.equal(p.health.current, 8);
});

test("armor: destroyed armor protects nothing", () => {
  const p = pc({ armor: { name: "Vaccsuit", ap: 3, dr: 0, destroyed: true } });
  assert.equal(applyDamage(p, 2).dealt, 2);
});

test("Anti-Armor ignores and destroys armor", () => {
  assert.deepEqual(mitigate(5, { ap: 7, aa: true }), { raw: 5, dr: 0, afterDr: 5, through: 5, armorDestroyed: true, armorIgnored: false });
  const p = pc({ armor: { name: "Standard Battle Dress", ap: 7, dr: 0, destroyed: false } });
  const r = applyDamage(p, 5, { aa: true });
  assert.equal(r.dealt, 5);
  assert.equal(p.armor.destroyed, true);
});

test("DR applies first: 12 damage, DR 3, AP 10 is 9, under AP, ignored", () => {
  const p = pc({ armor: { name: "Advanced Battle Dress", ap: 10, dr: 3, destroyed: false } });
  const r = applyDamage(p, 12);
  assert.equal(r.dealt, 0);
  assert.equal(r.armorIgnored, true);
  assert.equal(p.armor.destroyed, false);
});

test("DR still applies with destroyed armor and against Anti-Armor", () => {
  const p = pc({ armor: { name: "Advanced Battle Dress", ap: 10, dr: 3, destroyed: true } });
  assert.equal(applyDamage(p, 12).dealt, 9);
  assert.equal(applyDamage(pc({ armor: { name: "ABD", ap: 10, dr: 3, destroyed: false } }), 12, { aa: true }).dealt, 9);
});

test("carryover: Health 5/15, 8 damage is one Wound and Health 12/15", () => {
  const p = pc({ armor: { name: "Crew Attire", ap: 0, dr: 0, destroyed: false }, health: { current: 5, max: 15 }, wounds: { current: 0, max: 3 } });
  const r = applyDamage(p, 8, { rng: seq(4) });
  assert.equal(r.wounds.length, 1);
  assert.equal(p.wounds.current, 1);
  assert.equal(p.health.current, 12);
  assert.equal(r.wounds[0].carryover, 3);
});

test("a big hit can cause two Wounds", () => {
  const p = pc({ armor: { name: "Crew Attire", ap: 0, dr: 0, destroyed: false }, health: { current: 5, max: 15 }, wounds: { current: 0, max: 3 } });
  const r = applyDamage(p, 22, { rng: seq(1, 1) });
  assert.equal(r.wounds.length, 2);
  assert.equal(p.wounds.current, 2);
  assert.equal(p.health.current, 13);
  assert.equal(r.deathSave, false);
});

test("reaching Max Wounds asks for a Death Save", () => {
  const p = pc({ armor: { name: "Crew Attire", ap: 0, dr: 0, destroyed: false }, health: { current: 5, max: 15 }, wounds: { current: 1, max: 2 } });
  const r = applyDamage(p, 8, { rng: seq(1) });
  assert.equal(p.wounds.current, 2);
  assert.equal(r.deathSave, true);
  assert.equal(p.health.current, 12);
});

test("Wounds Table effects are applied: bleeding, and a dead result skips the Death Save", () => {
  const base = { armor: { name: "Crew Attire", ap: 0, dr: 0, destroyed: false }, health: { current: 3, max: 15 }, wounds: { current: 0, max: 3 } };
  const a = pc(structuredClone(base));
  applyDamage(a, 4, { type: "bleeding", rng: seq(4) });
  assert.equal(a.cond.bleeding, 2);
  const b = pc(structuredClone(base));
  const r = applyDamage(b, 4, { type: "gore", rng: seq(9) });
  assert.ok(b.cond.dead);
  assert.equal(r.dead, true);
  assert.equal(r.deathSave, false);
});

test("Lethal Injuries set a Death Save countdown, Strength loss is rolled", () => {
  const p = pc({ armor: { name: "Crew Attire", ap: 0, dr: 0, destroyed: false }, health: { current: 3, max: 15 }, wounds: { current: 0, max: 3 } });
  applyDamage(p, 4, { type: "blunt", rng: seq(7, 4) });
  assert.equal(p.deathSaveIn, 4);
  const q = pc({ armor: { name: "Crew Attire", ap: 0, dr: 0, destroyed: false }, health: { current: 3, max: 15 }, wounds: { current: 0, max: 3 } });
  applyDamage(q, 4, { type: "fire", rng: seq(4, 6) });
  assert.equal(q.stats.strength, 34);
});

test("bleeding ticks each round and ignores armor and DR", () => {
  const p = pc({ armor: { name: "Advanced Battle Dress", ap: 10, dr: 3, destroyed: false } });
  p.cond.bleeding = 2;
  for (const d of roundTick(p, []).damage) hazardDamage(p, d.n, d.type);
  assert.equal(p.health.current, 13);
  assert.equal(p.armor.destroyed, false);
  for (const d of roundTick(p, []).damage) hazardDamage(p, d.n, d.type);
  assert.equal(p.health.current, 11);
});

test("unarmed damage is Strength / 10, rounded down", () => {
  assert.equal(weaponDamage(UNARMED, 38), "3");
  assert.equal(weaponDamage(UNARMED, 42), "4");
  assert.equal(weaponDamage(UNARMED, 9), "0");
});

test("weapons are matched from item names", () => {
  const names = weaponsOf(["Combat shotgun (registered to MARY)", "Heavy crowbar", "Torch"]).map((w) => w.name);
  assert.deepEqual(names, ["Combat Shotgun", "Crowbar", "Unarmed"]);
  assert.equal(weaponDamage(weaponsOf(["Combat shotgun"])[0], 30, "long"), "1d10");
});

test("armor defaults from items: the best one, else crew attire", () => {
  assert.equal(armorFrom(["Vaccsuit", "Hazard suit"]).ap, 5);
  assert.equal(armorFrom(["Work fatigues"]).name, "Standard Crew Attire");
  assert.equal(armorFrom(["Advanced Battle Dress"]).dr, 3);
  for (const c of sanitizeCrew(structuredClone(DEFAULT_CREW))) assert.ok(c.armor.ap >= 1, c.name);
});

test("a weapon's [+] on the wound type keeps the higher row, [-] the lower", () => {
  assert.equal(rollWound("gunshot", "+", seq(2, 8)).roll, 8);
  assert.equal(rollWound("gunshot", "+", seq(8, 2)).roll, 8);
  assert.equal(rollWound("gunshot", "-", seq(2, 8)).roll, 2);
  assert.equal(rollWound("gunshot", "", seq(5, 9)).roll, 5);
});

test("the Wounds Table has ten rows in each of five columns", () => {
  for (const col of Object.values(WOUNDS)) assert.equal(col.length, 10);
  assert.equal(rollWound("gore", "", seq(9)).dead, true);
  assert.equal(rollWound("blunt", "", seq(9)).deathSave, true);
});

test("Death Save outcomes (PSG 29.2)", () => {
  assert.equal(deathSaveOutcome(0).kind, "unconscious");
  assert.equal(deathSaveOutcome(1).kind, "dying");
  assert.equal(deathSaveOutcome(2).kind, "dying");
  assert.equal(deathSaveOutcome(3).kind, "comatose");
  assert.equal(deathSaveOutcome(4).kind, "comatose");
  for (const n of [5, 7, 9]) assert.equal(deathSaveOutcome(n).kind, "dead");
  const p = pc();
  applyDeathSave(p, 6);
  assert.ok(p.cond.dead);
  const q = pc();
  applyDeathSave(q, 0, seq(5, 2));
  assert.equal(q.status, "unconscious");
});

test("an adversary loses a Wound at 0 Health and Health resets with carryover", () => {
  const s = sanitizeStats({ combat: 40, instinct: 40, woundsMax: 3, healthPerWound: 20, attacks: [] });
  const r = damageAdversary(s, 24);
  assert.equal(r.woundsLost, 1);
  assert.equal(s.wounds, 2);
  assert.equal(s.health, 16);
  assert.equal(s.dead, undefined);
  damageAdversary(s, 16 + 20 + 20);
  assert.equal(s.wounds, 0);
  assert.equal(s.dead, true);
});

test("adversary AP and DR use the same rules, Anti-Armor destroys its armor", () => {
  const s = sanitizeStats({ combat: 40, instinct: 40, ap: 5, dr: 1, woundsMax: 1, healthPerWound: 30, attacks: [] });
  assert.equal(damageAdversary(s, 5).dealt, 0);
  assert.equal(s.armorDestroyed, undefined);
  assert.equal(damageAdversary(s, 8).dealt, 2);
  assert.equal(s.armorDestroyed, true);
  const t = sanitizeStats({ combat: 40, instinct: 40, ap: 9, woundsMax: 1, healthPerWound: 30, attacks: [] });
  assert.equal(damageAdversary(t, 6, { aa: true }).dealt, 6);
  assert.equal(t.armorDestroyed, true);
});

for (const c of CAMPAIGNS) {
  test(`${c.title}: every adversary has combat numbers that reach its voice`, () => {
    for (const s of c.stories) {
      const stats = sanitizeStats(structuredClone({ ...s.adversary.combat }));
      assert.ok(stats, `${s.id}: combat`);
      assert.ok(stats.combat >= 24 && stats.instinct >= 24, `${s.id}: numbers`);
      assert.ok(stats.woundsMax >= 1 && stats.woundsMax <= 4, `${s.id}: wounds`);
      assert.ok(stats.special, `${s.id}: special`);
      for (const a of stats.attacks) assert.ok(/^\d?d\d+(\+\d+)?$/.test(a.damage), `${s.id}: ${a.name} damage`);
      const draft = normalizeDraft(composeDraft(c, s, { cast: {} }, {}));
      assert.deepEqual(draft.adversaries[0].stats, stats, `${s.id}: draft`);
      const built = applyDraft(draft);
      assert.deepEqual(built.config.voices.find((v) => v.adversary).adversary.stats, stats, `${s.id}: voice`);
    }
  });
}

test("one pipeline: hazard damage ignores armor, rolls the Wounds Table and carries over", () => {
  const p = pc({ health: { current: 5, max: 15 }, wounds: { current: 0, max: 3 } });
  const r = hazardDamage(p, 8, "fire", { rng: seq(4) });
  assert.equal(r.result.dealt, 8);
  assert.equal(p.armor.destroyed, false);
  assert.equal(r.result.wounds[0].roll, 4);
  assert.equal(p.health.current, 12);
  const toxic = hazardDamage(pc({ health: { current: 2, max: 15 } }), 5, "toxic");
  assert.equal(toxic.result.wounds[0].roll, null);
  const w = hazardWound(p, "fire", { rng: seq(3) });
  assert.equal(w.wound.roll, 3);
  assert.equal(p.wounds.current, 2);
});

test("a Lethal Injury countdown falls due after its rounds, dying is a cond counter", () => {
  const p = pc({ deathSaveIn: 2 });
  assert.equal(deathSaveCountdown(p), false);
  assert.equal(deathSaveCountdown(p), true);
  const q = pc();
  applyDeathSave(q, 1, seq(3));
  assert.equal(q.cond.dying, 3);
});
