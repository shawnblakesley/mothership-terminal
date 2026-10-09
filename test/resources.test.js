import { test } from "node:test";
import assert from "node:assert/strict";
import { RIM_HAULERS as c } from "../campaigns/rim-haulers.js";
import { newProgress, sanitizeProgress, carryInto, finishInto, travelTo, resupply, resupplyView, laneBetween, isTransit } from "../campaign.js";
import { sanitizeCrew, changeItem } from "../crew.js";
import { weaponsOf, weaponByName } from "../weapons.js";
import { sanitizeStats } from "../combat.js";
import { fuelCost, loaded, magazines, spendShot, reload, mergeAmmo, rigStation, resourcesFrom, TANK } from "../resources.js";
import { useStimpak, roundTick, hourTick, airLeft, protection, conditionText } from "../hazards.js";
import { Session } from "../session.js";

const seq = (...vals) => { let i = 0; return () => vals[Math.min(i++, vals.length - 1)]; };
const gunner = (items = ["Combat shotgun", "Ammo (combat shotgun) x2"], extra = {}) => sanitizeCrew([{ name: "Test", className: "Marine", items, health: { current: 12, max: 12 }, ...extra }])[0];
const shotgun = weaponByName("Combat Shotgun");

test("shots decrement per attack; the 5th shot of a 4-shot shotgun needs a reload", () => {
  const p = gunner();
  assert.equal(shotgun.shots, 4);
  assert.equal(loaded(p, shotgun), 4);
  for (let i = 0; i < 4; i++) assert.equal(spendShot(p, shotgun), true);
  assert.equal(loaded(p, shotgun), 0);
  assert.equal(spendShot(p, shotgun), false);
  assert.equal(loaded(p, shotgun), 0);
});

test("reload swaps in a spare magazine; an empty stack disappears; a full gun or no spare refuses", () => {
  const p = gunner();
  assert.equal(reload(p, shotgun).ok, false, "already full");
  assert.equal(magazines(p, shotgun), 2);
  spendShot(p, shotgun);
  const r = reload(p, shotgun);
  assert.equal(r.ok, true);
  assert.equal(loaded(p, shotgun), 4);
  assert.equal(magazines(p, shotgun), 1);
  assert.ok(p.items.includes("Ammo (combat shotgun)"));
  spendShot(p, shotgun);
  assert.equal(reload(p, shotgun).ok, true);
  assert.ok(!p.items.some((i) => /^ammo/i.test(i)), "last magazine used");
  spendShot(p, shotgun);
  const none = reload(p, shotgun);
  assert.equal(none.ok, false);
  assert.match(none.why, /no spare magazine/);
  assert.equal(loaded(p, shotgun), 3);
});

test("a weapon without shots (a crowbar) is never empty; magazines are not weapons", () => {
  const p = gunner(["Crowbar", "Ammo (smg) x3"]);
  assert.equal(spendShot(p, weaponByName("Crowbar")), true);
  assert.deepEqual(weaponsOf(p.items).map((w) => w.name), ["Crowbar", "Unarmed"]);
  assert.equal(reload(p, weaponByName("Crowbar")).ok, false);
});

test("magazine stacks merge on sheets and when items are added", () => {
  assert.deepEqual(mergeAmmo(["Flare", "Ammo (smg)", "Ammo (SMG) x2"]), ["Flare", "Ammo (smg) x3"]);
  const p = gunner(["SMG"]);
  changeItem(p, "add", "Ammo (smg)");
  changeItem(p, "add", "Ammo (SMG) x2");
  assert.deepEqual(p.items, ["SMG", "Ammo (smg) x3"]);
  assert.equal(changeItem(p, "use", "Ammo (smg)"), "used Ammo (smg)");
  assert.deepEqual(p.items, ["SMG", "Ammo (smg) x2"]);
  assert.equal(sanitizeCrew([{ name: "X", items: p.items, ammo: { smg: 9, "combat-shotgun": 2, nonsense: 1 } }])[0].ammo["smg"], 5);
  assert.deepEqual(Object.keys(sanitizeCrew([{ name: "X", items: [], ammo: { "nonsense": 1, crowbar: 1 } }])[0].ammo), []);
});

