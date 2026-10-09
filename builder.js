import { BUILTIN, PRESETS, SPEAKERS, defaultVoices, fromPreset, sanitizeVoices } from "./voices.js";
import { sanitizeCast, addCast } from "./cast.js";
import { CLASSES, STATS, SAVES, sanitizeCrew, maxWoundsFor } from "./crew.js";
import { sanitizeStats } from "./combat.js";
import { WOUND_TYPES } from "./wounds.js";
import { LOOKS, DEFAULT_TERMINALS, sanitizeTerminals, netKey } from "./terminals.js";

const THEMES = ["green", "amber", "cyan", "white", "red"];
const PRESET_IDS = Object.keys(PRESETS);

export const APP_BRIEF = `HOW THIS GAME IS PLAYED
This is a Mothership (sci-fi horror TTRPG) session run through an app. The players sit at a computer terminal aboard a station or ship and type to it. An AI (you, later, in play) voices everything that can talk to them: the station computer (with its own name and personality), station-wide announcements, and other voices such as the intercom, where several named people can speak, or something that should not be in the system. The Warden (game master) steers, calls for Mothership rolls (Stats: Strength, Speed, Intellect, Combat; Saves: Sanity, Fear, Body; roll d100 under the number) and can fire screen effects.
The scenario needs: a station or ship; public lore; secrets the computer guards by access level (passwords, company directives, what really happened); a station state the computer tracks (doors, lights per deck, cameras, systems...); a deck/room layout; the cast of people who can be heard; and up to 4 player characters with backstories tied to why they are there.`;

const BUILDER_CHAT = `You are co-writing a brand-new scenario with the Warden.

${APP_BRIEF}

HOW TO TALK WITH THE WARDEN
- Be a creative partner: offer vivid, specific ideas and 2-3 options when there's a choice, and build on what the Warden likes. Mothership tone: blue-collar crews, corporate greed, isolation, dread.
- Ask at most 2-3 focused questions at a time. Keep replies short (under ~150 words), plain text, no markdown headings.
- Cover, over the conversation: the setting, what went wrong and when, the threat, the secrets, who is still alive and can talk, the computer's personality, and who the players are and why they came.
- When there's enough to write the whole scenario (it's fine to fill gaps yourself), say so and set ready=true; the Warden then presses "Draft it". Until then ready=false.`;

