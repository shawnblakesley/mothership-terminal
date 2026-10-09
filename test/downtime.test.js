import { test } from "node:test";
import assert from "node:assert/strict";
import { RIM_HAULERS as c } from "../campaigns/rim-haulers.js";
import { newProgress, sanitizeProgress } from "../campaign.js";
import { sanitizeCrew } from "../crew.js";
import { resolve } from "../rolls.js";
import { worstSave, restAdvantage, applyRest, applyRecovery, SHORE, shoreCost, shoreDays, shoreAmount, applyShore, applyConversion, planRoll, settleRoll, treat, passDays, mirror, expiry, downtimeReady } from "../downtime.js";

const pc = (o = {}) => sanitizeCrew([{ name: "Test", className: "Teamster", stats: { strength: 40, speed: 40, intellect: 40, combat: 40 }, saves: { sanity: 30, fear: 40, body: 50 }, health: { current: 5, max: 12 }, stress: 8, minStress: 2, ...o }])[0];
// A resolved Save with a chosen roll.
const save = (d, target = 50) => resolve({ check: "body", advantage: "none", bonus: 0 }, target, [d]);
const seq = (...v) => { let i = 0; return (min, max) => Math.min(max, Math.max(min, v[i++ % v.length])); };

test("Rest Save uses the worst of the three Saves", () => {
  assert.equal(worstSave(pc()), "sanity");
  assert.equal(worstSave(pc({ saves: { sanity: 40, fear: 30, body: 50 } })), "fear");
  assert.equal(worstSave(pc({ saves: { sanity: 40, fear: 40, body: 25 } })), "body");
});

test("a rest save success reduces Stress by the ones digit: rolled 24 against worst 30 is -4", () => {
  const p = pc({ stress: 10 });
  const r = save(24, p.saves[worstSave(p)]);
  assert.equal(r.success, true);
  const out = applyRest(p, r);
  assert.equal(out.digit, 4);
  assert.equal(p.stress, 6);
});

test("a rest save never takes Stress below Minimum Stress", () => {
  const p = pc({ stress: 5, minStress: 4 });
  applyRest(p, save(29, 30));
  assert.equal(p.stress, 4);
});

test("a rest save failure is +1 Stress, and 90-99 always fails", () => {
  const p = pc({ stress: 5 });
  assert.equal(applyRest(p, save(45, 30)).ok, false);
  assert.equal(p.stress, 6);
  const q = pc({ stress: 5, saves: { sanity: 99, fear: 99, body: 99 } });
  assert.equal(applyRest(q, save(95, 99)).ok, false);
  assert.equal(q.stress, 6);
});

test("rest advantage: leisure or a crewmate's help [+], unsafe [-], Nightmares [-] automatically, and they cancel", () => {
  assert.equal(restAdvantage(pc()).advantage, "none");
  assert.equal(restAdvantage(pc(), { leisure: true }).advantage, "advantage");
  assert.equal(restAdvantage(pc(), { helped: true }).advantage, "advantage");
  assert.equal(restAdvantage(pc(), { unsafe: true }).advantage, "disadvantage");
  const bad = pc();
  bad.cond.tags = ["Nightmares"];
  assert.equal(restAdvantage(bad).advantage, "disadvantage");
  assert.equal(restAdvantage(bad, { leisure: true }).advantage, "none");
});

test("short-term recovery: a Body Save success resets Health to Maximum and Wounds stay; failure is +1 Stress", () => {
  const p = pc();
  p.wounds.current = 1;
  assert.equal(applyRecovery(p, save(10, 50)).ok, true);
  assert.equal(p.health.current, 12);
  assert.equal(p.wounds.current, 1);
  const q = pc({ stress: 4 });
  applyRecovery(q, save(60, 50));
  assert.equal(q.health.current, 5);
  assert.equal(q.stress, 5);
});

test("C-class shore leave costs 2d10 x 100cr: 200 to 2,000", () => {
  assert.equal(shoreCost("C", () => 1).total, 200);
  assert.equal(shoreCost("C", () => 10).total, 2000);
  let lo = 1e9, hi = 0;
  for (let i = 0; i < 400; i++) { const t = shoreCost("C").total; lo = Math.min(lo, t); hi = Math.max(hi, t); assert.ok(t >= 200 && t <= 2000 && t % 100 === 0); }
  assert.ok(lo < 600 && hi > 1600);
});

