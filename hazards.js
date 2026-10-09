import crypto from "crypto";
import { newCond, applyDamage, gainWound, setVital, playable } from "./crew.js";
import { WOUND_TYPES, WOUND_LABELS } from "./wounds.js";
import { roomId, clampInt } from "./clean.js";

export const ROUND_SECONDS = 10;
const SURVIVAL = "PSG 32-33 (Survival)";
const STORY = "story hazard";

// kind "psg" is a Mothership 1e rule (RULES.md); "story" hazards are not Mothership rules: the generic rule applies (a Save or Check; failure = +1 Stress and the consequence the story names).
export const HAZARDS = {
  vacuum: { name: "Vacuum", kind: "psg", source: SURVIVAL, per: "round", check: null, protect: "a sealed vaccsuit, hazard suit or advanced battle dress while its air lasts; androids need no oxygen", rule: "No oxygen: 15 seconds, then unconscious. 1d5 minutes later, dead. A punctured vaccsuit decompresses within 1d5 rounds." },
  oxygen: { name: "Life support offline", kind: "psg", source: SURVIVAL, per: "24 hours", check: "body", protect: "androids, people in cryosleep, anyone on their own oxygen (sealed suit, oxygen tank)", rule: "Oxygen supply = 1d10 x the ship's max crew. Every 24 hours subtract the breathing crew (2 more each for strenuous activity). Supply under 2x breathing crew: [-] on all rolls. Under the breathing crew: Body Save or Death Save. Supply gone: as no oxygen." },
  toxic: { name: "Toxic atmosphere", kind: "psg", source: SURVIVAL, per: "round", check: "body", damage: "1d10", protect: "a rebreather, a sealed suit or own oxygen", rule: "Without a rebreather or own oxygen: 1d10 Damage per round; a Body Save halves it." },
  corrosive: { name: "Corrosive atmosphere", kind: "psg", source: SURVIVAL, per: "round", check: null, damage: "level", levels: [1, 10], levelLabel: "1 mild to 10 high", rule: "1 (mild) to 10 (high) Damage per round." },
  radiation: { name: "Radiation", kind: "psg", source: SURVIVAL, per: "round", check: "body", levels: [1, 3], levelLabel: "1 trace, 2 acute, 3 lethal", protect: "armor with radiation shielding (vaccsuit, hazard suit, advanced battle dress)", rule: "Level 1 Trace: nothing immediate. Level 2 Acute: all Stats and Saves -1 every round. Level 3 Lethal: every round a Body Save or a lethal dose (death in 1d5 days). Radiation Pills: 1d5 Damage, Radiation Level -1 for 2d10 minutes." },
  cold: { name: "Extreme cold", kind: "psg", source: SURVIVAL, per: "hour", check: "body", protect: "a hazard suit", rule: "Sub-zero and not dressed for it: Body Save every hour or succumb. This app reads succumb as a Death Save on a failure." },
  heat: { name: "Extreme heat", kind: "psg", source: SURVIVAL, per: "hour", check: "body", protect: "a hazard suit", rule: "Over 40 C: Body Save every hour or succumb. This app reads succumb as a Death Save on a failure." },
  fire: { name: "Fire", kind: "psg", source: "PSG 14-15, 29 (flamethrower, Wounds Table)", per: "round", check: null, damage: "2d10", wound: "fire", rule: "Anyone in the room is set on fire: 2d10 Damage per round (Fire & Explosives) until put out." },
  explosion: { name: "Explosion", kind: "psg", source: "SBT Hull Breach (secondary summary)", per: "event", check: "body", wound: "fire", rule: "Everyone in the room: Body Save or take 1 Wound (Fire & Explosives). A Critical Failure is sucked into space (vacuum)." },
  breach: { name: "Hull breach", kind: "psg", source: "SBT Hull Breach (secondary summary)", per: "event", check: "body", wound: "fire", rule: "Everyone aboard: Body Save or take 1 Wound (Fire & Explosives). A Critical Failure is sucked into space (vacuum)." },
  contagion: { name: "Contagion", kind: "story", source: STORY, per: "exposure", check: "body", rule: "Body Save on each exposure. Failure: infected, a Condition the story defines." },
  darkness: { name: "Darkness", kind: "story", source: STORY, per: "exposure", check: "fear", rule: "Fear Save when the dark matters. Failure: the story's consequence." },
  crush: { name: "Crushing", kind: "story", source: STORY, per: "exposure", check: "speed", damage: "level d10", wound: "blunt", levels: [1, 3], levelLabel: "1 to 3 severity", rule: "Speed Check. Failure: Damage by severity (1d10, 2d10 or 3d10), Blunt Force." },
  collapse: { name: "Collapse", kind: "story", source: STORY, per: "exposure", check: "speed", damage: "level d10", wound: "blunt", levels: [1, 3], levelLabel: "1 to 3 severity", rule: "Speed Check. Failure: Damage by severity (1d10, 2d10 or 3d10), Blunt Force." },
  machinery: { name: "Dangerous machinery", kind: "story", source: STORY, per: "exposure", check: "speed", damage: "level d10", wound: "blunt", levels: [1, 3], levelLabel: "1 to 3 severity", rule: "Speed Check. Failure: Damage by severity (1d10, 2d10 or 3d10), Blunt Force." },
  gravity: { name: "Gravity anomaly", kind: "story", source: STORY, per: "exposure", check: "strength", rule: "Strength Check to hold on. Failure: pulled toward the source." },
  acid: { name: "Acid", kind: "story", source: STORY, per: "round", check: null, damage: "level", levels: [1, 10], levelLabel: "1 mild to 10 high", rule: "As a corrosive atmosphere: 1 (mild) to 10 (high) Damage per round." },
  ice: { name: "Ice", kind: "story", source: STORY, per: "exposure", check: "speed", damage: "1d10", wound: "blunt", rule: "Speed Check or fall: 1d10 Damage, Blunt Force." },
  entanglement: { name: "Entanglement", kind: "story", source: STORY, per: "exposure", check: "strength", advantage: "disadvantage", rule: "Strength Check [-] to escape, like the Foam Gun. Failure: still stuck." },
  infohazard: { name: "Infohazard", kind: "story", source: STORY, per: "exposure", check: "sanity", rule: "Sanity Save on each exposure. Failure: 1 more Stress than the usual, and the story's consequence." },
  temporal: { name: "Temporal anomaly", kind: "story", source: STORY, per: "exposure", check: "sanity", rule: "Sanity Save on each loop. Failure: the story's consequence." },
};
export const hazardInfo = (type) => HAZARDS[type] || null;
export const WOUND_COLUMN = WOUND_LABELS;

