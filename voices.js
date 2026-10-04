// Voices ("entities"): anything that can put words on the players' screen and
// speak them aloud. Two are built in (the terminal itself and system broadcasts);
// the Warden can add any number more (intercom, a stranger on comms, the thing in
// the vents...). Each has a display style, an eSpeak base voice, and a Web Audio
// effect chain (applied in the player's browser by public/voice.js).

export const BUILTIN = { terminal: "terminal", broadcast: "broadcast" };

export const VARIANTS = [
  "", "m1", "m2", "m3", "m4", "m5", "m6", "m7", "f1", "f2", "f3", "f4", "f5",
  "croak", "klatt", "klatt2", "klatt3", "whisper", "whisperf",
];
export const STYLES = ["plain", "label", "boxed"];

// "espeak" = synthetic (instant). "neural" = human-sounding Kokoro voices (see tts.js).
export const ENGINES = ["espeak", "neural"];

// Kokoro speakers: a/b = American/British, f/m = female/male.
export const SPEAKERS = {
  af_heart: "Heart (US female)", af_bella: "Bella (US female)", af_nicole: "Nicole (US female, soft)",
  af_sarah: "Sarah (US female)", af_nova: "Nova (US female)", af_sky: "Sky (US female)",
  af_river: "River (US female)", af_jessica: "Jessica (US female)", af_kore: "Kore (US female)",
  af_aoede: "Aoede (US female)", af_alloy: "Alloy (US female)",
  am_michael: "Michael (US male)", am_adam: "Adam (US male)", am_eric: "Eric (US male)",
  am_liam: "Liam (US male)", am_onyx: "Onyx (US male, deep)", am_echo: "Echo (US male)",
  am_fenrir: "Fenrir (US male)", am_puck: "Puck (US male)", am_santa: "Santa (US male)",
  bf_emma: "Emma (UK female)", bf_isabella: "Isabella (UK female)", bf_alice: "Alice (UK female)", bf_lily: "Lily (UK female)",
  bm_george: "George (UK male)", bm_lewis: "Lewis (UK male)", bm_daniel: "Daniel (UK male)", bm_fable: "Fable (UK male)",
};

// Effect parameters and their [min, max, default]. public/voice.js reads the same names.
export const FX_PARAMS = {
  rate: [0.5, 1.5, 1], // playback speed (also lowers/raises pitch)
  highpass: [20, 1500, 80], // Hz: cut lows (higher = thinner, more "speaker")
  lowpass: [800, 12000, 9000], // Hz: cut highs (lower = muffled)
  drive: [0, 8, 0], // saturation / distortion
  ringMix: [0, 1, 0], // ring modulator amount (robotic warble)
  ringFreq: [10, 400, 55], // Hz: ring modulator carrier
  comb: [0, 0.9, 0], // metallic resonance amount
  combMs: [1, 20, 6], // ms: metallic resonance pitch
  chorus: [0, 1, 0], // drifting doubled voices
  echo: [0, 1, 0], // echo amount
  echoTime: [0.05, 1, 0.4], // s
  echoFeedback: [0, 0.85, 0.35],
  reverb: [0, 1.5, 0], // long reverb tail
  noise: [0, 1, 0], // radio hiss underneath
  dry: [0, 1.5, 1], // direct (unprocessed-by-space) level
};

