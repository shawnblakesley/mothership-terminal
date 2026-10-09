import { SPEAKERS, COMMS_PRESETS, voiceFor } from "./voices.js";
import { slug as keySlug, roomId } from "./clean.js";

export const MAX_CAST = 40;
export const ATTITUDES = { "-3": "Hostile", "-2": "Resentful", "-1": "Wary", 0: "Neutral", 1: "Friendly", 2: "Trusting", 3: "Loyal" };
export const attitudeLabel = (n) => ATTITUDES[n] || "Neutral";
const clampAttitude = (n) => Math.max(-3, Math.min(3, Math.round(Number(n) || 0)));
const clampStress = (n, def = 2) => (Number.isFinite(Number(n)) && n !== null && n !== "" ? Math.max(0, Math.min(20, Math.round(Number(n)))) : def);

export const PANIC_TABLE = [null,
  { name: "Adrenaline rush", effect: "[+] on every roll for the next 2d10 minutes, and Stress drops by 1d5." },
  { name: "Nervous", effect: "+1 Stress." },
  { name: "Jumpy", effect: "+1 Stress, and every crewmember close by gains 2 Stress." },
  { name: "Overwhelmed", effect: "[-] on everything for 1d10 minutes, and Minimum Stress goes up by 1 for good.", minStress: 1 },
  { name: "Coward", effect: "new Condition: they must pass a Fear Save before they can fight, or run away." },
  { name: "Frightened", effect: "new Condition: facing what frightened them calls for a Fear Save at [-], or they gain 1d5 Stress." },
  { name: "Nightmares", effect: "new Condition: [-] on every Rest Save." },
  { name: "Loss of confidence", effect: "new Condition: one of their Skills (their choice) no longer gives its bonus." },
  { name: "Deflated", effect: "new Condition: whenever a crewmember close by fails a Save, they gain 1 Stress." },
  { name: "Doomed", effect: "new Condition: their Critical Successes count as Critical Failures." },
  { name: "Suspicious", effect: "for the next week, whenever someone joins their group (even back from a short absence), a Fear Save or +1 Stress." },
  { name: "Haunted", effect: "new Condition: something has started visiting them. Soon it will make demands." },
  { name: "Death wish", effect: "for the next 24 hours, meeting a stranger or a known enemy means a Sanity Save, or they attack at once." },
  { name: "Prophetic vision", effect: "an intense vision of an impending terror, and Minimum Stress goes up by 2 for good.", minStress: 2 },
  { name: "Catatonic", effect: "unresponsive for 2d10 minutes; Stress drops by 1d10." },
  { name: "Rage", effect: "[+] on every Damage roll for 1d10 hours, and every crewmember gains 1 Stress." },
  { name: "Spiraling", effect: "new Condition: their Panic Checks are rolled with Disadvantage." },
  { name: "Compounding problems", effect: "roll twice on this table, and Minimum Stress goes up by 1 for good.", minStress: 1 },
  { name: "Heart attack / short circuit (androids)", effect: "Maximum Wounds drops by 1, [-] on every roll for 1d10 hours, and Minimum Stress goes up by 1 for good.", minStress: 1 },
  { name: "Retire", effect: "the character leaves the story: their player rolls up a new character." },
];

export function panicEntry(n) {
  const e = PANIC_TABLE[n];
  if (!e) return null;
  if (n !== 18) return { ...e };
  const more = [0, 0].map(() => { let d; do d = 1 + Math.floor(Math.random() * 20); while (d === 18); return d; });
  return {
    name: `${e.name} (${more.map((d) => `${d}: ${PANIC_TABLE[d].name}`).join(" + ")})`,
    effect: `Minimum Stress goes up by 1 for good, and two panics: ${more.map((d) => `${d}, ${PANIC_TABLE[d].name}: ${PANIC_TABLE[d].effect}`).join(" Then ")}`,
    minStress: e.minStress + more.reduce((sum, d) => sum + (PANIC_TABLE[d].minStress || 0), 0),
  };
}
export const PORTRAIT_FILE = /^([a-f0-9]{12}\.(png|jpg|webp|gif)|kit\/[a-z0-9_-]{1,60}\.(png|jpg))$/;