export const OTHER_RULES = {
  exhaustion: { name: "Exhaustion", kind: "psg", source: SURVIVAL, rule: "After 12 hours of activity, a Body Save every hour; failure = 1 Damage. After 24 hours: [-] on all rolls until 8 hours' rest." },
  food: { name: "Food and water", kind: "psg", source: SURVIVAL, rule: "About 3 weeks without food; after 24 hours without food, [-] on all rolls. At least 1 L of water a day; at that minimum, strenuous activity needs a Body Save or you pass out, and when tracking water that closely, [-] on all rolls." },
  bleeding: { name: "Bleeding", kind: "psg", source: "PSG 32.2", rule: "1 Damage per round per point of Bleeding, cumulative, ignoring armor and DR, until stopped (a First Aid Kit stops it)." },
  cryosickness: { name: "Cryosickness", kind: "psg", source: SURVIVAL, rule: "[-] on all rolls for 1 week after cryosleep; a stimpak cures it." },
};

const d = (sides) => crypto.randomInt(1, sides + 1);
export const rollDice = (n, sides, rng = d) => Array.from({ length: n }, () => rng(sides)).reduce((a, b) => a + b, 0);

const isAndroid = (pc) => pc.className === "Android";
const gear = (pc) => [...(pc.items || []), typeof pc.armor === "string" ? pc.armor : pc.armor?.destroyed ? "" : pc.armor?.name].filter(Boolean).map(String);
const SUITS = [
  { re: /vacc?\s?suit/i, name: "vaccsuit", hours: 12, temp: false },
  { re: /hazard suit/i, name: "hazard suit", hours: 1, temp: true },
  { re: /advanced battle dress/i, name: "advanced battle dress", hours: 1, temp: false },
];
const suitsOf = (pc) => gear(pc).filter((g) => !/punctured/i.test(g)).map((g) => SUITS.find((s) => s.re.test(g))).filter(Boolean);
const hasGear = (pc, re) => gear(pc).some((g) => re.test(g));
export const TANK_HOURS = { normal: 12, strain: 4 };

