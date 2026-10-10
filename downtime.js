import { clampInt } from "./clean.js";
import { randInt, rollDice, rollWithAdv } from "./dice.js";
import { SAVES, playable, gainStress, setVital } from "./crew.js";
import { combineAdvantage } from "./rolls.js";
import { ageDays } from "./hazards.js";
import { PANIC_TABLE } from "./cast.js";
import { spend, exact } from "./money.js";

// Downtime between stories: rest, recovery, shore leave and medical treatment (PSG 20.2, 34-39; see _out/tickets/RULES.md).
// The functions are pure over a character (and the campaign progress, for money and the day count); rolls take an rng(min, max).

const two = (n) => String(n).padStart(2, "0");
export const worstSave = (pc) => SAVES.reduce((a, b) => (pc.saves[b] < pc.saves[a] ? b : a));
export const hasCondition = (pc, re) => (pc.cond?.tags || []).some((t) => re.test(t));
const upper = (s) => s[0].toUpperCase() + s.slice(1);

// ---- Rest Save (PSG 20.2): the worst Save; success -ones digit of the roll, failure +1 Stress.
// [+] for a leisure activity or a crewmate who gives up their own rest; [-] for an unsafe place; the Nightmares Condition is [-] automatically.
export function restAdvantage(pc, { leisure = false, helped = false, unsafe = false } = {}) {
  const why = [leisure && "a leisure activity [+]", helped && "a crewmate gave up their rest [+]", unsafe && "an unsafe place [-]", hasCondition(pc, /nightmares/i) && "Nightmares [-]"].filter(Boolean);
  const list = [(leisure || helped) && "advantage", (unsafe || hasCondition(pc, /nightmares/i)) && "disadvantage"].filter(Boolean);
  return { advantage: combineAdvantage(list), why };
}
// result: a resolved Save ({ success, used }).
export function applyRest(pc, result) {
  const from = pc.stress;
  if (result.success) {
    const digit = result.used % 10;
    setVital(pc, "stress", pc.stress - digit);
    return { ok: true, digit, from, to: pc.stress };
  }
  const g = gainStress(pc, 1);
  return { ok: false, digit: 0, from, to: g.to, over: g.over };
}

// ---- Short-term recovery (PSG 34.1): once per day, after 6+ hours of rest, a Body Save; success resets Health to Maximum. Wounds stay.
export function applyRecovery(pc, result) {
  const from = pc.health.current;
  if (result.success) {
    setVital(pc, "health", pc.health.max);
    return { ok: true, from, to: pc.health.current };
  }
  const sFrom = pc.stress, g = gainStress(pc, 1);
  return { ok: false, from, to: from, stress: [sFrom, g.to], over: g.over };
}