test("a lane costs 1 fuel per started 3 days: 3 days = 1, 4 = 2, 9 = 3", () => {
  assert.deepEqual([1, 3, 4, 6, 7, 9].map(fuelCost), [1, 1, 2, 2, 3, 3]);
  const nine = c.lanes.find((l) => l.days === 9);
  assert.equal(fuelCost(nine.days), 3);
  const p = newProgress(c);
  p.at = nine.a;
  const r = travelTo(p, c, nine.b);
  assert.equal(r.ok, true);
  assert.equal(r.cost, 3);
  assert.equal(p.resources.fuel, 7);
  assert.equal(p.at, nine.b);
});

test("Travel Port Gallow to Tollgate: fuel drops by 1; no lane, no fuel and a story in play refuse", () => {
  const p = newProgress(c);
  assert.equal(p.at, "port_gallow");
  assert.equal(p.resources.fuel, TANK);
  const r = travelTo(p, c, "tollgate");
  assert.equal(r.ok, true);
  assert.equal(p.resources.fuel, 9);
  assert.equal(p.at, "tollgate");
  assert.equal(travelTo(p, c, "lantern").ok, false, "no lane");
  p.resources.fuel = 0;
  const dry = travelTo(p, c, "port_gallow");
  assert.equal(dry.ok, false);
  assert.match(dry.error, /Not enough fuel/);
  p.resources.fuel = 5;
  p.current = "first_shift";
  assert.equal(travelTo(p, c, "port_gallow").ok, false);
});

test("the rig's resources go into the story's station and come back, clamped; a transit lane burns fuel once", () => {
  const p = newProgress(c);
  p.resources.fuel = 6;
  p.resources.stores.flares = 2;
  const story = c.stories.find((s) => !s.at);
  const lane = laneBetween(c, story.from, story.to);
  assert.ok(lane, "every transit story runs along a lane");
  const station = { fuel: { pct: 78 }, mary: { docked: "X" } };
  const cfg = { cast: [], voices: [], crew: [] };
  const out = carryInto(cfg, c, story, p, station);
  assert.equal(out.burned, fuelCost(lane.days));
  assert.equal(p.resources.fuel, 6 - fuelCost(lane.days));
  assert.deepEqual(station.rig, rigStation(p.resources));
  assert.equal(station.fuel, undefined, "fuel.pct is replaced");
  assert.equal(station.rig.fuel_units, p.resources.fuel);
  p.current = story.id;
  const again = carryInto(cfg, c, story, p, { rig: {} });
  assert.equal(again.burned, 0, "a rebuild is not charged twice");
  station.rig.fuel_units = "2";
  station.rig.parts = 99999;
  station.rig.rations = -4;
  finishInto(p, c, cfg, "ok", [], station);
  assert.equal(p.resources.fuel, 2);
  assert.equal(p.resources.stores.parts, 99);
  assert.equal(p.resources.stores.rations, 0);
  assert.equal(finishInto(newProgress(c), c, cfg, "", [], station), null);
  assert.equal(resourcesFrom(null, p.resources), p.resources);
});

test("progress carries its resources through a save", () => {
  const p = newProgress(c);
  p.resources.fuel = 4;
  assert.equal(sanitizeProgress(JSON.parse(JSON.stringify(p))).resources.fuel, 4);
  const junk = sanitizeProgress({ id: c.id, resources: { fuel: 99, stores: { parts: "x" } } });
  assert.equal(junk.resources.fuel, TANK);
  assert.equal(junk.resources.stores.parts, c.ship.resources.stores.parts);
});

test("every port has a class and the classes follow the ticket", () => {
  const want = { port_gallow: "A", tollgate: "C", halfway_house: "C", cinder: "B", st_brigid: "C", boneyard: "C", lantern: "X", terminus: "C" };
  assert.deepEqual(Object.fromEntries(c.locations.map((l) => [l.id, l.portClass])), want);
});

test("resupply: PSG prices times the port class (X x2, C x1.25, B x1, A x1) times faction standing", () => {
  const p = newProgress(c);
  const at = (id) => { p.at = id; return resupplyView(c, p).prices; };
  assert.deepEqual(at("port_gallow"), { ammo: 50, aid: 75, stimpak: 1000, mre: 70, tank: 50 });
  assert.equal(at("cinder").ammo, 50);
  assert.equal(at("tollgate").ammo, 63);
  assert.equal(at("tollgate").stimpak, 1250);
  assert.equal(at("lantern").ammo, 100);
  assert.equal(at("lantern").mre, 140);
  p.at = "port_gallow";
  p.factions.gallow_mercer = -2;
  assert.equal(resupplyView(c, p).prices.ammo, 63, "faction standing applies on top (x1.25)");
  p.factions.gallow_mercer = -3;
  assert.equal(resupplyView(c, p).trade, false);
  assert.equal(resupply(p, c, { lines: { ammo: 1 }, ammoFor: "Combat Shotgun" }).ok, false);
});