// Who is protected from what, and by what. "" means not protected.
export function protection(pc, type) {
  const c = pc.cond || newCond();
  const sealed = !c.leak && suitsOf(pc).find((s) => c.air < s.hours * 3600);
  const tank = hasGear(pc, /oxygen tank/i) && c.air < (c.strenuous ? TANK_HOURS.strain : TANK_HOURS.normal) * 3600;
  switch (type) {
    case "vacuum": return isAndroid(pc) ? "android (needs no oxygen)" : sealed ? sealed.name : "";
    case "oxygen": return isAndroid(pc) ? "android (needs no oxygen)" : c.cryosleep ? "cryosleep" : sealed ? sealed.name : tank ? "oxygen tank" : "";
    case "toxic": return sealed ? sealed.name : hasGear(pc, /rebreather/i) ? "rebreather" : tank ? "oxygen tank" : "";
    case "radiation": return suitsOf(pc)[0]?.name || "";
    case "temperature": return suitsOf(pc).find((s) => s.temp)?.name || "";
    default: return "";
  }
}

// Reasons for [-] on all rolls.
export function penalties(pc, { thinAir = false } = {}) {
  const c = pc.cond || newCond();
  return [
    c.cryo > 0 && "cryosickness",
    c.active >= 24 && "exhaustion (24 hours without 8 hours' rest)",
    c.fed >= 24 && "no food for 24 hours",
    c.thirsty && "water at the minimum",
    thinAir && "oxygen running low",
  ].filter(Boolean);
}
export const withDisadvantage = (base, reasons) => (!reasons.length ? base : base === "advantage" ? "none" : "disadvantage");

