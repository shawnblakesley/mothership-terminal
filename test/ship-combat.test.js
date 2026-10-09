import { test } from "node:test";
import assert from "node:assert/strict";
import { RIM_HAULERS as c } from "../campaigns/rim-haulers.js";
import { newProgress, sanitizeProgress, carryInto } from "../campaign.js";
import { rigStation } from "../resources.js";
import { parseReply } from "../agent.js";
import {
  movementOutcome, moveBand, checkMove, evadeMinimum, fuelCostOf, fuelAdvantage, battleResult, hullHit, applyHit, mdmgEffect, moraleHails,
  classAdvantage, unwinnable, shipConsequences, attackStatus, sanitizeShip, sanitizeRig, rollIssues, majorCost, distressResponse, resupplyEffect, identified, MAINTENANCE, shipBrief,
} from "../ships.js";
import { Session } from "../session.js";
import { startFight, setCrewMove, setEnemyMove, resolveMovement, resolveAttack, endFight, rigAction, shipClockRan, runEffect, setFire, hooks } from "../shipfight.js";

const ok = { success: true, critical: false }, crit = { success: true, critical: true }, fail = { success: false, critical: false }, cfail = { success: false, critical: true };
const mary = () => sanitizeRig(null, c.ship.combat);
const story = (id) => c.stories.find((x) => x.id === id);
const redTide = () => sanitizeShip({ ...story("hot_load").ships[0], side: "enemy" });
const writ = () => sanitizeShip({ ...story("blockade_run").ships[0], side: "enemy" });
const fixed = (n) => (lo, hi) => Math.min(hi, Math.max(lo, n));
const seq = (...vals) => { let i = 0; return () => vals[Math.min(i++, vals.length - 1)]; };

// ---- The campaign's numbers (house rule)

test("the rig and the two enemy ships carry the ticket's numbers", () => {
  const m = mary();
  assert.deepEqual([m.class, m.thrusters, m.battle, m.systems, m.hull, m.armed], [2, 35, 0, 40, 3, false]);
  const r = redTide();
  assert.deepEqual([r.class, r.thrusters, r.battle, r.systems, r.hull], [1, 50, 45, 35, 2]);
  assert.deepEqual(r.weapons, [{ name: "Autocannon", damage: "1d5", range: "firing" }]);
  const w = writ();
  assert.deepEqual([w.class, w.thrusters, w.battle, w.systems, w.hull], [2, 45, 50, 50, 4]);
  assert.deepEqual(w.weapons.map((x) => [x.name, x.range]), [["Railgun", "detection"], ["Point-defence", "firing"]]);
  assert.equal(w.transponder.captain, "Capt. Ilse Marrak");
  assert.equal(r.transponder, undefined);
});

// ---- Movement (SBT)

test("movement: success against failure moves the band for the winner's choice", () => {
  const evade = (check) => ({ move: "evade", check }), pursue = (check) => ({ move: "pursue", check });
  assert.deepEqual(movementOutcome(evade(ok), pursue(fail)).winner, "a");
  assert.deepEqual(movementOutcome(evade(fail), pursue(ok)).winner, "b");
  assert.equal(moveBand("firing", "evade").range, "detection");
  assert.equal(moveBand("firing", "pursue").range, "contact");
  assert.equal(moveBand("contact", "pursue").moved, false);
  assert.equal(moveBand("detection", "evade").moved, false);
});

test("movement: a Critical Success moves it even if the other side succeeded; a Critical Failure lets the other side move it even if they failed", () => {
  const e = (check) => ({ move: "evade", check }), p = (check) => ({ move: "pursue", check });
  assert.equal(movementOutcome(e(crit), p(ok)).winner, "a");
  assert.equal(movementOutcome(e(ok), p(crit)).winner, "b");
  assert.equal(movementOutcome(e(fail), p(cfail)).winner, "a");
  assert.equal(movementOutcome(e(cfail), p(fail)).winner, "b");
  assert.equal(movementOutcome(e(ok), p(cfail)).winner, "a");
});

test("movement: a tie changes nothing", () => {
  const e = (check) => ({ move: "evade", check }), p = (check) => ({ move: "pursue", check });
  for (const [a, b] of [[ok, ok], [fail, fail], [crit, crit], [cfail, cfail]]) assert.equal(movementOutcome(e(a), p(b)).winner, null);
});

