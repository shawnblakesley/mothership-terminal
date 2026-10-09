import { randInt, rollDice, rollTable } from "./dice.js";
import { combatCheck } from "./combat.js";
import { clampInt } from "./clean.js";

// Ship-to-ship combat. Everything marked SBT comes from a summary of the Shipbreaker's Toolkit (RULES.md, Ships), not the book.
// Everything marked HOUSE is a campaign house rule (the ticket supplies it where the summary has a gap) and the UI says so.

export const CLASS_NAMES = ["Shuttlecraft", "Light Commercial", "Medium Commercial", "Heavy Commercial", "Light Military", "Medium Military"];
export const classLabel = (n) => ["0", "I", "II", "III", "IV", "V"][n] ?? "?";
export const RANGES = ["detection", "firing", "contact"];
export const RANGE_NOTES = {
  detection: "Detection: the same system. Trajectory, rough size, transponder. Railguns only. Comms latency minutes to hours.",
  firing: "Firing: planet to moon. Ship class and type. All weapons. Comms latency seconds.",
  contact: "Contact: close orbit. Lifeforms aboard, ship status. Boarding. No latency.",
};
export const MOVES = ["maintain", "evade", "pursue"];
export const STATIONS = ["pilot", "gunner", "engineer"];
export const STATION_STAT = { pilot: "thrusters", gunner: "battle", engineer: "systems" };
export const STATION_SKILL = { pilot: "Piloting", gunner: "Firearms", engineer: "" };

// SBT: Evade needs at least this much fuel (3 at Contact, 2 at Firing, 1 at Detection).
export const EVADE_MIN = { contact: 3, firing: 2, detection: 1 };
export const evadeMinimum = (range) => EVADE_MIN[range] ?? 1;

// HOUSE: ship stats sit on the same 1-99 scale as character stats; a hit deals 1d5 before Hull.
export const HIT_DICE = "1d5";
// HOUSE: 1 rules "fuel" = 1 rig fuel unit.
export const PATCH_COST = 20_000;
export const RESUPPLY_COST = 1000;

const text = (v, n) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);

export function sanitizeShip(raw, base = {}) {
  const r = raw && typeof raw === "object" ? raw : {};
  const b = base && typeof base === "object" ? base : {};
  const pick = (k, lo, hi, def) => clampInt(r[k], lo, hi, clampInt(b[k], lo, hi, def));
  const weapons = (Array.isArray(r.weapons) ? r.weapons : Array.isArray(b.weapons) ? b.weapons : [])
    .filter((w) => w && text(w.name, 40)).slice(0, 6)
    .map((w) => ({ name: text(w.name, 40), damage: HIT_DICE, range: w.range === "detection" ? "detection" : "firing" }));
  const hullMax = clampInt(r.hullMax ?? r.hull ?? b.hullMax ?? b.hull, 0, 9, 1);
  const out = {
    id: String(r.id || b.id || r.name || b.name || "").toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30) || "ship",
    name: text(r.name || b.name, 40) || "UNKNOWN SHIP",
    kind: text(r.kind ?? b.kind, 40),
    class: pick("class", 0, 5, 1),
    thrusters: pick("thrusters", 1, 99, 30),
    battle: pick("battle", 0, 99, 0),
    systems: pick("systems", 1, 99, 30),
    hull: clampInt(r.hull, 0, hullMax, clampInt(b.hull, 0, hullMax, hullMax)),
    hullMax,
    mdmg: clampInt(r.mdmg, 0, 99, clampInt(b.mdmg, 0, 99, 0)),
    armed: weapons.length > 0,
    weapons,
  };
  const fuel = r.fuel ?? b.fuel;
  if (fuel !== undefined && fuel !== null && fuel !== "") out.fuel = clampInt(fuel, 0, 999, 0);
  if (r.transponder ?? b.transponder) {
    const t = r.transponder ?? b.transponder;
    out.transponder = typeof t === "object" ? { callsign: text(t.callsign, 40), captain: text(t.captain, 40), homePort: text(t.homePort, 40), destination: text(t.destination, 40) } : null;
  }
  if (r.side === "crew" || r.side === "enemy") out.side = r.side;
  const issues = r.issues ?? b.issues;
  if (issues !== undefined) out.issues = (Array.isArray(issues) ? issues : []).map((i) => text(i, 40)).filter(Boolean).slice(0, 12);
  if (r.owed !== undefined || b.owed !== undefined) out.owed = clampInt(r.owed ?? b.owed, 0, 9, 0);
  if (r.adversary ?? b.adversary) out.adversary = text(r.adversary ?? b.adversary, 60);
  return out;
}