const airText = (pc) => {
  const a = airLeft(pc);
  return a ? `OWN AIR (${a.name}): ${a.left >= 1 ? `${Math.round(a.left * 10) / 10} hours` : `${Math.round(a.left * 60)} minutes`} left` : "OWN AIR USED UP";
};
export function conditionText(pc) {
  const c = pc.cond || newCond();
  const days = Math.ceil(c.lethal / 24);
  return [
    c.dead && `DEAD (${c.dead})`,
    c.dying > 0 && `DYING: dead in ${c.dying} round${c.dying > 1 ? "s" : ""} without intervention`,
    c.out && !c.dead && "UNCONSCIOUS (no air)",
    !c.out && c.vac > 0 && `NO AIR for ${c.vac} seconds`,
    c.spaced && "SUCKED INTO SPACE",
    c.fire && "ON FIRE: 2d10 Damage per round",
    c.bleeding > 0 && `BLEEDING ${c.bleeding}: ${c.bleeding} Damage per round`,
    c.leak ? "SUIT PUNCTURED: decompressed" : c.puncture > 0 && `SUIT PUNCTURED: decompresses in ${c.puncture} round${c.puncture > 1 ? "s" : ""}`,
    c.rad > 0 && `RADIATION: -${c.rad} to all Stats and Saves`,
    c.pills > 0 && "RADIATION PILLS: Level -1",
    c.lethal > 0 && `LETHAL RADIATION DOSE: dies in ${days} day${days > 1 ? "s" : ""}`,
    c.cryo > 0 && `[-] CRYOSICKNESS: ${Math.ceil(c.cryo / 24)} day${c.cryo > 24 ? "s" : ""} left`,
    c.boost > 0 && `[+] STIMPAK: about ${Math.ceil(c.boost / 6)} minute${c.boost > 6 ? "s" : ""} left`,
    c.stims.length > 0 && `STIMPAK DOSES in the last 24 hours: ${c.stims.length}`,
    c.air > 0 && airText(pc),
    c.cryosleep && "IN CRYOSLEEP",
    c.active >= 24 ? "[-] EXHAUSTED: 24+ hours without rest" : c.active > 12 && "EXHAUSTED: Body Save every hour",
    c.fed >= 504 ? "STARVING: about 3 weeks without food" : c.fed >= 24 && "[-] NO FOOD for 24+ hours",
    c.thirsty && "[-] WATER AT THE MINIMUM",
    c.strenuous && "STRENUOUS ACTIVITY",
    ...c.tags,
  ].filter(Boolean);
}

export function vacuumTick(c, seconds, rng = d) {
  const out = [];
  if (c.dead) return out;
  c.vac += seconds;
  if (!c.out && c.vac >= 15) {
    c.out = true;
    c.deadAt = 15 + 60 * rng(5);
    out.push(`unconscious from no air; dead in ${Math.round((c.deadAt - 15) / 60)} minute${c.deadAt - 15 > 60 ? "s" : ""} without air`);
  }
  if (c.out && c.vac >= c.deadAt) {
    c.dead = "no air";
    out.push("dead from no air");
  }
  return out;
}
export const puncture = (c, rng = d) => { c.puncture = rng(5); c.leak = false; return c.puncture; };
export const patch = (c) => { c.puncture = 0; c.leak = false; };
export const airRestored = (c) => { c.vac = 0; c.out = false; c.deadAt = 0; c.spaced = false; };

export const radLevel = (c, level) => Math.max(0, level - (c.pills > 0 ? 1 : 0));
export const takePills = (c, rng = d) => { c.pills = 6 * rollDice(2, 10, rng); return rollDice(1, 5, rng); };
export const wake = (c) => { c.cryosleep = false; c.cryo = 168; };
export const stimpak = (c) => { c.cryo = 0; };
// PSG Stimpak: -1 Stress, +1d10 Health, [+] on all rolls for 1d10 minutes, cures cryosickness. A dose after the first in 24 hours: roll 1d10 (0-9);
// under the number of doses in the past 24 hours (this one included) is a Death Save. rng(sides) reads 1..sides.
export function useStimpak(pc, rng = d) {
  const c = pc.cond;
  c.stims = [...c.stims.filter((a) => a < 24), 0];
  const heal = rollDice(1, 10, rng), before = pc.health.current;
  pc.health.current = Math.min(pc.health.max, before + heal);
  const [, stress] = setVital(pc, "stress", pc.stress - 1);
  stimpak(c);
  const minutes = rollDice(1, 10, rng);
  c.boost = Math.max(c.boost, 6 * minutes);
  const doses = c.stims.length;
  const overdose = doses > 1 ? { roll: rng(10) - 1, doses } : null;
  if (overdose) overdose.deathSave = overdose.roll < doses;
  return { heal: pc.health.current - before, rolled: heal, stress, minutes, doses, overdose };
}
export const STIMPAK_RULE = "Stimpak (PSG): -1 Stress, +1d10 Health, [+] on all rolls for 1d10 minutes, cures cryosickness. More than one in a day: roll 1d10; under the number of doses in the past 24 hours is a Death Save.";