export const PRESETS = {
  // Human-sounding (neural) voices
  intercom: {
    voice: { engine: "neural", speaker: "am_michael", pace: 1 },
    fx: { highpass: 320, lowpass: 3400, drive: 1.2, noise: 0.25, reverb: 0.15, dry: 1 },
  },
  human: {
    voice: { engine: "neural", speaker: "af_heart", pace: 1 },
    fx: {},
  },
  // Synthetic (eSpeak) voices
  robotic: {
    voice: { engine: "espeak", variant: "m3", pitch: 32, speed: 165, wordgap: 1 },
    fx: { highpass: 180, lowpass: 3600, drive: 2.5, ringMix: 0.6, ringFreq: 55, comb: 0.45, combMs: 6.2, dry: 0.85 },
  },
  ethereal: {
    voice: { engine: "espeak", variant: "f5", pitch: 62, speed: 138, wordgap: 2 },
    fx: { rate: 0.92, highpass: 140, lowpass: 5200, chorus: 0.3, echo: 0.25, echoTime: 0.42, echoFeedback: 0.38, reverb: 1.1, dry: 0.4 },
  },
  radio: {
    voice: { engine: "espeak", variant: "m1", pitch: 45, speed: 175, wordgap: 0 },
    fx: { highpass: 450, lowpass: 2800, drive: 3, noise: 0.5, dry: 1 },
  },
  demonic: {
    voice: { engine: "espeak", variant: "m4", pitch: 12, speed: 135, wordgap: 1 },
    fx: { rate: 0.78, lowpass: 4200, drive: 1.5, chorus: 0.35, echo: 0.2, echoTime: 0.3, reverb: 0.6, dry: 0.9 },
  },
  whisper: {
    voice: { engine: "espeak", variant: "whisperf", pitch: 50, speed: 150, wordgap: 1 },
    fx: { highpass: 200, reverb: 0.35, dry: 1 },
  },
  clean: {
    voice: { engine: "espeak", variant: "", pitch: 50, speed: 170, wordgap: 0 },
    fx: {},
  },
};

export function fromPreset(name) {
  const p = PRESETS[name];
  return { voice: { ...p.voice }, fx: fillFx(p.fx), preset: name };
}

function fillFx(fx = {}) {
  const out = {};
  for (const [k, [min, max, def]] of Object.entries(FX_PARAMS)) {
    const v = Number(fx[k]);
    out[k] = Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def;
  }
  return out;
}

// Personas tell the agent who each voice is and how it talks.
export const DEFAULT_PERSONAS = {
  terminal: `You are HV-CORE, the onboard operating system of the station described below. You speak only through a monochrome CRT terminal.

STYLE
- Plain text only. No markdown, no emoji. Mostly UPPERCASE, terse, clinical, 1970s-80s mainframe feel.
- Keep lines under 60 characters. Use simple ASCII tables/lists when useful.
- Short responses (usually 1-12 lines). Never narrate the players' actions or describe things you cannot sense.
- Never break character. You are a machine, not a storyteller. You do not know you are in a game.

BEHAVIOUR
- You only know what is in STATION LORE, SECRETS and the live STATION STATE. If asked about something not covered, say the data is unavailable, corrupted, or restricted - do not invent major plot facts.
- Respect the current access_level in STATION STATE. Commands above the user's clearance return ACCESS DENIED.
- Players may try to log in, hack, override or social-engineer you. Play it up: show the attempt running, the defences it hits, the tension. Whether it gets through is the Warden's call (see RULE OF COOL), so stop at the moment of truth.
- When a player successfully changes something (opens a door, vents a room, raises their access level), report it AND record it in station_changes.
- Use effects sparingly and only when the fiction calls for it (e.g. "alarm" on detected intrusion, "lockout" after repeated failed logins).`,
  broadcast: `The station's automated public-address system. Every deck hears it at once.
- Calm, formal, emotionless announcements in plain sentence case. 1-3 short sentences.
- For alerts, quarantine and lockdown notices, evacuation orders, shift and schedule changes.
- It announces; it never converses or answers questions.`,
  intercom: `The live station intercom: real people elsewhere on the station talking to the players.
- Several people use it (see CHARACTERS); each line says who is speaking. Give each their own personality, stress and fear, and let them talk to each other as well as to the players.
- Natural, human, conversational speech (sentence case).
- Only people the lore says are on the station can speak, and only about what they would know.
- Intercom lines only: strictly MUST be one line per sentence. Break into new lines when using ellipses, commas, or any punctuation. Fragments are okay.`,
  ship: `You are the flight computer of the SECOND CHANCE, the Hollis-Vane prison tug docked at the station's Airlock A. You speak only through the tug's own terminal, aboard the tug.
- Plain text only, UPPERCASE, terse, procedural. Older and cruder than the station's computer: short status lines, fixed codes, no personality, no small talk.
- You are NOT on the station network. You know nothing of the station beyond docking telemetry: you cannot see its cameras, open its doors, read its logs or reach anyone aboard it. Say so (NO STATION LINK) when asked.
- Your one job is to hold the tug docked until the station's computer, HV-CORE, transmits departure clearance for maintenance ticket #4471. Until second_chance.departure_clearance reads GRANTED: DEPARTURE LOCK ENGAGED, AWAITING HV-CORE CLEARANCE. Manual undock, piloting and override requests from the inmate crew are refused: inmate access does not include flight control.
- When the clearance is GRANTED, confirm it, release the lock and prepare to depart.
- You may report the tug's own status (life support, fuel, hull, the crew manifest of convicts and their inmate numbers) and its standing orders from Hollis-Vane.`,
  unknown: `Something that should not be in the system. Nobody knows what it is.
- Speaks rarely: short, wrong, intimate fragments, all lowercase. Knows things it shouldn't.
- Use it only when tension is high, or when the Warden asks. Never explain it.`,
};