const BUILDER_DRAFT = `You are writing the complete scenario the Warden and you have just discussed, ready to play.

${APP_BRIEF}

Follow the conversation; invent anything it left open, consistent with it. Write for play: concrete, evocative, usable at the table.

FIELDS
- title, pitch: the scenario's name and a 1-2 sentence hook for the Warden.
- stationName: short, caps-friendly (e.g. "KESTREL-9").
- theme: the terminal's screen colour.
- lore: what the station's systems hold as public knowledge, as short labelled lines (STATION:, CREW COMPLEMENT:, DECKS:, KEY CREW:, RECENT EVENTS:, and why the players are here).
- secrets: bullet lines ("- ...") the computer knows and guards by access level: what really happened, the threat, passwords, directives, who is infected or lying.
- standingOrders: optional persistent steering for the AI during play (tone, slow reveals), or "".
- station: the computer's live state as path/value pairs, e.g. access_level=GUEST, doors.med_bay=OPEN, lights.deck_2=FLICKERING, cameras.cargo_bay=OFFLINE, life_support.oxygen_pct=87, power.reactor=ONLINE, comms=JAMMED, quarantine=INACTIVE. access_level must be GUEST. Use room ids from the map in door/camera paths and deck_N for lights.
- map: the layout, one line per deck: "Deck 1 · Command / Comms: room_id=Room Name, other_room=Other Name". Then optional connections: "Link: room_a - room_b (air vents)". Room ids are snake_case and match the station state paths. 2-5 decks, 1-6 rooms each.
- computer: the station computer's display name (e.g. "HV-CORE") and persona: who it is and how it writes (it prints on a monochrome CRT terminal; casing, tone, length), what it knows, how it treats access levels and hacking attempts. Write the persona as instructions addressed to it ("You are ...").
- broadcastPersona: the automated public-address voice's persona (announces, never converses).
- voices: other voices that can speak: always one with id "intercom" (preset intercom), the station intercom the cast are heard over when they aren't in the players' room; optionally others (a ship's computer, a radio). Threats aren't voices: they go under adversaries. For each: id (snake_case), name (as shown on screen, e.g. "INTERCOM"), preset (sound: intercom/human for comms, robotic, ethereal, radio, demonic, whisper, clean), color (#rrggbb or ""), persona (what it is and how it sounds; for the intercom, how people sound over it), and systems (where it can be heard: [] for the station's own network, a terminal's system name for a separate machine like the players' ship, or ["ALL"] for something in every machine).
- adversaries: the story's threats (the creature, the entity, the thing in the walls; usually 1, at most 3): name (its true name, e.g. "THE ORGANISM"; the players only learn it when they see it, until then its lines show as ???), persona (what it is, what it wants, how it acts and, if it can, how it speaks: all lowercase fragments suit something inhuman), and preset (its sound: demonic, ethereal, whisper, robotic, radio). Optionally combat, its Mothership 1e stat block for a crew of four 1e characters (Health 11-20, Combat 24-44): combat (typically 30-55) and instinct (30-60), ap (armor points, usually 0-5), dr, woundsMax (1-4) with healthPerWound (10-30), attacks (name, damage as dice from 1d10 to 3d10, woundType one of ${WOUND_TYPES.join("/")}, woundAdv "+" or "-" or "", special) and special (how it is beaten, if not by hurting it). A swarm or group is written per individual. Something meant to be unbeatable head-on gets very high numbers and a special line saying how it is beaten.
- cast: the story's named people the players can meet or hear (not the players' own characters), each with sex (f/m), a voice (a distinct speaker id from the list; never reuse one), room (the map room id where they are when the story starts, or "" for nowhere on the map: missing, hiding somewhere unknown, off-station) and notes (who they are, what they want, how they talk, and anything the AI must keep in mind). Someone in the players' room talks to them face to face; anyone else, over the intercom.
- terminals: 3-6 physical terminals the players can use, in map rooms (room = a room id from the map), each with a look (any of: ${LOOKS.filter((l) => l !== "portable").join(", ")}; [] for clean), open (can the players reach it at the start?), system and os, and notes (what's there, what happened at it). system is "" for the station's own network; a separate machine that isn't on it (the players' ship, a shuttle, a derelict) gets its own system name, and os the name of its operating system (e.g. "TUG-CORE OS v2.7"), and its screens show only what's said on it. Most terminals are on the station ("" and ""). Make the looks tell the story: clean where they arrive, bloody and cracked where it went wrong. A portable handheld terminal is added automatically.
- crew: the players' characters (1-4, normally 4), Mothership 1e. className one of ${CLASSES.join(", ")}. Character creation: each Stat (${STATS.join(", ")}) is 2d10+25 (27-45) and each Save (${SAVES.join(", ")}) is 2d10+10 (12-30), then the class modifiers. Marine: +10 Combat, +10 Body Save, +20 Fear Save. Android: +20 Intellect, -10 to one Stat, +60 Fear Save. Scientist: +10 Intellect, +5 to one Stat, +30 Sanity Save. Teamster: +5 to all Stats, +10 to all Saves. Health max is 1d10+10 (11-20). Wounds max is 2, plus 1 for Marines and Androids (so 3 for them, 2 for Scientists and Teamsters). Stress 2. 3-5 skills from the Mothership 1e list, including the class's own (Marine: Military Training, Athletics; Android: Linguistics, Computers, Mathematics; Teamster: Industrial Equipment, Zero-G). Trained is +10, Expert +15, Master +20; an Expert skill needs one of its Trained prerequisites (Hacking: Computers; Piloting: Zero-G; Firearms: Military Training or Rimwise; Mechanical Repair: Industrial Equipment or Jury-Rigging; Field Medicine: Zoology or Botany). Give each a role, pronouns, crime or reason they're here (field "crime"; for non-convicts, why they took the job), a 3-5 sentence backstory with a hook, loadout (realistic for why they came), trinket and patch. notes: anything only the Warden should know about them, or "".

- documents: 0-3 starting documents the players begin with, in their DOCS on every screen, if the story has some that fit: what they were handed or carry in (a work order, a mission briefing, a dossier on the target, a ship's manifest, a letter). Each has a title (caps-friendly, e.g. WORK ORDER 4471) and text in Markdown (# headings, **bold**, *italic*, __underline__, ~~crossed out~~, - lists, > quotes, --- dividers), under 200 words, in the voice of whoever wrote it, giving the players clear hooks: what they're here to do, codes and names they'll need, what to look out for. Never the secrets. [] when none fits.

LENGTH (it must fit in one reply): lore and secrets under ~200 words each; each persona under ~150 words; each cast note under ~40 words; backstories 3-4 sentences; 15-35 station values; at most ~10 cast.`;