test("movement: Maintain Course gives the other side an automatic success", () => {
  const m = { move: "maintain", check: null };
  assert.equal(movementOutcome(m, { move: "pursue", check: fail }).winner, "b");
  assert.equal(movementOutcome({ move: "evade", check: cfail }, m).winner, "a");
  assert.equal(movementOutcome(m, m).winner, null);
});

test("movement: Evade needs 3 fuel at Contact, 2 at Firing, 1 at Detection; the leak adds 1 to any spend", () => {
  assert.deepEqual(["contact", "firing", "detection"].map(evadeMinimum), [3, 2, 1]);
  const ship = mary();
  assert.equal(checkMove(ship, "evade", 2, "contact", 10).ok, false);
  assert.equal(checkMove(ship, "evade", 3, "contact", 10).ok, true);
  assert.equal(checkMove(ship, "evade", 1, "detection", 10).ok, true);
  assert.equal(checkMove(ship, "evade", 0, "detection", 10).ok, false);
  assert.equal(checkMove(ship, "pursue", 0, "firing", 10).ok, true);
  assert.equal(checkMove(ship, "maintain", 5, "firing", 10).spend, 0, "Maintain Course spends nothing");
  assert.equal(checkMove(ship, "evade", 3, "contact", 2).ok, false, "not enough fuel aboard");
  const leaking = { ...ship, mdmg: 1 };
  assert.equal(fuelCostOf(leaking, 3), 4);
  assert.equal(fuelCostOf(leaking, 0), 0);
  assert.equal(fuelCostOf({ ...ship, mdmg: 2 }, 3), 3);
  assert.equal(checkMove(leaking, "evade", 3, "contact", 3).ok, false);
});

test("the side that spent more fuel has [+] on its Thrusters check", () => {
  assert.equal(fuelAdvantage(3, 1), "+");
  assert.equal(fuelAdvantage(2, 2), "");
  assert.equal(fuelAdvantage(1, 3), "");
});

// ---- Attack (SBT)

test("Battle check results: Critical Failure +2 MDMG to itself, failure +1, success deals damage, Critical Success double", () => {
  assert.deepEqual(battleResult(cfail, 4), { kind: "critfail", label: "Critical Failure", self: 2, damage: 0 });
  assert.deepEqual(battleResult(fail, 4), { kind: "fail", label: "Failure", self: 1, damage: 0 });
  assert.deepEqual(battleResult(ok, 4), { kind: "hit", label: "Success", self: 0, damage: 4 });
  assert.deepEqual(battleResult(crit, 4), { kind: "crit", label: "Critical Success", self: 0, damage: 8 });
});

test("an unarmed ship automatically fails Battle checks (and so does one with weapons offline)", () => {
  const m = mary(), r = redTide();
  const st = attackStatus({ ...m, side: "crew" }, r, "firing");
  assert.equal(st.checks, true);
  assert.equal(st.autoFail, true);
  assert.equal(st.why, "unarmed");
  assert.deepEqual(battleResult(null, 5), { kind: "fail", label: "automatic failure", self: 1, damage: 0 });
  const offline = { ...r, mdmg: 2 };
  assert.equal(attackStatus(offline, m, "firing").autoFail, true);
  assert.equal(attackStatus(r, m, "firing").autoFail, false);
});

test("only a railgun fires at Detection range; everything fires at Firing and Contact", () => {
  const w = writ(), r = redTide(), m = mary();
  assert.equal(attackStatus(w, m, "detection").checks, true);
  assert.equal(attackStatus(r, m, "detection").checks, false);
  assert.equal(attackStatus(r, m, "firing").checks, true);
  assert.equal(attackStatus(r, m, "contact").checks, true);
  assert.equal(attackStatus({ ...m, side: "crew" }, r, "detection").checks, false);
});

test("Hull is subtracted from incoming damage; at or above Hull, Hull drops by 1", () => {
  assert.deepEqual(hullHit(3, 2), { through: 0, hullDrops: false, hull: 3 });
  assert.deepEqual(hullHit(3, 3), { through: 0, hullDrops: true, hull: 2 });
  assert.deepEqual(hullHit(3, 5), { through: 2, hullDrops: true, hull: 2 });
  assert.deepEqual(hullHit(0, 4), { through: 4, hullDrops: false, hull: 0 });
  const ship = { hull: 2, mdmg: 1 };
  const r = applyHit(ship, 5);
  assert.deepEqual([ship.hull, ship.mdmg, r.through, r.hullDrops], [1, 4, 3, true]);
  assert.equal(r.effect.name, "Fire on deck");
  const self = { hull: 2, mdmg: 0 };
  applyHit(self, 0, 2);
  assert.deepEqual([self.hull, self.mdmg], [2, 2], "MDMG a ship gives itself skips Hull");
});

