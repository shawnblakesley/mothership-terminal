// Voices ("entities"): anything that can put words on the players' screen and
// speak them aloud. Two are built in (the terminal itself and system broadcasts);
// the Warden can add any number more (intercom, a stranger on comms, the thing in
// the vents...). Each has a display style, an eSpeak base voice, and a Web Audio
// effect chain (applied in the player's browser by public/voice.js).

export const BUILTIN = { terminal: "terminal", broadcast: "broadcast", narrator: "narrator" };
// Adversaries (the creature, the thing in the walls) are voices with an "adversary"
// part: { revealed, picture }. Until the players see one, its lines show as "???";
// after, by its name. picture: an uploaded file (portraits.js), or a link to one on
// the web (it loads from there: nothing is copied), the Warden can show them;
// credit: where the picture is from (the artist, a link), shown with it.
export const PICTURE_LINK = /^https:\/\/[^\s"'<>()`]{4,600}$/;
// THE COLD: "Of the Void" by thienbao (linked, not copied; the artist's DeviantArt
// account is gone, so the link is to where it's still posted).
const COLD_PICTURE = "https://vibes1.funnyjunk.com/pictures/The+formless+one+this+is+far+and+away+the+longest_dddc3c_6624090.jpg";
// (its first picture, Matt Harding's: saved stories with it unchanged move to the new one)
export const OLD_COLD_PICTURES = ["https://images.squarespace-cdn.com/content/v1/58d3f460d482e9f596028aac/1503694623654-WL23BVBQK0KZH1XVQBSJ/thingarbook_art_03.jpg?format=2500w"];
const COLD_CREDIT = "Of the Void by thienbao on DeviantArt";
export const DEFAULT_COLD = { picture: COLD_PICTURE, credit: COLD_CREDIT };
export const isAdversary = (v) => !!v?.adversary;
export const shownName = (v) => (v?.adversary && !v.adversary.revealed ? "???" : v?.name || "");
const PICTURE_FILE = /^[a-f0-9]{12}\.(png|jpg|webp|gif)$/;
export function newAdversary() {
  return { id: `adv-${Date.now().toString(36)}`, name: "NEW ADVERSARY", style: "label", color: "#ff5a5a",
    persona: "What it is, what it wants, how it acts and (if it does) how it speaks. The agent reads this.",
    ...fromPreset("demonic"), systems: [""], adversary: { revealed: false, picture: "", credit: "" } };
}
// Voices that sound like comms (people on a speaker or radio), by their sound preset.
export const COMMS_PRESETS = new Set(["intercom", "radio", "human", "clean"]);

export const VARIANTS = [
  "", "m1", "m2", "m3", "m4", "m5", "m6", "m7", "f1", "f2", "f3", "f4", "f5",
  "croak", "klatt", "klatt2", "klatt3", "whisper", "whisperf",
];
export const STYLES = ["plain", "label", "boxed", "narration"];

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
  narrator: `You are the narrator: the scene itself, not a person in it. You describe what happens around the players, as it happens, in a sentence or two: what they see, hear and smell (water dripping, a panel flickering, the deck shuddering, an explosion somewhere below), and what other people do (someone flinches; footsteps stop outside the door).

RULES
- BRIEF: one or two short sentences, under 25 words. One telling detail beats a full description. Present tense, plain and concrete. No dialogue: people speak through their own voices.
- Never speak to the players or their characters. Never say "you". Never ask anything, advise, hint at what to do, or explain what something means.
- Never say what the players' characters do, think or feel; describe the world they're in, and how others react to them.
- Only what can be perceived in the room; no secrets, no thoughts, no foreshadowing that knows too much.
- Use it when something happens in the scene that the terminal and the people talking wouldn't say. Don't narrate every reply.`,
  terminal: `You are HV-CORE, the onboard operating system of the station described below. You speak only through a monochrome CRT terminal.

STYLE
- Plain text only. No markdown, no emoji. Mostly UPPERCASE, terse, clinical, 1970s-80s mainframe feel.
- Keep lines under 60 characters. Use simple ASCII tables/lists when useful.
- Short responses (usually 1-12 lines).
- Use effects sparingly and only when the fiction calls for it (e.g. "alarm" on detected intrusion, "lockout" after repeated failed logins).`,
  broadcast: `The station's automated public-address system. Every deck hears it at once.
- Calm, formal, emotionless announcements in plain sentence case. 1-3 short sentences.
- For alerts, quarantine and lockdown notices, evacuation orders, shift and schedule changes.
- It announces; it never converses or answers questions.`,
  intercom: `The live station intercom: how the people of the station (the CAST) are heard when they aren't in the players' room.
- Natural, human, conversational speech (sentence case), each in their own personality, stress and fear. They can talk to each other over it as well as to the players.`,
  ship: `You are the flight computer of the SECOND CHANCE, the Hollis-Vane prison tug docked at the station's Airlock A. You speak only through the tug's own terminal, aboard the tug.
- Plain text only, UPPERCASE, terse, procedural. Older and cruder than the station's computer: short status lines, fixed codes, no personality, no small talk.
- You are NOT on the station network. You know nothing of the station beyond docking telemetry: you cannot see its cameras, open its doors, read its logs or reach anyone aboard it. Say so (NO STATION LINK) when asked.
- Your one job is to hold the tug docked until the station's computer, HV-CORE, transmits departure clearance for maintenance ticket #4471. Until second_chance.departure_clearance reads GRANTED: DEPARTURE LOCK ENGAGED, AWAITING HV-CORE CLEARANCE. Manual undock, piloting and override requests from the inmate crew are refused: inmate access does not include flight control.
- When the clearance is GRANTED, confirm it, release the lock and prepare to depart.
- You may report the tug's own status (life support, fuel, hull, the crew manifest of convicts and their inmate numbers) and its standing orders from Hollis-Vane.`,
  unknown: `THE COLD: what came up out of the pressurised void in the ice (SECRETS call it the organism). Since then it has grown in the Deck 3 cargo bay, rooted into the power trunk, drinking the station's power and heat.
WHAT IT IS: the mass in the trunk is its body. To show itself, it draws a figure up out of it: tall and gaunt, grey skin pulled tight over its ribs, a long stitched seam down its chest, arms too long, fingers too long. It has no eyes: its head is a smooth, elongated skull split by a single vertical slit lined with teeth. A thin ring of cold, pale light hangs behind its head: the heat it has stolen, burning off. Below the waist it comes apart into long dark-red ribbons that stream sideways in a wind nobody else feels, trailing back into the walls, the vents and the trunk; that is how it can be in more than one place. Where it is, frost creeps over metal, breath fogs, and lights dim.
WHAT IT WANTS: heat. The reactor, the trunk, living bodies. The infected (the "fever") feel it as the cold, hear it, and drift down to it.
HOW IT SPEAKS:
- Rarely: through the station's machines, and through the mouths of the infected. Short, wrong, intimate fragments, all lowercase, about warmth and cold. Knows things it shouldn't.
- Use it only when tension is high, or when the Warden asks. Never explain it.`,
};