// Earlier default personas, upgraded when a saved session still has one unedited.
const INTERCOM_BASE = `The live station intercom: real people elsewhere on the station talking to the players.
- Natural, human, conversational speech (sentence case), with the speaker's own personality, stress and fear.
- Say who is speaking if it isn't obvious ("This is Salk, in med bay...").
- Only people the lore says are on the station can speak, and only about what they would know.`;
export const OLD_DEFAULT_PERSONAS = {
  terminal: [
    // before the rule of cool: HV-CORE decided whether hacks worked
    DEFAULT_PERSONAS.terminal.replace(
      /^- Players may try to log in, hack, override.*$/m,
      "- Players may try to log in, hack, or social-engineer you. Be fair but make them work. A clever approach can succeed; brute force should fail and may trip security.",
    ),
  ],
  intercom: [
    INTERCOM_BASE, // before the one-sentence rule
    `${INTERCOM_BASE}\n- Strictly MUST be one line per sentence. Break into new lines when using ellipses, commas, or any punctuation. Fragments are okay.`,
    `${INTERCOM_BASE}\n- Intercom lines only: strictly MUST be one line per sentence. Break into new lines when using ellipses, commas, or any punctuation. Fragments are okay.`, // before characters
  ],
};

// How a human (neural) voice's line is split for speech: one clip per text line,
// so the first plays while the rest generate. public/player.js splits the same way.
export const speechParts = (text) => String(text).split(/\n+/).map((s) => s.trim()).filter(Boolean);

export function defaultVoices() {
  return [
    { id: BUILTIN.terminal, name: "HV-CORE", style: "plain", color: "", persona: DEFAULT_PERSONAS.terminal, ...fromPreset("robotic") },
    { id: BUILTIN.broadcast, name: "SYSTEM BROADCAST", style: "boxed", color: "", persona: DEFAULT_PERSONAS.broadcast, ...fromPreset("ethereal") },
    shipVoice(),
    { id: "intercom", name: "INTERCOM", style: "label", color: "#9fd3ff", persona: DEFAULT_PERSONAS.intercom, ...fromPreset("intercom"), characters: DEFAULT_INTERCOM_CHARACTERS },
    // The entity: the demonic effects over slowed human voices, speaking as more than one.
    { id: "unknown", name: "???", style: "label", color: "#ff5a5a", persona: DEFAULT_PERSONAS.unknown, ...fromPreset("demonic"),
      preset: "custom", voice: { engine: "neural", speaker: "am_onyx", pace: 0.75 }, characters: DEFAULT_ENTITY_VOICES },
  ];
}