test("MDMG effects by total, including 9 or more", () => {
  assert.equal(mdmgEffect(0), null);
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => mdmgEffect(n).name), [
    "Emergency fuel leak", "Weapons offline", "Navigation offline", "Fire on deck", "Hull breach", "Life support offline", "Radiation leak", "Dead in the water", "Abandon ship",
  ]);
  assert.equal(mdmgEffect(9).key, "abandon");
  assert.equal(mdmgEffect(14).key, "abandon");
  assert.equal(mdmgEffect(14).n, 14);
});

test("morale: it may hail only when the d10 (0-9) is under its MDMG total", () => {
  assert.equal(moraleHails(3, 2), true);
  assert.equal(moraleHails(3, 3), false);
  assert.equal(moraleHails(1, 0), true);
  assert.equal(moraleHails(1, 1), false);
  assert.equal(moraleHails(0, 0), false, "an undamaged ship doesn't break");
});

test("class rules: [+] against a ship one class lower; two or more classes higher can't be beaten head-on", () => {
  const m = mary(), r = redTide(), w = writ();
  assert.equal(classAdvantage(m, r), "+");
  assert.equal(classAdvantage(r, m), "");
  assert.equal(classAdvantage(m, w), "");
  assert.equal(unwinnable(m, w), false);
  assert.equal(unwinnable(m, r), false);
  assert.equal(unwinnable(r, { ...m, class: 3 }), true);
  assert.equal(unwinnable(m, { ...r, class: 4 }), true);
  assert.equal(unwinnable({ ...m, class: 0 }, { ...r, class: 1 }), false);
  assert.equal(attackStatus({ ...r, class: 3 }, m, "firing").adv, "+", "the Battle check carries the [+]");
  assert.equal(attackStatus({ ...m, side: "crew" }, { ...r, class: 4 }, "firing").unwinnable, true);
});

test("a ship check failure gives all crew 1 Stress; a Critical Failure also gives all crew a Panic Check", () => {
  assert.deepEqual(shipConsequences(ok), { stressAll: false, panicAll: false });
  assert.deepEqual(shipConsequences(crit), { stressAll: false, panicAll: false });
  assert.deepEqual(shipConsequences(fail), { stressAll: true, panicAll: false });
  assert.deepEqual(shipConsequences(cfail), { stressAll: true, panicAll: true });
});

test("resupply: one fight without it is [-] on Battle checks, two automatically fail", () => {
  const armed = { weapons: [{ name: "x" }], owed: 0 };
  assert.equal(resupplyEffect(armed), "");
  assert.equal(resupplyEffect({ ...armed, owed: 1 }), "-");
  assert.equal(resupplyEffect({ ...armed, owed: 2 }), "fail");
  assert.equal(resupplyEffect({ weapons: [], owed: 3 }), "", "an unarmed ship has nothing to resupply");
  const r = redTide();
  assert.equal(attackStatus({ ...r, owed: 1 }, mary(), "firing").adv, "-");
  assert.equal(attackStatus({ ...r, owed: 2 }, mary(), "firing").autoFail, true);
});

// ---- After the battle, repairs, distress (SBT, with the house rules the ticket names)

test("maintenance issues: none on a pass, one on a failure, two on a Critical Failure", () => {
  assert.deepEqual(rollIssues(ok), []);
  assert.equal(rollIssues(fail).length, 1);
  assert.equal(rollIssues(cfail, seq(1, 6)).length, 2);
  assert.deepEqual(rollIssues(fail, () => 6), ["CB down"]);
  assert.equal(MAINTENANCE.length, 6);
});

test("major repairs cost 1d5 mcr x the ship's class", () => {
  assert.equal(majorCost(2, 3), 6_000_000);
  assert.equal(majorCost(4, 5), 20_000_000);
});

