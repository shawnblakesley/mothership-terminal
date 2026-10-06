// The cast: the people of the story (not the players' own characters, crew.js).
// Each has a human voice of their own, a portrait (optional), notes for the agent,
// and the room they're in now. Where they are decides how they're heard: in the
// players' room they talk face to face, clear; anywhere else they come over the
// intercom (config.castChannel, a voice: its name, look and speaker effects).
// The Warden edits the cast; the agent brings new people in and moves them.
//   { id, name, voice: Kokoro speaker id, notes, room: map room id or "", portrait: file or "",
//     attitude: how they feel about the players, -3 (hostile) to 3 (loyal), 0 neutral; why: the reason,
//     stress: 0-20, like the crew's (2 to start): a Panic check is a d20 at or under it }
// portrait: an upload (portraits.js), or "kit/sfcp-<n>.png", one of the pack that
// comes with the app (public/portraits/, listed in pack.json): Victor J Merino's
// Sci-fi character portraits project, CC BY-NC 4.0, credited on the players'
// screens while one is in use.
import { SPEAKERS, COMMS_PRESETS, voiceFor } from "./voices.js";

export const MAX_CAST = 40;
// How someone feels about the players: everyone starts Neutral; the agent (and the Warden) move it.
export const ATTITUDES = { "-3": "Hostile", "-2": "Resentful", "-1": "Wary", 0: "Neutral", 1: "Friendly", 2: "Trusting", 3: "Loyal" };
export const attitudeLabel = (n) => ATTITUDES[n] || "Neutral";
const clampAttitude = (n) => Math.max(-3, Math.min(3, Math.round(Number(n) || 0)));
const clampStress = (n, def = 2) => (Number.isFinite(Number(n)) && n !== null && n !== "" ? Math.max(0, Math.min(20, Math.round(Number(n)))) : def);

// The panic table: when anyone panics (a d20 at or under their Stress), the number
// rolled is looked up here, worse the higher it goes (so only the very stressed can
// roll the worst). The Warden can replace it with their own (config.panicTable: 20
// lines, "Name: what happens"); this is the app's own, in the spirit of Mothership's.
const APP_PANIC = [null,
  { name: "Steels themself", effect: "a surge of adrenaline: for the next few moments they act with sudden, sharp courage." },
  { name: "Shaking hands", effect: "they tremble badly; anything delicate they try goes wrong." },
  { name: "Hears things", effect: "they insist they hear voices or movement nobody else does, and won't let it go." },
  { name: "Jumpy", effect: "they flinch at everything and startle at any sound; they might lash out by reflex." },
  { name: "Freezes", effect: "they lock up, unable to move or speak for a while; someone has to pull them along." },
  { name: "Bolts", effect: "they turn and run, abandoning whatever they were doing and whoever they were with." },
  { name: "Hides", effect: "they find somewhere to hide and won't come out." },
  { name: "Babbles", effect: "they talk fast and make no sense, and blurt out something they shouldn't (a secret slips)." },
  { name: "Begs", effect: "they cling to the players and plead to be saved; useless until someone calms them." },
  { name: "Lashes out", effect: "they attack the nearest person, or smash whatever is in reach." },
  { name: "Hopeless", effect: "they give up: they're sure everyone is going to die, and refuse to help." },
  { name: "Paranoid", effect: "they decide one of the players is to blame, or infected, and turn on them." },
  { name: "Collapses", effect: "they're violently sick and drop to the floor, too weak to stand for a while." },
  { name: "Reckless", effect: "they do something rash that puts themselves and everyone near them in danger." },
  { name: "Faints", effect: "they pass out cold." },
  { name: "Catatonic", effect: "they stare into nothing, unresponsive, until something snaps them out of it." },
  { name: "Berserk", effect: "they attack wildly, friend or foe, until they're restrained or stopped." },
  { name: "Breaks", effect: "a complete breakdown: screaming, weeping, beyond reason for the rest of the scene." },
  { name: "Desperate act", effect: "they do something that makes everything much worse: seal a door with people behind it, trigger an alarm, take a hostage." },
  { name: "Heart attack", effect: "they collapse clutching their chest, and will die within minutes without medical help. (Something artificial suffers a catastrophic shutdown instead.)" },
];
// A portrait file: an upload, or one that comes with the app (the crew's use these too).
export const PORTRAIT_FILE = /^([a-f0-9]{12}\.(png|jpg|webp|gif)|kit\/[a-z0-9_-]{1,60}\.(png|jpg))$/;