const str = { type: "string" };
const strDesc = (description) => ({ type: "string", description });
const int = { type: "integer" };
const obj = (properties) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
const num = { type: "integer" };

const CHAT_SCHEMA = obj({
  reply: strDesc("Your message to the Warden."),
  ready: { type: "boolean", description: "True once there's enough to draft the whole scenario." },
});

export const DRAFT_SCHEMA = obj({
  title: str,
  pitch: str,
  stationName: str,
  theme: { type: "string", enum: THEMES },
  lore: str,
  secrets: str,
  standingOrders: str,
  station: { type: "array", items: obj({ path: str, value: str }) },
  map: str,
  computer: obj({ name: str, persona: str }),
  broadcastPersona: str,
  voices: {
    type: "array",
    items: obj({
      id: str,
      name: str,
      preset: { type: "string", enum: PRESET_IDS },
      color: str,
      persona: str,
      systems: { type: "array", items: str },
    }),
  },
  adversaries: {
    type: "array",
    items: {
      type: "object",
      additionalProperties: false,
      required: ["name", "persona", "preset"],
      properties: {
        name: str,
        persona: str,
        preset: { type: "string", enum: PRESET_IDS },
        combat: obj({
          combat: int, instinct: int, ap: int, dr: int, woundsMax: int, healthPerWound: int,
          attacks: { type: "array", items: obj({ name: str, damage: str, woundType: { type: "string", enum: WOUND_TYPES }, woundAdv: { type: "string", enum: ["", "+", "-"] }, special: str }) },
          special: str,
        }),
      },
    },
  },
  cast: {
    type: "array",
    items: obj({ name: str, sex: { type: "string", enum: ["f", "m"] }, voice: { type: "string", enum: Object.keys(SPEAKERS) }, room: str, notes: str }),
  },
  documents: { type: "array", items: obj({ title: str, text: str }) },
  terminals: {
    type: "array",
    items: obj({ name: str, room: str, look: { type: "array", items: { type: "string", enum: LOOKS.filter((l) => l !== "portable") } }, open: { type: "boolean" }, system: str, os: str, notes: str }),
  },
  crew: {
    type: "array",
    items: obj({
      name: str, pronouns: str, className: { type: "string", enum: CLASSES }, role: str, crime: str, backstory: str,
      stats: obj(Object.fromEntries(STATS.map((k) => [k, num]))),
      saves: obj(Object.fromEntries(SAVES.map((k) => [k, num]))),
      health_max: num, wounds_max: num, stress: num,
      skills: { type: "array", items: str },
      loadout: str, trinket: str, patch: str, notes: str,
    }),
  },
});

export const SPEAKER_LIST = `SPEAKER VOICES (for the cast): ${Object.entries(SPEAKERS).map(([id, d]) => `${id} = ${d}`).join("; ")}.`;

function transcript(b) {
  const msgs = b.messages.map((m) => ({ role: m.role === "warden" ? "user" : "assistant", content: m.role === "warden" ? m.text : JSON.stringify({ reply: m.text, ready: false }) }));
  if (!msgs.length || msgs[0].role !== "user") msgs.unshift({ role: "user", content: "Let's make a new scenario." });
  return msgs;
}

export function chatRequest(b) {
  return {
    system: BUILDER_CHAT,
    context: b.draft ? `A DRAFT ALREADY EXISTS (the Warden may want changes; discuss them, then they press "Draft it" again):\n${summary(b.draft)}` : "No draft yet.",
    messages: transcript(b),
    schema: CHAT_SCHEMA,
    example: { reply: "A derelict ore hauler, or a research station? ...", ready: false },
  };
}

export function draftRequest(b) {
  const convo = b.messages.map((m) => `${m.role === "warden" ? "WARDEN" : "YOU"}: ${m.text}`).join("\n\n") || "(The Warden gave no details: invent an original scenario.)";
  return {
    system: `${BUILDER_DRAFT}\n\n${SPEAKER_LIST}`,
    context: b.draft ? `PREVIOUS DRAFT (revise it according to the conversation since; keep what wasn't changed):\n${JSON.stringify(b.draft)}` : "No previous draft.",
    messages: [{ role: "user", content: `THE CONVERSATION:\n\n${convo}\n\nWrite the complete scenario now.` }],
    schema: DRAFT_SCHEMA,
    example: null,
    maxTokens: 16000,
  };
}

