import { PORTRAIT_FILE } from "./cast.js";
import { slug, clampInt as int } from "./clean.js";
import { mitigate, deathSaveOutcome } from "./combat.js";
import { rollWound, WOUNDS } from "./wounds.js";
import { rollDice, randInt } from "./dice.js";
import { armorFrom, weaponsOf } from "./weapons.js";
import { ammoOf, ammoItem, mergeAmmo, sanitizeAmmo, ammoLine } from "./resources.js";

export const MAX_CREW = 4;
export const CLASSES = ["Teamster", "Android", "Scientist", "Marine"];
export const STATS = ["strength", "speed", "intellect", "combat"];
export const SAVES = ["sanity", "fear", "body"];

const COND_NUMBERS = { vac: 0, deadAt: 0, air: 0, puncture: 0, rad: 0, pills: 0, lethal: 0, bleeding: 0, active: 0, fed: 0, cryo: 0, dying: 0, boost: 0 };
const COND_FLAGS = ["out", "leak", "fire", "thirsty", "cryosleep", "strenuous", "spaced"];
export const newCond = () => ({ ...COND_NUMBERS, ...Object.fromEntries(COND_FLAGS.map((k) => [k, false])), dead: "", tags: [], stims: [] });
export function sanitizeCond(c) {
  const out = newCond();
  for (const k of Object.keys(COND_NUMBERS)) out[k] = int(c?.[k], 0, 1e7, 0);
  for (const k of COND_FLAGS) out[k] = c?.[k] === true;
  out.dead = str(c?.dead, 40);
  out.stims = (Array.isArray(c?.stims) ? c.stims : []).map((a) => int(a, 0, 23, 24)).filter((a) => a < 24).slice(0, 20);
  out.tags = (Array.isArray(c?.tags) ? c.tags : []).map((t) => str(t, 60).trim()).filter(Boolean).slice(0, 12);
  return out;
}
export const TRAUMA_RESPONSES = {
  Marine: "Whenever they Panic, every Close friendly player makes a Fear Save.",
  Android: "Fear Saves made by Close friendly players are at [-].",
  Scientist: "Whenever they fail a Sanity Save, all Close friendly players gain 1 Stress.",
  Teamster: "Once per session, they may take [+] on a Panic Check.",
};
export const traumaResponse = (pc) => TRAUMA_RESPONSES[pc?.className] || "";
export const maxWoundsFor = (className) => (className === "Marine" || className === "Android" ? 3 : 2);
const MAX_STRESS = 20;
// Not playable: dead (pc.cond.dead) or retired (Panic Table 20). pc.status is combat's unconscious/comatose, a different thing.
export const isGone = (c) => !!c.cond?.dead || !!c.retired;
export const playable = (c) => !isGone(c);
// High Score (PSG 18.3): sessions survived. It has no mechanical effect and nothing in the rules code reads it.
// End session: every living character's High Score goes up by 1. Returns who it went up for.
export function endSession(crew) {
  const living = crew.filter(playable);
  for (const c of living) c.highScore = Math.min(9999, (c.highScore || 0) + 1);
  return living;
}
// Records where a character's story ended (the memorial's "story") the first time they are gone; clears it if the Warden puts them back in play.
// Returns the characters newly gone.
export function settleEndings(crew, where) {
  const fresh = [];
  for (const c of crew) {
    if (isGone(c) && !c.endedIn) { c.endedIn = String(where || "Unknown").slice(0, 80); fresh.push(c); }
    else if (!isGone(c) && (c.endedIn || c.finalWords)) { c.endedIn = ""; c.finalWords = ""; }
  }
  return fresh;
}
export const memorialOf = (crew) => crew.filter(isGone).map((c) => ({ id: c.id, name: c.name, className: c.className, highScore: c.highScore || 0, retired: !c.cond?.dead, how: c.cond?.dead === "Warden" ? "Marked deceased by the Warden" : c.cond?.dead || "Retired from play", story: c.endedIn || "", epitaph: c.epitaph || "", finalWords: c.finalWords || "", portrait: c.portrait || "" }));
// The crew member (living or not) with the highest High Score, or null if nobody has survived a session.
export const longestSurvivor = (crew) => crew.reduce((best, c) => ((c.highScore || 0) > (best?.highScore || 0) ? c : best), null);
export const goneWord = (c) => (c.cond?.dead ? "deceased" : c.retired ? "retired" : "");
const legacy = (cond, status) => (status === "deceased" && !cond.dead ? { ...cond, dead: "Warden" } : cond);