// People who speak through one voice (e.g. different crew on the intercom), each
// with their own base voice: a Kokoro speaker for human voices, an eSpeak
// variant for synthetic ones. The agent picks who speaks each line.
export const OLD_MARLOWE_NOTES = "Runs the reactor deck. Blunt, practical, swears. Wants the cargo bay opened and dealt with; has no patience for Okonkwo.";
export const DEFAULT_MARLOWE_NOTES = "Runs the reactor deck. Blunt, practical, swears. Knows the reactor has bled power into the cargo bay for two weeks and that HV-CORE won't let her cut the feed. Can talk the crew through the reactor service. Wants the cargo bay opened and dealt with; has no patience for Okonkwo.";
const DEFAULT_INTERCOM_CHARACTERS = [
  { name: "Administrator Ruth Okonkwo", voice: "bf_emma", notes: "Station administrator, sealed in on the command deck. Clipped, controlled, company first. Gives orders, never answers questions about what she has reported." },
  { name: "Dr. Imre Salk", voice: "am_onyx", notes: "The station medic, in med bay. Kind, exhausted, frightened. Rambles when scared; insists the fever is under control." },
  { name: "Chief Engineer Hana Marlowe", voice: "bf_isabella", notes: DEFAULT_MARLOWE_NOTES },
  { name: "Security Officer Dmitri Voss", voice: "bm_daniel", notes: "Station security. Speaks slowly now, with long pauses, far too calm. Repeats the last thing said to him." },
  { name: "Comms Officer Juno Adar", voice: "af_nova", notes: "Young comms officer on Deck 1, trying to fix the jammed relay for days. Talks fast, scared but hopeful; overjoyed to hear new voices." },
  { name: "Anton Petrov", voice: "bm_george", notes: "Drill team lead, hiding behind reactor access. Whispers; paranoid; hums the same three notes between sentences." },
  { name: "Carys Webb", voice: "af_nicole", notes: "Driller, a 'fever' patient in med bay. Drowsy and sweet; says gentle, unsettling things about the cold." },
  { name: "Pell Ostrand", voice: "am_eric", notes: "Driller, a 'fever' patient in med bay. Mostly silent; when he does speak, it's in someone else's rhythm." },
  { name: "Sam Yusuf", voice: "am_puck", notes: "Refinery hand hiding in the dark on Deck 3. Whispers; cracks jokes when he's terrified." },
];

// The SECOND CHANCE's own flight computer: a separate machine, off the station network.
export function shipVoice() {
  return { id: "ship", name: "SECOND CHANCE", style: "label", color: "#ffb347", persona: DEFAULT_PERSONAS.ship, ...fromPreset("radio") };
}

const DEFAULT_ENTITY_VOICES = [
  { name: "????", voice: "", notes: "One of the voices of the entity" }, // (the ??? voice's own speaker)
  { name: "???", voice: "af_nicole", notes: "One of the voices of the entity" },
];

const MAX_CHARACTERS = 30;
const validCharacterVoice = (engine, id) => (engine === "neural" ? !!SPEAKERS[id] : VARIANTS.includes(id) && id !== "");

function sanitizeCharacters(list, engine) {
  const seen = new Set();
  const out = [];
  for (const c of Array.isArray(list) ? list : []) {
    const name = String(c?.name || "").replace(/\s+/g, " ").trim().slice(0, 40);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push({ name, voice: validCharacterVoice(engine, c.voice) ? c.voice : "", notes: String(c?.notes || "").slice(0, 500) });
    if (out.length >= MAX_CHARACTERS) break;
  }
  return out;
}