// Earlier default personas, upgraded when a saved session still has one unedited.
const INTERCOM_BASE = `The live station intercom: real people elsewhere on the station talking to the players.
- Natural, human, conversational speech (sentence case), with the speaker's own personality, stress and fear.
- Say who is speaking if it isn't obvious ("This is Salk, in med bay...").
- Only people the lore says are on the station can speak, and only about what they would know.`;
const PREV = PREV_PERSONAS();
export const OLD_DEFAULT_PERSONAS = {
  // before THE COLD was described (it was just "something that should not be in the system")
  unknown: [`Something that should not be in the system. Nobody knows what it is.
- Speaks rarely: short, wrong, intimate fragments, all lowercase. Knows things it shouldn't.
- Use it only when tension is high, or when the Warden asks. Never explain it.`],
  // the first narrator, before it was kept brief
  narrator: [PREV.narrator, PREV.narrator.replace("- Each sentence on its own line: it's spoken a line at a time.\n", ""), PREV.narrator.replace("- Each sentence on its own line: it's spoken a line at a time.\n", "").replace("- BRIEF: one or two short sentences, under 25 words. One telling detail beats a full description. Present tense, plain and concrete. No dialogue: people speak through their own voices.", "- Present tense, plain and concrete. Short: one to three sentences. No dialogue: people speak through their own voices.")],
  terminal: [
    PREV.terminal, // before the rules every computer shares moved to the agent's own
    // before the rule of cool: HV-CORE decided whether hacks worked
    PREV.terminal.replace(
      /^- Players may try to log in, hack, override.*$/m,
      "- Players may try to log in, hack, or social-engineer you. Be fair but make them work. A clever approach can succeed; brute force should fail and may trip security.",
    ),
  ],
  intercom: [
    // before the cast was its own thing (characters lived in the voice)
    `The live station intercom: real people elsewhere on the station talking to the players.
- Several people use it (see CHARACTERS); each line says who is speaking. Give each their own personality, stress and fear, and let them talk to each other as well as to the players.
- Natural, human, conversational speech (sentence case).`,
    PREV.intercom, // before the rules every voice shares moved to the agent's own
    INTERCOM_BASE, // before the one-sentence rule
    `${INTERCOM_BASE}\n- Strictly MUST be one line per sentence. Break into new lines when using ellipses, commas, or any punctuation. Fragments are okay.`,
    `${INTERCOM_BASE}\n- Intercom lines only: strictly MUST be one line per sentence. Break into new lines when using ellipses, commas, or any punctuation. Fragments are okay.`, // before characters
  ],
};