test("resupply buys fuel, magazines, kits, stimpaks, MREs and tanks and totals the price", () => {
  const p = newProgress(c);
  p.at = "tollgate";
  p.resources.fuel = 4;
  const who = p.crew[1];
  const before = who.items.length;
  const r = resupply(p, c, { to: who.id, ammoFor: "Combat Shotgun", fuelPrice: 100, lines: { fuel: 2, ammo: 2, aid: 1, stimpak: 1, mre: 1, tank: 1 } });
  assert.equal(r.ok, true, r.error);
  assert.equal(p.resources.fuel, 6);
  assert.equal(p.resources.stores.rations, c.ship.resources.stores.rations + 7);
  assert.equal(r.total, 2 * 125 + 2 * 63 + 94 + 1250 + 88 + 63);
  assert.ok(who.items.includes("Stimpak") && who.items.includes("First aid kit") && who.items.includes("Oxygen tank"));
  assert.equal(who.items.length, before + 3, "the new magazines join his stack of 2");
  assert.ok(who.items.includes("Ammo (combat shotgun) x4"));
  assert.equal(resupply(p, c, { to: who.id, lines: { fuel: 9 } }).ok, false, "the tank holds 10");
  assert.equal(resupply(p, c, { to: who.id, lines: { ammo: 1 }, ammoFor: "Crowbar" }).ok, false, "needs a firearm");
  p.current = "first_shift";
  assert.equal(resupply(p, c, { to: who.id, lines: { aid: 1 } }).ok, false, "not during a story");
});

test("oxygen tank: 12 hours normally, 4 hours under strain, tracked per character while they rely on it", () => {
  const p = gunner(["Oxygen tank", "Standard crew attire"]);
  const toxic = [{ type: "toxic" }];
  assert.equal(protection(p, "toxic"), "oxygen tank");
  for (let i = 0; i < 3 * 360; i++) roundTick(p, toxic, () => 1);
  assert.equal(p.cond.air, 3 * 3600);
  assert.equal(airLeft(p).name, "oxygen tank");
  assert.equal(airLeft(p).left, 9);
  assert.ok(conditionText(p).some((t) => /OWN AIR \(oxygen tank\): 9 hours left/.test(t)));
  p.cond.strenuous = true;
  assert.equal(airLeft(p).left, 1);
  assert.equal(protection(p, "toxic"), "oxygen tank");
  for (let i = 0; i < 360; i++) roundTick(p, toxic, () => 1);
  assert.equal(airLeft(p).left, 0);
  assert.equal(protection(p, "toxic"), "", "the tank is spent under strain");
  p.cond.strenuous = false;
  assert.equal(protection(p, "toxic"), "oxygen tank", "still 12 hours when not strained");
});

test("a vaccsuit's 12 hours and a hazard suit's 1 hour count down the same way", () => {
  const v = gunner(["Vaccsuit"]);
  v.cond.air = 3600 * 2;
  assert.equal(airLeft(v).left, 10);
  const h = gunner(["Hazard suit"]);
  h.cond.air = 1800;
  assert.equal(airLeft(h).left, 0.5);
  assert.equal(airLeft(gunner(["Flare"])), null);
});

test("stimpak: -1 Stress, +1d10 Health, [+] for 1d10 minutes, cures cryosickness; no roll for the first dose", () => {
  const p = gunner(["Stimpak"], { health: { current: 4, max: 12 }, stress: 6 });
  p.cond.cryo = 100;
  const r = useStimpak(p, seq(7, 3));
  assert.equal(p.stress, 5);
  assert.equal(p.health.current, 11);
  assert.equal(r.heal, 7);
  assert.equal(p.cond.cryo, 0);
  assert.equal(p.cond.boost, 18, "3 minutes = 18 rounds of 10 seconds");
  assert.equal(r.overdose, null);
  assert.equal(r.minutes, 3);
  const full = gunner(["Stimpak"], { health: { current: 12, max: 12 }, stress: 2 });
  useStimpak(full, seq(9, 1));
  assert.equal(full.health.current, 12, "Health stops at its maximum");
  assert.equal(full.stress, 2, "Stress stops at Minimum Stress");
});