// ---- Shore Leave (PSG 39) by port class. cost = dice x unit; convert = what a success converts; max = what a critical success converts.
export const SHORE = {
  X: { name: "criminal settlement or pirate base", cost: { dice: "1d100", unit: 10000 }, convert: { dice: "2d10", adv: "+" }, max: 20 },
  C: { name: "rundown outpost or frontier settlement", cost: { dice: "2d10", unit: 100 }, convert: { dice: "1d5" }, max: 5 },
  B: { name: "industrial station or large military installation", cost: { dice: "2d10", unit: 1000 }, convert: { dice: "1d10" }, max: 10 },
  A: { name: "metropolis or trading centre", cost: { dice: "2d10", unit: 10000 }, convert: { dice: "2d10" }, max: 20 },
  S: { name: "luxury, invite only", cost: { dice: "2d10", unit: 100000 }, convert: { all: true }, max: Infinity },
};
export const shoreText = (cls) => {
  const s = SHORE[cls];
  if (!s) return null;
  const k = s.cost.unit >= 1000 ? `${s.cost.unit / 1000}kcr` : `${s.cost.unit}cr`;
  return { cls, name: s.name, cost: `${s.cost.dice} x ${k}`, convert: s.convert.all ? "all Stress" : `${s.convert.dice}${s.convert.adv ? " [+]" : ""} Stress`, max: s.max === Infinity ? "all Stress" : `${s.max} Stress` };
};
export function shoreCost(cls, rng = randInt) {
  const s = SHORE[cls];
  if (!s) return null;
  const r = rollDice(s.cost.dice, rng);
  // A d100 that's multiplied reads 00 as 100, not nothing (as the dice note reads summed d10s 1-10).
  const total = /d100$/.test(s.cost.dice) && r.total === 0 ? 100 : r.total;
  return { dice: r.rolls, total: total * s.cost.unit };
}
export const shoreDays = (rng = randInt) => rollDice("2d10", rng);
// The amount a success may convert, rolled per the table (X: 2d10 with [+]). `all` for class S.
export function shoreAmount(cls, rng = randInt) {
  const s = SHORE[cls];
  if (!s) return null;
  if (s.convert.all) return { all: true, rolled: Infinity, dice: [] };
  const r = rollWithAdv(s.convert.dice, s.convert.adv || "", rng);
  return { all: false, rolled: r.total, dice: r.all };
}
// The Sanity Save's four outcomes. result: a resolved Save ({ success, critical, used }). amount: from shoreAmount.
export function applyShore(pc, result, cls, amount) {
  const s = SHORE[cls], min = pc.minStress ?? 2, above = Math.max(0, pc.stress - min), from = pc.stress;
  if (!result.success && result.critical) return { outcome: "critical failure", from, to: pc.stress, points: 0, relieved: 0, panicCheck: true, ownStress: false };
  if (!result.success) {
    const g = gainStress(Object.assign(pc, { stress: min }), 1);
    return { outcome: "failure", from, to: g.to, points: 0, relieved: above, panicCheck: false, ownStress: true, over: g.over };
  }
  const cap = result.critical ? s.max : amount.all ? Infinity : amount.rolled;
  const points = Math.min(above, cap);
  pc.stress = min;
  return { outcome: result.critical ? "critical success" : "success", from, to: min, points, relieved: above - points, panicCheck: false, ownStress: true };
}
// Spreads converted points over the Saves: +1 per point (PSG 39).
export function applyConversion(pc, points, alloc) {
  const give = Object.fromEntries(SAVES.map((k) => [k, clampInt(alloc?.[k], 0, 99, 0)]));
  const total = SAVES.reduce((n, k) => n + give[k], 0);
  if (total !== points) return { ok: false, error: `Spread exactly ${points} point${points === 1 ? "" : "s"} (you have ${total}).` };
  const done = [];
  for (const k of SAVES) if (give[k]) { pc.saves[k] = Math.min(99, pc.saves[k] + give[k]); done.push(`${upper(k)} Save +${give[k]} (now ${pc.saves[k]})`); }
  return { ok: true, done };
}

// ---- Medical treatments (PSG 35). Side effects are Conditions on the sheet (pc.cond.tags) with an "(until day N)" so they end on their own.
const DAY = 1, WEEK = 7;
const until = (day, days) => `(until day ${day + days})`;
const tagIn = (pc, tag) => { pc.cond.tags = [tag, ...pc.cond.tags].slice(0, 12); return tag; };
export const expiry = (tag) => Number(/\(until day (\d+)\)/.exec(tag)?.[1]) || 0;
export function ensureBase(pc) {
  pc.base ||= { stats: { ...pc.stats }, saves: { ...pc.saves } };
  return pc.base;
}
const randomCondition = (rng) => {
  const list = PANIC_TABLE.filter((e) => e && /^new Condition/.test(e.effect));
  return list[rng(0, list.length - 1)];
};
const onePercent = (rng) => rollDice("1d100", rng).total === 0;
const restore = (pc, kind, key, amount) => {
  const base = ensureBase(pc)[kind][key], now = pc[kind][key], to = Math.min(base, now + amount);
  pc[kind][key] = to;
  return [now, to, base];
};