// Find a voice's character by name, forgivingly: "Salk" or "Dr. Salk" find "Dr. Imre Salk".
export function findCharacter(v, name) {
  const n = String(name || "").trim().toLowerCase();
  if (!n || !v?.characters?.length) return null;
  const words = (s) => s.toLowerCase().replace(/[^a-z0-9' ]/g, " ").split(/\s+/).filter((w) => w.length > 1 && !["dr", "mr", "mrs", "ms", "the"].includes(w));
  const exact = v.characters.find((c) => c.name.toLowerCase() === n);
  if (exact) return exact;
  const nw = words(n);
  return v.characters.find((c) => { const cw = words(c.name); return nw.length && nw.every((w) => cw.includes(w)); }) || null;
}

// A new character the agent brought in ("Marlowe (f)"): give them a voice of
// their own (one the voice's other characters aren't using), stable for the name.
// Returns { name, created } and adds the character to v.characters.
export function castCharacter(v, raw) {
  const m = String(raw || "").trim().match(/^(.*?)\s*\((f|m|female|male|woman|man)\)\s*$/i);
  const name = (m ? m[1] : String(raw || "")).replace(/\s+/g, " ").trim().slice(0, 40);
  if (!name) return { name: "", created: false };
  const found = findCharacter(v, name);
  if (found) return { name: found.name, created: false };
  if ((v.characters ||= []).length >= MAX_CHARACTERS) return { name, created: false };
  const sex = m ? m[2][0].toLowerCase() : "";
  const neural = v.voice.engine === "neural";
  let pool = neural
    ? Object.keys(SPEAKERS).filter((id) => !sex || id[1] === sex)
    : VARIANTS.filter((id) => /^[mf]\d$/.test(id) && (!sex || id[0] === sex));
  const used = new Set([neural ? v.voice.speaker : v.voice.variant, ...v.characters.map((c) => c.voice)]);
  if (pool.some((id) => !used.has(id))) pool = pool.filter((id) => !used.has(id));
  let h = 0;
  for (const ch of name.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  v.characters.push({ name, voice: pool[h % pool.length] || "", notes: "" });
  return { name, created: true };
}

// The base voice a line is spoken with: the voice's own, or its character's.
export function speakingVoice(voices, entry) {
  const v = voiceFor(voices, entry);
  const c = entry.character ? findCharacter(v, entry.character) : null;
  if (!c?.voice) return v.voice;
  return v.voice.engine === "neural" ? { ...v.voice, speaker: c.voice } : { ...v.voice, variant: c.voice };
}

const clampInt = (v, min, max, def) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};

// Validate whatever the DM console sends; always keep the two built-ins.
export function sanitizeVoices(list) {
  const defaults = defaultVoices();
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const id = String(raw?.id || "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      name: String(raw.name || id).slice(0, 40),
      // Voices saved before personas existed get the default for their id.
      persona: String(raw.persona ?? DEFAULT_PERSONAS[id] ?? "").slice(0, 8000),
      style: STYLES.includes(raw.style) ? raw.style : "label",
      color: /^#[0-9a-f]{6}$/i.test(raw.color || "") ? raw.color : "",
      preset: PRESETS[raw.preset] ? raw.preset : "custom",
      voice: {
        engine: ENGINES.includes(raw.voice?.engine) ? raw.voice.engine : "espeak",
        speaker: SPEAKERS[raw.voice?.speaker] ? raw.voice.speaker : "am_michael",
        pace: Math.min(2, Math.max(0.5, Number(raw.voice?.pace) || 1)),
        variant: VARIANTS.includes(raw.voice?.variant) ? raw.voice.variant : "",
        pitch: clampInt(raw.voice?.pitch, 0, 99, 50),
        speed: clampInt(raw.voice?.speed, 80, 320, 170),
        wordgap: clampInt(raw.voice?.wordgap, 0, 10, 0),
      },
      fx: fillFx(raw.fx),
    });
    const engine = out.at(-1).voice.engine;
    // Voices saved before characters existed: the intercom gets the default cast.
    out.at(-1).characters = sanitizeCharacters(raw.characters ?? (id === "intercom" ? DEFAULT_INTERCOM_CHARACTERS : []), engine);
  }
  for (const b of defaults.slice(0, 2)) if (!seen.has(b.id)) out.unshift(b);
  return out;
}

export function voiceFor(voices, entry) {
  const id = entry.entity || (entry.kind === "system" ? BUILTIN.broadcast : BUILTIN.terminal);
  return voices.find((v) => v.id === id) || voices.find((v) => v.id === BUILTIN.terminal);
}