const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "someone";

// KESTREL-9's people, where they are when the crew arrives.
export const OLD_MARLOWE_NOTES = "Runs the reactor deck. Blunt, practical, swears. Wants the cargo bay opened and dealt with; has no patience for Okonkwo.";
export const DEFAULT_MARLOWE_NOTES = "Runs the reactor deck. Blunt, practical, swears. Knows the reactor has bled power into the cargo bay for two weeks and that HV-CORE won't let her cut the feed. Can talk the crew through the reactor service. Wants the cargo bay opened and dealt with; has no patience for Okonkwo.";
// Their faces, by number in the portrait pack.
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

// Validate whatever the console (or a saved story, or the story builder) sends.
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
      room: String(c?.room || "").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 60),
      portrait: PORTRAIT_FILE.test(c?.portrait || "") ? c.portrait : "",
      attitude: clampAttitude(c?.attitude),
      why: String(c?.why || "").slice(0, 160),
      stress: clampStress(c?.stress),
    });
    if (out.length >= MAX_CAST) break;
  }
  return out;
}

// Find someone by name, forgivingly: "Salk" or "Dr. Salk" find "Dr. Imre Salk".
export function findCast(cast, name) {
  const n = String(name || "").replace(/\s*\((f|m|female|male|woman|man)\)\s*$/i, "").trim().toLowerCase();
  if (!n || !cast?.length) return null;
  const words = (s) => s.toLowerCase().replace(/[^a-z0-9' ]/g, " ").split(/\s+/).filter((w) => w.length > 1 && !["dr", "mr", "mrs", "ms", "the"].includes(w));
  const exact = cast.find((c) => c.name.toLowerCase() === n || c.id === n);
  if (exact) return exact;
  const nw = words(n);
  return cast.find((c) => { const cw = words(c.name); return nw.length && nw.every((w) => cw.includes(w)); }) || null;
}

// Someone new the agent brought in ("Marlowe (f)"): added with a voice nobody
// else is using (stable for the name). Returns { member, created }.
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

// The base voice someone speaks with: always a human one.
export const castVoice = (member) => ({ engine: "neural", speaker: member?.voice || "am_michael", pace: 1 });

// The base voice a log line is spoken with: its speaker's (the cast's own), or its voice's.
// Raise or lower someone's Stress (0-20). Returns [before, after].
export const DEFAULT_PANIC_TABLE = APP_PANIC.slice(1).map((e) => `${e.name}: ${e.effect}`);

// 20 lines, one per result (a blank one falls back to the app's).
export function sanitizePanicTable(list) {
  const lines = Array.isArray(list) ? list : [];
  return DEFAULT_PANIC_TABLE.map((d, i) => String(lines[i] ?? "").replace(/\s+/g, " ").trim().slice(0, 400) || d);
}

// Result n (1-20) of the session's table: { name, effect }.
export function panicEntry(table, n) {
  const line = sanitizePanicTable(table)[n - 1] || "";
  const m = /^([^:]{1,60}):\s*(.*)$/.exec(line);
  return m ? { name: m[1].trim(), effect: m[2].trim() || m[1].trim() } : { name: line.split(" ").slice(0, 4).join(" "), effect: line };
}

export function shiftStress(member, change) {
  const before = member.stress ?? 2;
  member.stress = clampStress(before + (Math.round(Number(change)) || 0));
  return [before, member.stress];
}

// Move someone's attitude by `change` steps (clamped). Returns [before, after].
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

// The voice the cast is heard through when they aren't in the room.
export function channelOf(config) {
  const voices = config.voices || [];
  const ok = (id) => voices.some((v) => v.id === id);
  if (ok(config.castChannel)) return config.castChannel;
  if (ok("intercom")) return "intercom";
  return voices.find((v) => COMMS_PRESETS.has(v.preset) && !["terminal", "broadcast", "narrator"].includes(v.id))?.id || "broadcast";
}

// Stories from before the cast was its own thing: people moved out of the voices
// they spoke through (the comms-like ones: an intercom, a radio), into rooms by
// the station's occupants lists (and taken off them: the cast's room is theirs).
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

// Rooms from occupants.<room> ("Dr. Imre Salk, Carys Webb (hiding)"); whoever is
// matched comes off the list (what was said about them in brackets goes to their notes).
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