export const TREATMENTS = {
  counselor: { name: "Artificial Wellness Counselor", cost: 150, weekly: true, time: "1 hour", text: "Restores 1 Sanity Save (up to its original value). 1% chance of a random Condition. Max once per week." },
  defrag: { name: "Cognitive Defragmentation", cost: 100000, choice: "condition", time: "", text: "Removes 1 Condition. 1% chance of total amnesia. [-] on Intellect, Sanity and Fear for 4 weeks." },
  nanogel: { name: "Deep Tissue Nanogel Massage", cost: 24000, weekly: true, time: "", text: "Minimum Stress -1. [-] on all actions for 24 hours. Max once per week." },
  slicksim: { name: "Immersive Slicksim Therapy", cost: 1000, choice: ["combat", "fear"], time: "", text: "Restores 1d10 Combat or 1d10 Fear Save (up to its original value). 1% chance of being stuck for 1d10 days and -1d5 Sanity Save." },
  medpod: { name: "Medpod", cost: 6000, time: "a week", text: "Restores 1 Wound (not lost limbs). Takes a week." },
  pseudoflesh: { name: "Pseudoflesh Injection", cost: 18000, choice: ["speed", "strength", "body", "wounds"], time: "", text: "Restores 2d10 Speed, Strength or Body Save, or all Wounds. [-] on all rolls for 2 weeks, then 4 weeks of recovery." },
  psychosurgery: { name: "Psychosurgery", cost: 28000, choice: ["intellect", "sanity", "fear", "minstress"], time: "", text: "Restores Intellect, Sanity or Fear to its maximum, or Minimum Stress to 2. [-] on all rolls for 4 weeks." },
};
export const treatmentList = () => Object.entries(TREATMENTS).map(([id, t]) => ({ id, name: t.name, cost: t.cost, weekly: !!t.weekly, text: t.text, choice: t.choice || null, time: t.time }));

// What a treatment would do, before anything is charged: { error } or { ok }.
function check(p, pc, id, choice) {
  const t = TREATMENTS[id], day = p.downtime?.day || 0;
  if (!t) return { error: "No such treatment." };
  const last = p.downtime?.last?.[pc.id]?.[id];
  if (t.weekly && last !== undefined && day - last < WEEK) return { error: `${t.name} is limited to once a week: ${pc.name} had it on day ${last}, it is day ${day}.` };
  const base = ensureBase(pc);
  if (id === "counselor" && pc.saves.sanity >= base.saves.sanity) return { error: `${pc.name}'s Sanity Save is already at its original ${base.saves.sanity}.` };
  if (id === "defrag" && !pc.cond.tags.includes(choice)) return { error: pc.cond.tags.length ? "Pick a Condition to remove." : `${pc.name} has no Condition to remove.` };
  if (id === "medpod" && !(pc.wounds.current > 0)) return { error: `${pc.name} has no Wounds to restore.` };
  if (Array.isArray(t.choice) && !t.choice.includes(choice)) return { error: "Pick what to restore." };
  if (id === "slicksim" && pc[choice === "combat" ? "stats" : "saves"][choice] >= base[choice === "combat" ? "stats" : "saves"][choice]) return { error: `${upper(choice)} is already at its original value.` };
  if (id === "pseudoflesh" && choice !== "wounds") {
    const kind = choice === "body" ? "saves" : "stats";
    if (pc[kind][choice] >= base[kind][choice]) return { error: `${upper(choice)} is already at its original value.` };
  }
  if (id === "pseudoflesh" && choice === "wounds" && !(pc.wounds.current > 0)) return { error: `${pc.name} has no Wounds to restore.` };
  if (id === "psychosurgery" && choice !== "minstress") {
    const kind = choice === "intellect" ? "stats" : "saves";
    if (pc[kind][choice] >= base[kind][choice]) return { error: `${upper(choice)} is already at its original value.` };
  }
  if (id === "psychosurgery" && choice === "minstress" && (pc.minStress ?? 2) === 2) return { error: "Minimum Stress is already 2." };
  return { ok: true };
}

