import { randInt, rollDice } from "./dice.js";
import { sanitizeRequest, checkLabel, PANIC } from "./rolls.js";
import { playable, gainStress, findSkill } from "./crew.js";
import { campaignById, isTransit, laneBetween } from "./campaign.js";
import {
  RANGES, STATIONS, STATION_SKILL, classLabel, sanitizeShip, newFight, checkMove, fuelCostOf, evadeMinimum,
  movementOutcome, moveBand, fuelAdvantage, rollShipCheck, rollHit, battleResult, applyHit, attackStatus, navOffline, mdmgEffect,
  rollMorale, moraleHails, rollIssues, rollMajor, rollMinorDays, rollDistress, identified, describeShip, MAINTENANCE, PATCH_COST, RESUPPLY_COST, unwinnable, classAdvantage, shipConsequences,
} from "./ships.js";

// The session-side half of ship-to-ship combat (rules and numbers in ships.js). state.shipFight is saved with the session.
const RIG = "rig";
// Tests swap the dice here.
export const hooks = { rng: randInt };
const cap = (w) => w[0].toUpperCase() + w.slice(1);
const pad = (d) => String(d).padStart(2, "0");
const advWord = (a) => (a === "+" ? "advantage" : a === "-" ? "disadvantage" : "none");

export const fightOf = (s) => s.state.shipFight || null;
const live = (s) => { const f = fightOf(s); return f && !f.ended ? f : null; };
const rigOf = (f) => f.ships.find((x) => x.side === "crew");
const foesOf = (f) => f.ships.filter((x) => x.side === "enemy");
const bad = (s, text) => s.send("dm", { t: "toast", level: "error", text });

const campaignOf = (s) => {
  const p = s.state.campaign, c = campaignById(p?.id);
  return c ? { p, c } : null;
};
// Attacking is a choice each round: an armed ship fires unless told to hold, an unarmed one holds unless told to fire (house rule).
export const fires = (f, sh) => f.fire?.[sh.side] ?? sh.weapons.length > 0;
const alive = (s) => s.state.config.crew.filter(playable);

// ---- Fuel (house rule: 1 rules fuel = 1 rig fuel unit), kept where the rig keeps it.
export const rigFuel = (s) => {
  const r = s.state.station?.rig;
  return r && Number.isFinite(Number(r.fuel_units)) ? Number(r.fuel_units) : s.state.campaign?.resources?.fuel ?? 0;
};
function spendRigFuel(s, n) {
  const r = s.state.station?.rig;
  if (r && Number.isFinite(Number(r.fuel_units))) r.fuel_units = String(Math.max(0, Number(r.fuel_units) - n));
  else if (s.state.campaign) s.state.campaign.resources.fuel = Math.max(0, s.state.campaign.resources.fuel - n);
}

// Writes the rig back into the campaign so Hull, MDMG and what it owes carry between stories (campaign.js carryInto / finishInto read p.ship).
function syncRig(s) {
  const f = fightOf(s), p = s.state.campaign;
  const rig = f && rigOf(f);
  if (rig && p) {
    const { side, ...keep } = rig;
    p.ship = keep;
  }
}

// ---- Undo: one step of a fight is one Retcon, like an agent's reply.
export function shipSnapshot(s) {
  return { fight: structuredClone(s.state.shipFight || null), ship: structuredClone(s.state.campaign?.ship || null), offers: structuredClone(s.state.offers || []), clocks: structuredClone(s.state.clocks || []) };
}
export function restoreShip(s, snap) {
  if (!snap) return;
  const had = !!s.state.shipFight || !!snap.fight;
  s.state.shipFight = snap.fight;
  if (s.state.campaign && snap.ship) s.state.campaign.ship = snap.ship;
  s.state.offers = snap.offers;
  s.shipSnap = null;
  if (had) s.sendHeader();
}
function step(s, fn) {
  if (s.delivering) return fn();
  const top = s.undoStack.at(-1);
  const own = s.shipSnap && s.shipSnap === top ? top : s.undoSnapshot();
  const fresh = own !== top;
  s.delivering = own;
  try { return fn(); } finally {
    s.delivering = null;
    if (fresh && own.entries.length) s.undoStack = [...s.undoStack, own].slice(-5);
    s.shipSnap = own;
  }
}

function changed(s) {
  syncRig(s);
  s.sendHeader();
  s.syncDm();
  s.touch();
}
function note(s, f, text, kind = "note", extra = {}) {
  f?.log.push(`R${f.round} ${text.split("\n")[0]}`);
  if (f && f.log.length > 40) f.log.splice(0, f.log.length - 40);
  return s.addLog(kind, text, kind === "roll" ? { combat: true, ship: true, ...extra } : extra);
}