test("the cost table by class: B 2d10 x 1kcr, A 2d10 x 10kcr, S 2d10 x 100kcr, X 1d100 x 10kcr (a multiplied d100 reads 00 as 100)", () => {
  assert.deepEqual([shoreCost("B", () => 1).total, shoreCost("B", () => 10).total], [2000, 20000]);
  assert.deepEqual([shoreCost("A", () => 1).total, shoreCost("A", () => 10).total], [20000, 200000]);
  assert.deepEqual([shoreCost("S", () => 1).total, shoreCost("S", () => 10).total], [200000, 2000000]);
  assert.equal(shoreCost("X", () => 0).total, 1000000);
  assert.equal(shoreCost("X", () => 99).total, 990000);
  assert.equal(shoreDays(() => 10).total, 20);
  assert.equal(shoreDays(() => 1).total, 2);
});

test("the conversion amount by class: C 1d5, B 1d10, A 2d10, X 2d10 [+] (keep the higher), S all", () => {
  assert.equal(shoreAmount("C", () => 5).rolled, 5);
  assert.equal(shoreAmount("B", () => 10).rolled, 10);
  assert.equal(shoreAmount("A", () => 10).rolled, 20);
  const x = shoreAmount("X", seq(1, 2, 9, 9));
  assert.equal(x.rolled, 18);
  assert.deepEqual(x.dice, [3, 18]);
  assert.equal(shoreAmount("S").all, true);
});

test("shore leave success converts up to the rolled amount and relieves the rest down to Minimum Stress", () => {
  const p = pc({ stress: 10, minStress: 2 });
  const out = applyShore(p, save(40, 50), "C", { rolled: 3 });
  assert.equal(out.outcome, "success");
  assert.equal(out.points, 3);
  assert.equal(out.relieved, 5);
  assert.equal(p.stress, 2);
  const q = pc({ stress: 4, minStress: 2 });
  assert.equal(applyShore(q, save(40, 50), "C", { rolled: 5 }).points, 2, "no more than the Stress above Minimum");
});

test("shore leave failure converts nothing, relieves all to Minimum, then +1 for the failed Save", () => {
  const p = pc({ stress: 10, minStress: 3 });
  const out = applyShore(p, save(70, 50), "C", { rolled: 5 });
  assert.equal(out.outcome, "failure");
  assert.equal(out.points, 0);
  assert.equal(p.stress, 4);
});

test("shore leave critical failure changes nothing and requests a Panic Check", () => {
  const p = pc({ stress: 10 });
  const out = applyShore(p, save(77, 50), "C", { rolled: 5 });
  assert.equal(out.outcome, "critical failure");
  assert.equal(out.panicCheck, true);
  assert.equal(out.points, 0);
  assert.equal(p.stress, 10);
  assert.equal(save(99, 50).panicCheck, true, "the roll itself also calls the Panic Check");
});

test("shore leave critical success converts the port's maximum and relieves the rest; class S converts all", () => {
  const p = pc({ stress: 12, minStress: 2 });
  const out = applyShore(p, save(33, 50), "C", { rolled: 1 });
  assert.equal(out.outcome, "critical success");
  assert.equal(out.points, 5, "C maximum 5, not the rolled 1");
  assert.equal(out.relieved, 5);
  assert.equal(p.stress, 2);
  const q = pc({ stress: 15 });
  assert.equal(applyShore(q, save(22, 50), "B", { rolled: 1 }).points, 10);
  const s = pc({ stress: 15 });
  assert.equal(applyShore(s, save(40, 50), "S", { all: true, rolled: Infinity }).points, 13);
  assert.equal(SHORE.X.max, 20);
  assert.equal(SHORE.A.max, 20);
});

test("converted points are spread over Sanity, Fear and Body Saves, exactly", () => {
  const p = pc();
  assert.equal(applyConversion(p, 3, { sanity: 1, fear: 1 }).ok, false);
  assert.equal(applyConversion(p, 3, { sanity: 2, body: 1 }).ok, true);
  assert.deepEqual([p.saves.sanity, p.saves.fear, p.saves.body], [32, 40, 51]);
});