test("the distress signal table: 0 days, 1-2 weeks, 3-4 months, 5-6 years, 7 decades, 8-9 never; the Rim +1 step, the Dark Lane +2", () => {
  const units = (roll, steps) => distressResponse(roll, steps, () => 7);
  assert.equal(units(0, 0).unit, "days");
  assert.equal(units(2, 0).unit, "weeks");
  assert.equal(units(4, 0).unit, "months");
  assert.equal(units(6, 0).unit, "years");
  assert.equal(units(7, 0).unit, "decades");
  assert.equal(units(8, 0).never, true);
  assert.equal(units(0, 1).unit, "weeks");
  assert.equal(units(0, 2).unit, "months");
  assert.equal(units(4, 2).unit, "decades");
  assert.equal(units(5, 2).never, true);
  assert.equal(units(7, 1).never, true);
  assert.equal(units(1, 2).unit, "years");
  assert.equal(units(0, 0).n, 14, "2d10 reads 1-10 each");
});

test("what the players see of the enemy by range", () => {
  assert.equal(identified(writ(), "detection").name, "WRIT OF SEIZURE");
  assert.equal(identified(redTide(), "detection").name, "");
  assert.equal(identified(redTide(), "firing").class, 1);
  assert.equal(identified(redTide(), "firing").hull, undefined);
  assert.equal(identified(redTide(), "contact").hull, 2);
});

// ---- The agent's reply field

test("the agent's ship_fight field is read and trimmed", () => {
  const r = parseReply(JSON.stringify({ lines: [], ship_fight: { start: { ship: "red_tide", range: "bogus" }, enemy_move: "evade", fuel: 3.4, extra: 1 } }), []);
  assert.deepEqual(r.ship_fight, { start: { ship: "red_tide", range: "firing" }, enemy_move: "evade", fuel: 3 });
  assert.equal(parseReply(JSON.stringify({ lines: [], ship_fight: { enemy_move: "dance" } }), []).ship_fight, null);
  assert.equal(parseReply(JSON.stringify({ lines: [] }), []).ship_fight, null);
});

// ---- A Session: the HOT LOAD setup

function session() {
  Session.prototype.usesNeural = () => false;
  const s = new Session({ code: "TEST", tokenHash: "x", game: {} }, { onChange() {}, onEnd() {} });
  s.touch = () => {};
  s.syncDm = () => {};
  s.toPlayers = () => {};
  s.send = () => {};
  s.initPlayers = () => {};
  hooks.rng = fixed(50);
  const p = newProgress(c);
  const st = story("hot_load");
  p.current = st.id;
  s.state.campaign = p;
  s.state.station = { rig: rigStation(p.resources), reactor: "ONLINE", drive: "CRUISE", lights: { deck_1: "ON" } };
  carryInto(s.state.config, c, st, p, s.state.station);
  return s;
}
const finish = (s, dice) => {
  for (const pc of s.state.roll.pcs.map((x) => s.crewById(x.id))) {
    const n = s.publicRoll().pcs.find((p) => p.id === pc.id).advantage === "none" ? 1 : 2;
    s.rollFor(pc, Array(n).fill(dice), { by: "warden" });
  }
};

test("campaign progress carries the rig's ship and the story's ships", () => {
  const s = session();
  assert.equal(s.state.config.ships[0].id, "red_tide");
  assert.equal(s.state.campaign.ship.hull, 3);
  const back = sanitizeProgress(JSON.parse(JSON.stringify({ ...s.state.campaign, ship: { ...s.state.campaign.ship, hull: 1, mdmg: 4, issues: ["CB down"], owed: 1, thrusters: 99 } })));
  assert.deepEqual([back.ship.hull, back.ship.mdmg, back.ship.issues, back.ship.owed, back.ship.thrusters], [1, 4, ["CB down"], 1, 35]);
});