// Hours of own air left, from the best source the character is on: a suit's tank (vaccsuit 12 h, hazard suit 1 h, advanced battle dress 1 h) or an oxygen tank (12 h normally, 4 h under strain).
export function airLeft(pc) {
  const c = pc.cond || newCond();
  const sources = [
    ...(c.leak ? [] : suitsOf(pc).map((s) => ({ name: s.name, hours: s.hours }))),
    ...(hasGear(pc, /oxygen tank/i) ? [{ name: "oxygen tank", hours: c.strenuous ? TANK_HOURS.strain : TANK_HOURS.normal }] : []),
  ].map((s) => ({ ...s, left: Math.max(0, s.hours * 3600 - c.air) / 3600 })).sort((a, b) => b.left - a.left);
  return sources[0] || null;
}
export const rest = (c, hours) => { if (hours >= 8) c.active = 0; };

export const oxygenStart = (maxCrew, rng = d) => rng(10) * maxCrew;
export const breathing = (crew) => crew.filter((p) => !isAndroid(p) && !p.cond?.cryosleep && playable(p));
export function oxygenState(supply, nBreathing) {
  return { low: supply < 2 * nBreathing, save: supply < nBreathing, gone: supply <= 0 };
}
export function oxygenDay(supply, crew) {
  const b = breathing(crew);
  const use = b.length + 2 * b.filter((p) => p.cond?.strenuous).length;
  const next = Math.max(0, supply - use);
  return { supply: next, use, breathing: b.length, ...oxygenState(next, b.length) };
}

// Hazard damage and Wounds go through the one pipeline (crew.js applyDamage / gainWound): no armor or DR, a real Wounds Table roll for types that have a column.
const column = (type) => (WOUND_TYPES.includes(type) ? type : "");
export function hazardDamage(pc, n, type, opts = {}) {
  if (!(n > 0)) return { n: 0, wound: false, atMax: false, type };
  const result = applyDamage(pc, n, { type: column(type), direct: true, ...opts });
  return { n, wound: result.wounds.length > 0, atMax: pc.wounds.current >= pc.wounds.max, type, result };
}
export function hazardWound(pc, type, opts = {}) {
  const wound = gainWound(pc, column(type), opts);
  return { n: 0, wound, atMax: pc.wounds.current >= pc.wounds.max, type };
}

const need = (pc, kind, check, extra = {}) => {
  return { kind, pc: pc.id, check, reason: "", ...extra, advantage: extra.advantage || "none" };
};
const dmgLevel = (h) => clampInt(h.level, 1, 10, 1);

// One round (about 10 seconds) for one character. `here` is the hazards in the room they are in.
export function roundTick(pc, here, rng = d) {
  const c = pc.cond;
  const events = [], needs = [], damage = [];
  if (c.dead) return { events, needs, damage };
  const types = new Set(here.map((h) => h.type));
  if (c.puncture > 0 && --c.puncture === 0) { c.leak = true; events.push("suit decompressed"); }
  if (c.bleeding > 0) damage.push({ n: c.bleeding, type: "bleeding", why: `Bleeding ${c.bleeding}` });
  if (types.has("fire") && !c.fire) { c.fire = true; events.push("is on fire"); }
  if (c.fire) damage.push({ n: rollDice(2, 10, rng), type: "fire", why: "on fire" });
  if (c.pills > 0) c.pills--;
  if (c.boost > 0) c.boost--;
  if (c.dying > 0 && --c.dying === 0) { c.dead = "dying"; events.push("dead"); }

  const airless = types.has("vacuum") || c.spaced || here.some((h) => h.type === "oxygen" && h.supply <= 0);
  if (airless) {
    const by = protection(pc, "vacuum");
    if (by) c.air += ROUND_SECONDS;
    else events.push(...vacuumTick(c, ROUND_SECONDS, rng));
  } else if (c.vac > 0 && !c.out) {
    c.vac = 0;
    events.push("gets their breath back");
  }
  for (const h of here) {
    const info = HAZARDS[h.type];
    if (!info) continue;
    if (h.type === "toxic" && !c.dead) {
      const by = protection(pc, "toxic");
      if (by) c.air += by === "rebreather" ? 0 : ROUND_SECONDS;
      else needs.push(need(pc, "toxic", "body", { dmg: rollDice(1, 10, rng), reason: "TOXIC ATMOSPHERE, HALF ON A SUCCESS" }));
    } else if (h.type === "corrosive" || h.type === "acid") damage.push({ n: dmgLevel(h), type: h.type, why: info.name.toLowerCase() });
    else if (h.type === "radiation") {
      const eff = radLevel(c, h.level || 1);
      if (protection(pc, "radiation")) continue;
      if (eff === 2) c.rad = Math.min(99, c.rad + 1);
      else if (eff >= 3) needs.push(need(pc, "radiation", "body", { reason: "LETHAL RADIATION" }));
    }
  }
  return { events, needs, damage };
}