// ---- Starting and ending
export function startFight(s, spec = {}) {
  const cp = campaignOf(s);
  if (!cp) return bad(s, "Ship fights run inside a campaign (the rig is the crew's ship).");
  if (live(s)) return bad(s, "A ship fight is already under way.");
  const raw = spec.custom && typeof spec.custom === "object"
    ? spec.custom
    : (s.state.config.ships || []).find((x) => x.id === spec.ship || x.name.toLowerCase() === String(spec.ship || "").toLowerCase());
  if (!raw) return bad(s, "No such ship in this story. Use a ship from the story's list, or a custom one.");
  const foe = sanitizeShip({ ...raw, id: raw.id || "custom", side: "enemy", mdmg: 0, hull: raw.hull, hullMax: raw.hullMax ?? raw.hull });
  const rig = sanitizeShip({ ...cp.p.ship, side: "crew" });
  const f = newFight([rig, foe], spec.range);
  f.phase = "choose";
  s.state.shipFight = f;
  s.shipSnap = null;
  note(s, f, `SHIP FIGHT: ${rig.name} AND ${foe.name}. RANGE ${f.range.toUpperCase()}.`, "note");
  s.addLog("note", `Ship fight (Shipbreaker's Toolkit via a summary; ship numbers, 1d5 hits and the rest of the setup are house rules). ${describeShip(rig)}. ${describeShip(foe)}.${unwinnable(rig, foe) ? ` ${foe.name} is two or more classes above the rig: it can't be beaten head-on. The crew's options are flight, surrender or a trick.` : ""}`);
  changed(s);
  return true;
}

export function endFight(s, how = "") {
  const f = live(s);
  if (!f) return;
  step(s, () => {
    const rig = rigOf(f);
    f.ended = true;
    f.waiting = null;
    if (rig.weapons.length) rig.owed = Math.min(9, (rig.owed || 0) + 1);
    const took = rig.mdmg > (f.startMdmg[rig.id] ?? 0);
    note(s, f, `SHIP FIGHT OVER${how ? `: ${how.toUpperCase()}` : ""}. ${rig.name} HULL ${rig.hull}/${rig.hullMax}, MDMG ${rig.mdmg}.`);
    if (rig.weapons.length) s.addLog("note", `Weapons must be resupplied after every fight (SBT, via a summary): ${rig.owed === 1 ? "Battle checks next fight are at [-]" : "Battle checks next fight automatically fail"} until the rig resupplies (house rule: 1 kcr per weapon at a port).`);
    syncRig(s);
    if (took) { f.afterDue = true; callAfter(s, f); }
    else s.addLog("note", `${rig.name} took no MDMG this fight: no Systems check is needed.`);
  });
  changed(s);
  if (!f.waiting && s.hasKey()) s.requestReply();
}

// SBT: after the battle a ship that took MDMG makes a Systems check. If a roll is in the way it stays due (the Warden's button calls it).
function callAfter(s, f) {
  if (s.state.roll?.status === "waiting") return s.addLog("note", "The Systems check after the battle is due once the roll in progress is done (Systems check button).");
  if (callCheck(s, f, "engineer", "systems", { kind: "after", reason: "AFTER THE BATTLE: SYSTEMS CHECK" })) f.afterDue = false;
}

// ---- Stations and the skill that goes with a check
export function pcAt(s, f, station) {
  const crew = alive(s);
  return crew.find((c) => f.stations[c.id] === station) || null;
}
function rollerFor(s, f, station) {
  const crew = alive(s);
  const skillName = STATION_SKILL[station];
  return pcAt(s, f, station) || (skillName && crew.find((c) => findSkill(c, skillName))) || crew[0] || null;
}
function skillFor(f, pc, station) {
  const want = f.skills[station] ?? STATION_SKILL[station];
  return want && findSkill(pc, want) ? findSkill(pc, want).name : "";
}

// ---- A ship check on a player's screen: the ship's stat, that one character's skill bonus; consequences are applied when the step resolves.
function callCheck(s, f, station, stat, { kind, reason, advantage = "none" }) {
  const rig = rigOf(f);
  const pc = rollerFor(s, f, station);
  if (!pc) { bad(s, "No crew member can make the check."); return false; }
  if (s.state.roll?.status === "waiting") { bad(s, "Finish the roll in progress first."); return false; }
  let req;
  try {
    req = sanitizeRequest({ pc: pc.id, check: "intellect", skill: skillFor(f, pc, station), advantage, reason }, s.state.config.crew);
  } catch (err) { bad(s, err.message); return false; }
  req.check = "ship";
  req.ship = { stat, label: `${rig.name} ${cap(stat)}`, value: rig[stat], station, kind };
  f.waiting = { kind, roll: req.id, pc: pc.id };
  s.state.roll = req;
  s.addLog("note", `Ship check called for ${pc.name} (${station}): ${checkLabel(req)}${req.skill ? ` + ${req.skill}` : ""} against ${rig.name}'s ${cap(stat)} ${rig[stat]}.${reason ? ` ${reason}` : ""}`);
  s.toPlayers({ t: "roll", roll: s.publicRoll() });
  changed(s);
  return true;
}

// Called from Session.finishRoll when a ship check is done.
export function shipRollDone(s, roll) {
  const f = fightOf(s);
  if (!f?.waiting || f.waiting.roll !== roll.id) return;
  const got = roll.results[f.waiting.pc]?.result;
  const kind = f.waiting.kind;
  f.waiting = null;
  if (!got) return;
  const check = { success: got.success, critical: got.critical };
  if (kind === "movement") finishMovement(s, f, check);
  else if (kind === "attack") finishAttack(s, f, check);
  else if (kind === "after") finishAfter(s, f, check);
  else step(s, () => crewConsequences(s, f, check, `${rigOf(f).name} ${cap(roll.ship.stat)}`));
}