test("HOT LOAD: the gunship closes from Firing to Contact; fuel comes off the rig", () => {
  const s = session();
  assert.equal(startFight(s, { ship: "red_tide", range: "firing" }), true);
  const f = s.state.shipFight;
  f.ships[1].thrusters = 0;
  assert.equal(setCrewMove(s, "evade", 2), true);
  assert.equal(setEnemyMove(s, "pursue", 2), true);
  resolveMovement(s);
  assert.equal(s.state.roll.check, "ship");
  assert.equal(s.state.roll.ship.stat, "thrusters");
  assert.equal(s.publicRoll().label, "SHIP THRUSTERS CHECK");
  assert.equal(s.state.station.rig.fuel_units, "8");
  assert.equal(s.state.roll.advantage, "none");
  // The Red Tide always fails (Thrusters 0): the crew's success moves the band OUT, not in.
  finish(s, 5);
  assert.equal(f.range, "detection");
  assert.equal(f.phase, "moved");
  // A second round: the crew hold course, the gunship pursues and succeeds automatically.
  f.round = 2; f.attackedRound = 1; f.moves = { crew: null, enemy: null };
  setCrewMove(s, "maintain", 0);
  setEnemyMove(s, "pursue", 1);
  resolveMovement(s);
  assert.equal(s.state.roll?.status === "waiting", false, "no roll when one side maintains");
  assert.equal(f.range, "firing");
});

test("a failed Thrusters check against a failed enemy check is a tie, and every crewmember takes 1 Stress", () => {
  const s = session();
  startFight(s, { ship: "red_tide", range: "firing" });
  const f = s.state.shipFight;
  f.ships[1].thrusters = 0;
  const before = s.state.config.crew.map((pc) => pc.stress);
  setCrewMove(s, "evade", 2);
  setEnemyMove(s, "pursue", 5);
  resolveMovement(s);
  finish(s, 97);
  assert.equal(f.range, "firing", "both fail: a tie");
  assert.deepEqual(s.state.config.crew.map((pc) => pc.stress), before.map((n) => n + 1));
});

test("a Critical Failure on a ship check gives every crewmember 1 Stress and offers each a Panic Check", () => {
  const s = session();
  startFight(s, { ship: "red_tide", range: "firing" });
  const f = s.state.shipFight;
  const before = s.state.config.crew.map((pc) => pc.stress);
  f.ships[1].thrusters = 0;
  setCrewMove(s, "evade", 2);
  setEnemyMove(s, "pursue", 1);
  resolveMovement(s);
  finish(s, 99);
  assert.deepEqual(s.state.config.crew.map((pc) => pc.stress), before.map((n) => n + 1));
  assert.ok(s.state.offers.some((o) => o.roll.check === "panic" && o.roll.pc === "all"));
  assert.equal(f.range, "contact", "the Critical Failure lets the gunship close even though it failed");
});

test("HOT LOAD: unarmed MARY auto-fails her Battle check; MDMG 5 is a hull breach and everyone aboard makes a Body Save", () => {
  const s = session();
  startFight(s, { ship: "red_tide", range: "contact" });
  const f = s.state.shipFight;
  f.ships[0].mdmg = 4;
  const stress = s.state.config.crew.map((pc) => pc.stress);
  setFire(s, "crew", true);
  resolveAttack(s);
  const rig = f.ships[0];
  assert.equal(rig.mdmg, 5);
  assert.equal(s.state.campaign.ship.mdmg, 5, "MDMG carries into the campaign");
  assert.equal(s.state.station.hazards.rig.type, "breach");
  assert.equal(s.state.roll.check, "body");
  assert.equal(s.state.roll.pcs.length, 4);
  assert.deepEqual(s.state.config.crew.map((pc) => pc.stress), stress.map((n) => n + 1), "an automatic failure is a failed ship check");
  assert.equal(f.round, 2);
  assert.match(s.state.log.find((e) => /ATTACK/.test(e.text)).text, /AUTOMATIC FAILURE \(UNARMED\)/);
});

test("firing is a choice: an unarmed MARY holds fire by default (no MDMG, no Stress); choosing Fire is an automatic failure with its consequences", () => {
  const s = session();
  startFight(s, { ship: "red_tide", range: "contact" });
  const f = s.state.shipFight;
  const stress = s.state.config.crew.map((pc) => pc.stress);
  resolveAttack(s);
  assert.equal(f.ships[0].mdmg, 0, "she held fire");
  assert.deepEqual(s.state.config.crew.map((pc) => pc.stress), stress);
  assert.match(s.state.log.find((e) => /ATTACK/.test(e.text)).text, /LONG HAUL MARY: NO ATTACK \(HOLDS FIRE\)/);
  assert.equal(f.ships[1].mdmg >= 1 || f.ships[0].hull <= 3, true);
  assert.deepEqual(f.fire, { crew: null, enemy: null }, "the choice resets each round");
  setFire(s, "crew", true);
  resolveAttack(s);
  assert.equal(f.ships[0].mdmg, 1);
  assert.deepEqual(s.state.config.crew.map((pc) => pc.stress), stress.map((n) => n + 1));
});