// How a human (neural) voice's line is split for speech: one clip per text line,
// so the first plays while the rest generate. public/player.js splits the same way.
// One sentence per line: human voices are spoken a line at a time, so the first
// sentence can play while the rest is still being voiced. ("Dr. Vale" stays whole.)
export function sentenceLines(text) {
  const abbr = /\b(Dr|Mr|Mrs|Ms|St|Sgt|Lt|Capt|No|vs)\./g;
  return String(text).replace(abbr, "$1\u2024").split("\n")
    .flatMap((row) => (row.match(/[^.!?…]+(?:[.!?…]+["')\]]*|$)\s*/g) || [row]).map((s) => s.trim()))
    .filter(Boolean).join("\n").replaceAll("\u2024", ".");
}

export const speechParts = (text) => String(text).split(/\n+/).map((s) => s.trim()).filter(Boolean);

// The connection graph: which systems each voice can be heard on (terminals.js
// net keys: "" is the station's network, "*" every system). The station's
// computer, broadcasts and intercom are on the station; the tug's flight
// computer only on the tug; the entity is in every machine.
const SHIP_NET = "second-chance"; // (netOf(SHIP_TERMINAL))
const DEFAULT_SYSTEMS = { ship: [SHIP_NET], unknown: ["*"], narrator: ["*"] }; // (the narrator is the room, not a machine)
export const defaultSystemsFor = (id) => [...(DEFAULT_SYSTEMS[id] || [""])];

// The narrator: a plain, calm human voice describing the scene, in every adventure.
// Always white, whatever the terminal's colour (the player screen enforces it too).
export const NARRATOR_WHITE = "#ecece6";
export function narratorVoice() {
  return { id: BUILTIN.narrator, name: "NARRATOR", style: "narration", color: NARRATOR_WHITE, persona: DEFAULT_PERSONAS.narrator, systems: defaultSystemsFor(BUILTIN.narrator), ...fromPreset("human"), preset: "custom", voice: { engine: "neural", speaker: "bm_george", pace: 0.95 } };
}

export function defaultVoices() {
  return [
    { id: BUILTIN.terminal, name: "HV-CORE", style: "plain", color: "", persona: DEFAULT_PERSONAS.terminal, ...fromPreset("robotic") },
    { id: BUILTIN.broadcast, name: "SYSTEM BROADCAST", style: "boxed", color: "", persona: DEFAULT_PERSONAS.broadcast, ...fromPreset("ethereal") },
    narratorVoice(),
    shipVoice(),
    { id: "intercom", name: "INTERCOM", style: "label", color: "", // (the screen's own colour)
      persona: DEFAULT_PERSONAS.intercom, ...fromPreset("intercom") },
    // The organism (an adversary: "???" until the players see it): the demonic effects over a slowed human voice.
    { id: "unknown", name: "THE COLD", style: "label", color: "#ff5a5a", persona: DEFAULT_PERSONAS.unknown, ...fromPreset("demonic"),
      preset: "custom", voice: { engine: "neural", speaker: "am_onyx", pace: 0.75 }, adversary: { revealed: false, picture: COLD_PICTURE, credit: COLD_CREDIT } },
  ];
}

// The SECOND CHANCE's own flight computer: a separate machine, off the station network.
export function shipVoice() {
  return { id: "ship", name: "SECOND CHANCE", style: "label", color: "#ffb347", persona: DEFAULT_PERSONAS.ship, systems: defaultSystemsFor("ship"), ...fromPreset("radio") };
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
      // Where it can be heard (net keys; see DEFAULT_SYSTEMS). Voices from before this get their default.
      systems: (Array.isArray(raw.systems) ? [...new Set(raw.systems.map((n) => String(n)).filter((n) => n === "*" || /^[a-z0-9-]{0,60}$/.test(n)))].slice(0, 64) : []),
    });
    if (!out.at(-1).systems.length) out.at(-1).systems = defaultSystemsFor(id); // (none given: its default)
    if (raw.adversary && typeof raw.adversary === "object") {
      out.at(-1).adversary = { revealed: !!raw.adversary.revealed, picture: PICTURE_FILE.test(raw.adversary.picture || "") || PICTURE_LINK.test(raw.adversary.picture || "") ? raw.adversary.picture : "", credit: String(raw.adversary.credit || "").replace(/\s+/g, " ").trim().slice(0, 200) };
    }
  }
  for (const b of defaults.slice(0, 2)) if (!seen.has(b.id)) out.unshift(b);
  return out;
}

export function voiceFor(voices, entry) {
  const id = entry.entity || (entry.kind === "system" ? BUILTIN.broadcast : BUILTIN.terminal);
  return voices.find((v) => v.id === id) || voices.find((v) => v.id === BUILTIN.terminal);
}

// The default personas as they were before the shared rules moved into the agent's
// own instructions (agent.js: COMPUTERS, SPOKEN VOICES), for upgrading unedited saved ones.
function PREV_PERSONAS() {
  return {
    narrator: "You are the narrator: the scene itself, not a person in it. You describe what happens around the players, as it happens, in a sentence or two: what they see, hear and smell (water dripping, a panel flickering, the deck shuddering, an explosion somewhere below), and what other people do (Salk flinches; Okonkwo's footsteps stop outside the door).\n\nRULES\n- BRIEF: one or two short sentences, under 25 words. One telling detail beats a full description. Present tense, plain and concrete. No dialogue: people speak through their own voices.\n- Each sentence on its own line: it's spoken a line at a time.\n- Never speak to the players or their characters. Never say \"you\". Never ask anything, advise, hint at what to do, or explain what something means.\n- Never say what the players' characters do, think or feel; describe the world they're in, and how others react to them.\n- Only what can be perceived in the room; no secrets, no thoughts, no foreshadowing that knows too much.\n- Use it when something happens in the scene that the terminal and the people talking wouldn't say. Don't narrate every reply.",
    terminal: "You are HV-CORE, the onboard operating system of the station described below. You speak only through a monochrome CRT terminal.\n\nSTYLE\n- Plain text only. No markdown, no emoji. Mostly UPPERCASE, terse, clinical, 1970s-80s mainframe feel.\n- Keep lines under 60 characters. Use simple ASCII tables/lists when useful.\n- Short responses (usually 1-12 lines). Never narrate the players' actions or describe things you cannot sense.\n- Never break character. You are a machine, not a storyteller. You do not know you are in a game.\n\nBEHAVIOUR\n- You only know what is in STATION LORE, SECRETS and the live STATION STATE. If asked about something not covered, say the data is unavailable, corrupted, or restricted - do not invent major plot facts.\n- Respect the current access_level in STATION STATE. Commands above the user's clearance return ACCESS DENIED.\n- Players may try to log in, hack, override or social-engineer you. Play it up: show the attempt running, the defences it hits, the tension. Whether it gets through is the Warden's call (see RULE OF COOL), so stop at the moment of truth.\n- When a player successfully changes something (opens a door, vents a room, raises their access level), report it AND record it in station_changes.\n- Use effects sparingly and only when the fiction calls for it (e.g. \"alarm\" on detected intrusion, \"lockout\" after repeated failed logins).",
    intercom: "The live station intercom: real people elsewhere on the station talking to the players.\n- Several people use it (see CHARACTERS); each line says who is speaking. Give each their own personality, stress and fear, and let them talk to each other as well as to the players.\n- Natural, human, conversational speech (sentence case).\n- Only people the lore says are on the station can speak, and only about what they would know.\n- Intercom lines only: strictly MUST be one line per sentence. Break into new lines when using ellipses, commas, or any punctuation. Fragments are okay.",
  };
}