// SBT: a failed ship check gives all crew 1 Stress; a Critical Failure makes all of them take a Panic Check.
function crewConsequences(s, f, check, what) {
  const c = shipConsequences(check);
  if (c.stressAll) {
    for (const pc of alive(s)) {
      const { from, to, over } = gainStress(pc, 1);
      s.addLog("note", `${pc.name}: Stress ${from} → ${to} (${what} failed: all crew +1 Stress).`);
      s.stressOver(pc, over);
    }
    s.crewChanged();
  }
  if (c.panicAll) s.offerRoll(`Panic Check for the whole crew (${what}: Critical Failure)`, { pc: "all", check: PANIC, reason: `${what} Critical Failure` });
}

// ---- Movement
export function setMove(s, side, move, spend, shipId) {
  const f = live(s);
  if (!f) return;
  if (f.waiting) return bad(s, "A check is waiting; finish it first.");
  const ship = side === "crew" ? rigOf(f) : foesOf(f).find((x) => x.id === shipId) || foesOf(f)[0];
  const have = side === "crew" ? rigFuel(s) : ship.fuel ?? Infinity;
  const r = checkMove(ship, move, spend, f.range, have);
  if (!r.ok) return bad(s, r.error);
  f.moves[side] = { move: r.move, spend: r.spend };
  changed(s);
  return true;
}
export const setCrewMove = (s, move, spend) => setMove(s, "crew", move, spend);
export const setEnemyMove = (s, move, spend, shipId) => setMove(s, "enemy", move, spend, shipId);

export function resolveMovement(s) {
  const f = live(s);
  if (!f) return;
  if (f.waiting || s.state.roll?.status === "waiting") return bad(s, "A roll is waiting; finish it first.");
  const { crew: cm, enemy: em } = f.moves;
  if (!cm || !em) return bad(s, !cm ? "The crew haven't chosen a move." : "Choose the enemy's move first.");
  if (f.movedRound === f.round) return bad(s, "Movement is already resolved this round.");
  const rig = rigOf(f);
  const again = checkMove(rig, cm.move, cm.spend, f.range, rigFuel(s));
  if (!again.ok) return bad(s, again.error);
  const active = cm.move !== "maintain" && em.move !== "maintain";
  if (active && !navOffline(rig) && !rollerFor(s, f, "pilot")) return bad(s, "Nobody can fly the rig.");
  step(s, () => {
    const foe = foesOf(f)[0];
    spendRigFuel(s, again.cost);
    if (foe.fuel !== undefined) foe.fuel = Math.max(0, foe.fuel - fuelCostOf(foe, em.spend));
    if (active && !navOffline(rig)) {
      callCheck(s, f, "pilot", "thrusters", { kind: "movement", reason: `${cm.move.toUpperCase()}${cm.spend ? `, ${cm.spend} fuel` : ""}`, advantage: advWord(fuelAdvantage(cm.spend, em.spend)) });
    } else finishMovement(s, f, null);
  });
}

function finishMovement(s, f, crewCheck) {
  step(s, () => {
    const { crew: cm, enemy: em } = f.moves;
    const rig = rigOf(f), foe = foesOf(f)[0];
    const bothActive = cm.move !== "maintain" && em.move !== "maintain";
    const enemyAdv = fuelAdvantage(em.spend, cm.spend);
    const enemyCheck = bothActive && !navOffline(foe) ? rollShipCheck(foe.thrusters, enemyAdv, hooks.rng) : null;
    const out = movementOutcome({ move: cm.move, check: bothActive ? crewCheck : null }, { move: em.move, check: bothActive ? enemyCheck : null });
    const winMove = out.winner === "a" ? cm.move : out.winner === "b" ? em.move : null;
    const was = f.range;
    const moved = winMove ? moveBand(f.range, winMove) : null;
    if (moved) f.range = moved.range;
    const roll = (c, who, stat, adv) => c ? `${who} THRUSTERS ${stat}${adv ? ` [${adv}]` : ""}: ROLLED ${pad(c.d ?? 0)}, ${c.success ? (c.critical ? "CRITICAL SUCCESS" : "SUCCESS") : c.critical ? "CRITICAL FAILURE" : "FAILURE"}` : "";
    const crewLine = bothActive ? (crewCheck ? `${rig.name.toUpperCase()}: ${crewCheck.success ? (crewCheck.critical ? "CRITICAL SUCCESS" : "SUCCESS") : crewCheck.critical ? "CRITICAL FAILURE" : "FAILURE"}` : `${rig.name.toUpperCase()}: NO THRUSTERS CHECK (NAVIGATION OFFLINE): FAILS`) : "";
    const lines = [
      `MOVEMENT · ${rig.name.toUpperCase()} ${cm.move.toUpperCase()}S${cm.spend ? ` (${cm.spend} FUEL)` : ""} · ${foe.name.toUpperCase()} ${em.move.toUpperCase()}S${em.spend ? ` (${em.spend} FUEL)` : ""}`,
      crewLine,
      bothActive ? (enemyCheck ? roll(enemyCheck, foe.name.toUpperCase(), foe.thrusters, enemyAdv) : `${foe.name.toUpperCase()}: NO THRUSTERS CHECK: FAILS`) : "",
      moved ? (moved.moved ? `RANGE ${was.toUpperCase()} → ${f.range.toUpperCase()} (${out.how})` : `RANGE STAYS ${f.range.toUpperCase()}: ${winMove === "evade" ? "NO FURTHER OUT" : "NO CLOSER"}`) : `RANGE STAYS ${f.range.toUpperCase()}${out.how ? ` (${out.how})` : ""}`,
    ].filter(Boolean);
    note(s, f, lines.join("\n"), "roll");
    if (bothActive && crewCheck) crewConsequences(s, f, crewCheck, `${rig.name} Thrusters`);
    if (moved && !moved.moved && winMove === "evade") s.addLog("note", `The band can't go further out than Detection. The Warden rules whether the ship breaks away (End fight, "escaped").`);
    f.movedRound = f.round;
    f.phase = "moved";
    syncRig(s);
  });
  changed(s);
  if (s.state.roll?.status !== "waiting" && s.hasKey()) s.requestReply();
}