test("an armed enemy holds fire when told to: no Battle check and no MDMG to itself", () => {
  const s = session();
  startFight(s, { ship: "red_tide", range: "contact" });
  const f = s.state.shipFight;
  setFire(s, "enemy", false);
  resolveAttack(s);
  assert.equal(f.ships[1].mdmg, 0);
  assert.match(s.state.log.find((e) => /ATTACK/.test(e.text)).text, /THE RED TIDE: NO ATTACK \(HOLDS FIRE\)/);
});

test("the agent's enemy_fire field is read and applied", () => {
  assert.deepEqual(parseReply(JSON.stringify({ lines: [], ship_fight: { enemy_fire: false } }), []).ship_fight, { enemy_fire: false });
  const s = session();
  startFight(s, { ship: "red_tide", range: "contact" });
  s.deliver({ lines: [], ship_fight: { enemy_fire: false } }, "agent");
  assert.equal(s.state.shipFight.fire.enemy, false);
});

test("the MDMG effects reach the people aboard through the hazards", () => {
  const s = session();
  startFight(s, { ship: "red_tide", range: "contact" });
  const f = s.state.shipFight;
  const rig = f.ships[0];
  const run = (n) => { rig.mdmg = n; };
  rig.mdmg = 4;
  assert.equal(mdmgEffect(rig.mdmg).key, "fire");
  const hz = () => Object.values(s.state.station.hazards || {}).map((h) => h.type).sort();
  runEffect(s, f, rig, seq(0, 0));
  assert.deepEqual(hz(), ["corrosive", "toxic"]);
  assert.equal(Object.values(s.state.station.hazards).find((h) => h.type === "corrosive").level, 10);
  run(6);
  runEffect(s, f, rig);
  assert.match(s.state.station.rig.life_support, /OFFLINE/i);
  assert.equal(s.state.station.hazards.rig.type, "oxygen");
  assert.ok(s.state.station.hazards.rig.supply % 4 === 0 && s.state.station.hazards.rig.supply <= 40, "1d10 x the rig's max crew of 4");
  run(7);
  runEffect(s, f, rig);
  assert.equal(s.state.station.hazards.engine_room.type, "radiation");
  assert.equal(s.state.station.hazards.engine_room.level, 1);
  assert.ok(s.state.clocks.some((k) => /RADIATION LEAK/.test(k.label)));
  const clock = s.state.clocks.find((k) => /RADIATION LEAK/.test(k.label));
  assert.equal(shipClockRan(s, clock, seq(5, 5)), true);
  assert.equal(s.state.station.hazards.engine_room.level, 2);
  run(8);
  runEffect(s, f, rig);
  assert.equal(s.state.station.reactor, "EMERGENCY POWER");
  assert.equal(s.state.station.drive, "OFFLINE");
  assert.equal(s.state.station.lights.deck_1, "EMERGENCY");
  run(9);
  runEffect(s, f, rig, seq(4));
  const abandon = s.state.clocks.find((k) => k.label === "ABANDON SHIP");
  assert.equal(abandon.seconds, 240, "1d10 minutes");
  for (const t of s.clockTimers.values()) clearTimeout(t);
});

test("the rig's Hull and MDMG carry between stories, and a patch job is a house rule that leaves an issue", () => {
  const s = session();
  startFight(s, { ship: "red_tide", range: "contact" });
  const f = s.state.shipFight;
  f.ships[0].mdmg = 3;
  f.ships[0].hull = 1;
  setFire(s, "crew", true);
  resolveAttack(s);
  assert.ok(s.state.campaign.ship.mdmg >= 4);
  assert.equal(s.state.campaign.ship.hull <= 1, true);
  s.state.campaign.current = "";
  s.state.campaign.ship.mdmg = 3;
  rigAction(s, { t: "shipPatch" }, seq(6));
  assert.equal(s.state.campaign.ship.mdmg, 2);
  assert.deepEqual(s.state.campaign.ship.issues, ["CB down"]);
  rigAction(s, { t: "shipMajor" }, seq(3));
  assert.deepEqual([s.state.campaign.ship.mdmg, s.state.campaign.ship.hull], [0, 3]);
  assert.match(s.state.log.at(-1).text, /6 mcr/);
});