const afterFinish = () => {
  const p = newProgress(c, () => 5);
  p.done = [{ id: "x", outcome: "", at: 1 }];
  p.at = "halfway_house";
  return p;
};
const live = (p) => sanitizeCrew(structuredClone(p.crew));

test("shore leave at Halfway House (class C): the cost is charged from the character, refused if short, and the Save follows", () => {
  const p = afterFinish(), crew = live(p), a = crew[0];
  assert.equal(c.locations.find((l) => l.id === "halfway_house").portClass, "C");
  assert.match(planRoll(p, c, a, "shore", { safe: false }).error, /relatively safe/);
  p.crew[0].credits = 50;
  assert.match(planRoll(p, c, a, "shore", { safe: true }, () => 5).error, /costs 1,000cr/);
  assert.equal(p.crew[0].credits, 50, "nothing charged when refused");
  p.crew[0].credits = 5000;
  const plan = planRoll(p, c, a, "shore", { safe: true }, () => 5);
  assert.equal(plan.ok, true);
  assert.equal(p.crew[0].credits, 4000);
  assert.equal(plan.days, 10);
  assert.equal(plan.request.check, "sanity");
  assert.equal(plan.dt.cls, "C");
  assert.match(plan.lines[0], /1,000cr.*10 days/);
});

test("the shore leave Save spreads points through settleRoll and keeps them pending until spread", () => {
  const p = afterFinish(), crew = live(p), a = crew[0];
  a.stress = 9;
  const out = settleRoll(p, a, { kind: "shore", cls: "B", port: "X" }, save(40, 60), () => 4);
  assert.equal(out.ownStress, true);
  assert.equal(p.downtime.pending[a.id].points, 4);
  assert.equal(a.stress, a.minStress);
  assert.match(planRoll(p, c, a, "shore", { safe: true }).error, /still has Save points/);
});

test("planRoll for a rest Save picks the worst Save and its advantage; cryosleep gets none", () => {
  const p = afterFinish(), a = live(p)[0];
  const plan = planRoll(p, c, a, "rest", { unsafe: true });
  assert.equal(plan.request.check, worstSave(a));
  assert.equal(plan.request.advantage, "disadvantage");
  a.cond.cryosleep = true;
  assert.match(planRoll(p, c, a, "rest", {}).error, /cryosleep/);
});

test("the next story starts from the downtime results (campaign crew copy)", () => {
  const p = afterFinish(), a = live(p)[0];
  a.stress = 9;
  a.health.current = 3;
  applyRest(a, save(24, 30));
  applyRecovery(a, save(10, 50));
  a.cond.tags = ["[-] ALL ROLLS (until day 14)"];
  mirror(p, a);
  const q = p.crew.find((x) => x.id === a.id);
  assert.equal(q.stress, 5);
  assert.equal(q.health.current, q.health.max);
  const again = sanitizeProgress(JSON.parse(JSON.stringify(p)));
  assert.equal(again.crew[0].stress, 5);
  assert.deepEqual(again.crew[0].cond.tags, ["[-] ALL ROLLS (until day 14)"]);
  assert.ok(again.crew[0].base.saves.sanity > 0, "campaign start keeps the original stats and saves");
});

test("downtime is ready only after a story, between stories", () => {
  const p = newProgress(c, () => 5);
  const cfg = { crew: live(p) };
  assert.equal(downtimeReady(p, cfg), false, "no story finished yet");
  p.done = [{ id: "x" }];
  assert.equal(downtimeReady(p, cfg), true);
  p.current = "y";
  assert.equal(downtimeReady(p, cfg), false);
});

// ---- treatments
const rich = () => { const p = afterFinish(); p.crew[0].credits = 500000; return [p, live(p)[0]]; };
const pay = (p, a) => p.crew.find((x) => x.id === a.id).credits;