export const DEFAULT_CREW = [
  {
    id: "rusk",
    name: "Teodora \"Rook\" Rusk",
    pronouns: "she/her",
    className: "Teamster",
    role: "Rigger and welder",
    crime: "Hijacked a Hollis-Vane ore hauler. 11 years' contract labour.",
    backstory: "A third-generation belt rigger who knows ships by their noises. When the company repossessed her brother's habitat module with his kids inside, she took a hauler and towed it out of the repo yard. She got them out; the company got her. She is quietly furious, good with her hands, and the closest thing this crew has to a foreman.",
    stats: { strength: 42, speed: 31, intellect: 29, combat: 30 },
    saves: { sanity: 26, fear: 34, body: 33 },
    health: { current: 15, max: 15 },
    wounds: { current: 0, max: 2 },
    stress: 2,
    skills: ["Zero-G", "Industrial Equipment", "Mechanical Repair", "Jury-Rigging"],
    loadout: "Vaccsuit, plasma cutter, tool rig, 2 flares, ration bar.",
    trinket: "Her niece's drawing of a ship, laminated.",
    patch: "\"SAFETY THIRD\"",
    notes: "",
  },
  {
    id: "varga",
    name: "Elias \"Tick\" Varga",
    pronouns: "he/him",
    className: "Scientist",
    role: "Chemist and systems tech",
    crime: "Cooked combat stims for a mine-gang. 6 years.",
    backstory: "Once a promising pharmaceutical chemist, until his research grant ran out and a mining crew's foreman offered him ten times the pay. Twitchy, brilliant, talks to himself when he works. He has been clean for two years and counts every day of it under his breath.",
    stats: { strength: 24, speed: 33, intellect: 46, combat: 22 },
    saves: { sanity: 38, fear: 24, body: 25 },
    health: { current: 11, max: 11 },
    wounds: { current: 0, max: 2 },
    stress: 2,
    skills: ["Chemistry", "Computers", "Pharmacology", "Hacking"],
    loadout: "Standard crew attire, med scanner, field chem kit, hand terminal, stimpak (1).",
    trinket: "Two-year sobriety chip, worn smooth.",
    patch: "\"I ♥ CARBON\"",
    notes: "",
  },
  {
    id: "moll",
    name: "MOLL-7",
    pronouns: "it/its",
    className: "Android",
    role: "Utility android",
    crime: "\"Malfunction\": refused a shutdown order and walked off a job site. Leased to the penal labour program instead of being scrapped.",
    backstory: "A company utility android built for hull work. When its supervisor ordered it to seal a section with two workers still inside, it opened the door instead and walked off the job. Its memory was partially wiped, but not entirely: it remembers faces it can't place. Calm, literal, unsettlingly polite. Humans tend to forget it is in the room.",
    stats: { strength: 36, speed: 34, intellect: 41, combat: 25 },
    saves: { sanity: 20, fear: 60, body: 30 },
    health: { current: 14, max: 14 },
    wounds: { current: 0, max: 3 },
    stress: 2,
    skills: ["Computers", "Mechanical Repair", "Linguistics", "Mathematics"],
    loadout: "Integrated diagnostic port, cutting torch, 30 m cable, company ID tag (scratched off).",
    trinket: "A child's plastic star it can't remember receiving.",
    patch: "\"OBEY\" (with the O scratched out)",
    notes: "Android: Fear saves as above; while MOLL-7 is close, other crew's Fear saves are made at [−].",
  },
  {
    id: "oyelaran",
    name: "Dax Oyelaran",
    pronouns: "he/him",
    className: "Marine",
    role: "Ex-colonial marine, hauler",
    crime: "Struck a commanding officer during an evacuation. Dishonourable discharge, 8 years.",
    backstory: "Served nine years with the Colonial Marines. On his last tour his lieutenant ordered the evac shuttle to leave without the civilians still boarding; Dax knocked him out and held the ramp. The tribunal agreed the order was wrong and convicted him anyway. Steady, protective, and the only one of them who has seen something truly bad before.",
    stats: { strength: 38, speed: 30, intellect: 26, combat: 44 },
    saves: { sanity: 27, fear: 30, body: 36 },
    health: { current: 17, max: 17 },
    wounds: { current: 0, max: 2 },
    stress: 2,
    skills: ["Military Training", "Firearms", "Athletics", "Hand-to-Hand Combat"],
    loadout: "Work fatigues, heavy crowbar, rigging gun (nail driver), first aid kit. No firearm: convicts aren't issued them.",
    trinket: "His old dog tags, one of them someone else's.",
    patch: "\"SEMPER FI\" (faded)",
    notes: "",
  },
];
const DEFAULT_FACES = { rusk: "94", varga: "20", moll: "45", oyelaran: "21" };
for (const c of DEFAULT_CREW) c.portrait = `kit/sfcp-${DEFAULT_FACES[c.id]}.png`;