// One hour for one character. Per-round hazards other than vacuum are not run for a whole hour: the caller says so.
export function hourTick(pc, here, rng = d, { food = true } = {}) {
  const c = pc.cond;
  const events = [], needs = [], damage = [], skipped = [];
  if (c.dead) return { events, needs, damage, skipped };
  if (!c.cryosleep) { c.active += 1; if (food) c.fed += 1; }
  c.stims = c.stims.map((a) => a + 1).filter((a) => a < 24);
  c.boost = Math.max(0, c.boost - 360);
  if (c.cryo > 0) c.cryo--;
  if (c.lethal > 0 && --c.lethal === 0) { c.dead = "lethal radiation dose"; events.push("dead of the lethal radiation dose"); }
  if (c.dying > 0) { c.dead = "dying"; c.dying = 0; events.push("dead"); }
  if (c.fed === 504) events.push("about three weeks without food");
  const types = new Set(here.map((h) => h.type));
  const airless = types.has("vacuum") || c.spaced || here.some((h) => h.type === "oxygen" && h.supply <= 0);
  if (airless && !c.dead) {
    if (protection(pc, "vacuum")) c.air += 3600;
    else events.push(...vacuumTick(c, 3600, rng));
  }
  for (const t of ["toxic", "corrosive", "acid", "radiation", "fire"]) if (types.has(t) && !c.dead) skipped.push(t);
  for (const t of ["cold", "heat"]) {
    if (types.has(t) && !c.dead && !protection(pc, "temperature")) needs.push(need(pc, t, "body", { reason: `${t === "cold" ? "EXTREME COLD" : "EXTREME HEAT"}, EVERY HOUR` }));
  }
  if (c.active > 12 && !c.cryosleep && !c.dead) needs.push(need(pc, "exhaustion", "body", { reason: "EXHAUSTION" }));
  return { events, needs, damage, skipped };
}

// A hazard that happens once when it starts, or each time it is triggered (explosion, hull breach and the story hazards).
export function eventNeeds(pc, h, rng = d) {
  const info = HAZARDS[h.type];
  if (!info || !playable(pc) || !["event", "exposure"].includes(info.per)) return [];
  const level = clampInt(h.level, 1, 3, 1);
  const dmg = /level d10/.test(info.damage || "") ? rollDice(level, 10, rng) : info.damage === "1d10" ? rollDice(1, 10, rng) : 0;
  return [need(pc, h.type, info.check, { advantage: info.advantage, dmg, reason: `${info.name.toUpperCase()}${info.kind === "story" ? " (STORY HAZARD)" : ""}` })];
}

export const strenuousNeed = (pc) => need(pc, "strenuous", "body", { reason: "STRENUOUS ACTIVITY ON MINIMUM WATER" });
export const oxygenNeed = (pc) => need(pc, "oxygen", "body", { reason: "LIFE SUPPORT OFFLINE" });