// Treats one character: refuses if the rules or the money do not allow it; otherwise charges the account and applies it.
export function treat(p, pc, id, { choice = "", pay = "", rng = randInt } = {}) {
  const t = TREATMENTS[id], day = p.downtime?.day || 0;
  const ok = check(p, pc, id, choice);
  if (ok.error) return { ok: false, error: ok.error };
  const s = spend(p, pay || pc.id, t.cost, `${t.name} for ${pc.name}`);
  if (!s.ok) return { ok: false, error: s.error };
  const lines = [], days = id === "medpod" ? WEEK : 0;
  const note = (x) => lines.push(`${pc.name}: ${x}`);
  const rolled = (e) => rollDice(e, rng);
  if (id === "counselor") {
    const [a, b] = restore(pc, "saves", "sanity", 1);
    note(`Sanity Save ${a} to ${b}.`);
    if (onePercent(rng)) { const e = randomCondition(rng); note(`1% side effect: a random Condition, ${e.name} (${e.effect}).`); tagIn(pc, `CONDITION: ${e.name}`); }
  } else if (id === "defrag") {
    pc.cond.tags = pc.cond.tags.filter((x) => x !== choice);
    note(`Condition removed: ${choice}.`);
    if (onePercent(rng)) { note("1% side effect: total amnesia."); tagIn(pc, "TOTAL AMNESIA"); }
    note(`[-] on Intellect, Sanity and Fear for 4 weeks (until day ${day + 28}).`);
    tagIn(pc, `[-] INTELLECT, SANITY, FEAR ${until(day, 28)}`);
  } else if (id === "nanogel") {
    const from = pc.minStress ?? 2;
    pc.minStress = Math.max(0, from - 1);
    note(`Minimum Stress ${from} to ${pc.minStress}. [-] on all actions for 24 hours (until day ${day + DAY}).`);
    tagIn(pc, `[-] ALL ACTIONS ${until(day, DAY)}`);
  } else if (id === "slicksim") {
    const r = rolled("1d10"), kind = choice === "combat" ? "stats" : "saves";
    const [a, b, base] = restore(pc, kind, choice, r.total);
    note(`${upper(choice)} ${kind === "saves" ? "Save " : ""}${a} to ${b} (1d10 rolled ${r.total}, original ${base}).`);
    if (onePercent(rng)) {
      const d = rolled("1d10").total, s5 = rolled("1d5").total, before = pc.saves.sanity;
      pc.saves.sanity = Math.max(1, before - s5);
      note(`1% side effect: stuck in the sim for ${d} day${d > 1 ? "s" : ""} (until day ${day + d}); Sanity Save -${s5} (1d5), ${before} to ${pc.saves.sanity}.`);
      tagIn(pc, `STUCK IN SLICKSIM ${until(day, d)}`);
    }
  } else if (id === "medpod") {
    pc.wounds.current -= 1;
    note(`Wounds ${pc.wounds.current + 1} to ${pc.wounds.current}. A week passes (lost limbs are not restored).`);
  } else if (id === "pseudoflesh") {
    if (choice === "wounds") { note(`all Wounds restored (${pc.wounds.current} to 0).`); pc.wounds.current = 0; }
    else {
      const r = rolled("2d10"), kind = choice === "body" ? "saves" : "stats";
      const [a, b, base] = restore(pc, kind, choice, r.total);
      note(`${upper(choice)} ${kind === "saves" ? "Save " : ""}${a} to ${b} (2d10 rolled ${r.total}, original ${base}).`);
    }
    note(`[-] on all rolls for 2 weeks (until day ${day + 14}), then 4 weeks of recovery (until day ${day + 14 + 28}).`);
    tagIn(pc, `RECOVERING, 4 WEEKS ${until(day, 14 + 28)}`);
    tagIn(pc, `[-] ALL ROLLS ${until(day, 14)}`);
  } else if (id === "psychosurgery") {
    if (choice === "minstress") {
      const from = pc.minStress ?? 2;
      pc.minStress = 2;
      pc.stress = Math.max(pc.stress, 2);
      note(`Minimum Stress ${from} to 2.`);
    } else {
      const kind = choice === "intellect" ? "stats" : "saves";
      const base = ensureBase(pc)[kind][choice], a = pc[kind][choice];
      pc[kind][choice] = Math.max(a, base);
      note(`${upper(choice)}${kind === "saves" ? " Save" : ""} ${a} to its maximum ${pc[kind][choice]}.`);
    }
    note(`[-] on all rolls for 4 weeks (until day ${day + 28}).`);
    tagIn(pc, `[-] ALL ROLLS ${until(day, 28)}`);
  }
  p.downtime.last[pc.id] = { ...p.downtime.last[pc.id], [id]: day };
  return { ok: true, name: t.name, cost: t.cost, lines, days, entries: s.entries };
}

// Short-term recovery is once per day (RULES.md); the Rest Save once per day too (house rule). The day is recorded when the Save is rolled.
export function markRested(p, id, kind) {
  p.downtime.last ||= {};
  p.downtime.last[id] = { ...p.downtime.last[id], [kind]: p.downtime.day };
}