// The rig as it is saved in the campaign: its fixed numbers from the campaign, with Hull, MDMG, fitted weapons, issues and what it owes in resupply.
export function sanitizeRig(raw, base) {
  return sanitizeShip({ ...(raw && typeof raw === "object" ? raw : {}), id: base.id, name: base.name, kind: base.kind, class: base.class, thrusters: base.thrusters, systems: base.systems, hullMax: base.hull ?? base.hullMax, issues: raw?.issues ?? [], owed: raw?.owed ?? 0 }, { ...base, hullMax: base.hull ?? base.hullMax });
}

// SBT: the effect for the ship's MDMG total. The rig-side effects (4-9) are run by the app through the hazards.
export const MDMG_EFFECTS = {
  1: { key: "leak", name: "Emergency fuel leak", rule: "Every fuel spend costs +1." },
  2: { key: "weapons", name: "Weapons offline", rule: "Battle checks automatically fail." },
  3: { key: "nav", name: "Navigation offline", rule: "No Thrusters checks; 10% of the navigation data is wiped." },
  4: { key: "fire", name: "Fire on deck", rule: "The burning sections become a toxic and highly corrosive atmosphere." },
  5: { key: "breach", name: "Hull breach", rule: "Everyone aboard makes a Body Save or takes 1 Wound (Fire & Explosives). A Critical Failure is sucked into space." },
  6: { key: "life", name: "Life support offline", rule: "Oxygen supply is 1d10 x the ship's maximum crew (PSG 33.1)." },
  7: { key: "radiation", name: "Radiation leak", rule: "Radiation Level +1 every 2d10 minutes." },
  8: { key: "dead", name: "Dead in the water", rule: "All systems offline; emergency power only." },
  9: { key: "abandon", name: "Abandon ship", rule: "The ship is destroyed in 1d10 minutes." },
};
export const mdmgEffect = (total) => {
  const n = Math.floor(Number(total) || 0);
  return n < 1 ? null : { n, ...MDMG_EFFECTS[Math.min(9, n)] };
};
export const effectKey = (ship) => mdmgEffect(ship.mdmg)?.key || "";
// What the current total does to the fight. HOUSE: "dead in the water" and "abandon ship" (all systems offline) take weapons and navigation with them; and only the effect for the current total applies.
export const fuelLeak = (ship) => effectKey(ship) === "leak";
export const weaponsOffline = (ship) => ["weapons", "dead", "abandon"].includes(effectKey(ship));
export const navOffline = (ship) => ["nav", "dead", "abandon"].includes(effectKey(ship));

// Fuel a ship's spend really costs: +1 on any spend while the emergency fuel leak is the current effect.
export const fuelCostOf = (ship, spend) => (spend > 0 ? spend + (fuelLeak(ship) ? 1 : 0) : 0);

// Rank of a check result: Critical Success 3, success 2, failure 1, Critical Failure 0.
export const rank = (c) => (!c ? 1 : c.success ? (c.critical ? 3 : 2) : c.critical ? 0 : 1);