const str = (v, n) => String(v ?? "").slice(0, n);

// Credits are their own field. Older sheets kept them in the notes as "Credits: Ncr.": move that over.
const NOTE_CREDITS = /\s*Credits:\s*([\d,]+)\s*cr\.?/i;
function creditsOf(c) {
  const note = str(c.notes, 1000), found = NOTE_CREDITS.exec(note);
  const have = Number.isFinite(Number(c.credits)) && c.credits !== "" && c.credits !== null;
  return { credits: have ? int(c.credits, 0, 999999999, 0) : found ? int(found[1].replace(/,/g, ""), 0, 999999999, 0) : 0, notes: (found ? note.replace(NOTE_CREDITS, "") : note).trim() };
}

export function sanitizeCrew(list) {
  const out = [];
  const seen = new Set();
  for (const c of Array.isArray(list) ? list : []) {
    const name = str(c?.name, 60).trim();
    if (!name) continue;
    let id = slug(c.id || name) || `pc${out.length + 1}`;
    while (seen.has(id)) id += "x";
    seen.add(id);
    const items = mergeAmmo(Array.isArray(c.items) ? c.items.map((s) => str(s, 60).trim()).filter(Boolean) : itemsFrom(c.loadout)).slice(0, MAX_ITEMS);
    const minStress = int(c.minStress, 0, MAX_STRESS, 2);
    const pc = {
      id,
      name,
      pronouns: str(c.pronouns, 20),
      className: CLASSES.includes(c.className) ? c.className : "Teamster",
      role: str(c.role, 80),
      crime: str(c.crime, 300),
      backstory: str(c.backstory, 2000),
      stats: Object.fromEntries(STATS.map((k) => [k, int(c.stats?.[k], 1, 99, 30)])),
      saves: Object.fromEntries(SAVES.map((k) => [k, int(c.saves?.[k], 1, 99, 30)])),
      health: { current: int(c.health?.current, 0, 99, 12), max: int(c.health?.max, 1, 99, 12) },
      wounds: { current: int(c.wounds?.current, 0, 9, 0), max: int(c.wounds?.max, 1, 9, 2) },
      stress: Math.max(int(c.stress, 0, MAX_STRESS, 2), minStress),
      minStress,
      startStress: int(c.startStress ?? DEFAULT_CREW.find((d) => d.id === slug(c.id || name))?.stress, 0, 20, 2),
      skills: (Array.isArray(c.skills) ? c.skills : String(c.skills || "").split(",")).map(skillOf).filter(Boolean).slice(0, 12),
      loadout: str(c.loadout, 400),
      items,
      armor: sanitizeArmor(c.armor, items),
      ammo: sanitizeAmmo(c.ammo),
      ...(STATUSES.includes(c.status) ? { status: c.status, statusNote: str(c.statusNote, 120) } : {}),
      ...(int(c.deathSaveIn, 0, 99, 0) ? { deathSaveIn: int(c.deathSaveIn, 0, 99, 0) } : {}),
      trinket: str(c.trinket, 160),
      patch: str(c.patch, 80),
      ...creditsOf(c),
      ...(c.base?.stats && c.base?.saves ? { base: { stats: Object.fromEntries(STATS.map((k) => [k, int(c.base.stats[k], 1, 99, 30)])), saves: Object.fromEntries(SAVES.map((k) => [k, int(c.base.saves[k], 1, 99, 30)])) } } : {}),
      cond: legacy(sanitizeCond(c.cond), c.status),
      portrait: PORTRAIT_FILE.test(c.portrait || "") ? c.portrait : "",
      retired: !!c.retired || c.status === "retired",
      replacedBy: str(c.replacedBy, 30),
      highScore: int(c.highScore, 0, 9999, 0),
      epitaph: str(c.epitaph, 140),
      endedIn: str(c.endedIn, 80),
      finalWords: str(c.finalWords, 240),
    };
    // Only living characters count toward the cap of 4: the dead and retired stay on the record, up to MAX_CREW * 3 files.
    if (out.length >= MAX_CREW * 3) break;
    if (playable(pc) && out.filter(playable).length >= MAX_CREW) continue;
    out.push(pc);
  }
  return out;
}