test("ending a fight: owed resupply for an armed rig, a Systems check if she took MDMG, and issues from a failure", () => {
  const s = session();
  rigAction(s, { t: "shipFit", name: "Rigging cannon", battle: 30 });
  s.state.campaign.current = "hot_load";
  startFight(s, { ship: "red_tide", range: "firing" });
  const f = s.state.shipFight;
  assert.equal(f.ships[0].armed, true);
  f.ships[0].mdmg = 1;
  endFight(s, "ceasefire");
  assert.equal(s.state.campaign.ship.owed, 1);
  assert.equal(s.state.roll.check, "ship");
  assert.equal(s.state.roll.ship.stat, "systems");
  finish(s, 97);
  assert.equal(s.state.campaign.ship.issues.length, 1);
  assert.equal(s.state.shipFight.ended, true);
  s.state.campaign.current = "";
  rigAction(s, { t: "shipResupply" });
  assert.equal(s.state.campaign.ship.owed, 0);
});

test("the Systems check after the battle stays due while another roll is waiting, and a roll is refused in the way of a step", () => {
  const s = session();
  startFight(s, { ship: "red_tide", range: "contact" });
  const f = s.state.shipFight;
  f.ships[0].mdmg = 4;
  setFire(s, "crew", true);
  resolveAttack(s);
  assert.equal(s.state.roll.check, "body", "the hull breach saves are waiting");
  endFight(s, "ceasefire");
  assert.equal(f.afterDue, true);
  assert.equal(f.waiting, null);
  f.moves = { crew: { move: "maintain", spend: 0 }, enemy: { move: "pursue", spend: 1 } };
  f.ended = false;
  resolveMovement(s);
  assert.equal(f.movedRound, undefined, "no step while a roll is waiting");
});

test("Retcon undoes the last round and starting a fight from the agent's reply", () => {
  const s = session();
  s.deliver({ lines: [], ship_fight: { start: { ship: "red_tide", range: "contact" } } }, "agent");
  assert.ok(s.state.shipFight);
  s.retcon();
  assert.equal(s.state.shipFight, null);
  startFight(s, { ship: "red_tide", range: "contact" });
  const mdmg = s.state.shipFight.ships[0].mdmg;
  const stress = s.state.config.crew.map((pc) => pc.stress);
  setFire(s, "crew", true);
  resolveAttack(s);
  assert.ok(s.state.shipFight.ships[0].mdmg > mdmg);
  s.retcon();
  assert.equal(s.state.shipFight.ships[0].mdmg, mdmg);
  assert.equal(s.state.shipFight.round, 1);
  assert.equal(s.state.campaign.ship.mdmg, mdmg);
  assert.deepEqual(s.state.config.crew.map((pc) => pc.stress), stress);
});

test("the agent's enemy move is applied and the fight ends on its say-so; Restart story clears the fight", () => {
  const s = session();
  s.deliver({ lines: [], ship_fight: { start: { ship: "red_tide", range: "firing" } } }, "agent");
  s.deliver({ lines: [], ship_fight: { enemy_move: "evade", fuel: 0 } }, "agent");
  assert.deepEqual(s.state.shipFight.moves.enemy, { move: "evade", spend: 2 }, "raised to the Firing-range minimum");
  assert.match(shipBrief(s.state), /Round 1, range FIRING/);
  assert.match(shipBrief(s.state), /enemy's move this round is set/);
  s.deliver({ lines: [], ship_fight: { end: true } }, "agent");
  assert.equal(s.state.shipFight.ended, true);
  s.restartStory();
  assert.equal(s.state.shipFight, null);
});

test("a saved session keeps its ship fight", () => {
  const s = session();
  startFight(s, { ship: "writ", range: "detection" });
  assert.equal(s.state.shipFight, null, "that ship isn't in HOT LOAD");
  startFight(s, { ship: "red_tide" });
  const saved = JSON.parse(JSON.stringify(s));
  const again = new Session(saved, { onChange() {}, onEnd() {} });
  assert.equal(again.state.shipFight.ships[1].id, "red_tide");
  assert.equal(again.state.campaign.ship.name, "LONG HAUL MARY");
});