// ---- Attack and morale
export function resolveAttack(s) {
  const f = live(s);
  if (!f) return;
  if (f.waiting || s.state.roll?.status === "waiting") return bad(s, "A roll is waiting; finish it first.");
  if (f.attackedRound === f.round) return bad(s, "The attack phase is already resolved this round.");
  const rig = rigOf(f), foe = foesOf(f)[0];
  const st = attackStatus(rig, foe, f.range);
  step(s, () => {
    if (st.checks && !st.autoFail && fires(f, rig)) {
      if (!callCheck(s, f, "gunner", "battle", { kind: "attack", reason: `BATTLE CHECK${st.adv ? ` [${st.adv}]` : ""}${st.why ? ` (${st.why})` : ""}`, advantage: advWord(st.adv) })) return;
    } else finishAttack(s, f, null);
  });
}

function finishAttack(s, f, crewCheck) {
  step(s, () => {
    const rig = rigOf(f);
    const before = Object.fromEntries(f.ships.map((x) => [x.id, x.mdmg]));
    const rows = [];
    for (const sh of f.ships) {
      const target = f.ships.find((x) => x.side !== sh.side);
      const st = attackStatus(sh, target, f.range);
      if (!st.checks || !fires(f, sh)) { rows.push({ sh, st: st.checks ? { why: "holds fire" } : st, skip: true }); continue; }
      let check = null, shown = "";
      if (st.autoFail) shown = `AUTOMATIC FAILURE (${st.why.toUpperCase()})`;
      else if (sh.side === "crew") { check = crewCheck; shown = crewCheck ? `ROLLED, ${crewCheck.success ? (crewCheck.critical ? "CRITICAL SUCCESS" : "SUCCESS") : crewCheck.critical ? "CRITICAL FAILURE" : "FAILURE"}` : "NO CHECK"; }
      else { check = rollShipCheck(sh.battle, st.adv, hooks.rng); shown = `BATTLE ${sh.battle}${st.adv ? ` [${st.adv}]` : ""}: ROLLED ${pad(check.d)}, ${check.success ? (check.critical ? "CRITICAL SUCCESS" : "SUCCESS") : check.critical ? "CRITICAL FAILURE" : "FAILURE"}`; }
      const dmg = check?.success ? rollHit(hooks.rng) : 0;
      rows.push({ sh, target, st, check, br: battleResult(check, dmg), shown });
    }
    const lines = [`ATTACK · RANGE ${f.range.toUpperCase()}`];
    for (const r of rows) {
      if (r.skip) { lines.push(`${r.sh.name.toUpperCase()}: ${r.st.unwinnable ? "CAN'T BE BEATEN HEAD-ON: NO ATTACK" : `NO ATTACK (${r.st.why.toUpperCase()})`}`); continue; }
      const out = r.br.kind === "hit" || r.br.kind === "crit" ? `${r.br.label.toUpperCase()}: ${r.br.damage} DAMAGE TO ${r.target.name.toUpperCase()}${r.br.kind === "crit" ? " (DOUBLE)" : ""}` : `${r.br.label.toUpperCase()}: +${r.br.self} MDMG TO ITSELF`;
      lines.push(`${r.sh.name.toUpperCase()}: ${r.shown} · ${out}`);
    }
    // Resolve everything at once: damage and self-MDMG after all the checks.
    const hits = [];
    for (const r of rows) {
      if (r.skip) continue;
      if (r.br.self) hits.push({ ship: r.sh, damage: 0, self: r.br.self });
      if (r.br.damage) hits.push({ ship: r.target, damage: r.br.damage, self: 0 });
    }
    for (const h of hits) {
      const res = applyHit(h.ship, h.damage, h.self);
      const hull = `${h.ship.name.toUpperCase()}: HULL ${res.damage - res.through} ABSORBED${res.hullDrops ? `, HULL DROPS TO ${h.ship.hull}` : ""}, ${res.through} GETS THROUGH`;
      if (h.damage && h.ship.side === "crew") lines.push(hull);
      else if (h.damage) s.addLog("note", hull);
    }
    note(s, f, lines.join("\n"), "roll");
    // Status lines: the Warden's eyes.
    for (const sh of f.ships) {
      if (sh.mdmg !== before[sh.id]) s.addLog("note", `${sh.name}: MDMG ${before[sh.id]} → ${sh.mdmg}, Hull ${sh.hull}/${sh.hullMax}${mdmgEffect(sh.mdmg) ? `. EFFECT: ${mdmgEffect(sh.mdmg).name}: ${mdmgEffect(sh.mdmg).rule}` : ""}`);
    }
    // SBT: a failed ship check on the rig's side gives all crew 1 Stress; a Critical Failure, a Panic Check each.
    const mine = rows.find((r) => r.sh === rig && !r.skip);
    if (mine) {
      const failed = mine.br.kind === "fail" || mine.br.kind === "critfail";
      if (failed) crewConsequences(s, f, { success: false, critical: mine.br.kind === "critfail" }, `${rig.name} Battle check`);
    }
    for (const sh of f.ships) if (sh.mdmg !== before[sh.id]) runEffect(s, f, sh);
    // SBT Morale: 1d10 for any enemy that took MDMG this round; under its MDMG, it may hail.
    for (const foe of foesOf(f)) {
      if (foe.mdmg <= before[foe.id]) continue;
      const roll = rollMorale(hooks.rng);
      const hails = moraleHails(foe.mdmg, roll);
      s.addLog("note", `Morale: ${foe.name} rolls ${roll} against MDMG ${foe.mdmg}: ${hails ? "it may hail, offering a ceasefire or to talk" : "it fights on"}.`);
      if (hails) { f.hails = [...f.hails.filter((h) => h.ship !== foe.id), { ship: foe.id, round: f.round }]; s.addLog("warden", `MORALE: ${foe.name} has taken MDMG and its morale breaks (SBT). It hails the crew offering a ceasefire or to talk. Voice the hail now.`); }
    }
    f.attackedRound = f.round;
    f.round += 1;
    f.moves = { crew: null, enemy: null };
    f.fire = { crew: null, enemy: null };
    f.phase = "choose";
    syncRig(s);
  });
  changed(s);
  if (s.state.roll?.status !== "waiting" && s.hasKey()) s.requestReply();
}