// ---- Time and the campaign's downtime state.
export function sanitizeDowntime(d, crew = []) {
  const ids = new Set(crew.map((x) => x.id));
  const pend = {}, last = {};
  for (const [id, v] of Object.entries(d?.pending && typeof d.pending === "object" ? d.pending : {})) if (ids.has(id) && v?.points > 0) pend[id] = { points: clampInt(v.points, 1, 99, 1), port: String(v.port || "").slice(0, 60) };
  for (const [id, v] of Object.entries(d?.last && typeof d.last === "object" ? d.last : {})) if (ids.has(id) && v && typeof v === "object") last[id] = Object.fromEntries(Object.entries(v).filter(([k]) => TREATMENTS[k] || k === "recovery" || k === "rest").map(([k, n]) => [k, clampInt(n, 0, 99999, 0)]));
  return { downtime: { day: clampInt(d?.day, 0, 99999, 0), pending: pend, last } };
}

// Days pass: Conditions with an "(until day N)" that is now over end, and the timed ones (Stimpak doses, cryosickness, a lethal dose) run down. Returns the lines for the log.
export function passDays(p, crews, n) {
  const days = clampInt(n, 0, 3650, 0), lines = [];
  p.downtime.day += days;
  const aged = new Set(), told = new Set();
  for (const crew of crews) {
    for (const pc of crew) {
      if (days && pc.cond && !aged.has(pc.cond)) {
        aged.add(pc.cond);
        const said = ageDays(pc, days);
        if (said.length && !told.has(pc.id)) { told.add(pc.id); lines.push(`${pc.name}: ${said.join("; ")}.`); }
      }
      const gone = pc.cond.tags.filter((t) => expiry(t) && expiry(t) <= p.downtime.day);
      if (!gone.length) continue;
      pc.cond.tags = pc.cond.tags.filter((t) => !gone.includes(t));
      if (crew === crews[0]) lines.push(`${pc.name}: ${gone.map((t) => t.replace(/\s*\(until day \d+\)/, "")).join(", ")} ${gone.length > 1 ? "have" : "has"} worn off.`);
    }
  }
  return lines;
}

// ---- Starting the rolls and settling them. A roll is a Save on the players' screens; the plan carries what to do with the result.
export const downtimeReady = (p, config) => !!p && !p.current && p.done.length > 0 && p.crew.every((x) => config.crew.some((y) => y.id === x.id));

// kind "recovery" | "rest" | "shore". Returns { error } or { ok, request, dt, lines, entries }.
export function planRoll(p, c, pc, kind, o = {}, rng = randInt) {
  if (!playable(pc)) return { ok: false, error: `${pc.name} is not playable.` };
  if (kind === "recovery" || kind === "rest") {
    const day = p.downtime?.day || 0, last = p.downtime?.last?.[pc.id]?.[kind];
    if (last === day) return { ok: false, error: `${pc.name} has already had a ${kind === "rest" ? "Rest Save" : "short-term recovery"} today (day ${day}): pass a day first.` };
  }
  if (kind === "recovery") {
    if (pc.health.current >= pc.health.max) return { ok: false, error: `${pc.name} is already at full Health.` };
    return { ok: true, request: { pc: pc.id, check: "body", reason: "Short-term recovery" }, dt: { kind }, lines: [], entries: [] };
  }
  if (kind === "rest") {
    if (pc.cond?.cryosleep) return { ok: false, error: `${pc.name} is in cryosleep: Stress is not usually relieved there.` };
    const save = worstSave(pc), a = restAdvantage(pc, o);
    return { ok: true, request: { pc: pc.id, check: save, advantage: a.advantage, reason: `Rest Save (worst Save: ${upper(save)}${a.why.length ? `; ${a.why.join(", ")}` : ""})` }, dt: { kind, save }, lines: [], entries: [] };
  }
  if (kind === "shore") {
    const loc = c.locations.find((l) => l.id === p.at), cls = loc?.portClass;
    if (!loc || !SHORE[cls]) return { ok: false, error: "Shore Leave needs a port with a class." };
    if (!o.safe) return { ok: false, error: `Shore Leave needs a relatively safe port: tick that ${loc.name} is safe.` };
    if (p.downtime.pending[pc.id]) return { ok: false, error: `${pc.name} still has Save points to spread.` };
    const cost = shoreCost(cls, rng), have = p.crew.find((x) => x.id === pc.id)?.credits || 0;
    if (cost.total > have) return { ok: false, error: `Shore Leave at ${loc.name} (class ${cls}) costs ${exact(cost.total)} (${cost.dice.join("+")} x ${exact(SHORE[cls].cost.unit)}); ${pc.name} has ${exact(have)}.` };
    const s = spend(p, pc.id, cost.total, `Shore Leave at ${loc.name} (class ${cls})`);
    const days = shoreDays(rng);
    const lines = [`${pc.name} takes Shore Leave at ${loc.name} (class ${cls}, PSG 39): pays ${exact(cost.total)} (${shoreText(cls).cost}: ${cost.dice.join(", ")}), ${days.total} days (2d10: ${days.rolls.join("+")}).`];
    return { ok: true, request: { pc: pc.id, check: "sanity", reason: `Shore Leave at ${loc.name} (class ${cls})` }, dt: { kind, cls, port: loc.name }, lines, entries: s.entries, days: days.total };
  }
  return { ok: false, error: "Unknown downtime step." };
}