test("stimpak overdose: a second dose in 24 hours rolls 1d10 (0-9); under 2 is a Death Save", () => {
  const dose = (roll) => {
    const p = gunner(["Stimpak"]);
    useStimpak(p, seq(5, 5));
    const r = useStimpak(p, seq(5, 5, roll + 1));
    return r.overdose;
  };
  assert.deepEqual(dose(0), { roll: 0, doses: 2, deathSave: true });
  assert.equal(dose(1).deathSave, true);
  assert.equal(dose(2).deathSave, false);
  assert.equal(dose(9).deathSave, false);
});

test("stimpak overdose: the roll must be under the doses in the past 24 hours; old doses stop counting", () => {
  const p = gunner(["Stimpak"]);
  useStimpak(p, seq(5, 5));
  useStimpak(p, seq(5, 5, 9));
  const third = useStimpak(p, seq(5, 5, 3));
  assert.equal(third.overdose.doses, 3);
  assert.equal(third.overdose.roll, 2);
  assert.equal(third.overdose.deathSave, true, "2 is under 3");
  for (let i = 0; i < 23; i++) hourTick(p, [], () => 1);
  assert.equal(p.cond.stims.length, 3, "still inside 24 hours");
  hourTick(p, [], () => 1);
  assert.equal(p.cond.stims.length, 0, "24 hours later they no longer count");
  assert.equal(useStimpak(p, seq(5, 5)).overdose, null);
});

test("the stimpak [+] ends after its minutes: rounds and hours wear it down", () => {
  const p = gunner(["Stimpak"]);
  useStimpak(p, seq(5, 2));
  assert.equal(p.cond.boost, 12);
  roundTick(p, []);
  assert.equal(p.cond.boost, 11);
  hourTick(p, [], () => 1);
  assert.equal(p.cond.boost, 0);
});

test("food is only tracked when rationing is on", () => {
  const p = gunner(["Flare"]);
  hourTick(p, [], () => 1, { food: false });
  assert.equal(p.cond.fed, 0);
  assert.equal(p.cond.active, 1);
  hourTick(p, [], () => 1, { food: true });
  assert.equal(p.cond.fed, 1);
});

// ---- A Session

function session() {
  Session.prototype.usesNeural = () => false;
  const s = new Session({ code: "TEST", tokenHash: "x", game: {} }, { onChange() {}, onEnd() {} });
  s.touch = () => {};
  s.syncDm = () => {};
  s.toPlayers = () => {};
  s.send = () => {};
  s.initPlayers = () => {};
  return s;
}
const withDummy = (s) => {
  s.state.config.voices.push({ id: "dummy", name: "Dummy", adversary: { revealed: true, stats: sanitizeStats({ combat: 30, instinct: 30, woundsMax: 20, healthPerWound: 999, attacks: [] }) } });
  return s.state.config.voices.at(-1);
};

test("firing the combat shotgun five times: the 5th is refused until the character reloads; Retcon undoes the reload", () => {
  const s = session();
  const [a] = s.state.config.crew;
  a.items = ["Combat shotgun", "Ammo (combat shotgun)"];
  a.ammo = {};
  withDummy(s);
  for (let i = 0; i < 4; i++) s.crewAttack({ pc: a, weapon: "Combat Shotgun", target: "Dummy" });
  assert.equal(loaded(a, shotgun), 0);
  const before = s.state.log.length;
  s.crewAttack({ pc: a, weapon: "Combat Shotgun", target: "Dummy" });
  assert.match(s.state.log.at(-1).text, /out of shots/);
  assert.equal(s.state.log.length, before + 1);
  assert.equal(s.state.config.voices.at(-1).adversary.stats.wounds <= 20, true);
  s.deliver({ lines: [], reloads: [{ by: a.name, weapon: "Combat Shotgun" }] }, "agent");
  assert.equal(loaded(a, shotgun), 4);
  assert.equal(magazines(a, shotgun), 0);
  s.retcon();
  assert.equal(loaded(a, shotgun), 0);
  assert.equal(magazines(a, shotgun), 1);
  assert.ok(a.items.includes("Ammo (combat shotgun)"));
});