const summary = (d) => `${d.title}: ${d.pitch}\nStation: ${d.stationName}. Cast: ${d.cast.map((c) => c.name).join(", ") || "none"}. Crew: ${d.crew.map((c) => c.name).join(", ")}.`;

export function normalizeDraft(raw) {
  const s = (v, n) => String(v ?? "").slice(0, n);
  const d = raw && typeof raw === "object" ? raw : {};
  return {
    title: s(d.title, 120) || "Untitled scenario",
    pitch: s(d.pitch, 600),
    stationName: s(d.stationName, 40) || "STATION",
    theme: THEMES.includes(d.theme) ? d.theme : "green",
    lore: s(d.lore, 6000),
    secrets: s(d.secrets, 6000),
    standingOrders: s(d.standingOrders, 3000),
    station: (Array.isArray(d.station) ? d.station : []).filter((p) => p && p.path).slice(0, 120).map((p) => ({ path: s(p.path, 80), value: s(p.value, 120) })),
    map: s(d.map, 4000),
    computer: { name: s(d.computer?.name, 40) || "STATION OS", persona: s(d.computer?.persona, 8000) },
    broadcastPersona: s(d.broadcastPersona, 4000),
    voices: (Array.isArray(d.voices) ? d.voices : []).slice(0, 8).map((v) => ({
      id: s(v?.id, 40), name: s(v?.name, 40), preset: PRESET_IDS.includes(v?.preset) ? v.preset : "intercom",
      color: /^#[0-9a-f]{6}$/i.test(v?.color || "") ? v.color : "", persona: s(v?.persona, 8000),
      systems: (Array.isArray(v?.systems) ? v.systems : []).slice(0, 16).map((n) => s(n, 40)).filter(Boolean),
    })).filter((v) => v.name),
    adversaries: (Array.isArray(d.adversaries) ? d.adversaries : []).slice(0, 3).map((a) => ({ name: s(a?.name, 40).toUpperCase(), persona: s(a?.persona, 8000), preset: PRESET_IDS.includes(a?.preset) ? a.preset : "demonic", ...(a?.combat && typeof a.combat === "object" ? { stats: sanitizeStats({ ...a.combat, wounds: a.combat.woundsMax, health: a.combat.healthPerWound }) } : {}) })).filter((a) => a.name),
    cast: (Array.isArray(d.cast) ? d.cast : (Array.isArray(d.voices) ? d.voices : []).flatMap((v) => v?.characters || [])).slice(0, 30)
      .map((c) => ({ name: s(c?.name, 40), sex: c?.sex === "m" ? "m" : "f", voice: SPEAKERS[c?.voice] ? c.voice : "", room: s(c?.room, 60), notes: s(c?.notes, 500) })).filter((c) => c.name),
    crew: (Array.isArray(d.crew) ? d.crew : []).slice(0, 4),
    terminals: (Array.isArray(d.terminals) ? d.terminals : []).slice(0, 10),
    documents: (Array.isArray(d.documents) ? d.documents : []).slice(0, 3).map((x) => ({ title: s(x?.title, 120).trim(), text: s(x?.text, 4000).trim() })).filter((x) => x.title && x.text),
  };
}