const slug = (s) => keySlug(s) || "someone";

export const OLD_MARLOWE_NOTES = "Runs the reactor deck. Blunt, practical, swears. Wants the cargo bay opened and dealt with; has no patience for Okonkwo.";
export const DEFAULT_MARLOWE_NOTES = "Runs the reactor deck. Blunt, practical, swears. Knows the reactor has bled power into the cargo bay for two weeks and that HV-CORE won't let her cut the feed. Can talk the crew through the reactor service. Wants the cargo bay opened and dealt with; has no patience for Okonkwo.";
const DEFAULT_FACES = { Okonkwo: "70", Salk: "09", Marlowe: "44", Voss: "71", Adar: "86", Petrov: "58", Webb: "14", Ostrand: "98", Yusuf: "12" };
export const DEFAULT_CAST = [
  { name: "Administrator Ruth Okonkwo", voice: "bf_emma", room: "command_deck", notes: "Station administrator, sealed in on the command deck. Clipped, controlled, company first. Gives orders, never answers questions about what she has reported." },
  { name: "Dr. Imre Salk", voice: "am_onyx", room: "med_bay", notes: "The station medic, in med bay. Kind, exhausted, frightened. Rambles when scared; insists the fever is under control." },
  { name: "Chief Engineer Hana Marlowe", voice: "bf_isabella", room: "reactor_access", notes: DEFAULT_MARLOWE_NOTES },
  { name: "Security Officer Dmitri Voss", voice: "bm_daniel", room: "", notes: "Station security. Speaks slowly now, with long pauses, far too calm. Repeats the last thing said to him." },
  { name: "Comms Officer Juno Adar", voice: "af_nova", room: "command_deck", notes: "Young comms officer on Deck 1, trying to fix the jammed relay for days. Talks fast, scared but hopeful; overjoyed to hear new voices." },
  { name: "Anton Petrov", voice: "bm_george", room: "reactor_access", notes: "Drill team lead, hiding behind reactor access. Whispers; paranoid; hums the same three notes between sentences." },
  { name: "Carys Webb", voice: "af_nicole", room: "med_bay", notes: "Driller, a 'fever' patient in med bay. Drowsy and sweet; says gentle, unsettling things about the cold." },
  { name: "Pell Ostrand", voice: "am_eric", room: "med_bay", notes: "Driller, a 'fever' patient in med bay. Mostly silent; when he does speak, it's in someone else's rhythm." },
  { name: "Sam Yusuf", voice: "am_puck", room: "", notes: "Refinery hand hiding in the dark on Deck 3. Whispers; cracks jokes when he's terrified." },
].map((c) => ({ id: slug(c.name), ...c, portrait: `kit/sfcp-${DEFAULT_FACES[c.name.split(" ").at(-1)]}.png` }));
export const defaultCast = () => structuredClone(DEFAULT_CAST);

export function sanitizeCast(list) {
  const out = [];
  const names = new Set(), ids = new Set();
  for (const c of Array.isArray(list) ? list : []) {
    const name = String(c?.name || "").replace(/\s+/g, " ").trim().slice(0, 40);
    if (!name || names.has(name.toLowerCase())) continue;
    names.add(name.toLowerCase());
    let id = slug(c.id || name);
    for (let n = 2; ids.has(id); n++) id = `${slug(c.id || name)}-${n}`;
    ids.add(id);
    out.push({
      id,
      name,
      voice: SPEAKERS[c.voice] ? c.voice : "",
      notes: String(c?.notes || "").slice(0, 1500),
      room: roomId(c?.room),
      portrait: PORTRAIT_FILE.test(c?.portrait || "") ? c.portrait : "",
      attitude: clampAttitude(c?.attitude),
      why: String(c?.why || "").slice(0, 160),
      stress: clampStress(c?.stress),
    });
    if (out.length >= MAX_CAST) break;
  }
  return out;
}