export function crewTargets(target, crew) {
  const t = String(target || "").trim().toLowerCase().replace(/^the\s+/, "");
  if (!t) return [];
  if (t === "human" || t === "humans") return crew.filter((c) => c.className !== "Android").map((c) => c.id);
  const cls = CLASSES.find((k) => t === k.toLowerCase() || t === `${k.toLowerCase()}s`);
  if (cls) return crew.filter((c) => c.className === cls).map((c) => c.id);
  const words = (s) => s.toLowerCase().replace(/["'“”‘’()]/g, " ").split(/\s+/).filter((w) => w.length > 1);
  return crew.filter((c) => c.id === t || c.name.toLowerCase() === t || words(c.name).some((w) => words(t).includes(w))).map((c) => c.id);
}

export function resolveVariants(list, crew) {
  return (list || []).map((v) => ({ for: v.for, to: crewTargets(v.for, crew), text: v.text })).filter((v) => v.to.length);
}

const VITALS = ["health", "wounds", "stress"];
export function setVital(pc, field, value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || !VITALS.includes(field)) return null;
  const old = field === "stress" ? pc.stress : pc[field].current;
  const next = field === "stress" ? Math.max(pc.minStress ?? 0, Math.min(MAX_STRESS, n)) : Math.max(0, Math.min(pc[field].max, n));
  if (field === "stress") pc.stress = next;
  else pc[field].current = next;
  return [old, next];
}

const STATUSES = ["unconscious", "comatose"];
export const isDead = (pc) => !!pc.cond?.dead;
function sanitizeArmor(a, items) {
  if (!a || typeof a !== "object") return armorFrom(items);
  return { name: str(a.name, 40).trim() || "Armor", ap: int(a.ap, 0, 20, 1), dr: int(a.dr, 0, 20, 0), destroyed: a.destroyed === true };
}
export const armorText = (a) => `${a.name} AP ${a.ap}${a.dr ? ` DR ${a.dr}` : ""}${a.destroyed ? " (destroyed)" : ""}`;

// "-1d10" / "+2d10" -> a signed roll.
const signedRoll = (expr, rng) => {
  const m = /^([+-])?(.+)$/.exec(expr);
  return (m[1] === "-" ? -1 : 1) * rollDice(m[2], rng).total;
};

// Applies one Wounds Table row to the character; returns what was done, in words.
function applyWound(pc, w, rng) {
  const done = [];
  if (w.bleed) {
    pc.cond ||= newCond();
    pc.cond.bleeding = Math.min(99, pc.cond.bleeding + w.bleed);
    done.push(`Bleeding +${w.bleed} (now ${pc.cond.bleeding})`);
  }
  if (w.minStress) {
    const [, to] = raiseMinStress(pc, w.minStress);
    done.push(`Minimum Stress +${w.minStress} (now ${to})`);
  }
  if (w.stress) {
    const n = rollDice(w.stress, rng).total;
    const g = gainStress(pc, n);
    done.push(`Stress +${n} (now ${g.to}${g.over ? `, ${g.over} over the maximum` : ""})`);
  }
  for (const [kind, table] of [["stats", w.stat], ["saves", w.save]]) {
    for (const [k, expr] of Object.entries(table || {})) {
      const n = signedRoll(expr, rng);
      pc[kind][k] = Math.max(1, pc[kind][k] + n);
      done.push(`${k[0].toUpperCase() + k.slice(1)}${kind === "saves" ? " Save" : ""} ${n} (now ${pc[kind][k]})`);
    }
  }
  if (w.deathSaveIn) {
    pc.deathSaveIn = Math.min(pc.deathSaveIn || Infinity, rollDice("1d10", rng).total);
    done.push(`Death Save in ${pc.deathSaveIn} rounds unless dealt with`);
  }
  if (w.burn) done.push(`on fire: ${w.burn} Damage per round until put out (the Warden applies it)`);
  return done;
}

// One Wound: +1 Wound, a Wounds Table roll for the damage type (a type with no column, like toxic, takes the Wound without a roll) and its effects.
export function gainWound(pc, type, { adv = "", carry = 0, rng = randInt } = {}) {
  pc.wounds.current++;
  const w = WOUNDS[type] ? rollWound(type, adv, rng) : { type: "", adv: "", roll: null, all: [], severity: "", text: "No Wounds Table column for this damage: the Warden chooses." };
  const entry = { ...w, n: pc.wounds.current, carryover: carry, applied: applyWound(pc, w, rng) };
  if (w.dead) (pc.cond ||= newCond()).dead = "Wounds Table";
  return entry;
}

// PSG 28-29: damage to a player character. DR, then armor, then Health; at 0 Health a Wound, a Wounds Table roll and Health back to Maximum minus the carryover.
// direct: bleeding and other harm that skips armor and DR. armorAP / dr: override the sheet's armor.
export function applyDamage(pc, amount, { type = "blunt", woundAdv = "", aa = false, direct = false, armorAP, dr, rng = randInt } = {}) {
  const res = { raw: Math.max(0, Math.floor(Number(amount) || 0)), dealt: 0, dr: 0, armorHit: null, armorDestroyed: false, armorIgnored: false, wounds: [], deathSave: false, dead: false, skipped: false };
  if (isDead(pc)) return { ...res, skipped: true };
  const armor = pc.armor || { name: "", ap: 0, dr: 0, destroyed: false };
  const m = direct ? { ...mitigate(res.raw), through: res.raw } : mitigate(res.raw, { ap: armorAP ?? (armor.destroyed ? 0 : armor.ap), dr: dr ?? armor.dr, aa });
  Object.assign(res, { dealt: m.through, dr: m.dr, armorDestroyed: m.armorDestroyed, armorIgnored: m.armorIgnored, armorHit: armor.name || null });
  if (m.armorDestroyed && armorAP === undefined && pc.armor) pc.armor.destroyed = true;
  let h = pc.health.current - m.through;
  while (h <= 0 && m.through > 0 && !isDead(pc) && pc.wounds.current < pc.wounds.max) {
    const carry = -h;
    const w = gainWound(pc, type, { adv: woundAdv, carry, rng });
    res.wounds.push(w);
    if (w.deathSave) res.deathSave = true;
    if (w.dead) res.dead = true;
    h = pc.health.max - carry;
    if (pc.wounds.current >= pc.wounds.max) res.deathSave = true;
    if (res.deathSave) break;
  }
  // House rule (the PSG gives Wounds only up to the maximum): a hit that takes a character at Maximum Wounds to 0 Health calls a Death Save.
  if (!res.deathSave && !res.dead && m.through > 0 && h <= 0 && pc.wounds.current >= pc.wounds.max) res.deathSave = true;
  pc.health.current = Math.max(0, Math.min(pc.health.max, h));
  if (res.dead) res.deathSave = false;
  return res;
}

// PSG 29.2: what a revealed Death Save roll does to the character. Dead and dying live on pc.cond (dead, dying) like every other way to die.
export function applyDeathSave(pc, roll, rng = randInt) {
  const o = deathSaveOutcome(roll, rng);
  pc.cond ||= newCond();
  delete pc.deathSaveIn;
  if (o.kind === "dead") { pc.cond.dead = "Death Save"; pc.health.current = 0; }
  else if (o.kind === "unconscious") {
    pc.status = "unconscious";
    pc.statusNote = `Wakes in ${o.minutes} minutes. Maximum Health -${o.maxHealthLoss}.`;
    pc.health.max = Math.max(1, pc.health.max - o.maxHealthLoss);
    pc.health.current = Math.min(pc.health.current, pc.health.max);
  } else if (o.kind === "dying") pc.cond.dying = o.rounds;
  else Object.assign(pc, { status: "comatose", statusNote: "Comatose." });
  return o;
}

export function stabilise(pc) {
  delete pc.status;
  delete pc.statusNote;
  delete pc.deathSaveIn;
  if (pc.cond) pc.cond.dying = 0;
}

// A Lethal Injury's countdown: true on the round the Death Save falls due.
export function deathSaveCountdown(pc) {
  if (!(pc.deathSaveIn > 0) || isDead(pc)) return false;
  if (--pc.deathSaveIn > 0) return false;
  delete pc.deathSaveIn;
  return true;
}

export function gainStress(pc, n) {
  const from = pc.stress;
  const want = from + Math.max(0, Math.round(Number(n)) || 0);
  const [, to] = setVital(pc, "stress", want);
  return { from, to, over: Math.max(0, want - MAX_STRESS) };
}

export function raiseMinStress(pc, n) {
  const from = pc.minStress ?? 2;
  pc.minStress = Math.min(MAX_STRESS, from + n);
  if (pc.stress < pc.minStress) pc.stress = pc.minStress;
  return [from, pc.minStress];
}

export const closeCrew = (pc, crew, roomOf) => {
  const room = roomOf(pc.id);
  return room ? crew.filter((c) => c.id !== pc.id && roomOf(c.id) === room) : [];
};

const ammoNote = (pc) => { const a = ammoLine(pc, weaponsOf(pc.items)); return a ? `. Ammunition: ${a}` : ""; };
export function crewStatus(crew) {
  return crew.map((c) => {
    const extra = [c.armor && `Armor ${armorText(c.armor)}`, c.cond?.bleeding && `BLEEDING ${c.cond.bleeding} per round`, c.cond?.dead && `DECEASED (${c.cond.dead})`, c.retired && "RETIRED (no longer played)", c.cond?.dying && `DYING: dead in ${c.cond.dying} rounds without intervention`, c.status && `${c.status.toUpperCase()}${c.statusNote ? ` (${c.statusNote})` : ""}`, c.deathSaveIn && `a Death Save is due in ${c.deathSaveIn} rounds unless they are treated`].filter(Boolean);
    return `- ${c.name}: Health ${c.health.current}/${c.health.max}, Wounds ${c.wounds.current}/${c.wounds.max}, Stress ${c.stress}${extra.length ? `, ${extra.join(", ")}` : ""}. Carrying: ${c.items.join(", ") || "nothing"}${ammoNote(c)}`;
  }).join("\n");
}

export function freshen(pc) {
  pc.health.current = pc.health.max;
  pc.wounds.current = 0;
  pc.stress = Math.max(pc.startStress, pc.minStress ?? 0);
  pc.items = itemsFrom(pc.loadout);
  pc.armor = armorFrom(pc.items);
  pc.ammo = {};
  stabilise(pc);
  pc.cond = newCond();
}

const MAX_ITEMS = 24;
function itemsFrom(loadout) {
  const first = String(loadout || "").split(/\.(\s|$)/)[0];
  return first.split(/[,;]/).map((s) => s.trim().replace(/\.$/, "")).filter(Boolean).map((s) => s[0].toUpperCase() + s.slice(1)).slice(0, MAX_ITEMS);
}
export function changeItem(pc, action, rawItem) {
  const item = String(rawItem || "").trim().slice(0, 60);
  if (!item) return null;
  const mag = ammoOf(item);
  if (action === "add") {
    if (mag) {
      const at = pc.items.findIndex((x) => ammoOf(x)?.weapon === mag.weapon);
      if (at >= 0) pc.items[at] = ammoItem(mag.weapon, Math.min(99, ammoOf(pc.items[at]).n + mag.n));
      else if (pc.items.length >= MAX_ITEMS) return null;
      else pc.items.push(ammoItem(mag.weapon, mag.n));
      return `picked up ${item}`;
    }
    if (pc.items.length >= MAX_ITEMS) return null;
    pc.items.push(item[0].toUpperCase() + item.slice(1));
    return `picked up ${item}`;
  }
  const verb = action === "use" ? "used" : "lost";
  if (mag) {
    const at = pc.items.findIndex((x) => ammoOf(x)?.weapon === mag.weapon);
    if (at < 0) return null;
    const left = ammoOf(pc.items[at]).n - mag.n;
    if (left > 0) pc.items[at] = ammoItem(mag.weapon, left);
    else pc.items.splice(at, 1);
    return `${verb} ${item}`;
  }
  const want = item.toLowerCase();
  const i = pc.items.findIndex((x) => x.toLowerCase() === want);
  const j = i >= 0 ? i : pc.items.findIndex((x) => x.toLowerCase().includes(want) || want.includes(x.toLowerCase()));
  if (j < 0) return null;
  const [gone] = pc.items.splice(j, 1);
  return `${verb} ${gone}`;
}

export const SKILL_BONUSES = [10, 15, 20];
const SKILL_TIERS = {
  10: ["Linguistics", "Zoology", "Botany", "Geology", "Industrial Equipment", "Jury-Rigging", "Chemistry", "Computers", "Zero-G", "Mathematics", "Art", "Archaeology", "Theology", "Military Training", "Rimwise", "Athletics"],
  15: ["Psychology", "Pathology", "Field Medicine", "Ecology", "Asteroid Mining", "Mechanical Repair", "Explosives", "Pharmacology", "Hacking", "Piloting", "Physics", "Mysticism", "Wilderness Survival", "Firearms", "Hand-to-Hand Combat"],
  20: ["Sophontology", "Exobiology", "Surgery", "Planetology", "Robotics", "Engineering", "Cybernetics", "Artificial Intelligence", "Hyperspace", "Xenoesotericism", "Command"],
};
const skillKey = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "");
const BOOK = new Map(Object.entries(SKILL_TIERS).flatMap(([b, list]) => list.map((s) => [skillKey(s), Number(b)])));
const nearestTier = (n) => SKILL_BONUSES.reduce((best, b) => (Math.abs(b - n) < Math.abs(best - n) ? b : best));

