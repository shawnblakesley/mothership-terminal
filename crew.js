import { PORTRAIT_FILE } from "./cast.js";
import { slug, clampInt as int } from "./clean.js";
import { mitigate, deathSaveOutcome } from "./combat.js";
import { rollWound } from "./wounds.js";
import { rollDice, randInt } from "./dice.js";
import { armorFrom } from "./weapons.js";

export const MAX_CREW = 4;
export const CLASSES = ["Teamster", "Android", "Scientist", "Marine"];
export const STATS = ["strength", "speed", "intellect", "combat"];
export const SAVES = ["sanity", "fear", "body"];

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
    skills: ["Zero-G", "Heavy Machinery", "Mechanical Repair", "Jury-Rigging"],
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
    notes: "Android: Fear saves as above; other crew's Fear saves are made at [−] when MOLL-7 panics.",
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

export function sanitizeCrew(list) {
  const out = [];
  const seen = new Set();
  for (const c of Array.isArray(list) ? list : []) {
    const name = str(c?.name, 60).trim();
    if (!name) continue;
    let id = slug(c.id || name) || `pc${out.length + 1}`;
    while (seen.has(id)) id += "x";
    seen.add(id);
    const items = Array.isArray(c.items) ? c.items.map((s) => str(s, 60).trim()).filter(Boolean).slice(0, MAX_ITEMS) : itemsFrom(c.loadout);
    out.push({
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
      stress: int(c.stress, 0, 20, 2),
      startStress: int(c.startStress ?? DEFAULT_CREW.find((d) => d.id === slug(c.id || name))?.stress, 0, 20, 2),
      skills: (Array.isArray(c.skills) ? c.skills : String(c.skills || "").split(",")).map(skillOf).filter(Boolean).slice(0, 12),
      loadout: str(c.loadout, 400),
      items,
      armor: sanitizeArmor(c.armor, items),
      bleeding: int(c.bleeding, 0, 99, 0),
      ...(c.deceased === true ? { deceased: true } : {}),
      ...(STATUSES.includes(c.status) ? { status: c.status, statusNote: str(c.statusNote, 120), dyingIn: int(c.dyingIn, 0, 99, 0) } : {}),
      ...(int(c.deathSaveIn, 0, 99, 0) ? { deathSaveIn: int(c.deathSaveIn, 0, 99, 0) } : {}),
      trinket: str(c.trinket, 160),
      patch: str(c.patch, 80),
      notes: str(c.notes, 1000),
      portrait: PORTRAIT_FILE.test(c.portrait || "") ? c.portrait : "",
    });
    if (out.length >= MAX_CREW) break;
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
  const next = field === "stress" ? Math.max(0, Math.min(20, n)) : Math.max(0, Math.min(pc[field].max, n));
  if (field === "stress") pc.stress = next;
  else pc[field].current = next;
  return [old, next];
}

const STATUSES = ["unconscious", "dying", "comatose"];
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
    pc.bleeding = Math.min(99, (pc.bleeding || 0) + w.bleed);
    done.push(`Bleeding +${w.bleed} (now ${pc.bleeding})`);
  }
  if (w.minStress) {
    if (pc.minStress !== undefined) {
      pc.minStress += w.minStress;
      pc.stress = Math.min(20, Math.max(pc.stress, pc.minStress));
      done.push(`Minimum Stress +${w.minStress} (now ${pc.minStress})`);
    } else done.push(`Minimum Stress +${w.minStress}: not tracked yet, the Warden notes it`);
  }
  if (w.stress) {
    const n = rollDice(w.stress, rng).total;
    pc.stress = Math.min(20, pc.stress + n);
    done.push(`Stress +${n} (now ${pc.stress})`);
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

// PSG 28-29: damage to a player character. DR, then armor, then Health; at 0 Health a Wound, a Wounds Table roll and Health back to Maximum minus the carryover.
// direct: bleeding and other harm that skips armor and DR. armorAP / dr: override the sheet's armor.
export function applyDamage(pc, amount, { type = "blunt", woundAdv = "", aa = false, direct = false, armorAP, dr, rng = randInt } = {}) {
  const res = { raw: Math.max(0, Math.floor(Number(amount) || 0)), dealt: 0, dr: 0, armorHit: null, armorDestroyed: false, armorIgnored: false, wounds: [], deathSave: false, dead: false, skipped: false };
  if (pc.deceased) return { ...res, skipped: true };
  const armor = pc.armor || { name: "", ap: 0, dr: 0, destroyed: false };
  const m = direct ? { ...mitigate(res.raw), through: res.raw } : mitigate(res.raw, { ap: armorAP ?? (armor.destroyed ? 0 : armor.ap), dr: dr ?? armor.dr, aa });
  Object.assign(res, { dealt: m.through, dr: m.dr, armorDestroyed: m.armorDestroyed, armorIgnored: m.armorIgnored, armorHit: armor.name || null });
  if (m.armorDestroyed && armorAP === undefined && pc.armor) pc.armor.destroyed = true;
  let h = pc.health.current - m.through;
  while (h <= 0 && m.through > 0 && !pc.deceased && pc.wounds.current < pc.wounds.max) {
    const carry = -h;
    pc.wounds.current++;
    const w = rollWound(type, woundAdv, rng);
    const applied = applyWound(pc, w, rng);
    res.wounds.push({ ...w, n: pc.wounds.current, carryover: carry, applied });
    if (w.deathSave) res.deathSave = true;
    if (w.dead) { pc.deceased = true; res.dead = true; }
    h = pc.health.max - carry;
    if (pc.wounds.current >= pc.wounds.max) res.deathSave = true;
    if (res.deathSave) break;
  }
  pc.health.current = Math.max(0, Math.min(pc.health.max, h));
  if (res.dead) res.deathSave = false;
  return res;
}

// PSG 29.2: what a revealed Death Save roll does to the character.
export function applyDeathSave(pc, roll, rng = randInt) {
  const o = deathSaveOutcome(roll, rng);
  delete pc.deathSaveIn;
  if (o.kind === "dead") Object.assign(pc, { deceased: true, health: { ...pc.health, current: 0 } });
  else if (o.kind === "unconscious") {
    pc.status = "unconscious";
    pc.statusNote = `Wakes in ${o.minutes} minutes. Maximum Health -${o.maxHealthLoss}.`;
    pc.health.max = Math.max(1, pc.health.max - o.maxHealthLoss);
    pc.health.current = Math.min(pc.health.current, pc.health.max);
  } else if (o.kind === "dying") Object.assign(pc, { status: "dying", statusNote: `Dies in ${o.rounds} rounds without intervention.`, dyingIn: o.rounds });
  else Object.assign(pc, { status: "comatose", statusNote: "Comatose." });
  return o;
}

export function stabilise(pc) {
  delete pc.status;
  delete pc.statusNote;
  delete pc.dyingIn;
  delete pc.deathSaveIn;
}

// A new round: Bleeding hurts (ignoring armor and DR, PSG 32.2) and the countdowns tick. Returns an event per character who is affected.
export function roundTick(crew, rng = randInt) {
  const events = [];
  for (const pc of crew) {
    if (pc.deceased) continue;
    const ev = { pc, bleed: null, deathSave: false, died: false, left: null };
    if (pc.bleeding > 0) ev.bleed = { amount: pc.bleeding, ...applyDamage(pc, pc.bleeding, { type: "bleeding", direct: true, rng }) };
    if (ev.bleed?.deathSave) ev.deathSave = true;
    if (pc.deceased) ev.died = true;
    else if (pc.deathSaveIn > 0) {
      pc.deathSaveIn--;
      ev.left = `Death Save in ${pc.deathSaveIn} rounds`;
      if (!pc.deathSaveIn) { delete pc.deathSaveIn; ev.deathSave = true; }
    }
    if (!pc.deceased && pc.status === "dying" && pc.dyingIn > 0) {
      pc.dyingIn--;
      if (!pc.dyingIn) { pc.deceased = true; delete pc.status; ev.died = true; }
      else pc.statusNote = `Dies in ${pc.dyingIn} rounds without intervention.`;
    }
    if (ev.bleed || ev.deathSave || ev.died || ev.left) events.push(ev);
  }
  return events;
}

export function crewStatus(crew) {
  return crew.map((c) => {
    const extra = [c.armor && `Armor ${armorText(c.armor)}`, c.bleeding && `BLEEDING ${c.bleeding} per round`, c.deceased && "DECEASED", c.status && `${c.status.toUpperCase()}${c.statusNote ? ` (${c.statusNote})` : ""}`, c.deathSaveIn && `a Death Save is due in ${c.deathSaveIn} rounds unless they are treated`].filter(Boolean);
    return `- ${c.name}: Health ${c.health.current}/${c.health.max}, Wounds ${c.wounds.current}/${c.wounds.max}, Stress ${c.stress}${extra.length ? `, ${extra.join(", ")}` : ""}. Carrying: ${c.items.join(", ") || "nothing"}`;
  }).join("\n");
}

export function freshen(pc) {
  pc.health.current = pc.health.max;
  pc.wounds.current = 0;
  pc.stress = pc.startStress;
  pc.items = itemsFrom(pc.loadout);
  pc.armor = armorFrom(pc.items);
  pc.bleeding = 0;
  delete pc.deceased;
  stabilise(pc);
}

const MAX_ITEMS = 24;
function itemsFrom(loadout) {
  const first = String(loadout || "").split(/\.(\s|$)/)[0];
  return first.split(/[,;]/).map((s) => s.trim().replace(/\.$/, "")).filter(Boolean).map((s) => s[0].toUpperCase() + s.slice(1)).slice(0, MAX_ITEMS);
}
export function changeItem(pc, action, rawItem) {
  const item = String(rawItem || "").trim().slice(0, 60);
  if (!item) return null;
  if (action === "add") {
    if (pc.items.length >= MAX_ITEMS) return null;
    pc.items.push(item[0].toUpperCase() + item.slice(1));
    return `picked up ${item}`;
  }
  const want = item.toLowerCase();
  const i = pc.items.findIndex((x) => x.toLowerCase() === want);
  const j = i >= 0 ? i : pc.items.findIndex((x) => x.toLowerCase().includes(want) || want.includes(x.toLowerCase()));
  if (j < 0) return null;
  const [gone] = pc.items.splice(j, 1);
  return `lost ${gone}`;
}

export const SKILL_BONUSES = [10, 15, 20];
const SKILL_TIERS = {
  10: ["Linguistics", "Zoology", "Botany", "Geology", "Industrial Equipment", "Heavy Machinery", "Jury-Rigging", "Chemistry", "Computers", "Zero-G", "Mathematics", "Art", "Archaeology", "Theology", "Military Training", "Rimwise", "Athletics"],
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
export const findSkill = (pc, name) => (name ? (pc?.skills || []).find((s) => s.name.toLowerCase() === String(name).toLowerCase()) : null) || null;

export function crewBrief(crew) {
  return crew.map((c) => `- ${c.name} (${c.pronouns || "?"}; ${c.className}, ${c.role}). Convicted: ${c.crime} ${c.backstory} Skills: ${c.skills.map(skillText).join(", ") || "none"}. Started with: ${c.loadout}${c.notes ? ` Warden notes: ${c.notes}` : ""}`).join("\n");
}