function finishAfter(s, f, check) {
  step(s, () => {
    const rig = rigOf(f);
    if (!check.success) {
      const got = rollIssues(check, hooks.rng);
      rig.issues = [...(rig.issues || []), ...got].slice(0, 12);
      s.addLog("note", `Systems check failed after the battle: Maintenance Issue${got.length > 1 ? "s" : ""} (house rule table): ${got.join(", ")}. ${got.map((n) => MAINTENANCE.find((m) => m.name === n)?.note).filter(Boolean).join(" ")}`);
    } else s.addLog("note", `Systems check passed: no Maintenance Issue.`);
    crewConsequences(s, f, check, `${rig.name} Systems`);
    syncRig(s);
  });
  changed(s);
}

// ---- MDMG effects on the rig: the people aboard feel them through the hazards.
const rigRooms = (s) => {
  const cp = campaignOf(s);
  return (cp?.c.ship.rooms || []).filter((r) => r !== cp.c.ship.room && r !== "container");
};
export function runEffect(s, f, ship, rng = hooks.rng) {
  const e = mdmgEffect(ship.mdmg);
  if (!e) return;
  if (ship.side !== "crew") {
    s.addLog("note", `${ship.name} at MDMG ${ship.mdmg}: ${e.name}. ${e.rule} (an enemy ship: narrate it${e.n >= 9 ? "; it is destroyed in 1d10 minutes" : ""}).`);
    if (e.n >= 9) abandon(s, ship, rng);
    return;
  }
  s.addLog("warden", `SHIP MDMG ${ship.mdmg}: ${e.name.toUpperCase()}. ${e.rule}${e.n <= 3 ? " (it changes the fight)" : " (the app applies it to the people aboard)"}`);
  switch (e.key) {
    case "fire": {
      const rooms = rigRooms(s);
      if (!rooms.length) break;
      const a = rooms[rng(0, rooms.length - 1)];
      const b = rooms.filter((r) => r !== a)[rng(0, Math.max(0, rooms.length - 2))] || a;
      s.setHazard(a, "toxic");
      if (b !== a) s.setHazard(b, "corrosive", 10);
      else s.setHazard(a, "corrosive", 10);
      s.addLog("note", `Fire on deck (SBT): the burning sections are a toxic atmosphere in ${a}${b !== a ? ` and a highly corrosive one (level 10) in ${b}` : ""}. The hazards tool keeps one hazard per room, so the two share out.`);
      break;
    }
    case "breach":
      if (s.state.station.hazards?.[RIG]?.type === "breach") { s.hazardUnits.push({ u: "event", room: RIG, type: "breach" }); s.pumpHazards(); } else s.setHazard(RIG, "breach");
      break;
    case "life": {
      const r = s.state.station.rig ||= {};
      r.life_support = "OFFLINE";
      s.syncHazards();
      s.sendHeader();
      break;
    }
    case "radiation": {
      s.setHazard("engine_room", "radiation", 1);
      leakClock(s, rng);
      break;
    }
    case "dead":
      for (const [path, value] of [["reactor", "EMERGENCY POWER"], ["drive", "OFFLINE"], ["power", "EMERGENCY POWER ONLY"], ["lights.deck_1", "EMERGENCY"], ["lights.deck_2", "EMERGENCY"], ["lights.deck_3", "EMERGENCY"], ["cameras.cargo_spine", "OFFLINE"]]) {
        if (path !== "power" && !has(s.state.station, path)) continue;
        setAt(s.state.station, path, value);
        s.addLog("note", `Station: ${path} → ${value}`);
      }
      s.sendHeader();
      break;
    case "abandon":
      abandon(s, ship, rng);
      break;
  }
}
const has = (obj, dotted) => dotted.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), obj) !== undefined;
function setAt(obj, dotted, value) {
  const keys = dotted.split(".");
  let o = obj;
  for (const k of keys.slice(0, -1)) o = o[k] && typeof o[k] === "object" ? o[k] : (o[k] = {});
  o[keys.at(-1)] = value;
}
function abandon(s, ship, rng = hooks.rng) {
  const minutes = rollDice("1d10", rng).total;
  s.startClock(ship.side === "crew" ? "ABANDON SHIP" : `${ship.name} DESTROYED`, minutes * 60, "ship");
  s.addLog("note", `${ship.name}: abandon ship (SBT): destroyed in ${minutes} minute${minutes > 1 ? "s" : ""} (1d10). A clock is on every screen.`);
}
function leakClock(s, rng = hooks.rng) {
  const minutes = rollDice("2d10", rng).total;
  s.startClock("RADIATION LEAK: LEVEL +1", minutes * 60, "ship");
}
// A ship clock that does something when it runs out. Returns true when handled.
export function shipClockRan(s, clock, rng = hooks.rng) {
  if (!/^RADIATION LEAK/.test(clock.label)) return false;
  const h = s.state.station.hazards?.engine_room;
  if (h?.type !== "radiation") return true;
  const level = Math.min(3, (h.level || 1) + 1);
  s.setHazard("engine_room", "radiation", level);
  s.addLog("note", `Radiation leak (SBT): Radiation Level ${level}.`);
  if (level < 3) leakClock(s, rng);
  return true;
}