// The result of the roll: changes the character and says what happened. { lines, over, ownStress, panicCheck }.
export function settleRoll(p, pc, dt, result, rng = randInt) {
  if (dt.kind === "recovery" || dt.kind === "rest") markRested(p, pc.id, dt.kind);
  const roll = two(result.used), word = result.outcome;
  if (dt.kind === "recovery") {
    const r = applyRecovery(pc, result);
    return { lines: [`${pc.name}: short-term recovery, Body Save ${roll} (${word}): ${r.ok ? `Health ${r.from} to ${r.to}` : `no recovery, Stress ${r.stress[0]} to ${r.stress[1]}`}. Wounds stay.`], over: r.over || 0, ownStress: true, panicCheck: false };
  }
  if (dt.kind === "rest") {
    const r = applyRest(pc, result);
    return { lines: [`${pc.name}: Rest Save (${upper(dt.save)}, the worst Save) ${roll} (${word}): ${r.ok ? `ones digit ${r.digit}, Stress ${r.from} to ${r.to}` : `Stress ${r.from} to ${r.to}`}.`], over: r.over || 0, ownStress: true, panicCheck: false };
  }
  const amount = shoreAmount(dt.cls, rng), r = applyShore(pc, result, dt.cls, amount);
  const lines = [`${pc.name}: Shore Leave Sanity Save ${roll} (${word}).`];
  if (r.outcome === "critical failure") lines.push(`Nothing converted or relieved; Stress stays ${r.to}. A Panic Check is required.`);
  else if (r.outcome === "failure") lines.push(`Nothing converted; Stress relieved to Minimum (${r.relieved} points), then +1 for the failed Save: ${r.from} to ${r.to}.`);
  else {
    lines.push(`Converts up to ${amount.all ? "all" : `${amount.rolled} (${SHORE[dt.cls].convert.dice}${SHORE[dt.cls].convert.adv ? " [+]" : ""}: ${amount.dice.join(" / ")})`}${r.outcome === "critical success" ? `, the port's maximum (${SHORE[dt.cls].max === Infinity ? "all" : SHORE[dt.cls].max}) on a critical success` : ""}: ${r.points} point${r.points === 1 ? "" : "s"} of Stress to spread over Saves; ${r.relieved} relieved. Stress ${r.from} to ${r.to}.`);
    if (r.points) p.downtime.pending[pc.id] = { points: r.points, port: dt.port };
  }
  return { lines, over: r.over || 0, ownStress: r.ownStress, panicCheck: r.panicCheck };
}

// Copies what downtime changed on a live character into the campaign's own copy (credits stay the campaign's).
export function mirror(p, pc) {
  const q = p.crew.find((x) => x.id === pc.id);
  if (!q) return;
  Object.assign(q, structuredClone({ health: pc.health, wounds: pc.wounds, stress: pc.stress, minStress: pc.minStress, stats: pc.stats, saves: pc.saves, cond: pc.cond, base: pc.base }));
}
