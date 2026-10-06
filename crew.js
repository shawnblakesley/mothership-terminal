// The players' characters (Mothership 1e): up to four crew files a session's
// players pick from. Each player screen claims one; the Warden sees and edits
// them all, and the agent knows who is who.
import { PORTRAIT_FILE } from "./cast.js";

export const MAX_CREW = 4;
export const CLASSES = ["Teamster", "Android", "Scientist", "Marine"];
export const STATS = ["strength", "speed", "intellect", "combat"];
export const SAVES = ["sanity", "fear", "body"];

// The default scenario: a convict maintenance crew, sent to KESTREL-9 to fix
// a comms fault. Everything on the station went wrong while they were in transit.
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

const str = (v, n) => String(v ?? "").slice(0, n);
const int = (v, min, max, def) => {
  const x = Math.round(Number(v));
  return Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : def;
};
const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30);

// Validate crew from the console or the story builder.
export function sanitizeCrew(list) {
  const out = [];
  const seen = new Set();
  for (const c of Array.isArray(list) ? list : []) {
    const name = str(c?.name, 60).trim();
    if (!name) continue;
    let id = slug(c.id || name) || `pc${out.length + 1}`;
    while (seen.has(id)) id += "x";
    seen.add(id);
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
      // Where their Stress starts in a fresh story (a restart puts it back here):
      // the original crew file's, or Mothership's 2.
      startStress: int(c.startStress ?? DEFAULT_CREW.find((d) => d.id === slug(c.id || name))?.stress, 0, 20, 2),
      skills: (Array.isArray(c.skills) ? c.skills : String(c.skills || "").split(",")).map((s) => str(s, 40).trim()).filter(Boolean).slice(0, 12),
      loadout: str(c.loadout, 400),
      // What they carry now (the loadout is how they started): changes in play.
      items: Array.isArray(c.items) ? c.items.map((s) => str(s, 60).trim()).filter(Boolean).slice(0, MAX_ITEMS) : itemsFrom(c.loadout),
      trinket: str(c.trinket, 160),
      patch: str(c.patch, 80),
      notes: str(c.notes, 1000),
      portrait: PORTRAIT_FILE.test(c.portrait || "") ? c.portrait : "", // (cast.js: an upload, or one that comes with the app)
    });
    if (out.length >= MAX_CREW) break;
  }
  return out;
}

// Which crew a variant is for: a class ("Android", "androids"), "Humans" (everyone
// but androids), or a character
// by id, name, nickname or any part of their name. Returns crew ids.
export function crewTargets(target, crew) {
  const t = String(target || "").trim().toLowerCase().replace(/^the\s+/, "");
  if (!t) return [];
  if (t === "human" || t === "humans") return crew.filter((c) => c.className !== "Android").map((c) => c.id);
  const cls = CLASSES.find((k) => t === k.toLowerCase() || t === `${k.toLowerCase()}s`);
  if (cls) return crew.filter((c) => c.className === cls).map((c) => c.id);
  const words = (s) => s.toLowerCase().replace(/["'“”‘’()]/g, " ").split(/\s+/).filter((w) => w.length > 1);
  return crew.filter((c) => c.id === t || c.name.toLowerCase() === t || words(c.name).some((w) => words(t).includes(w))).map((c) => c.id);
}

// Resolve a line's variants against the crew: [{ for, to: [ids], text }], targets that match nobody dropped.
export function resolveVariants(list, crew) {
  return (list || []).map((v) => ({ for: v.for, to: crewTargets(v.for, crew), text: v.text })).filter((v) => v.to.length);
}

// Health, wounds and stress: set one (clamped to the sheet). Returns [old, new].
export const VITALS = ["health", "wounds", "stress"];
export function setVital(pc, field, value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || !VITALS.includes(field)) return null;
  const old = field === "stress" ? pc.stress : pc[field].current;
  const next = field === "stress" ? Math.max(0, Math.min(20, n)) : Math.max(0, Math.min(pc[field].max, n));
  if (field === "stress") pc.stress = next;
  else pc[field].current = next;
  return [old, next];
}

// Their current condition and what they carry, for the agent's per-turn context.
export function crewStatus(crew) {
  return crew.map((c) => `- ${c.name}: Health ${c.health.current}/${c.health.max}, Wounds ${c.wounds.current}/${c.wounds.max}, Stress ${c.stress}. Carrying: ${c.items.join(", ") || "nothing"}`).join("\n");
}

// Fresh for a new start of the story: full Health, no Wounds, starting Stress,
// and what their loadout says they carry.
export function freshen(pc) {
  pc.health.current = pc.health.max;
  pc.wounds.current = 0;
  pc.stress = pc.startStress;
  pc.items = itemsFrom(pc.loadout);
}

// Items: a loadout's first sentence, split into things ("Vaccsuit, plasma cutter, 2 flares.").
const MAX_ITEMS = 24;
function itemsFrom(loadout) {
  const first = String(loadout || "").split(/\.(\s|$)/)[0];
  return first.split(/[,;]/).map((s) => s.trim().replace(/\.$/, "")).filter(Boolean).map((s) => s[0].toUpperCase() + s.slice(1)).slice(0, MAX_ITEMS);
}
// Add or take away one item; returns what happened, or null if nothing did.
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

// One line per character for the agent.
export function crewBrief(crew) {
  return crew.map((c) => `- ${c.name} (${c.pronouns || "?"}; ${c.className}, ${c.role}). Convicted: ${c.crime} ${c.backstory} Skills: ${c.skills.join(", ") || "none"}. Started with: ${c.loadout}${c.notes ? ` Warden notes: ${c.notes}` : ""}`).join("\n");
}