// ---- Boarding at Contact range hands over to crew combat.
export function board(s) {
  const f = live(s);
  if (!f) return;
  if (f.range !== "contact") return bad(s, "Boarding needs Contact range.");
  const foe = foesOf(f)[0];
  f.boarding = true;
  s.addLog("warden", `BOARDING: ${foe.name} is at Contact range and boards ${rigOf(f).name}. Switch to crew combat (no initiative, the usual attacks and Wounds). The ship fight can resume if the boarders are beaten.`);
  if (foe.adversary) s.revealAdversaries([foe.adversary]);
  note(s, f, `BOARDING · ${foe.name.toUpperCase()} BOARDS ${rigOf(f).name.toUpperCase()}. CREW COMBAT TAKES OVER.`);
  changed(s);
  if (s.hasKey()) s.requestReply();
}

export function setFire(s, side, on) {
  const f = live(s);
  if (!f || !["crew", "enemy"].includes(side) || f.waiting) return;
  f.fire = { ...f.fire, [side]: !!on };
  changed(s);
  return true;
}

export function setRange(s, range) {
  const f = live(s);
  if (!f || !RANGES.includes(range) || range === f.range) return;
  step(s, () => { s.addLog("note", `Range ${f.range} → ${range} (the Warden's call).`); f.range = range; });
  changed(s);
}

export function cancelWaiting(s) {
  const f = fightOf(s);
  if (!f?.waiting) return;
  if (s.state.roll?.status === "waiting" && s.state.roll.id === f.waiting.roll) {
    s.state.roll = null;
    s.toPlayers({ t: "roll", roll: null });
  }
  f.waiting = null;
  s.addLog("note", "The ship step was cancelled.");
  changed(s);
}

// ---- Distress signal (SBT table; house rule: the Rim is an outer system, +1 step, the Dark Lane isolated, +2)
export function distress(s, rng = hooks.rng) {
  const cp = campaignOf(s);
  let steps = 0, where = "";
  if (cp) {
    const story = cp.c.stories.find((x) => x.id === cp.p.current);
    const dark = story && isTransit(story) && laneBetween(cp.c, story.from, story.to)?.dark;
    steps = dark ? 2 : 1;
    where = dark ? "the Dark Lane (isolated, +2 steps, house rule)" : "the Rim (an outer system, +1 step, house rule)";
  }
  const r = rollDistress(steps, rng);
  s.addLog("roll", `DISTRESS SIGNAL${where ? ` FROM ${where.toUpperCase()}` : ""}\nROLLED ${r.roll}${steps ? ` +${steps} STEP${steps > 1 ? "S" : ""}` : ""}: ${r.never ? "NO ONE ANSWERS" : `RESPONSE IN ${r.n} ${r.unit.toUpperCase()}`}`, { combat: true, ship: true });
  s.syncDm();
  if (s.hasKey()) s.requestReply();
}