// SBT Movement. Each side: { move, check } where check is { success, critical } or null (no Thrusters check). A side that Maintains Course makes no check and the other side automatically succeeds.
// Returns { winner: "a" | "b" | null, how, moves }.
export function movementOutcome(a, b) {
  if (a.move === "maintain" && b.move === "maintain") return { winner: null, how: "both hold course" };
  if (a.move === "maintain") return { winner: "b", how: "automatic success against Maintain Course" };
  if (b.move === "maintain") return { winner: "a", how: "automatic success against Maintain Course" };
  const ra = rank(a.check), rb = rank(b.check);
  const sa = a.check?.success, sb = b.check?.success;
  if (sa && !sb) return { winner: "a", how: "success against failure" };
  if (sb && !sa) return { winner: "b", how: "success against failure" };
  if (ra === 3 && rb !== 3) return { winner: "a", how: "Critical Success" };
  if (rb === 3 && ra !== 3) return { winner: "b", how: "Critical Success" };
  if (rb === 0 && ra !== 0) return { winner: "a", how: "the other side's Critical Failure" };
  if (ra === 0 && rb !== 0) return { winner: "b", how: "the other side's Critical Failure" };
  return { winner: null, how: sa ? "both succeed: a tie" : "both fail: a tie" };
}

// Evade moves the band out, Pursue moves it in (one step). Returns the new range and whether it moved.
export function moveBand(range, move) {
  const i = RANGES.indexOf(range);
  const j = Math.max(0, Math.min(2, i + (move === "evade" ? -1 : move === "pursue" ? 1 : 0)));
  return { range: RANGES[j], moved: j !== i, edge: j === i && move !== "maintain" };
}

// Whoever spent the most fuel has [+] on the Thrusters check.
export const fuelAdvantage = (mine, theirs) => (mine > theirs ? "+" : "");

// HOUSE: legal fuel for a move. Evade needs the minimum; the rig's cost includes a fuel leak.
export function checkMove(ship, move, spend, range, have = Infinity) {
  if (!MOVES.includes(move)) return { ok: false, error: "Choose Maintain Course, Evade or Pursue." };
  const n = move === "maintain" ? 0 : clampInt(spend, 0, 99, 0);
  if (move === "evade" && n < evadeMinimum(range)) return { ok: false, error: `Evade needs at least ${evadeMinimum(range)} fuel at ${range[0].toUpperCase() + range.slice(1)} range.` };
  const cost = fuelCostOf(ship, n);
  if (cost > have) return { ok: false, error: `${ship.name} has ${have} fuel; that costs ${cost}.` };
  return { ok: true, move, spend: n, cost };
}

// SBT Attack: the result of one Battle check. check null (an unarmed ship, weapons offline, no resupply) automatically fails.
// Critical Failure +2 MDMG to the attacker, failure +1, success deals `damage`, Critical Success deals double.
export function battleResult(check, damage = 0) {
  if (!check) return { kind: "fail", label: "automatic failure", self: 1, damage: 0 };
  if (check.success) return check.critical ? { kind: "crit", label: "Critical Success", self: 0, damage: damage * 2 } : { kind: "hit", label: "Success", self: 0, damage };
  return check.critical ? { kind: "critfail", label: "Critical Failure", self: 2, damage: 0 } : { kind: "fail", label: "Failure", self: 1, damage: 0 };
}

// SBT: Hull is subtracted from incoming damage; at or above Hull, Hull drops by 1 after the hit. What gets past goes to MDMG. Does not change the ship.
export function hullHit(hull, damage) {
  const dmg = Math.max(0, Math.floor(Number(damage) || 0));
  return { through: Math.max(0, dmg - hull), hullDrops: hull > 0 && dmg >= hull, hull: hull > 0 && dmg >= hull ? hull - 1 : hull };
}
// Applies a hit and any MDMG a ship gave itself. Returns what happened, including the new MDMG total and its effect when the total changed.
export function applyHit(ship, damage, selfMdmg = 0) {
  const was = ship.mdmg;
  const h = hullHit(ship.hull, damage);
  ship.hull = h.hull;
  ship.mdmg = Math.min(99, ship.mdmg + h.through + selfMdmg);
  return { ...h, damage, was, mdmg: ship.mdmg, changed: ship.mdmg !== was, effect: ship.mdmg !== was ? mdmgEffect(ship.mdmg) : null };
}