// What a result does. Returns damage / wounds to apply, whether a Death Save follows, extra Stress, and a line for the log.
export function settle(pc, n, result, rng = d) {
  const c = pc.cond;
  const out = { damage: 0, dtype: "", wounds: 0, deathSave: false, stress: 0, text: "" };
  const ok = result.success;
  switch (n.kind) {
    case "toxic":
      out.damage = ok ? Math.ceil(n.dmg / 2) : n.dmg;
      out.dtype = "toxic";
      out.text = `toxic atmosphere: ${n.dmg} Damage${ok ? ", halved by the Body Save" : ""}`;
      break;
    case "radiation":
      if (!ok && !c.lethal) { c.lethal = 24 * rng(5); out.text = `lethal radiation dose: dead in ${c.lethal / 24} day${c.lethal > 24 ? "s" : ""}`; }
      else if (!ok) out.text = "another lethal dose";
      break;
    case "cold": case "heat": case "oxygen":
      if (!ok) { out.deathSave = true; out.text = `${n.kind === "oxygen" ? "short of air" : `succumbs to the ${n.kind}`}: Death Save`; }
      break;
    case "exhaustion":
      if (!ok) { out.damage = 1; out.dtype = "exhaustion"; out.text = "exhaustion: 1 Damage"; }
      break;
    case "strenuous":
      if (!ok) out.text = "passes out from the effort (water at the minimum)";
      break;
    case "explosion": case "breach":
      if (!ok) {
        out.wounds = 1;
        out.dtype = "fire";
        out.text = "takes 1 Wound (Fire & Explosives)";
        if (result.critical) { c.spaced = true; out.text += "; sucked into space (vacuum)"; }
      }
      break;
    default: {
      if (ok) break;
      const info = HAZARDS[n.kind];
      if (n.dmg) { out.damage = n.dmg; out.dtype = info.wound || "blunt"; out.text = `${info.name.toLowerCase()}: ${n.dmg} Damage (${WOUND_COLUMN[info.wound] || "Blunt Force"})`; }
      else out.text = `${info?.name.toLowerCase() || n.kind}: the story's consequence applies`;
      if (n.kind === "contagion") { c.tags = [...c.tags.filter((t) => !/infected/i.test(t)), "INFECTED (story hazard)"].slice(0, 8); out.text = "infected (story hazard condition)"; }
      if (n.kind === "infohazard") out.stress = 1;
    }
  }
  return out;
}

export function normalizeHazards(raw, now = Date.now()) {
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [room, h] of Object.entries(raw)) {
    const id = roomId(room);
    const type = String(h?.type ?? "").toLowerCase().trim();
    const info = HAZARDS[type];
    if (!id || !info) continue;
    out[id] = {
      type,
      level: info.levels ? clampInt(h.level, info.levels[0], info.levels[1], info.levels[0]) : null,
      since: clampInt(h.since, 0, 1e15, now),
      rounds: clampInt(h.rounds, 0, 1e9, 0),
      hours: clampInt(h.hours, 0, 1e9, 0),
      ...(type === "oxygen" ? { supply: clampInt(h.supply, 0, 1e4, 0) } : {}),
    };
  }
  return out;
}

export function hazardBrief(station, crew) {
  const hz = station?.hazards || {};
  const lines = Object.entries(hz).map(([room, h]) => {
    const info = HAZARDS[h.type];
    return `- ${room}: ${info.name}${h.level ? ` level ${h.level}` : ""}${h.type === "oxygen" ? `, oxygen supply ${h.supply}` : ""} (${info.kind === "psg" ? "Mothership rule" : "story hazard"}): ${info.rule}`;
  });
  const sick = crew.map((pc) => [pc, conditionText(pc)]).filter(([, t]) => t.length).map(([pc, t]) => `- ${pc.name}: ${t.join("; ")}`);
  return { lines, sick };
}