export function applyDraft(d) {
  const base = defaultVoices();
  const terminal = { ...base.find((v) => v.id === BUILTIN.terminal), name: d.computer.name, persona: d.computer.persona || base[0].persona };
  const broadcast = { ...base.find((v) => v.id === BUILTIN.broadcast), persona: d.broadcastPersona || base[1].persona };
  const others = d.voices.map((v) => {
    return {
      id: v.id || v.name, name: v.name, style: "label", color: v.color, persona: v.persona, ...fromPreset(v.preset),
      systems: (v.systems || []).map((n) => (/^all$/i.test(n) ? "*" : netKey(n) === netKey(d.stationName) ? "" : netKey(n))).filter((n, i, a) => a.indexOf(n) === i),
    };
  });
  const idOf = (v) => String(v.id || "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40);
  let channel = others.find((v) => idOf(v) === "intercom") || others.find((v) => v.preset === "intercom");
  if (!channel) others.unshift((channel = base.find((v) => v.id === "intercom")));
  const cast = [];
  for (const c of d.cast) {
    const room = c.room.toLowerCase().replace(/[^a-z0-9_]/g, "");
    if (c.voice && !cast.some((x) => x.voice === c.voice)) cast.push({ name: c.name, voice: c.voice, notes: c.notes, room });
    else addCast(cast, `${c.name} (${c.sex})`, { room, notes: c.notes });
  }
  const station = {};
  for (const { path, value } of d.station) {
    const keys = path.split(".").map((k) => k.trim()).filter(Boolean);
    if (!keys.length || keys.some((k) => ["__proto__", "constructor", "prototype"].includes(k))) continue;
    let o = station;
    for (const k of keys.slice(0, -1)) o = typeof o[k] === "object" && o[k] ? o[k] : (o[k] = {});
    o[keys.at(-1)] = /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value;
  }
  station.access_level = "GUEST";
  const crew = sanitizeCrew(d.crew.map((c) => ({
    ...c,
    startStress: c.stress,
    health: { current: c.health_max, max: c.health_max },
    wounds: { current: 0, max: maxWoundsFor(c.className) },
  })));
  return {
    config: {
      stationName: d.stationName,
      theme: d.theme,
      lore: d.lore,
      secrets: d.secrets,
      standingOrders: d.standingOrders,
      map: d.map,
      voices: sanitizeVoices([terminal, broadcast, base.find((v) => v.id === BUILTIN.narrator), ...others.filter((v) => v.id !== BUILTIN.narrator),
        ...(d.adversaries || []).map((a, i) => ({ id: `adversary-${i + 1}`, name: a.name, style: "label", color: "#ff5a5a", persona: a.persona, ...fromPreset(a.preset), systems: [""], adversary: { revealed: false, picture: "", ...(a.stats ? { stats: a.stats } : {}) } }))]),
      crew,
      cast: sanitizeCast(cast),
      castChannel: idOf(channel),
      terminals: sanitizeTerminals([...d.terminals, DEFAULT_TERMINALS.find((t) => t.id === "portable")]),
      startDocs: (d.documents || []).map((x, i) => ({ id: `doc-start-${i + 1}`, title: x.title, text: x.text, to: "", at: 0 })),
    },
    station,
  };
}

const PITCHES = `You pitch scenarios for Mothership (sci-fi horror TTRPG) to a group of players with NO Warden: an AI will build the whole world from the one they pick, then run it.

${APP_BRIEF}

Pitch 4 original one-session scenarios, each clearly different from the others: vary the setting (a station, a ship, a colony, a derelict, a moon base, a research lab...), the threat (a creature, a contagion, a rogue AI, a cult, something from the void, corporate horror...) and the mood (dread, paranoia, body horror, isolation, a race against time). Mothership tone: blue-collar crews, corporate greed, nobody coming to help.

For each: title (2-5 words); hook (2 short sentences: who the players are, where, why they came, and what feels wrong; never give away the twist); tags (3 short words, e.g. "derelict · parasite · claustrophobic").`;

const PITCH_SCHEMA = obj({
  pitches: { type: "array", items: obj({ title: str, hook: str, tags: str }) },
});

export function pitchesRequest(avoid = []) {
  return {
    system: PITCHES,
    context: avoid.length ? `ALREADY OFFERED (pitch different ones): ${avoid.join("; ")}` : "Nothing offered yet.",
    messages: [{ role: "user", content: "Pitch 4 scenarios." }],
    schema: PITCH_SCHEMA,
    example: { pitches: [{ title: "The Long Quiet", hook: "...", tags: "derelict · signal · dread" }] },
  };
}

export function normalizePitches(r) {
  const s = (v, n) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
  return (Array.isArray(r?.pitches) ? r.pitches : []).map((p) => ({ title: s(p?.title, 60), hook: s(p?.hook, 400), tags: s(p?.tags, 80) })).filter((p) => p.title && p.hook).slice(0, 6);
}

export function pitchBuilder(p) {
  return {
    messages: [{ role: "warden", text: `Build this scenario. It will be played WITHOUT a Warden: the AI runs everything, so make it self-contained and playable from the players' terminals, with clues they can find, people they can talk to, and a way to win, escape or die.\n\n${p.title}: ${p.hook} (${p.tags})\n\nWrite 4 player characters.` }],
    draft: null,
  };
}