test("an agent attack on an empty weapon is refused and its Combat check stays unspent; reloading comes first", () => {
  const s = session();
  const [a] = s.state.config.crew;
  a.items = ["Revolver"];
  a.ammo = { revolver: 0 };
  withDummy(s);
  s.state.roll = { check: "combat", results: { [a.id]: { result: { success: true } } } };
  s.applyAttacks({ crew_attacks: [{ by: a.name, weapon: "Revolver", target: "Dummy" }] });
  assert.equal(s.state.roll.results[a.id].attacked, undefined);
  assert.match(s.state.log.at(-1).text, /out of shots/);
  a.ammo = { revolver: 6 };
  s.applyAttacks({ crew_attacks: [{ by: a.name, weapon: "Revolver", target: "Dummy" }] });
  assert.equal(s.state.roll.results[a.id].attacked, true);
  assert.equal(a.ammo.revolver, 5);
});

test("using a stimpak through item_changes applies the PSG effect, and Retcon undoes it", () => {
  const s = session();
  const [a] = s.state.config.crew;
  a.items = ["Stimpak"];
  a.health.current = 1;
  a.stress = 8;
  s.deliver({ lines: [], item_changes: [{ for: a.name, action: "use", item: "Stimpak", why: "patching up" }] }, "agent");
  assert.deepEqual(a.items, []);
  assert.ok(a.health.current > 1);
  assert.equal(a.stress, 7);
  assert.ok(a.cond.boost > 0);
  assert.equal(a.cond.stims.length, 1);
  assert.equal(s.advOpts(a, { check: "body" }).more.includes("advantage"), true);
  s.retcon();
  assert.equal(a.health.current, 1);
  assert.equal(a.stress, 8);
  assert.equal(a.cond.boost, 0);
  assert.deepEqual(a.items, ["Stimpak"]);
});

test("an oxygen tank swap resets the air counter only if another tank is left", () => {
  const s = session();
  const [a] = s.state.config.crew;
  a.items = ["Oxygen tank", "Oxygen tank"];
  a.cond.air = 5000;
  s.crewCondition(a.id, "tankout");
  assert.equal(a.cond.air, 0);
  assert.equal(a.items.length, 1);
  a.cond.air = 5000;
  s.crewCondition(a.id, "tankout");
  assert.equal(a.cond.air, 5000);
  assert.equal(a.items.length, 0);
});

test("rig life support OFFLINE runs the oxygen supply procedure for everyone aboard; ONLINE ends it", () => {
  const s = session();
  const p = newProgress(c);
  const story = c.stories.find((x) => isTransit(x));
  p.current = story.id;
  s.state.campaign = p;
  s.state.config.shipCrew = 4;
  s.state.station = { rig: rigStation(p.resources) };
  s.syncHazards();
  assert.equal(s.state.station.hazards, undefined);
  s.state.station.rig.life_support = "OFFLINE";
  s.syncHazards();
  const h = s.state.station.hazards.rig;
  assert.equal(h.type, "oxygen");
  assert.ok(h.supply >= 4 && h.supply <= 40, "1d10 x max crew 4");
  const [a] = s.state.config.crew;
  assert.deepEqual(s.hazardsFor(a), [h], "it reaches a character aboard the rig in transit");
  s.state.station.rig.life_support = "ONLINE";
  s.syncHazards();
  assert.equal(s.state.station.hazards, undefined);
});

test("docked at a station, only the rig's own rooms are on the rig", () => {
  const s = session();
  const p = newProgress(c);
  p.current = "first_shift";
  s.state.campaign = p;
  const [a] = s.state.config.crew;
  const at = (room) => { s.roomOfPc = () => room; return s.onRig(a); };
  assert.equal(at("cab"), true);
  assert.equal(at("mary"), true);
  assert.equal(at("harbour_office"), false);
});

test("the player header carries the rig's live fuel and stores", () => {
  const s = session();
  assert.equal(s.playerHeader().rig, null);
  const p = newProgress(c);
  s.state.campaign = p;
  assert.deepEqual(s.playerHeader().rig.stores, p.resources.stores);
  p.current = c.stories[0].id;
  s.state.station = { rig: { ...rigStation(p.resources), fuel_units: 3, parts: 0 } };
  const rig = s.playerHeader().rig;
  assert.equal(rig.fuel, 3);
  assert.equal(rig.stores.parts, 0);
  assert.equal(rig.capacity, TANK);
});

test("the Warden's rationing switch turns hunger tracking on for a campaign", () => {
  const s = session();
  s.state.campaign = newProgress(c);
  const [a] = s.state.config.crew;
  s.passTime(2);
  assert.equal(a.cond.fed, 0);
  s.handleDm({ t: "rationing", on: true });
  s.passTime(2);
  assert.equal(a.cond.fed, 2);
  assert.match(s.state.log.find((e) => /Rationing/.test(e.text)).text, /PSG 32.5/);
});