export function skillOf(raw) {
  let name, bonus;
  if (raw && typeof raw === "object") ({ name, bonus } = raw);
  else {
    const m = /^(.*?)\s*\+\s*(\d{1,2})\s*$/.exec(String(raw ?? ""));
    [name, bonus] = m ? [m[1], Number(m[2])] : [raw, undefined];
  }
  name = String(name ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
  if (!name) return null;
  const n = Number(bonus);
  return { name, bonus: Number.isFinite(n) && n > 0 ? nearestTier(n) : BOOK.get(skillKey(name)) ?? 10 };
}
export const skillText = (s) => `${s.name} +${s.bonus}`;

// Saved sheets can carry "Heavy Machinery", which is not a Mothership 1e skill: it is Industrial Equipment (Trained). The bonus stays.
export function renameSkill(crew, from = "Heavy Machinery", to = "Industrial Equipment") {
  const named = (s) => skillKey(s && typeof s === "object" ? s.name : String(s ?? "").replace(/\s*\+\s*\d{1,2}\s*$/, ""));
  for (const pc of Array.isArray(crew) ? crew : []) {
    if (!Array.isArray(pc?.skills) || !pc.skills.some((s) => named(s) === skillKey(from))) continue;
    const has = pc.skills.some((s) => named(s) === skillKey(to));
    pc.skills = pc.skills.flatMap((s) => (named(s) !== skillKey(from) ? [s] : has ? [] : [s && typeof s === "object" ? { ...s, name: to } : String(s).replace(/^\s*heavy machinery/i, to)]));
  }
}
export const findSkill = (pc, name) => (name ? (pc?.skills || []).find((s) => s.name.toLowerCase() === String(name).toLowerCase()) : null) || null;

export function crewBrief(crew, { trauma = true } = {}) {
  return crew.map((c) => `- ${c.name} (${c.pronouns ? `pronouns ${c.pronouns}` : "no pronouns given: use they/them, never guessed from the name"}; ${c.className}, ${c.role}). Convicted: ${c.crime} ${c.backstory} ${c.cond?.dead ? "[DECEASED: no longer playable] " : c.retired ? "[RETIRED: no longer playable] " : ""}Skills: ${c.skills.map(skillText).join(", ") || "none"}. Started with: ${c.loadout}${trauma ? ` Trauma response (${c.className}): ${traumaResponse(c)}` : ""}${c.notes ? ` Warden notes: ${c.notes}` : ""}`).join("\n");
}