test("Medpod costs 6,000cr, heals one Wound taken and takes a week", () => {
  const [p, a] = rich();
  a.wounds.current = 2;
  const r = treat(p, a, "medpod");
  assert.equal(r.ok, true);
  assert.equal(a.wounds.current, 1);
  assert.equal(r.days, 7);
  assert.equal(pay(p, a), 494000);
  a.wounds.current = 0;
  assert.match(treat(p, a, "medpod").error, /no Wounds/);
});

test("treatments are refused when the character cannot pay", () => {
  const p = afterFinish(), a = live(p)[0];
  a.wounds.current = 1;
  p.crew[0].credits = 5999;
  assert.match(treat(p, a, "medpod").error, /costs 6,000cr/);
  assert.equal(a.wounds.current, 1);
});

test("Artificial Wellness Counselor: 150cr, +1 Sanity Save up to its original, once a week", () => {
  const [p, a] = rich();
  assert.match(treat(p, a, "counselor").error, /already at its original/);
  a.saves.sanity -= 3;
  const base = a.base?.saves.sanity ?? p.crew[0].base.saves.sanity;
  assert.equal(treat(p, a, "counselor", { rng: () => 5 }).ok, true);
  assert.equal(a.saves.sanity, base - 2);
  assert.equal(pay(p, a), 500000 - 150);
  assert.match(treat(p, a, "counselor", { rng: () => 5 }).error, /once a week/);
  passDays(p, [[a], p.crew], 7);
  assert.equal(treat(p, a, "counselor", { rng: () => 5 }).ok, true);
});

test("the 1% side effects fire only on a d100 roll of 00", () => {
  const [p, a] = rich();
  a.saves.sanity -= 5;
  const r = treat(p, a, "counselor", { rng: (lo, hi) => (hi === 99 ? 0 : lo) });
  assert.match(r.lines.join(" "), /random Condition/);
  assert.equal(a.cond.tags.length, 1);
  const [q, b] = rich();
  b.saves.sanity -= 5;
  assert.doesNotMatch(treat(q, b, "counselor", { rng: (lo, hi) => (hi === 99 ? 1 : lo) }).lines.join(" "), /Condition/);
});

test("Cognitive Defragmentation: 100kcr, removes one chosen Condition, [-] Intellect, Sanity, Fear for 4 weeks", () => {
  const [p, a] = rich();
  assert.match(treat(p, a, "defrag", { choice: "Nightmares" }).error, /no Condition/);
  a.cond.tags = ["Nightmares", "Doomed"];
  const r = treat(p, a, "defrag", { choice: "Nightmares", rng: (lo) => lo });
  assert.equal(r.ok, true);
  assert.equal(pay(p, a), 400000);
  assert.ok(!a.cond.tags.includes("Nightmares") && a.cond.tags.includes("Doomed"));
  assert.ok(a.cond.tags.some((t) => /INTELLECT, SANITY, FEAR/.test(t) && expiry(t) === 28));
});

test("Deep Tissue Nanogel Massage: 24kcr, Minimum Stress -1, [-] on all actions for 24 hours, once a week", () => {
  const [p, a] = rich();
  a.minStress = 4;
  assert.equal(treat(p, a, "nanogel").ok, true);
  assert.equal(a.minStress, 3);
  assert.equal(pay(p, a), 476000);
  assert.ok(a.cond.tags.some((t) => /ALL ACTIONS/.test(t) && expiry(t) === 1));
  assert.match(treat(p, a, "nanogel").error, /once a week/);
});

test("Immersive Slicksim Therapy: 1kcr, restores 1d10 Combat or Fear Save up to the original; the 1% sticks for 1d10 days and costs 1d5 Sanity Save", () => {
  const [p, a] = rich();
  const base = p.crew[0].base;
  a.stats.combat = base.stats.combat - 8;
  const r = treat(p, a, "slicksim", { choice: "combat", rng: (lo, hi) => (hi === 99 ? 50 : 6) });
  assert.equal(a.stats.combat, base.stats.combat - 2);
  assert.equal(pay(p, a), 499000);
  a.saves.fear = base.saves.fear - 4;
  const sanity = a.saves.sanity;
  const s = treat(p, a, "slicksim", { choice: "fear", rng: (lo, hi) => (hi === 99 ? 0 : hi === 5 ? 3 : 4) });
  assert.equal(a.saves.fear, base.saves.fear, "capped at the original");
  assert.equal(a.saves.sanity, sanity - 3);
  assert.ok(a.cond.tags.some((t) => /STUCK IN SLICKSIM/.test(t) && expiry(t) === 4));
  assert.equal(r.ok && s.ok, true);
});