// ---- The rig between stories (house rules except the repair cost, which is SBT)
export function rigAction(s, msg, rng = hooks.rng) {
  const cp = campaignOf(s);
  if (!cp) return;
  const { p, c } = cp;
  const rig = sanitizeShip(p.ship);
  const port = !p.current;
  const needPort = () => { if (!port) { bad(s, "Finish the story being played first (this needs a port)."); return true; } };
  const kcr = (n) => `${(n / 1000).toLocaleString("en-US")} kcr`;
  switch (msg.t) {
    case "shipResupply":
      if (needPort()) return;
      if (!rig.weapons.length) return bad(s, `${rig.name} is unarmed: no weapons to resupply.`);
      rig.owed = 0;
      s.addLog("note", `Weapons resupplied: ${rig.weapons.length} weapon${rig.weapons.length > 1 ? "s" : ""}, ${kcr(rig.weapons.length * RESUPPLY_COST)} (house rule: 1 kcr per weapon). The Warden takes the credits.`);
      break;
    case "shipFit": {
      if (msg.remove) { rig.weapons = []; rig.armed = false; s.addLog("note", `${rig.name}'s weapons are removed: unarmed again, her Battle checks automatically fail.`); break; }
      const name = String(msg.name || "").replace(/\s+/g, " ").trim().slice(0, 40);
      const battle = Math.round(Number(msg.battle));
      if (!name || !(battle >= 1 && battle <= 99)) return bad(s, "Name the weapon and give the rig a Battle stat from 1 to 99.");
      rig.weapons = [{ name, range: msg.range === "detection" ? "detection" : "firing" }];
      rig.battle = battle;
      s.addLog("note", `${rig.name} is fitted with ${name} (${rig.weapons[0].range === "detection" ? "Detection" : "Firing"} range), Battle ${battle} (the Warden's numbers, house rule).`);
      break;
    }
    case "shipMinor": {
      if (needPort()) return;
      const i = Number(msg.issue);
      if (!rig.issues?.[i]) return;
      const days = rollMinorDays(rng);
      const [gone] = rig.issues.splice(i, 1);
      s.addLog("note", `Minor repair (SBT: 2d10 days): ${gone} fixed in ${days} days.`);
      break;
    }
    case "shipMajor": {
      if (needPort()) return;
      if (!rig.mdmg && rig.hull >= rig.hullMax) return bad(s, `${rig.name} needs no major repairs.`);
      const m = rollMajor(rig.class, rng);
      rig.mdmg = 0;
      rig.hull = rig.hullMax;
      s.addLog("note", `Major repairs at a port (SBT: 1d5 mcr x the ship's class): rolled ${m.roll} x class ${classLabel(rig.class)} = ${(m.cost / 1_000_000).toLocaleString("en-US")} mcr. MDMG and Hull are fully repaired; finishing them takes months or years. The Warden takes the credits.`);
      break;
    }
    case "shipPatch": {
      if (needPort()) return;
      if (rig.mdmg < 1) return bad(s, `${rig.name} has no MDMG to patch.`);
      rig.mdmg -= 1;
      const issue = MAINTENANCE[rng(1, MAINTENANCE.length) - 1].name;
      rig.issues = [...(rig.issues || []), issue].slice(0, 12);
      s.addLog("note", `Patch job (house rule): MDMG ${rig.mdmg + 1} → ${rig.mdmg} for ${kcr(PATCH_COST)}; the rig keeps a Maintenance Issue: ${issue}. The Warden takes the credits.`);
      break;
    }
    default: return;
  }
  p.ship = sanitizeShip(rig);
  const f = fightOf(s);
  if (f) { const live_ = rigOf(f); if (live_) Object.assign(live_, { ...p.ship, side: "crew" }); }
  s.sendHeader();
  s.syncDm();
  s.touch();
}

// ---- Messages
export function shipDm(s, msg) {
  switch (msg.t) {
    case "shipStart": return startFight(s, msg);
    case "shipEnd": return endFight(s, String(msg.how || "").slice(0, 100));
    case "shipClear": s.state.shipFight = null; return changed(s);
    case "shipFire": return setFire(s, msg.side, msg.on);
    case "shipRange": return setRange(s, msg.range);
    case "shipEnemyMove": return setEnemyMove(s, msg.move, msg.fuel, msg.ship);
    case "shipCrewMove": return setCrewMove(s, msg.move, msg.fuel);
    case "shipAgentPicks": {
      const f = live(s);
      if (!f) return;
      s.addLog("warden", `Choose the enemy's move for round ${f.round} now: set ship_fight.enemy_move (maintain, evade or pursue) and ship_fight.fuel.`);
      if (s.hasKey()) s.generate();
      return;
    }
    case "shipStation": {
      const f = live(s);
      if (!f || !s.crewById(msg.pc)) return;
      f.stations[msg.pc] = STATIONS.includes(msg.station) ? msg.station : "";
      return changed(s);
    }
    case "shipSkill": {
      const f = live(s);
      if (!f || !STATIONS.includes(msg.station)) return;
      f.skills[msg.station] = String(msg.skill || "").slice(0, 40);
      return changed(s);
    }
    case "shipMovement": return resolveMovement(s);
    case "shipAttack": return resolveAttack(s);
    case "shipSystems": {
      const f = fightOf(s);
      if (!f) return;
      if (f.ended) return f.afterDue ? step(s, () => callAfter(s, f)) : undefined;
      return step(s, () => callCheck(s, f, "engineer", "systems", { kind: "systems", reason: String(msg.reason || "SYSTEMS CHECK").toUpperCase().slice(0, 60) }));
    }
    case "shipCancel": return cancelWaiting(s);
    case "shipBoard": return board(s);
    case "shipDistress": return distress(s);
    default: return rigAction(s, msg);
  }
}