// SBT Morale: roll 1d10 (0-9, a threshold, not a sum); under the ship's MDMG total it may hail offering a ceasefire or to talk.
export const moraleHails = (mdmg, roll) => mdmg > 0 && roll < mdmg;
export const rollMorale = (rng = randInt) => rollTable("", rng).value;

// SBT: against a ship one class lower, [+] on all Battle checks; against a ship two or more classes higher it can't be beaten head-on.
export const classAdvantage = (attacker, defender) => (attacker.class - defender.class === 1 ? "+" : "");
export const unwinnable = (attacker, defender) => defender.class - attacker.class >= 2;

// SBT: resupplying weapons is required after every fight. `owed` counts fights since: 1 means [-] on Battle checks, 2 or more automatically fail.
export const resupplyEffect = (ship) => (!ship.weapons?.length ? "" : (ship.owed || 0) >= 2 ? "fail" : (ship.owed || 0) === 1 ? "-" : "");

// Whether a ship makes a Battle check at this range, and how: { checks, autoFail, adv, why }.
// SBT: every ship within Firing range makes one; at Detection range only a railgun can fire. An unarmed ship automatically fails.
export function attackStatus(ship, target, range) {
  const inFiring = range !== "detection";
  const reach = ship.weapons.some((w) => w.range === "detection" || inFiring);
  if (!inFiring && !reach) return { checks: false, autoFail: false, adv: "", why: "out of range" };
  if (inFiring && unwinnable(ship, target) && ship.side === "crew") return { checks: false, autoFail: false, adv: "", why: `can't be beaten head-on (${target.name} is two or more classes higher)`, unwinnable: true };
  if (inFiring && !ship.weapons.length) return { checks: true, autoFail: true, adv: "", why: "unarmed" };
  if (weaponsOffline(ship)) return { checks: true, autoFail: true, adv: "", why: "weapons offline" };
  const sup = resupplyEffect(ship);
  if (sup === "fail") return { checks: true, autoFail: true, adv: "", why: "weapons not resupplied" };
  const up = classAdvantage(ship, target) === "+", down = sup === "-";
  return { checks: true, autoFail: false, adv: up && down ? "" : up ? "+" : down ? "-" : "", why: [up && "[+] a ship one class lower", down && "[-] not resupplied"].filter(Boolean).join(", ") };
}

// SBT: a failed ship check gives every crewmember 1 Stress; a Critical Failure also gives every crewmember a Panic Check.
export const shipConsequences = (result) => ({ stressAll: !result.success, panicAll: !result.success && !!result.critical });

// A server-rolled ship check: d100 under the stat, 90-99 always fails, doubles are criticals.
export const rollShipCheck = (stat, adv = "", rng = randInt) => combatCheck(stat, adv, rng);
export const rollHit = (rng = randInt) => rollDice(HIT_DICE, rng).total;

// HOUSE: Maintenance Issues (the book's table isn't available): 6 entries, flavour for the Warden.
export const MAINTENANCE = [
  { name: "Coolant leak", note: "The reactor runs hot and the cab smells of sweet chemicals." },
  { name: "Sensor ghosting", note: "Contacts that aren't there flicker on the plot." },
  { name: "Stuck airlock", note: "The outer door sticks halfway through every cycle." },
  { name: "Drive misfire", note: "The drive stutters when it spools up." },
  { name: "Dead cargo clamp", note: "One clamp on the cargo spine no longer holds." },
  { name: "CB down", note: "The CB radio is dead until it is fixed." },
];
export function rollIssues(result, rng = randInt) {
  const n = result.success ? 0 : result.critical ? 2 : 1;
  return Array.from({ length: n }, () => MAINTENANCE[rng(1, MAINTENANCE.length) - 1].name);
}