test("Pseudoflesh Injection: 18kcr, 2d10 Speed, Strength or Body Save (to the original) or all Wounds; [-] 2 weeks then 4 weeks recovering", () => {
  const [p, a] = rich();
  const base = p.crew[0].base;
  a.stats.speed = base.stats.speed - 15;
  assert.equal(treat(p, a, "pseudoflesh", { choice: "speed", rng: () => 4 }).ok, true);
  assert.equal(a.stats.speed, base.stats.speed - 7, "2d10 = 8");
  assert.equal(pay(p, a), 482000);
  assert.ok(a.cond.tags.some((t) => /ALL ROLLS/.test(t) && expiry(t) === 14));
  assert.ok(a.cond.tags.some((t) => /RECOVERING/.test(t) && expiry(t) === 42));
  a.wounds.current = 2;
  assert.equal(treat(p, a, "pseudoflesh", { choice: "wounds" }).ok, true);
  assert.equal(a.wounds.current, 0);
});

test("Psychosurgery: 28kcr, Intellect, Sanity or Fear to its maximum, or Minimum Stress to 2; [-] all rolls for 4 weeks", () => {
  const [p, a] = rich();
  const base = p.crew[0].base;
  a.saves.sanity = base.saves.sanity - 9;
  assert.equal(treat(p, a, "psychosurgery", { choice: "sanity" }).ok, true);
  assert.equal(a.saves.sanity, base.saves.sanity);
  assert.equal(pay(p, a), 472000);
  assert.ok(a.cond.tags.some((t) => /ALL ROLLS/.test(t) && expiry(t) === 28));
  a.minStress = 5;
  a.stress = 6;
  assert.equal(treat(p, a, "psychosurgery", { choice: "minstress" }).ok, true);
  assert.equal(a.minStress, 2);
  a.stats.intellect = base.stats.intellect - 5;
  assert.equal(treat(p, a, "psychosurgery", { choice: "intellect" }).ok, true);
  assert.equal(a.stats.intellect, base.stats.intellect);
});

test("side effects end by themselves as days pass", () => {
  const [p, a] = rich();
  a.minStress = 4;
  treat(p, a, "nanogel");
  a.cond.tags.push("Doomed");
  const lines = passDays(p, [[a], p.crew], 1);
  assert.deepEqual(a.cond.tags, ["Doomed"]);
  assert.match(lines[0], /worn off/);
  assert.equal(p.downtime.day, 1);
});

test("an X-class shore leave cost of 00 on the d100 is 100 x 10kcr, never free", async () => {
  const { shoreCost } = await import("../downtime.js");
  const cost = shoreCost("X", (lo) => lo);
  assert.equal(cost.total, 100 * 10000);
});

test("Pass days ages every character's timed conditions, each sheet once, and reports a lethal death", () => {
  const [p, a] = rich();
  Object.assign(a.cond, { stims: [1, 2], boost: 30, cryo: 168, lethal: 48 });
  const lines = passDays(p, [[a], [a, ...p.crew]], 30);
  assert.deepEqual([a.cond.stims, a.cond.boost, a.cond.cryo], [[], 0, 0]);
  assert.equal(a.cond.dead, "lethal radiation dose");
  assert.equal(lines.filter((l) => l.startsWith(a.name + ": ") && /died/.test(l)).length, 1);
});

test("Pass days ages both copies of a character (live crew and campaign clone) but reports each character once", () => {
  const [p, a] = rich();
  Object.assign(a.cond, { cryo: 168, lethal: 24 });
  const twin = structuredClone(a);
  const lines = passDays(p, [[a], [twin]], 10);
  assert.equal(twin.cond.cryo, 0);
  assert.equal(twin.cond.dead, "lethal radiation dose");
  assert.equal(lines.filter((l) => l.startsWith(a.name + ": ")).length, 1);
});