export function findCast(cast, name) {
  const n = String(name || "").replace(/\s*\((f|m|female|male|woman|man)\)\s*$/i, "").trim().toLowerCase();
  if (!n || !cast?.length) return null;
  const words = (s) => s.toLowerCase().replace(/[^a-z0-9' ]/g, " ").split(/\s+/).filter((w) => w.length > 1 && !["dr", "mr", "mrs", "ms", "the"].includes(w));
  const exact = cast.find((c) => c.name.toLowerCase() === n || c.id === n);
  if (exact) return exact;
  const nw = words(n);
  return cast.find((c) => { const cw = words(c.name); return nw.length && nw.every((w) => cw.includes(w)); }) || null;
}

export function addCast(cast, raw, { room = "", notes = "" } = {}) {
  const found = findCast(cast, raw);
  if (found) return { member: found, created: false };
  const m = String(raw || "").trim().match(/^(.*?)\s*\((f|m|female|male|woman|man)\)\s*$/i);
  const name = (m ? m[1] : String(raw || "")).replace(/\s+/g, " ").trim().slice(0, 40);
  if (!name || cast.length >= MAX_CAST) return { member: null, created: false };
  const sex = m ? m[2][0].toLowerCase() : "";
  let pool = Object.keys(SPEAKERS).filter((id) => !sex || id[1] === sex);
  const used = new Set(cast.map((c) => c.voice));
  if (pool.some((id) => !used.has(id))) pool = pool.filter((id) => !used.has(id));
  let h = 0;
  for (const ch of name.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  let id = slug(name);
  for (let n = 2; cast.some((c) => c.id === id); n++) id = `${slug(name)}-${n}`;
  const member = { id, name, voice: pool[h % pool.length] || "", notes: String(notes).slice(0, 600), room, portrait: "", attitude: 0, why: "", stress: 2 };
  cast.push(member);
  return { member, created: true };
}

export const castVoice = (member) => ({ engine: "neural", speaker: member?.voice || "am_michael", pace: 1 });

export function shiftStress(member, change) {
  const before = member.stress ?? 2;
  member.stress = clampStress(before + (Math.round(Number(change)) || 0));
  return [before, member.stress];
}

export function shiftAttitude(member, change, why = "") {
  const before = member.attitude || 0;
  member.attitude = clampAttitude(before + clampAttitude(change));
  if (why.trim()) member.why = why.trim().slice(0, 160);
  return [before, member.attitude];
}

export function speakingVoice(config, entry) {
  const member = entry.character ? findCast(config.cast, entry.character) : null;
  return member ? castVoice(member) : voiceFor(config.voices, entry).voice;
}

export function channelOf(config) {
  const voices = config.voices || [];
  const ok = (id) => voices.some((v) => v.id === id);
  if (ok(config.castChannel)) return config.castChannel;
  if (ok("intercom")) return "intercom";
  return voices.find((v) => COMMS_PRESETS.has(v.preset) && !["terminal", "broadcast", "narrator"].includes(v.id))?.id || "broadcast";
}

export function castFromVoices(voices, station) {
  const cast = [];
  let channel = "", most = 0;
  for (const v of voices) {
    const people = v.characters || [];
    if (!people.length || !(v.id === "intercom" || COMMS_PRESETS.has(v.preset))) continue;
    if (people.length > most) { most = people.length; channel = v.id; }
    for (const p of people) {
      if (findCast(cast, p.name)) continue;
      cast.push({ id: slug(p.name), name: p.name, voice: SPEAKERS[p.voice] ? p.voice : "", notes: p.notes || "", room: "", portrait: "" });
    }
  }
  placeByOccupants(cast, station);
  return { cast: sanitizeCast(cast), channel };
}

export function placeByOccupants(cast, station) {
  const occ = station?.occupants;
  if (!occ || typeof occ !== "object") return;
  for (const [room, value] of Object.entries(occ)) {
    if (typeof value !== "string") continue;
    const left = [];
    for (const part of value.split(",").map((s) => s.trim()).filter(Boolean)) {
      const aside = part.match(/\(([^)]*)\)\s*$/)?.[1] || "";
      const who = findCast(cast, part.replace(/\s*\([^)]*\)\s*$/, ""));
      if (!who) { left.push(part); continue; }
      who.room = room;
      if (aside && !who.notes.toLowerCase().includes(aside.toLowerCase())) who.notes = `${who.notes}${who.notes ? " " : ""}(${aside})`.slice(0, 600);
    }
    occ[room] = left.join(", ");
  }
}