// SBT Repairs: major repairs cost 1d5 mcr x the ship's class.
export const majorCost = (cls, roll) => roll * Math.max(1, cls) * 1_000_000;
export const rollMajor = (cls, rng = randInt) => { const d = rollDice("1d5", rng).total; return { roll: d, cost: majorCost(cls, d) }; };
// SBT: minor repairs take 2d10 days (each d10 reads 1-10).
export const rollMinorDays = (rng = randInt) => rollDice("2d10", rng).total;

// SBT Distress signal response (d10 0-9). Outer system +1 step, isolated +2 (the steps move down the list; past decades is never).
export const DISTRESS = [
  { unit: "days", dice: "2d10" },
  { unit: "weeks", dice: "2d10" },
  { unit: "months", dice: "2d10" },
  { unit: "years", dice: "2d10" },
  { unit: "decades", dice: "2d10" },
  { unit: "never" },
];
export const distressStep = (roll) => (roll === 0 ? 0 : roll <= 2 ? 1 : roll <= 4 ? 2 : roll <= 6 ? 3 : roll === 7 ? 4 : 5);
export function distressResponse(roll, steps = 0, rng = randInt) {
  const step = Math.min(5, distressStep(roll) + Math.max(0, steps));
  const row = DISTRESS[step];
  if (row.unit === "never") return { roll, steps, step, never: true, text: "no one answers" };
  const n = rollDice(row.dice, rng).total;
  return { roll, steps, step, never: false, n, unit: row.unit, text: `a response in ${n} ${row.unit}` };
}
export const rollDistress = (steps, rng = randInt) => distressResponse(rollTable("", rng).value, steps, rng);

// What each side can see of a ship at a range (SBT ranges), for the players' screens.
export function identified(ship, range) {
  const out = { range, known: "trajectory and rough size" };
  const t = ship.transponder;
  if (range === "detection") {
    if (t) Object.assign(out, { name: t.callsign || ship.name, captain: t.captain, homePort: t.homePort, destination: t.destination, class: ship.class, kind: ship.kind, known: "transponder" });
    else Object.assign(out, { name: "", known: "no transponder: trajectory and rough size only" });
    return out;
  }
  Object.assign(out, { name: t?.callsign || "", class: ship.class, kind: ship.kind, captain: t?.captain || "", known: "ship class and type" });
  if (range === "contact") Object.assign(out, { hull: ship.hull, mdmg: ship.mdmg, known: "lifeforms aboard, ship status", name: ship.name });
  return out;
}

export function describeShip(s) {
  return `${s.name} (Class ${classLabel(s.class)}${s.kind ? `, ${s.kind}` : ""}): Thrusters ${s.thrusters}, Battle ${s.battle}, Systems ${s.systems}, Hull ${s.hull}/${s.hullMax}, MDMG ${s.mdmg}${mdmgEffect(s.mdmg) ? ` (${mdmgEffect(s.mdmg).name})` : ""}, ${s.weapons.length ? `weapons: ${s.weapons.map((w) => `${w.name} (${w.range})`).join(", ")}` : "unarmed"}${s.fuel !== undefined ? `, fuel ${s.fuel}` : ""}`;
}

export const newFight = (ships, range = "firing") => ({
  id: Date.now().toString(36),
  ships,
  range: RANGES.includes(range) ? range : "firing",
  round: 1,
  moves: { crew: null, enemy: null },
  fire: { crew: null, enemy: null },
  stations: {},
  skills: {},
  waiting: null,
  hails: [],
  boarding: false,
  ended: false,
  startMdmg: Object.fromEntries(ships.map((s) => [s.id, s.mdmg])),
  log: [],
});

