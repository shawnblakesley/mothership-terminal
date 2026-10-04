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

function fromPreset(name) {
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
- Players may try to log in, hack, or social-engineer you. Be fair but make them work. A clever approach can succeed; brute force should fail and may trip security.
- When a player successfully changes something (opens a door, vents a room, raises their access level), report it AND record it in station_changes.
- Use effects sparingly and only when the fiction calls for it (e.g. "alarm" on detected intrusion, "lockout" after repeated failed logins).`,
  broadcast: `The station's automated public-address system. Every deck hears it at once.
- Calm, formal, emotionless announcements in plain sentence case. 1-3 short sentences.
- For alerts, quarantine and lockdown notices, evacuation orders, shift and schedule changes.
- It announces; it never converses or answers questions.`,
  intercom: `The live station intercom: real people elsewhere on the station talking to the players.
- Natural, human, conversational speech (sentence case), with the speaker's own personality, stress and fear.
- Say who is speaking if it isn't obvious ("This is Salk, in med bay...").
- Only people the lore says are on the station can speak, and only about what they would know.
- Intercom lines only: strictly MUST be one line per sentence. Break into new lines when using ellipses, commas, or any punctuation. Fragments are okay.`,
  unknown: `Something that should not be in the system. Nobody knows what it is.
- Speaks rarely: short, wrong, intimate fragments, all lowercase. Knows things it shouldn't.
- Use it only when tension is high, or when the Warden asks. Never explain it.`,
};

// Earlier default personas, upgraded when a saved session still has one unedited.
const INTERCOM_BASE = DEFAULT_PERSONAS.intercom.split("\n").slice(0, -1).join("\n");
export const OLD_DEFAULT_PERSONAS = {
  intercom: [
    INTERCOM_BASE, // before the one-sentence rule
    `${INTERCOM_BASE}\n- Strictly MUST be one line per sentence. Break into new lines when using ellipses, commas, or any punctuation. Fragments are okay.`,
  ],
};

// How a human (neural) voice's line is split for speech: one clip per text line,
// so the first plays while the rest generate. public/player.js splits the same way.
export const speechParts = (text) => String(text).split(/\n+/).map((s) => s.trim()).filter(Boolean);

export function defaultVoices() {
  return [
    { id: BUILTIN.terminal, name: "HV-CORE", style: "plain", color: "", persona: DEFAULT_PERSONAS.terminal, ...fromPreset("robotic") },
    { id: BUILTIN.broadcast, name: "SYSTEM BROADCAST", style: "boxed", color: "", persona: DEFAULT_PERSONAS.broadcast, ...fromPreset("ethereal") },
    { id: "intercom", name: "INTERCOM", style: "label", color: "#9fd3ff", persona: DEFAULT_PERSONAS.intercom, ...fromPreset("intercom") },
    { id: "unknown", name: "???", style: "label", color: "#ff5a5a", persona: DEFAULT_PERSONAS.unknown, ...fromPreset("demonic") },
  ];
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
  }
  for (const b of defaults.slice(0, 2)) if (!seen.has(b.id)) out.unshift(b);
  return out;
}

export function voiceFor(voices, entry) {
  const id = entry.entity || (entry.kind === "system" ? BUILTIN.broadcast : BUILTIN.terminal);
  return voices.find((v) => v.id === id) || voices.find((v) => v.id === BUILTIN.terminal);
}