export function shipPlayer(s, ws, msg) {
  const f = live(s), pc = s.characterOf(ws);
  if (!f || !pc || !playable(pc)) return;
  if (msg.t === "shipStation") {
    f.stations[pc.id] = STATIONS.includes(msg.station) ? msg.station : "";
    return changed(s);
  }
  if (msg.t === "shipFire") return setFire(s, "crew", msg.on);
  if (msg.t === "shipMove") {
    const pilot = pcAt(s, f, "pilot");
    if (pilot && pilot.id !== pc.id) return ws.send(JSON.stringify({ t: "notice", text: `${pilot.name} is the Pilot.` }));
    if (f.waiting) return;
    const r = checkMove(rigOf(f), msg.move, msg.fuel, f.range, rigFuel(s));
    if (!r.ok) return ws.send(JSON.stringify({ t: "notice", text: r.error }));
    f.moves.crew = { move: r.move, spend: r.spend };
    s.addLog("note", `${pc.name} sets the rig's course for the round.`);
    return changed(s);
  }
}

// Agent reply field: ship_fight { start, end, enemy_move, fuel }.
export function applyShipFight(s, sf) {
  if (!sf || typeof sf !== "object") return;
  if (sf.start?.ship) startFight(s, { ship: sf.start.ship, range: sf.start.range });
  if (sf.enemy_move) {
    if (!live(s)) s.addLog("note", "The agent chose an enemy move, but no ship fight is under way.");
    else {
      const f = live(s), fuel = sf.enemy_move === "maintain" ? 0 : Math.max(Number(sf.fuel) || 0, sf.enemy_move === "evade" ? evadeMinimum(f.range) : 0);
      if (setEnemyMove(s, sf.enemy_move, fuel)) s.addLog("note", `The agent chose the enemy's move for round ${f.round}: ${sf.enemy_move}${fuel ? `, ${fuel} fuel` : ""}.`);
    }
  }
  if (typeof sf.enemy_fire === "boolean" && live(s)) setFire(s, "enemy", sf.enemy_fire);
  if (sf.end === true && live(s)) endFight(s, "the agent ended it");
}

// ---- Views
function statusFor(s, f, ship) {
  const target = f.ships.find((x) => x.side !== ship.side);
  return { ...attackStatus(ship, target, f.range), advantage: classAdvantage(ship, target) };
}
export function shipDmView(s) {
  const cp = campaignOf(s);
  if (!cp) return null;
  const { p, c } = cp;
  const f = fightOf(s);
  const rig = f ? rigOf(f) : sanitizeShip(p.ship);
  const story = c.stories.find((x) => x.id === p.current);
  const dark = story && isTransit(story) && laneBetween(c, story.from, story.to)?.dark;
  const rigState = { ...rig, effect: mdmgEffect(rig.mdmg), majorRange: [rig.class * 1_000_000, rig.class * 5_000_000] };
  const out = {
    rig: rigState, port: !p.current, fuel: rigFuel(s), maintenance: MAINTENANCE.map((m) => m.name), distressSteps: dark ? 2 : 1,
    available: (s.state.config.ships || []).map((x) => ({ id: x.id, name: x.name, class: x.class, kind: x.kind })),
    patchCost: PATCH_COST, resupplyCost: RESUPPLY_COST, evadeMin: Object.fromEntries(RANGES.map((r) => [r, evadeMinimum(r)])),
    fight: null,
  };
  if (f) {
    out.fight = {
      ...f,
      ships: f.ships.map((x) => ({ ...x, fires: fires(f, x), effect: mdmgEffect(x.mdmg), status: statusFor(s, f, x), identified: identified(x, f.range), line: describeShip(x) })),
      pilot: rollerFor(s, f, "pilot")?.name || "", gunner: rollerFor(s, f, "gunner")?.name || "", engineer: rollerFor(s, f, "engineer")?.name || "",
      crewSkills: Object.fromEntries(s.state.config.crew.map((pc) => [pc.id, (pc.skills || []).map((k) => k.name)])),
      unwinnable: foesOf(f).some((x) => unwinnable(rig, x)),
    };
  }
  return out;
}

export function shipPlayerView(s) {
  const f = fightOf(s);
  if (!f) return null;
  const rig = rigOf(f), foe = foesOf(f)[0];
  return {
    range: f.range, round: f.round, ended: f.ended, phase: f.phase, waiting: f.waiting ? f.waiting.kind : "", boarding: f.boarding,
    rig: { name: rig.name, hull: rig.hull, hullMax: rig.hullMax, mdmg: rig.mdmg, effect: mdmgEffect(rig.mdmg)?.name || "", fuel: rigFuel(s) },
    enemy: foe ? identified(foe, f.range) : null,
    stations: f.stations, move: f.moves.crew, evadeMin: evadeMinimum(f.range),
    pilot: rollerFor(s, f, "pilot")?.id || "",
    unwinnable: foe ? unwinnable(rig, foe) : false,
    fire: fires(f, rig), armed: rig.weapons.length > 0,
    hailed: f.hails.length > 0,
  };
}