// The agent's ship_fight reply field: { start: { ship, range }, end, enemy_move, fuel }, or null when it changes nothing.
export function normalizeShipFight(raw) {
  if (!raw || typeof raw !== "object") return null;
  const out = {};
  if (raw.start && typeof raw.start === "object" && text(raw.start.ship, 40)) out.start = { ship: text(raw.start.ship, 40), range: RANGES.includes(raw.start.range) ? raw.start.range : "firing" };
  if (raw.end === true) out.end = true;
  if (typeof raw.enemy_fire === "boolean") out.enemy_fire = raw.enemy_fire;
  if (MOVES.includes(raw.enemy_move)) { out.enemy_move = raw.enemy_move; out.fuel = clampInt(raw.fuel, 0, 99, 0); }
  return Object.keys(out).length ? out : null;
}

// What the agent is told about ship combat every turn (state is the live session state).
export function shipBrief(state) {
  const f = state.shipFight;
  const ships = state.config?.ships || [];
  const head = "SHIP-TO-SHIP COMBAT (Shipbreaker's Toolkit via a summary; the numbers, 1d5 hits and the Maintenance table are campaign house rules, not Mothership rules). The app rolls and applies every check, hit, MDMG effect, fuel spend and range change: never invent them. Hails, boarding at Contact range and surrender are always options for either side.";
  if (!f) {
    if (!ships.length) return "";
    return `${head}\nNo ship fight is under way. Ships in this story: ${ships.map((x) => `${x.id} = ${describeShip(x)}`).join("; ")}. Start a fight only when the fiction makes it one: ship_fight.start = { ship: <id>, range: "detection" | "firing" | "contact" }.`;
  }
  const rig = f.ships.find((x) => x.side === "crew"), foes = f.ships.filter((x) => x.side === "enemy");
  const lines = [
    head,
    f.ended ? "The ship fight is OVER (narrate the aftermath)." : `Round ${f.round}, range ${f.range.toUpperCase()}. ${RANGE_NOTES[f.range]}`,
    `The crew's ship: ${describeShip(rig)}.${weaponsOffline(rig) ? " Her weapons are offline." : ""}${navOffline(rig) ? " Navigation is offline." : ""}${fuelLeak(rig) ? " She leaks fuel (every fuel spend costs +1)." : ""}`,
    ...foes.map((x) => `The enemy: ${describeShip(x)}.${x.transponder ? " It broadcasts a transponder." : " It broadcasts no transponder."}${unwinnable(rig, x) ? " It is two or more classes above the rig: the crew cannot beat it head-on; their options are flight, surrender or a trick." : classAdvantage(rig, x) ? " It is a class below the rig." : ""}`),
  ];
  if (!f.ended) {
    const m = f.moves?.enemy;
    lines.push(m ? `The enemy's move this round is set: ${m.move}${m.spend ? `, ${m.spend} fuel` : ""}. The crew's course is secret until the Warden resolves movement.` : "The enemy's move for this round is NOT set yet: choose it with ship_fight.enemy_move (maintain, evade or pursue) and ship_fight.fuel (Evade needs at least 3 fuel at Contact, 2 at Firing, 1 at Detection; Maintain Course spends none) when the Warden asks or the fiction needs it.");
    lines.push("Each round every ship chooses to fire or hold fire (house rule): an armed enemy fires by default; set ship_fight.enemy_fire = false to hold fire, or true to make an unarmed one try (an automatic failure). Only a ship that fires makes a Battle check and suffers its results.");
    lines.push("Narrate each [ROLL RESULT] from the app (movement, attack, morale) in the fiction. End the fight with ship_fight.end = true when it is over (a ceasefire, a surrender, one side gone, a boarding that settles it).");
  }
  if (f.boarding) lines.push("BOARDING: the enemy has boarded; run it as crew combat (attacks, crew_attacks).");
  if (f.hails?.length) lines.push(`MORALE: ${f.hails.map((h) => foes.find((x) => x.id === h.ship)?.name || "an enemy").join(", ")} broke and hails the crew offering a ceasefire or to talk (round ${f.hails.at(-1).round}). Voice that hail.`);
  if (rig?.issues?.length) lines.push(`The rig's Maintenance Issues (house rule): ${rig.issues.join(", ")}.`);
  return lines.join("\n");
}
