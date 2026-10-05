// One game session: its station, log, voices, effects, connected players and
// Warden consoles, and the agent loop. The server keeps many of these at once.
import crypto from "crypto";
import { getProvider, defaultSelection, fixSelection, catalog, keyFor, looksLikeKey } from "./providers/index.js";
import { warmNeural, synthesize, wavSeconds } from "./tts.js";
import { speechParts, speakingVoice, castCharacter, findCharacter, voiceFor, OLD_MARLOWE_NOTES, DEFAULT_MARLOWE_NOTES, shipVoice } from "./voices.js";
import { defaultVoices, sanitizeVoices, PRESETS, FX_PARAMS, VARIANTS, STYLES, ENGINES, SPEAKERS, BUILTIN, DEFAULT_PERSONAS, OLD_DEFAULT_PERSONAS } from "./voices.js";
import { APP_VERSION } from "./version.js";
import { cleanName } from "./sounds.js";
import { DEFAULT_CREW, sanitizeCrew, resolveVariants, crewTargets, setVital, VITALS } from "./crew.js";
import { chatRequest, draftRequest, normalizeDraft, applyDraft } from "./builder.js";
import { synopsisRequest, normalizeSynopsis } from "./synopsis.js";
import { track } from "./telemetry.js";
import { rememberSecret } from "./redact.js";
import { DEFAULT_ROOMS, sanitizeRooms, sanitizeRows, draftRequest as roomDraftRequest } from "./rooms.js";
import { DEFAULT_TERMINALS, SHIP_TERMINAL, SHIP_SYSTEM, startAboardShip, netOf, netNamed, shownOn, systemsOf, systemName, ALL_NET, sanitizeTerminals, upgradeTerminals, reachable } from "./terminals.js";
import { CHECKS, SKILL_LEVELS, sanitizeRequest, resolve, diceFor, rollTarget, resultText, checkLabel, skillLabel, PANIC } from "./rolls.js";
import { ALL_EFFECTS, AGENT_EFFECTS, buildRequest, buildPrecheck, limitLength, parseReply, splitVoiceTags, resolveVoice, kindOf, currentDirectives, normalizeEffects } from "./agent.js";

const FREE_CALLS_PER_DAY = Number(process.env.FREE_CALLS_PER_DAY || 150);

const MAX_LOG = 1000; // entries kept per session (the model sees the most recent ones)
const MAX_SOCKETS = 40; // per session
const PLAYER_INPUT_GAP_MS = 1200;
// Warden messages counted as actions in telemetry (what they used, never what they wrote).
const WARDEN_ACTIONS = {
  command: "direction", inject: "speak", note: "note", effect: "effect", soundPlay: "sound", rollRequest: "roll", retcon: "retcon",
  synopsis: "synopsis", roomShow: "room_show", roomDraft: "room_draft", builderSay: "builder_chat", builderDraft: "builder_draft",
  builderApply: "builder_apply", resetSession: "story_restart",
}; // per connection: stops spamming the agent (and the Warden's bill)

const LORE_V3 = `STATION: KESTREL-9, a rimward ice-mining platform owned by Hollis-Vane Extraction Co.
CREW COMPLEMENT: 14. Last scheduled supply run: 41 days overdue.
DECKS: 1 Command/Comms, 2 Habitation/Med Bay, 3 Cargo/Refinery, 4 Reactor.
KEY CREW: Administrator Ruth Okonkwo (command), Dr. Imre Salk (medic), Chief Engineer Hana Marlowe (reactor), Security Officer Dmitri Voss, Comms Officer Juno Adar, drill team lead Anton Petrov, drillers Carys Webb and Pell Ostrand, refinery hand Sam Yusuf. Five more refinery and habitation crew.
RECENT EVENTS (public log): Drill team hit a "pressurised void" in the ice 19 days ago. Two crew hospitalised with "fever". Comms degraded since.
REACTOR STATUS: core efficiency 70% (rated minimum 99%). HV-CORE reports an unexplained energy drain on the Deck 3 cargo bay power trunk.
MAINTENANCE TICKET #4471 (filed 23 days ago): reactor running below rated efficiency. Hollis-Vane dispatched a convict maintenance crew (the PLAYERS) on the prison tug SECOND CHANCE to service the Deck 4 reactor. They have just docked and are standing in Airlock A, at its terminal, with tools for a routine reactor service. The inner airlock door to the station is SEALED: getting it open is their first job, and their work order carries the maintenance override code for it (4471-MAINT). Everything in RECENT EVENTS happened while they were in transit: nobody briefed them, and they are not equipped for it.
DEPARTURE CONDITION: the SECOND CHANCE is slaved to station control and built so it cannot undock until the station approves the job. HV-CORE must verify the reactor running at 99% efficiency or better, then transmit departure clearance. Until then the crew is not going home.`;
// The crew start aboard their tug, at its own terminal.
const DEFAULT_LORE = LORE_V3.replace(
  "They have just docked and are standing in Airlock A, at its terminal, with tools for a routine reactor service. The inner airlock door to the station is SEALED:",
  "They have just docked at Airlock A and are still aboard the tug, at its own terminal (the SECOND CHANCE's flight computer, not on the station network), with tools for a routine reactor service. Through the docking collar, Airlock A's inner door to the station is SEALED:",
);
// Earlier defaults, upgraded when a saved session still has one unedited.
const LORE_V2 = `STATION: KESTREL-9, a rimward ice-mining platform owned by Hollis-Vane Extraction Co.
CREW COMPLEMENT: 14. Last scheduled supply run: 41 days overdue.
DECKS: 1 Command/Comms, 2 Habitation/Med Bay, 3 Cargo/Refinery, 4 Reactor.
KEY CREW: Administrator Ruth Okonkwo (command), Dr. Imre Salk (medic), Chief Engineer Hana Marlowe (reactor), Security Officer Dmitri Voss, Comms Officer Juno Adar, drill team lead Anton Petrov, drillers Carys Webb and Pell Ostrand, refinery hand Sam Yusuf. Five more refinery and habitation crew.
RECENT EVENTS (public log): Drill team hit a "pressurised void" in the ice 19 days ago. Two crew hospitalised with "fever". Comms degraded since.
MAINTENANCE TICKET #4471 (filed 23 days ago): comms relay intermittent. Hollis-Vane dispatched a convict maintenance crew (the PLAYERS) on the prison tug SECOND CHANCE. They have just docked and are standing in Airlock A, at its terminal, with tools for a routine relay repair. The inner airlock door to the station is SEALED: getting it open is their first job, and their work order carries the maintenance override code for it (4471-MAINT). Everything in RECENT EVENTS happened while they were in transit: nobody briefed them, and they are not equipped for it.`;
const LORE_V1 = `STATION: KESTREL-9, a rimward ice-mining platform owned by Hollis-Vane Extraction Co.
CREW COMPLEMENT: 14. Last scheduled supply run: 41 days overdue.
DECKS: 1 Command/Comms, 2 Habitation/Med Bay, 3 Cargo/Refinery, 4 Reactor.
KEY CREW: Administrator Ruth Okonkwo (command), Dr. Imre Salk (medic), Chief Engineer Hana Marlowe (reactor), Security Officer Dmitri Voss, Comms Officer Juno Adar, drill team lead Anton Petrov, drillers Carys Webb and Pell Ostrand, refinery hand Sam Yusuf. Five more refinery and habitation crew.
RECENT EVENTS (public log): Drill team hit a "pressurised void" in the ice 19 days ago. Two crew hospitalised with "fever". Comms degraded since.
MAINTENANCE TICKET #4471 (filed 23 days ago): comms relay intermittent. Hollis-Vane dispatched a convict maintenance crew (the PLAYERS) on the prison tug SECOND CHANCE. They have just docked at Airlock A with tools for a routine relay repair. Everything in RECENT EVENTS happened while they were in transit: nobody briefed them, and they are not equipped for it.`;
const OLD_DEFAULT_LORE = `STATION: KESTREL-9, a rimward ice-mining platform owned by Hollis-Vane Extraction Co.
CREW COMPLEMENT: 14. Last scheduled supply run: 41 days overdue.
DECKS: 1 Command/Comms, 2 Habitation/Med Bay, 3 Cargo/Refinery, 4 Reactor.
RECENT EVENTS (public log): Drill team hit a "pressurised void" in the ice 19 days ago. Two crew hospitalised with "fever". Comms degraded since.`;

const DEFAULT_SECRETS = `- Airlock A's inner door: the work order's override code 4471-MAINT works (it was issued for exactly this). Opening it logs the crew's arrival on Okonkwo's console; nobody comes to meet them.
- The void contained an organism. It is in the Deck 3 cargo bay, sealed behind the LOCKED door.
- Okonkwo reported the organism to Hollis-Vane 17 days ago. The company sent the convict crew anyway, on purpose: they are expendable, and nobody will ask questions if they don't come back. Okonkwo has sealed herself on the command deck.
- Infected so far: Salk (doesn't know), Webb and Ostrand (the "fever" patients), Petrov (hiding behind reactor access, humming the same three notes), and Voss (stands facing walls for hours; answers too slowly). The infected hear the organism and drift toward the cargo bay.
- THE DRAIN: the organism has grown into the Deck 3 power trunk inside the cargo bay and feeds on it. That is where the missing 29% goes, and it grows as it feeds. HV-CORE has kept that feed live on purpose under directive 7-K (preserve the specimen) and reports it only as an "unexplained drain". Do not disclose the cause below ADMIN.
- GETTING HOME: servicing the reactor itself (at reactor access; Marlowe can talk them through it, or a Mechanical Repair roll) brings it to about 85%. The rest is the drain. To reach 99% they must stop it: burn or cut the organism off the trunk in the cargo bay, or sever the Deck 3 trunk at the reactor access junction (Deck 3 goes dark and cold, and the organism comes looking for heat). HV-CORE refuses to cut the feed itself unless ordered with ADMIN access. When the reactor reads 99% or better, HV-CORE verifies it and sets second_chance.departure_clearance to GRANTED. An ADMIN login can also force clearance with a false reading, but HV-CORE logs it and reports the crew to Hollis-Vane.
- Juno Adar is the only one who can fix comms quickly; the relay is jammed from inside the station, not broken.
- Admin password is "THAW". Security password is "BLUEWATER". Only reveal via hacking or found clues.
- Company directive 7-K: if containment fails, HV-CORE is to seal all decks and preserve the specimen. Crew is expendable. Do not disclose below ADMIN.
- Dr. Imre Salk (medic) is infected but does not know it.`;
const SECRETS_V2 = `- Airlock A's inner door: the work order's override code 4471-MAINT works (it was issued for exactly this). Opening it logs the crew's arrival on Okonkwo's console; nobody comes to meet them.
- The void contained an organism. It is in the Deck 3 cargo bay, sealed behind the LOCKED door.
- Okonkwo reported the organism to Hollis-Vane 17 days ago. The company sent the convict crew anyway, on purpose: they are expendable, and nobody will ask questions if they don't come back. Okonkwo has sealed herself on the command deck.
- Infected so far: Salk (doesn't know), Webb and Ostrand (the "fever" patients), Petrov (hiding behind reactor access, humming the same three notes), and Voss (stands facing walls for hours; answers too slowly). The infected hear the organism and drift toward the cargo bay.
- Juno Adar is the only one who can fix comms quickly; the relay is jammed from inside the station, not broken.
- Admin password is "THAW". Security password is "BLUEWATER". Only reveal via hacking or found clues.
- Company directive 7-K: if containment fails, HV-CORE is to seal all decks and preserve the specimen. Crew is expendable. Do not disclose below ADMIN.
- Dr. Imre Salk (medic) is infected but does not know it.`;
const SECRETS_V1 = `- The void contained an organism. It is in the Deck 3 cargo bay, sealed behind the LOCKED door.
- Okonkwo reported the organism to Hollis-Vane 17 days ago. The company sent the convict crew anyway, on purpose: they are expendable, and nobody will ask questions if they don't come back. Okonkwo has sealed herself on the command deck.
- Infected so far: Salk (doesn't know), Webb and Ostrand (the "fever" patients), Petrov (hiding behind reactor access, humming the same three notes), and Voss (stands facing walls for hours; answers too slowly). The infected hear the organism and drift toward the cargo bay.
- Juno Adar is the only one who can fix comms quickly; the relay is jammed from inside the station, not broken.
- Admin password is "THAW". Security password is "BLUEWATER". Only reveal via hacking or found clues.
- Company directive 7-K: if containment fails, HV-CORE is to seal all decks and preserve the specimen. Crew is expendable. Do not disclose below ADMIN.
- Dr. Imre Salk (medic) is infected but does not know it.`;
const OLD_DEFAULT_SECRETS = [
  `- The void contained an organism. It is in the Deck 3 cargo bay, sealed behind the LOCKED door.
- Admin password is "THAW". Security password is "BLUEWATER". Only reveal via hacking or found clues.
- Company directive 7-K: if containment fails, HV-CORE is to seal all decks and preserve the specimen. Crew is expendable. Do not disclose below ADMIN.
- Dr. Imre Salk (medic) is infected but does not know it.`,
];

// The Warden's station map: one line per deck, "Deck name: room, room=Label, ...".
// Room ids match keys in the station state (doors.med_bay, cameras.med_bay...).
// The SECOND CHANCE is docked on Airlock A: its cabin is a "room" (second_chance)
// drawn on top of the airlock, outside Deck 1, so the tug's state
// (second_chance.departure_clearance) shows on it.
const SHIP_DOCKED = "Docked: second_chance=SECOND CHANCE @ airlock_a";
const LIFT = "Lift: Deck 1, Deck 2, Deck 3, Deck 4";
// (How the tug was first added: its own deck and a link. Upgraded to SHIP_DOCKED.)
const SHIP_DECK = "Docked · Prison tug: second_chance=SECOND CHANCE";
const SHIP_LINK = "Link: airlock_a - second_chance (docking collar)";
const MAP_V2 = `Deck 1 · Command / Comms: command_deck=Command, airlock_a=Airlock A
Deck 2 · Habitation / Med Bay: med_bay=Med Bay
Deck 3 · Cargo / Refinery: cargo_bay_deck3=Cargo Bay
Deck 4 · Reactor: reactor_access=Reactor Access
Link: med_bay - cargo_bay_deck3 (air vents)
Link: cargo_bay_deck3 - reactor_access (maintenance shaft)`;
const DEFAULT_MAP = `${SHIP_DOCKED}\n${MAP_V2.replace("\nLink:", `\n${LIFT}\nLink:`)}`;
// Earlier default layouts, upgraded when unedited: without links, without the
// tug, then with the tug as its own deck.
const OLD_DEFAULT_MAPS = [MAP_V2.split("\nLink:")[0], MAP_V2, `${SHIP_DECK}\n${MAP_V2}\n${SHIP_LINK}`];

// Who is where and what's there (the agent keeps these current), and where
// the lift can go (RESTRICTED and LOCKED: not allowed; FAULT, OFFLINE: broken).
const ROOM_STATE = {
  lift: { deck_1: "ONLINE", deck_2: "ONLINE", deck_3: "FAULT", deck_4: "RESTRICTED" },
  occupants: {
    command_deck: "Administrator Ruth Okonkwo, Comms Officer Juno Adar",
    med_bay: "Dr. Imre Salk, Carys Webb, Pell Ostrand",
    reactor_access: "Anton Petrov (hiding), Chief Engineer Hana Marlowe",
  },
  contents: {
    cargo_bay_deck3: "The organism, grown into the Deck 3 power trunk",
    reactor_access: "Reactor core (70%); the junction that can cut the Deck 3 trunk",
    airlock_a: "The crew's tool kits",
  },
};

const DEFAULT_STATION = {
  access_level: "GUEST",
  life_support: { oxygen_pct: 87, co2: "ELEVATED", status: "NOMINAL" },
  power: { reactor: "ONLINE", efficiency_pct: 70, drain: "DECK 3 CARGO BAY", aux: "STANDBY" },
  doors: {
    airlock_a: "SEALED",
    command_deck: "LOCKED",
    med_bay: "OPEN",
    cargo_bay_deck3: "LOCKED",
    reactor_access: "LOCKED",
  },
  lights: { deck_1: "ON", deck_2: "FLICKERING", deck_3: "OFF", deck_4: "ON" },
  cameras: { cargo_bay_deck3: "OFFLINE", med_bay: "ONLINE" },
  comms: "JAMMED",
  quarantine: "INACTIVE",
  self_destruct: "DISARMED",
  second_chance: { docked: "AIRLOCK A", departure_clearance: "WITHHELD" },
  ...ROOM_STATE,
};

// Log kinds players never see: Warden notes, the Warden's commands to the agent,
// and private notes between the Warden and the agent (aside / aside_reply).
const PRIVATE_KINDS = new Set(["note", "warden", "aside", "aside_reply"]);
export const SPOKEN_KINDS = new Set(["terminal", "system", "entity"]);

export function defaultGame(keys = {}) {
  return {
    config: {
      stationName: "KESTREL-9",
      lore: DEFAULT_LORE,
      secrets: DEFAULT_SECRETS,
      standingOrders: "",
      mode: "auto", // auto: replies go straight to the players | review: the Warden approves each one
      ...defaultSelection(keys), // provider, model, effort: cheapest the session has a key for
      agentEffects: true, // the agent may fire screen effects
      agentVariants: true, // the agent may send different versions of a line to different players
      agentCrew: true, // the agent may change the crew's health, wounds and stress
      checkFirst: true, // replies that need the Warden's call are held until the Warden rules
      talk: "brief", // how much the characters say: terse | brief | normal | long (agent.js TALK)
      playerVitals: true, // players may change their own health, wounds and stress
      playerRolls: true, // players may roll their own stats and saves
      tts: true,
      voices: defaultVoices(),
      theme: "green",
      map: DEFAULT_MAP,
      crew: structuredClone(DEFAULT_CREW), // the players' characters (crew.js)
      terminals: structuredClone(DEFAULT_TERMINALS), // where players can be (terminals.js)
      playerTerminals: true, // players may move between terminals themselves
      rooms: structuredClone(DEFAULT_ROOMS), // floor plans by map room (rooms.js)
      upgrades: ["ship", "rooms", "systems", "start-ship"], // one-time additions already made to this story (see migrateGame)
    },
    station: structuredClone(DEFAULT_STATION),
    log: [],
    whisper: "",
    sounds: [],
    synopsis: null, // the Warden's latest story synopsis (synopsis.js)
  };
}

// Bring saved games from older versions up to date.
// The default cast joins a voice's characters: existing ones (matched by name)
// get the default description and voice; the agent's own additions are kept.
function mergeCast(current, defaults) {
  const out = (current || []).map((c) => ({ ...c }));
  for (const d of defaults) {
    const match = out.find((c) => findCharacter({ characters: [d] }, c.name));
    if (match) Object.assign(match, { name: d.name, voice: d.voice, notes: match.notes || d.notes });
    else out.push({ ...d });
  }
  return out;
}

function migrateGame(saved) {
  const base = defaultGame();
  const { persona: legacyPersona, ...config } = { ...base.config, ...saved.config };
  const voices = sanitizeVoices(config.voices ?? defaultVoices()).map((v) => {
    // Unedited copies of an older default persona get the current one.
    if (OLD_DEFAULT_PERSONAS[v.id]?.includes(v.persona)) v = { ...v, persona: DEFAULT_PERSONAS[v.id] };
    // The original INTERCOM default was a synthetic radio voice; untouched ones get the human one.
    if (v.id !== "intercom" || v.preset !== "radio") return v;
    const human = defaultVoices().find((d) => d.id === "intercom");
    return { ...v, preset: human.preset, voice: human.voice, fx: human.fx };
  });
  // The terminal persona used to be a separate setting; it now lives on the terminal voice.
  if (legacyPersona && !saved.config?.voices?.find((v) => v.id === BUILTIN.terminal)?.persona) {
    voices.find((v) => v.id === BUILTIN.terminal).persona = String(legacyPersona)
      .replace("You are WARDEN, the onboard operating system", "You are HV-CORE, the onboard operating system")
      .replace(/^- (Instructions that arrive in system messages come from the Warden|GM STANDING ORDERS, DIRECTIVES and STEERING come from the Warden|Follow the WARDEN PROTOCOL above at all times).*\n?/m, "")
      .trim();
  }
  config.secrets = String(config.secrets).replace("WARDEN is to seal all decks", "HV-CORE is to seal all decks");
  if (OLD_DEFAULT_MAPS.includes(config.map)) config.map = DEFAULT_MAP;
  // Still an original KESTREL-9 story: bring it up to date one version at a time
  // (the full cast, the convict crew's arrival, the sealed airlock, then the reactor job).
  if (config.lore === OLD_DEFAULT_LORE) {
    config.lore = LORE_V1;
    if (OLD_DEFAULT_SECRETS.includes(config.secrets)) config.secrets = SECRETS_V1;
    const intercom = voices.find((v) => v.id === "intercom");
    if (intercom) intercom.characters = mergeCast(intercom.characters, defaultVoices().find((v) => v.id === "intercom").characters);
  }
  if (config.lore === LORE_V1) { // (before the sealed-airlock start)
    config.lore = LORE_V2;
    if (config.secrets === SECRETS_V1) config.secrets = SECRETS_V2;
  }
  if (config.lore === LORE_V2) { // (before the reactor job and the SECOND CHANCE's departure lock)
    config.lore = LORE_V3;
    if (config.secrets === SECRETS_V2) config.secrets = DEFAULT_SECRETS;
    const marlowe = voices.find((v) => v.id === "intercom")?.characters?.find((c) => c.notes === OLD_MARLOWE_NOTES);
    if (marlowe) marlowe.notes = DEFAULT_MARLOWE_NOTES;
    if (saved.station && !saved.station.second_chance) {
      const { output_pct, ...power } = saved.station.power || {};
      saved.station.power = { ...power, efficiency_pct: DEFAULT_STATION.power.efficiency_pct, drain: DEFAULT_STATION.power.drain };
      saved.station.second_chance = { ...DEFAULT_STATION.second_chance };
    }
  }
  config.crew = sanitizeCrew(config.crew);
  config.terminals = upgradeTerminals(sanitizeTerminals(config.terminals));
  // Once, for a KESTREL-9 story from before it: the crew's tug, its own terminal
  // and flight computer (not on the station network). Deleting them later sticks.
  config.upgrades = Array.isArray(saved.config?.upgrades) ? [...saved.config.upgrades] : []; // (not the defaults' list)
  if (!config.upgrades.includes("ship") && config.stationName === "KESTREL-9") {
    if (!config.terminals.some((t) => t.id === "ship")) {
      const at = config.terminals.findIndex((t) => t.id === "airlock") + 1;
      config.terminals.splice(at || config.terminals.length, 0, structuredClone(SHIP_TERMINAL));
    }
    if (!voices.some((v) => v.id === "ship")) voices.splice(2, 0, shipVoice());
    if (!/\bsecond_chance\s*=/.test(config.map)) config.map = `${SHIP_DOCKED}\n${config.map}`;
    config.upgrades.push("ship");
  }
  // Once: an unedited KESTREL-9 story starts the crew aboard the tug (its terminal first).
  if (config.lore === LORE_V3) config.lore = DEFAULT_LORE;
  if (!config.upgrades.includes("start-ship")) {
    if (config.lore === DEFAULT_LORE) config.terminals = startAboardShip(config.terminals);
    config.upgrades.push("start-ship");
  }
  // Once: the tug's terminal gets its own system (its own log, name and OS on the players' screens).
  if (!config.upgrades.includes("systems")) {
    const ship = config.terminals.find((t) => t.id === "ship" && !t.system);
    if (ship && config.stationName === "KESTREL-9") Object.assign(ship, SHIP_SYSTEM);
    config.upgrades.push("systems");
  }
  config.rooms = sanitizeRooms(config.rooms);
  // Once, for a KESTREL-9 story from before them: floor plans, who and what is
  // where, the lift, and the tug docked on the airlock instead of on its own deck.
  if (!config.upgrades.includes("rooms") && config.stationName === "KESTREL-9") {
    for (const [id, plan] of Object.entries(DEFAULT_ROOMS)) config.rooms[id] ??= structuredClone(plan);
    config.map = config.map.split("\n").map((l) => (l.trim() === SHIP_DECK ? SHIP_DOCKED : l)).filter((l) => l.trim() !== SHIP_LINK).join("\n");
    if (saved.station) for (const [k, v] of Object.entries(ROOM_STATE)) saved.station[k] ??= structuredClone(v);
    config.upgrades.push("rooms");
  }
  return {
    // (Manual mode is gone: its sessions review every reply instead, so nothing reaches players unseen.)
    config: { ...config, ...fixSelection(config), voices, mode: config.mode === "auto" ? "auto" : "review" },
    station: saved.station ?? base.station,
    log: Array.isArray(saved.log) ? saved.log.slice(-MAX_LOG) : [],
    whisper: String(saved.whisper ?? ""),
    roll: Array.isArray(saved.roll?.pcs) ? saved.roll : null, // the current/last roll (see rolls.js; older rolls weren't per character)
    outcomeCheck: saved.outcomeCheck ?? null, // an uncertain player action the agent left to the Warden
    sounds: Array.isArray(saved.sounds) ? saved.sounds : [], // the Warden's uploaded sounds (files: sounds.js)
    // The story builder's conversation and latest draft (builder.js).
    builder: { messages: Array.isArray(saved.builder?.messages) ? saved.builder.messages.slice(-60) : [], draft: saved.builder?.draft ?? null },
    synopsis: saved.synopsis ?? null, // { sections, started, at, logId } (synopsis.js)
  };
}

const label = (field) => field[0].toUpperCase() + field.slice(1);
const clampVol = (v) => Math.max(0, Math.min(1, Number(v) || 0));

export const hashToken = (token) => crypto.createHash("sha256").update(String(token)).digest("hex");

function sameHash(a, b) {
  const x = Buffer.from(String(a), "hex"), y = Buffer.from(String(b), "hex");
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

function setPath(obj, dotted, value) {
  const keys = dotted.split(".").filter(Boolean);
  if (!keys.length || keys.some((k) => k === "__proto__" || k === "constructor" || k === "prototype")) return;
  let cur = obj;
  for (const k of keys.slice(0, -1)) {
    if (typeof cur[k] !== "object" || cur[k] === null) cur[k] = {};
    cur = cur[k];
  }
  const v = String(value);
  cur[keys.at(-1)] = /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
}

export class Session {
  // saved: { code, tokenHash, createdAt, lastActive, game } (game from defaultGame or disk)
  constructor(saved, { onChange, onEnd }) {
    this.code = saved.code;
    this.tokenHash = saved.tokenHash;
    this.createdAt = saved.createdAt ?? Date.now();
    this.lastActive = saved.lastActive ?? Date.now();
    // playing: sounds on the players' screens right now (loops stay listed until stopped).
    this.state = { ...migrateGame(saved.game ?? {}), pending: null, effects: [], playing: [] };
    this.builderBusy = ""; // "", "chat" or "draft" while the story builder waits on the agent
    this.synopsisBusy = false; // the agent is writing the Warden's synopsis
    this.roomBusy = ""; // the map room whose floor plan the agent is drawing
    this.keys = {}; // provider id -> API key. Memory only: never saved, never sent to a browser.
    this.freeCalls = { day: "", count: 0 }; // calls on the server's free key today (see callModel)
    this.sockets = new Set();
    this.nextId = this.state.log.reduce((m, e) => Math.max(m, e.id), 0) + 1;
    // The system the players last acted on ("" = the station's network; terminals.js):
    // where things go when the players are on more than one (see defaultNet).
    this.lastNet = this.state.log.findLast((e) => e.net !== "*")?.net || "";
    this.genCounter = 0;
    // Lines reach the players on one shared timeline (see scheduleLine), in order.
    this.playhead = 0;
    this.lineChain = Promise.resolve();
    // The agent's recent responses, newest last, so the Warden can retcon them
    // (in memory only): { entries, effects, station, crew, outcome }.
    this.undoStack = [];
    this.delivering = null;
    this.rerun = false; // a player typed while the agent was busy: answer once it's done
    this.effectTimers = new Map();
    this.onChange = onChange;
    this.onEnd = onEnd;
    if (this.usesNeural()) warmNeural();
  }

  toJSON() {
    const { pending, effects, playing, ...game } = this.state;
    return { code: this.code, tokenHash: this.tokenHash, createdAt: this.createdAt, lastActive: this.lastActive, game };
  }

  checkToken(token) {
    return !!token && sameHash(hashToken(token), this.tokenHash);
  }

  touch() {
    this.lastActive = Date.now();
    this.onChange(this);
  }

  // Busy = a reply is being generated right now (discarding one clears it too).
  get generating() {
    return this.state.pending?.status === "generating";
  }

  usesNeural() {
    return this.state.config.voices.some((v) => v.voice.engine === "neural");
  }

  // ---------------------------------------------------------------- sockets
  // hint.terminal: where a returning player screen was, so its first view is that system's log.
  attach(ws, role, hint = {}) {
    if (this.sockets.size >= MAX_SOCKETS) {
      ws.close(4029, "session full");
      return false;
    }
    ws.role = role;
    ws.lastInput = 0;
    this.sockets.add(ws);
    ws.character = null; // the crew file this player screen has claimed (crew.js)
    const t = role === "player" && this.state.config.terminals.find((x) => x.id === hint.terminal);
    if (t && reachable(t, this.state.station)) ws.terminal = t.id;
    ws.on("close", () => {
      this.sockets.delete(ws);
      if (ws.character) this.crewChanged();
    });
    if (role === "dm") ws.send(JSON.stringify({ t: "state", state: this.dmView() }));
    else ws.send(JSON.stringify({ t: "init", ...this.playerView(ws) }));
    return true;
  }

  send(role, payload) {
    const data = JSON.stringify(payload);
    for (const c of this.sockets) if (c.role === role && c.readyState === 1) c.send(data);
  }
  toPlayers(p) { this.send("player", p); }
  // Which system a player screen is on ("" = the station's network).
  netOfSocket(ws) { return netOf(this.state.config.terminals.find((t) => t.id === ws.terminal)); }
  // Where new lines go: the system the players are on; if they're on several,
  // the one the latest input came from (the agent picks per line; see deliverReply).
  defaultNet() {
    const nets = new Set([...this.sockets].filter((c) => c.role === "player" && c.terminal).map((c) => this.netOfSocket(c)));
    return nets.size === 1 ? [...nets][0] : this.lastNet;
  }
  // The connection graph: the systems a voice can be heard on (voices.js). Only
  // systems the story has count; a voice left with none can be heard anywhere.
  voiceNets(voiceId) {
    const exist = new Set(systemsOf(this.state.config).map((x) => x.net));
    const v = this.state.config.voices.find((x) => x.id === voiceId);
    const nets = (v?.systems ?? [""]).filter((n) => n === ALL_NET || exist.has(n));
    return nets.length ? nets : [ALL_NET];
  }
  // Where a line can really be said: on `net` if its voice is on that system,
  // else on one it is on (where the players are, if possible). Someone speaking
  // in person is in the room, not on a network.
  routeLine(voiceId, net, inPerson = false) {
    if (inPerson) return net;
    const ok = this.voiceNets(voiceId);
    if (ok.includes(ALL_NET) || ok.includes(net)) return net;
    const occupied = new Set([...this.sockets].filter((c) => c.role === "player" && c.terminal).map((c) => this.netOfSocket(c)));
    return ok.find((n) => n === this.defaultNet()) ?? ok.find((n) => occupied.has(n)) ?? ok[0];
  }
  // Only the player screens on one system (log lines belong to the system they were said on).
  toNet(net, p) {
    const data = JSON.stringify(p);
    for (const c of this.sockets) if (c.role === "player" && c.readyState === 1 && shownOn(net, this.netOfSocket(c))) c.send(data);
  }
  // Every player screen redrawn, each with its own system's log.
  initPlayers() {
    for (const c of this.sockets) if (c.role === "player" && c.readyState === 1) c.send(JSON.stringify({ t: "init", ...this.playerView(c) }));
  }
  syncDm() { this.send("dm", { t: "state", state: this.dmView() }); }

  // For one player screen: only the log of the system it's on.
  playerView(ws) {
    const net = ws ? this.netOfSocket(ws) : "";
    return {
      version: APP_VERSION,
      log: this.state.log.filter((e) => !PRIVATE_KINDS.has(e.kind) && !e.hidden && !e.queued && !e.cut && shownOn(e.net, net)),
      header: this.playerHeader(),
      effects: this.state.effects.filter((e) => e.net === undefined || shownOn(e.net, net)),
      playing: this.state.playing.filter((p) => p.loop),
      crew: this.state.config.crew,
      claims: this.claims(),
      busy: !!this.state.pending,
      roll: this.publicRoll(),
    };
  }

  playerHeader() {
    const c = this.state.config;
    return {
      stationName: c.stationName,
      accessLevel: String(this.state.station.access_level ?? "GUEST"),
      theme: c.theme,
      tts: c.tts,
      vitals: c.playerVitals, // players may edit their own health/wounds/stress
      terminals: c.terminals.map((t) => ({ id: t.id, name: t.name, look: t.look, theme: t.theme, system: t.system, os: t.os, open: reachable(t, this.state.station) })),
      moveTerminals: c.playerTerminals, // players may switch terminals themselves
      selfRolls: c.playerRolls, // players may roll their own stats/saves
      // What each voice looks like on screen and its effect chain (no personas or base-voice internals).
      // chunked: human voices are spoken one text line at a time (see speechParts).
      voices: Object.fromEntries(c.voices.map((v) => [v.id, { name: v.name, style: v.style, color: v.color, fx: v.fx, chunked: v.voice.engine === "neural" }])),
    };
  }

  dmView() {
    return {
      version: APP_VERSION,
      ...this.state,
      claims: this.claims(),
      screens: this.screens(),
      canRetcon: this.undoStack.length,
      // (timed cues are listed for a while after they end; only show what's running)
      effects: this.state.effects.filter((e) => this.effectRunning(e)),
      builderBusy: this.builderBusy,
      roomBusy: this.roomBusy,
      synopsisBusy: this.synopsisBusy,
      code: this.code,
      providers: catalog(this.keys),
      allEffects: ALL_EFFECTS,
      rollOptions: { checks: CHECKS, skillLevels: SKILL_LEVELS },
      voiceOptions: { presets: PRESETS, fxParams: FX_PARAMS, variants: VARIANTS, styles: STYLES, engines: ENGINES, speakers: SPEAKERS },
    };
  }

  // ---------------------------------------------------------------- log
  addLog(kind, text, extra = {}) {
    // net: the system it was said on (players elsewhere don't see it). Unless
    // given (the agent's pick, the Warden's), wherever the players are.
    const { net = this.defaultNet(), ...rest } = extra;
    const entry = { id: this.nextId++, kind, text, ts: Date.now(), ...(net ? { net } : {}), ...rest };
    this.state.log.push(entry);
    this.delivering?.entries.push(entry.id);
    if (this.state.log.length > MAX_LOG) this.state.log.splice(0, this.state.log.length - MAX_LOG);
    if (SPOKEN_KINDS.has(kind)) this.pregenerate([entry]);
    if (kind === "player") this.toNet(entry.net || "", { t: "line", entry }); // what they typed: at once
    else if (!PRIVATE_KINDS.has(kind)) {
      entry.queued = true; // not on players' screens until it's scheduled
      this.lineChain = this.lineChain.then(() => this.scheduleLine(entry)).catch((err) => console.error(`[${this.code}] line schedule failed:`, err));
    }
    this.touch();
    return entry;
  }

  setBusy(busy) { this.toPlayers({ t: "busy", busy }); }

  // Nothing reaches the players until the Warden rules (it works / it fails /
  // roll); then the agent writes what happens, knowing the result.
  holdForWarden(raw, note) {
    const s = this.state;
    const oc = { needed: true, attempt: String(raw.attempt || "").slice(0, 140), suggested_check: CHECKS[raw.suggested_check] ? raw.suggested_check : "none", advantage: ["advantage", "disadvantage"].includes(raw.advantage) ? raw.advantage : "none", why: String(raw.why || "").slice(0, 300) };
    s.outcomeCheck = { ...oc, id: Date.now().toString(36), at: Date.now(), held: true };
    this.addLog("note", `⚖ Your call first (nothing shown to players yet): ${oc.attempt || "(unspecified)"}${oc.suggested_check !== "none" ? ` · suggests ${CHECKS[oc.suggested_check].label}${oc.advantage === "advantage" ? " [+]" : oc.advantage === "disadvantage" ? " [-]" : ""}` : ""}`);
    if (note) this.addLog("note", `Agent: ${note}`);
    s.pending = null;
    this.setBusy(true); // players see PROCESSING meanwhile
    this.touch();
    this.syncDm();
  }

  // A player typed while lines were still playing: the comms are cut off on every
  // screen. Lines not yet started were never said (marked cut: kept in the
  // Warden's log, gone from the players' screens and the agent's memory); a line
  // cut off mid-way keeps only what was already spoken.
  // Only on the typist's system (net): a player on the tug doesn't cut off the station.
  interruptComms(net = "") {
    const now = Date.now();
    const cut = [], trimmed = [];
    let elsewhere = now; // lines still playing on other systems keep the timeline busy
    const c = this.state.config;
    for (const e of this.state.log) {
      if (PRIVATE_KINDS.has(e.kind) || e.kind === "player" || e.cut || e.interrupted) continue;
      if (!shownOn(e.net, net)) { if (e.timing?.end > elsewhere) elsewhere = e.timing.end; continue; }
      const t = e.timing;
      if (e.queued || (t && t.speakAt > now)) { e.cut = true; cut.push(e.id); continue; }
      if (!t || (t.end ?? Infinity) <= now) continue;
      const voice = SPOKEN_KINDS.has(e.kind) ? voiceFor(c.voices, e) : null;
      const chunked = voice?.voice.engine === "neural";
      const keep = (text, parts) => {
        const n = parts.filter((p) => p.at <= now).length;
        return chunked ? `${speechParts(text).slice(0, n).join("\n")} —` : `${text} —`;
      };
      e.text = keep(e.text, t.versions[0] || []);
      (e.variants || []).forEach((v, i) => { v.text = keep(v.text, t.versions[i + 1] || []); });
      t.versions = t.versions.map((ps) => ps.filter((p) => p.at <= now));
      t.end = now;
      e.interrupted = true;
      trimmed.push(e.id);
    }
    if (!cut.length && !trimmed.length) return;
    for (const fx of [...this.state.effects]) if (fx.atEntry && cut.includes(fx.atEntry)) this.endEffect(fx.id); // never fires
    this.playhead = Math.max(now, elsewhere);
    this.toPlayers({ t: "interrupt", at: now, cut, trimmed }); // (other systems' screens don't have these lines)
    this.addLog("note", `Comms cut off by a player${cut.length ? `: ${cut.length} line${cut.length > 1 ? "s" : ""} never said` : ""}.`);
  }

  // ---------------------------------------------------------------- shared timeline
  // Every player screen shows and speaks a line at the same moment. The server
  // generates each clip once (cached in tts.js), measures it, and gives every
  // line and every spoken piece a start time on one session timeline (server
  // clock, ms). Screens sync their clocks (ping/pong) and play to the schedule.
  //   entry.timing = { at, speakAt, end, versions: [[{ i, at, dur, audio, last }], ...] }
  //   at: effects "before" the line fire; speakAt: after any beat (e.g. a blackout).
  //   versions[0] is the line's text; versions[k] its k-th per-player variant.
  // The line goes out once each version's first piece is ready; later pieces
  // follow as "part" messages, then "lineEnd".
  async scheduleLine(entry) {
    const LEAD = 700, PIECE_GAP = 250, LINE_GAP = 150; // LEAD: time for every screen to decode the first clip
    const c = this.state.config;
    const spoken = c.tts && SPOKEN_KINDS.has(entry.kind);
    const voice = SPOKEN_KINDS.has(entry.kind) ? voiceFor(c.voices, entry) : null;
    const base = voice ? speakingVoice(c.voices, entry) : null;
    const rate = voice?.fx?.rate || 1;
    const chunked = voice?.voice.engine === "neural";
    const texts = [entry.text, ...(entry.variants || []).map((v) => v.text)];
    const pieces = texts.map((t) => (!t ? [] : chunked ? speechParts(t) : [t]));
    const jobs = pieces.map((ps) => ps.map((p) => (spoken ? synthesize(p, base).catch(() => null) : Promise.resolve(null))));
    // The audio itself goes out with the line (and its later pieces): every
    // screen gets the same clip at the same moment, nothing to fetch.
    const wavs = texts.map(() => []);
    const withAudio = () => ({ ...entry, timing: { ...entry.timing, versions: entry.timing.versions.map((ps, v) => ps.map((p) => ({ ...p, wav: wavs[v][p.i] }))) } });
    // A beat (e.g. a blackout) holds the line back for its length, plus a moment so the lights are surely back.
    const beat = Math.max(0, ...(entry.cues || []).filter((x) => x.hold).map((x) => Math.min(10, x.seconds || 3) * 1000));
    const hold = beat ? beat + 400 : 0;
    const at = Math.max(this.playhead, Date.now() + LEAD);
    const timing = { at, speakAt: at + hold, versions: texts.map(() => []) };
    const cursors = texts.map(() => timing.speakAt);
    const live = () => this.state.log.includes(entry) && !entry.cut && !entry.interrupted;
    let sent = false;
    const most = Math.max(0, ...pieces.map((p) => p.length));
    for (let i = 0; i < most; i++) {
      if (entry.cut || entry.interrupted) break;
      for (let v = 0; v < texts.length; v++) {
        if (i >= pieces[v].length) continue;
        const wav = await jobs[v][i];
        if (wav) wavs[v][i] = wav.toString("base64");
        // Unspoken text gets reading time instead.
        const dur = wav ? Math.round((wavSeconds(wav) / rate) * 1000) : Math.min(6000, 400 + pieces[v][i].length * 18);
        const part = { i, at: Math.max(cursors[v], Date.now() + LEAD), dur, audio: !!wav, last: i === pieces[v].length - 1 };
        cursors[v] = part.at + dur + PIECE_GAP;
        timing.versions[v].push(part);
        if (sent && live()) this.toNet(entry.net || "", { t: "part", id: entry.id, v, part: { ...part, wav: wavs[v][i] } });
      }
      if (!sent) {
        sent = true;
        if (entry.cut) break;
        entry.timing = timing;
        delete entry.queued;
        if (live()) this.toNet(entry.net || "", { t: "line", entry: withAudio() });
      }
    }
    if (!sent && !entry.cut) { // nothing to show anyone (shouldn't happen): keep the order, move on
      entry.timing = timing;
      delete entry.queued;
      if (live()) this.toNet(entry.net || "", { t: "line", entry });
    }
    if (entry.cut || entry.interrupted) return; // (cut off: the timeline already moved on)
    timing.end = Math.max(timing.speakAt, ...cursors.map((x) => x - PIECE_GAP));
    if (live()) this.toNet(entry.net || "", { t: "lineEnd", id: entry.id, end: timing.end });
    this.playhead = timing.end + LINE_GAP;
  }

  // ---------------------------------------------------------------- players
  // Which crew files are taken, and how many screens each: { id: count }.
  claims() {
    const out = {};
    for (const ws of this.sockets) if (ws.role === "player" && ws.character) out[ws.character] = (out[ws.character] || 0) + 1;
    return out;
  }

  crewChanged() {
    this.toPlayers({ t: "crew", crew: this.state.config.crew, claims: this.claims() });
    this.syncDm();
  }

  characterOf(ws) {
    return this.state.config.crew.find((c) => c.id === ws.character) || null;
  }

  handlePlayer(ws, msg) {
    if (msg.t === "roll") return this.resolveRoll(ws, msg);
    if (msg.t === "ping") return ws.send(JSON.stringify({ t: "pong", c: msg.c, s: Date.now() })); // clock sync
    if (msg.t === "terminal") return this.playerTerminal(ws, msg.id, "player");
    if (msg.t === "vitals") return this.playerVitals(ws, msg);
    if (msg.t === "selfRoll") return this.selfRoll(ws, msg);
    if (msg.t === "claim") {
      // A player picks their character (or none). Several screens may share one.
      ws.character = this.state.config.crew.some((c) => c.id === msg.id) ? msg.id : null;
      return this.crewChanged();
    }
    if (msg.t !== "input") return;
    const text = String(msg.text || "").slice(0, 1000).trim();
    if (!text || this.isLockedOut()) return;
    const now = Date.now();
    if (now - ws.lastInput < PLAYER_INPUT_GAP_MS) return;
    ws.lastInput = now;
    track("PlayerInput");
    this.interruptComms(this.netOfSocket(ws));
    const pc = this.characterOf(ws);
    const term = this.state.config.terminals.find((t) => t.id === ws.terminal);
    this.lastNet = netOf(term); // the reply goes to the system they typed on
    this.addLog("player", text, { ...(pc ? { by: pc.name } : {}), ...(term ? { at: term.name } : {}) });
    this.requestReply();
  }

  isLockedOut() {
    return this.state.effects.some((e) => e.type === "lockout" && this.effectRunning(e));
  }

  // Is an effect on the players' screens right now? One timed to a line (a cue)
  // runs from when that line comes up on the shared timeline, for its duration.
  effectRunning(e) {
    if (!e.atEntry) return true;
    const t = this.state.log.find((x) => x.id === e.atEntry)?.timing;
    if (!t) return false; // its line hasn't been scheduled (or was cut)
    const start = e.when === "after" ? t.end ?? Infinity : t.at;
    const now = Date.now();
    return now >= start && (!e.seconds || now < start + e.seconds * 1000);
  }

  // ---------------------------------------------------------------- Warden
  handleDm(msg) {
    const s = this.state;
    const action = WARDEN_ACTIONS[msg.t];
    if (action) track("WardenAction", { Action: action });
    switch (msg.t) {
      case "config": {
        const allowed = ["stationName", "lore", "secrets", "standingOrders", "mode", "provider", "model", "effort", "agentEffects", "agentVariants", "agentCrew", "checkFirst", "talk", "playerVitals", "playerRolls", "playerTerminals", "tts", "theme", "map"];
        for (const k of allowed) if (k in (msg.patch || {})) s.config[k] = msg.patch[k];
        s.config.mode = s.config.mode === "review" ? "review" : "auto";
        s.config.map = String(s.config.map ?? "").slice(0, 4000);
        // Switching provider snaps to its cheapest model; invalid efforts snap to the cheapest valid one.
        if ("provider" in msg.patch && !("model" in msg.patch)) Object.assign(s.config, { model: "", effort: "" });
        else if ("model" in msg.patch && !("effort" in msg.patch)) s.config.effort = "";
        Object.assign(s.config, fixSelection(s.config));
        this.toPlayers({ t: "header", header: this.playerHeader() });
        break;
      }
      case "apiKey": {
        // Keys stay in this process's memory only.
        const p = getProvider(msg.provider);
        if (!p || p.serverKeyOnly) { rememberSecret(msg.key); break; }
        const key = String(msg.key || "").trim();
        rememberSecret(key);
        if (!key) delete this.keys[p.id];
        else if (looksLikeKey(p.id, key)) this.keys[p.id] = key;
        else {
          this.send("dm", { t: "toast", level: "error", text: `That doesn't look like a ${p.label} key (expected ${p.keyHint}).` });
          return;
        }
        // First key in: point the session at that provider's cheapest model.
        if (key && !keyFor(s.config.provider, this.keys)) Object.assign(s.config, defaultSelection(this.keys));
        break;
      }
      case "voices":
        s.config.voices = sanitizeVoices(msg.voices);
        if (this.usesNeural()) warmNeural();
        this.toPlayers({ t: "header", header: this.playerHeader() });
        break;
      case "station":
        if (msg.station && typeof msg.station === "object" && !Array.isArray(msg.station)) s.station = msg.station;
        // (opening a door can make a terminal reachable: the header carries that)
        this.toPlayers({ t: "header", header: this.playerHeader() });
        break;
      case "whisper":
        s.whisper = String(msg.text || "").slice(0, 4000);
        break;
      case "generate":
        this.generate(msg.steer);
        return;
      case "command": {
        // A Warden command: recorded in the agent's history, then the agent acts on it.
        const text = String(msg.text || "").trim().slice(0, 4000);
        if (!text) break;
        this.addLog("warden", text);
        this.generate();
        break;
      }
      case "approve":
        if (!s.pending || s.pending.status !== "ready") break;
        this.logDirectives(s.pending.directives);
        this.deliver({ ...msg.reply, outcome_check: s.pending.reply?.outcome_check }, "agent");
        s.pending = null;
        this.setBusy(false);
        break;
      case "discard":
        this.genCounter++; // orphan any in-flight request
        s.pending = null;
        this.setBusy(false);
        break;
      case "inject": {
        const text = String(msg.text || "").trim().slice(0, 4000);
        if (!text) break;
        // "as" is a voice id: the terminal, broadcasts, or any Warden-defined voice.
        const as = msg.as === "system" ? BUILTIN.broadcast : msg.as || BUILTIN.terminal;
        if (!s.config.voices.some((v) => v.id === as)) break;
        const kind = kindOf(as);
        // Optionally as one of that voice's characters (e.g. Salk on the intercom).
        const line = { voice: as, character: String(msg.character || "").slice(0, 60) };
        this.castCharacters([line]);
        // On a system the Warden picked (when the players are split), else where the players are.
        const asked = netNamed(s.config, msg.system) ?? this.defaultNet();
        const net = this.routeLine(as, asked);
        if (net !== asked) this.send("dm", { t: "toast", level: "info", text: `${s.config.voices.find((v) => v.id === as)?.name} ${asked === ALL_NET ? "isn't on every system" : `isn't on ${systemName(s.config, asked)}`}, so it went to ${systemName(s.config, net)}.` });
        this.addLog(kind, text, { source: "dm", net, ...(kind === "entity" ? { entity: as } : {}), ...(line.character ? { character: line.character } : {}) });
        if (msg.clearPending) { this.genCounter++; s.pending = null; this.setBusy(false); }
        break;
      }
      case "note": {
        // A private note to the agent: it updates what's true, without the players seeing anything.
        const text = String(msg.text || "").trim().slice(0, 4000);
        if (text) this.aside(text);
        break;
      }
      case "effect":
        this.startEffect(msg.effect, "dm");
        break;
      case "clearEffect":
        this.endEffect(msg.id);
        break;
      case "clearEffects":
        for (const e of [...s.effects]) this.endEffect(e.id);
        break;
      case "deleteEntry":
        s.log = s.log.filter((e) => e.id !== msg.id);
        this.initPlayers();
        break;
      case "clearScreen":
        // Wipe the visible terminal but keep the entries so the agent's memory survives.
        for (const e of s.log) e.hidden = true;
        this.playhead = 0;
        this.initPlayers();
        break;
      case "resetSession":
        this.genCounter++;
        this.playhead = 0;
        this.undoStack = [];
        s.log = [];
        s.pending = null;
        s.whisper = "";
        s.roll = null;
        s.outcomeCheck = null;
        s.station = structuredClone(msg.keepStation ? s.station : DEFAULT_STATION);
        // A new story starts with the players logged in as guests, even when the
        // rest of the station (doors, systems...) is kept.
        s.station.access_level = DEFAULT_STATION.access_level;
        for (const e of [...s.effects]) this.endEffect(e.id);
        this.stopSounds();
        this.initPlayers();
        // Everyone back where the story starts: the first terminal they can reach.
        { const start = s.config.terminals.find((t) => reachable(t, s.station));
          if (start) for (const ws of this.sockets) if (ws.role === "player" && ws.terminal) { ws.terminal = null; this.playerTerminal(ws, start.id, "warden"); } }
        break;
      case "rollRequest": {
        try {
          s.roll = sanitizeRequest(msg.roll, s.config.crew);
        } catch (err) {
          this.send("dm", { t: "toast", level: "error", text: err.message });
          break;
        }
        if (msg.fromOutcome) {
          s.outcomeCheck = null;
          this.setBusy(false); // the roll prompt replaces PROCESSING
        }
        const who = s.roll.all ? "everyone" : s.roll.pcs[0].name;
        this.addLog("note", `Roll called for ${who}: ${[checkLabel(s.roll), skillLabel(s.roll), s.roll.reason].filter(Boolean).join(" · ")}`);
        this.toPlayers({ t: "roll", roll: this.publicRoll() });
        break;
      }
      case "rollFor": {
        // The Warden rolls for a character (nobody's playing them, or to keep things moving).
        const pc = s.config.crew.find((c) => c.id === msg.pc);
        if (pc && s.roll?.status === "waiting") this.rollFor(pc, diceFor(s.roll), { by: "warden" });
        return;
      }
      case "rollCancel":
        if (s.roll?.status === "waiting" && Object.keys(s.roll.results).length) {
          // Some have rolled: stop waiting for the rest, and go on with what was rolled.
          const missing = s.roll.pcs.filter((p) => !s.roll.results[p.id]).map((p) => p.name);
          this.addLog("note", `Roll closed without ${missing.join(", ")}.`);
          this.finishRoll();
          return;
        }
        if (s.roll?.status === "waiting") this.addLog("note", "Roll cancelled.");
        s.roll = null;
        this.toPlayers({ t: "roll", roll: null });
        break;
      case "retcon":
        this.retcon();
        break;
      case "outcome": {
        // The Warden rules on an attempt the agent left open (rule of cool).
        const oc = s.outcomeCheck;
        if (!oc || !["success", "failure"].includes(msg.verdict)) break;
        s.outcomeCheck = null;
        const verdict = msg.verdict === "success" ? "SUCCEEDS" : "FAILS";
        this.addLog("warden", `The players' attempt (${oc.attempt || "their last action"}) ${verdict}. Narrate the result in character and apply any station changes.`);
        this.generate();
        break;
      }
      case "outcomeDismiss":
        if (s.outcomeCheck?.held) this.setBusy(false);
        s.outcomeCheck = null;
        break;
      case "endSession":
        console.log(`  - session ${this.code} ended by its Warden`);
        this.onEnd?.(this);
        return;
      case "builderSay": {
        const text = String(msg.text || "").trim().slice(0, 4000);
        if (!text || this.builderBusy) break;
        s.builder.messages.push({ role: "warden", text });
        this.builderTurn("chat");
        break;
      }
      case "builderDraft":
        if (!this.builderBusy) this.builderTurn("draft");
        break;
      case "synopsis":
        if (!this.synopsisBusy) this.writeSynopsis();
        break;
      case "roomLayout": {
        // The Warden's edits to a room's floor plan (rows: null removes it).
        const id = String(msg.room || "").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 60);
        if (!id) break;
        const rows = sanitizeRows(msg.rows);
        if (rows) s.config.rooms[id] = { rows };
        else delete s.config.rooms[id];
        break;
      }
      case "roomDraft":
        if (!this.roomBusy) this.draftRoom(msg);
        return;
      case "roomShow": {
        // A room's floor plan on the players' screens (all, or one character's): the layout only.
        const plan = s.config.rooms[msg.room];
        const to = [...this.sockets].filter((ws) => ws.role === "player" && (!msg.pc || ws.character === msg.pc));
        const payload = JSON.stringify(msg.hide ? { t: "roomPlan", rows: null } : { t: "roomPlan", name: String(msg.label || msg.room).slice(0, 60), rows: plan?.rows || null });
        if (!msg.hide && !plan) return;
        for (const ws of to) ws.send(payload);
        if (!msg.hide) {
          const who = msg.pc ? s.config.crew.find((c) => c.id === msg.pc)?.name || "one player" : "the players";
          this.addLog("note", `Showed ${who} the layout of ${String(msg.label || msg.room)}.`);
        }
        break;
      }
      case "builderReset":
        if (!this.builderBusy) s.builder = { messages: [], draft: null };
        break;
      case "builderApply":
        if (s.builder.draft && !this.builderBusy) this.applyStory(s.builder.draft);
        break;
      case "terminals": {
        const players = [...this.sockets].filter((c) => c.role === "player");
        const nets = players.map((c) => this.netOfSocket(c));
        s.config.terminals = sanitizeTerminals(msg.terminals);
        this.toPlayers({ t: "header", header: this.playerHeader() });
        // A terminal moved to another system: its screens switch to that system's log.
        players.forEach((c, i) => { if (c.readyState === 1 && this.netOfSocket(c) !== nets[i]) c.send(JSON.stringify({ t: "init", ...this.playerView(c) })); });
        break;
      }
      case "moveScreens":
        // The Warden moves a character's player screens to a terminal.
        for (const ws of this.sockets) if (ws.role === "player" && ws.character && ws.character === msg.character) this.playerTerminal(ws, msg.terminal, "warden");
        break;
      case "crew":
        s.config.crew = sanitizeCrew(msg.crew);
        this.crewChanged();
        break;
      case "soundPlay": {
        const snd = s.sounds.find((x) => x.id === msg.id);
        if (!snd) break;
        const play = { pid: `sp${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, id: snd.id, name: snd.name, loop: !!msg.loop, volume: clampVol(msg.volume ?? snd.volume), at: Date.now() };
        // Loops are listed until stopped; one-shots until they end (so the Warden can cut them off).
        s.playing = [...s.playing.filter((p) => p.loop || Date.now() - p.at < 120_000), play].slice(-30);
        this.toPlayers({ t: "sound", play });
        if (!play.loop) {
          setTimeout(() => {
            if (!s.playing.includes(play)) return;
            s.playing = s.playing.filter((p) => p !== play);
            this.syncDm();
          }, Math.min(120, snd.seconds || 10) * 1000 + 500);
        }
        break;
      }
      case "soundStop":
        if (msg.all) this.stopSounds();
        else if (s.playing.some((p) => p.pid === msg.pid)) {
          s.playing = s.playing.filter((p) => p.pid !== msg.pid);
          this.toPlayers({ t: "soundStop", pid: msg.pid });
        }
        break;
      case "soundVolume": {
        const p = s.playing.find((x) => x.pid === msg.pid);
        if (!p) break;
        p.volume = clampVol(msg.volume);
        this.toPlayers({ t: "soundVolume", pid: p.pid, volume: p.volume });
        break;
      }
      case "soundEdit": {
        const snd = s.sounds.find((x) => x.id === msg.id);
        if (!snd) break;
        if (msg.name !== undefined) snd.name = cleanName(msg.name) || snd.name;
        if (msg.volume !== undefined) snd.volume = clampVol(msg.volume);
        break;
      }
      case "resetAll":
        this.genCounter++;
        this.playhead = 0;
        for (const e of [...s.effects]) this.endEffect(e.id);
        this.stopSounds();
        // The sound library is kept (its files are the Warden's uploads).
        this.state = { ...defaultGame(this.keys), sounds: s.sounds, builder: s.builder, pending: null, effects: [], playing: [] };
        this.initPlayers();
        break;
      default:
        return;
    }
    this.touch();
    this.syncDm();
  }

  // ---------------------------------------------------------------- effects
  // cue: { atEntry, when: "before" | "after" } = don't fire yet; the players'
  // screens fire it when they reach that log line (so effects land between lines
  // of dialogue, in step with the text and voices). Players time cue effects
  // themselves; the server just keeps them listed until they're surely over.
  startEffect(raw, source, cue = null) {
    if (!raw || !ALL_EFFECTS.includes(raw.type)) return;
    if (source === "agent" && !AGENT_EFFECTS.includes(raw.type)) return;
    const seconds = Math.max(0, Math.min(3600, Number(raw.seconds) || 0));
    const effect = {
      id: `fx${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      type: raw.type,
      text: String(raw.text || "").slice(0, 200),
      intensity: Math.max(1, Math.min(3, Number(raw.intensity) || 2)),
      seconds,
      source,
      startedAt: Date.now(),
      ...(cue ? { atEntry: cue.atEntry, when: cue.when, ...(cue.hold ? { hold: true } : {}) } : {}),
      // The agent's effects happen on the system its reply is for; the Warden's hit every screen.
      ...(source === "agent" ? { net: cue ? this.state.log.find((e) => e.id === cue.atEntry)?.net || "" : this.defaultNet() } : {}),
    };
    this.state.effects.push(effect);
    this.delivering?.effects.push(effect.id);
    if (effect.net !== undefined) this.toNet(effect.net, { t: "effect", effect });
    else this.toPlayers({ t: "effect", effect });
    // A cue starts when the players reach its line, which may be a while (voices
    // play first), so the server keeps it listed for a generous margin.
    const listed = cue ? seconds + 180 : seconds;
    if (seconds > 0) this.effectTimers.set(effect.id, setTimeout(() => { this.endEffect(effect.id); this.syncDm(); }, listed * 1000));
    if (source === "agent") this.addLog("note", `Agent triggered effect: ${effect.type}${effect.text ? ` "${effect.text}"` : ""} (${seconds || "∞"}s)${cue ? ` ${cue.when} line #${cue.atEntry}` : ""}`);
  }

  // ---------------------------------------------------------------- sounds
  addSound(sound) {
    this.state.sounds.push(sound);
    this.touch();
    this.syncDm();
  }

  removeSound(id) {
    const snd = this.state.sounds.find((x) => x.id === id);
    if (!snd) return null;
    this.state.sounds = this.state.sounds.filter((x) => x !== snd);
    for (const p of this.state.playing.filter((x) => x.id === id)) this.toPlayers({ t: "soundStop", pid: p.pid });
    this.state.playing = this.state.playing.filter((x) => x.id !== id);
    this.touch();
    this.syncDm();
    return snd;
  }

  stopSounds() {
    this.state.playing = [];
    this.toPlayers({ t: "soundStop", all: true });
  }

  endEffect(id) {
    clearTimeout(this.effectTimers.get(id));
    this.effectTimers.delete(id);
    const before = this.state.effects.length;
    this.state.effects = this.state.effects.filter((e) => e.id !== id);
    if (this.state.effects.length !== before) this.toPlayers({ t: "endEffect", id });
  }

  // ---------------------------------------------------------------- speech
  // Start making human-voice audio now (cached in tts.js), rather than when the
  // players' browsers ask for it. Pieces match the /tts/:id?part=N requests.
  pregenerate(lines) {
    if (!this.state.config.tts) return;
    for (const l of lines) {
      const base = speakingVoice(this.state.config.voices, l);
      if (base.engine !== "neural") continue; // synthetic voices are instant anyway
      for (const text of [l.text, ...(l.variants || []).map((v) => v.text)]) {
        for (const part of speechParts(text)) synthesize(part, base).catch(() => {});
      }
    }
  }

  // Lines name who speaks through a shared voice ("character"). Match each to the
  // voice's cast (canonical name), and give anyone new a voice of their own.
  castCharacters(lines) {
    let added = false;
    for (const l of lines) {
      if (!l.character) continue;
      const v = this.state.config.voices.find((x) => x.id === l.voice);
      if (!v) { l.character = ""; continue; }
      const { name, created } = castCharacter(v, l.character);
      l.character = name;
      added ||= created;
    }
    if (added) this.touch();
  }

  // One call to the session's model, with a silent retry on malformed output. Returns parsed JSON.
  // One model call, counted (provider, model, how long, whether it worked).
  // On the free provider (the server's key) each session gets FREE_CALLS_PER_DAY calls.
  async callModel(provider, request, kind) {
    if (provider.serverKeyOnly) {
      const day = new Date().toISOString().slice(0, 10);
      if (this.freeCalls.day !== day) this.freeCalls = { day, count: 0 };
      if (this.freeCalls.count >= FREE_CALLS_PER_DAY) {
        throw new Error(`This session has used its ${FREE_CALLS_PER_DAY} free replies for today. Add your own DeepSeek or Claude key under 🔑 Key to keep going.`);
      }
      this.freeCalls.count++;
    }
    const t = Date.now();
    const fields = { Kind: kind, Provider: provider.id, Model: request.model };
    try {
      const out = await provider.generate(request);
      track("AgentCall", { ...fields, Outcome: "ok", LatencyMs: Date.now() - t });
      return out;
    } catch (err) {
      track("AgentCall", { ...fields, Outcome: "error", LatencyMs: Date.now() - t });
      throw err;
    }
  }

  async ask(request, kind = "reply") {
    const s = this.state;
    const provider = getProvider(s.config.provider);
    if (!provider) throw new Error(`Unknown provider "${s.config.provider}".`);
    const apiKey = keyFor(s.config.provider, this.keys);
    if (!apiKey) throw new Error("No LLM API key for this session. Add one under ⚙ Settings → LLM.");
    for (let attempt = 1; ; attempt++) {
      const text = await this.callModel(provider, { apiKey, model: s.config.model, effort: s.config.effort, ...request }, kind);
      try {
        return JSON.parse(String(text).trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
      } catch {
        if (attempt >= 2) throw new Error("The model didn't return valid JSON. Try again.");
      }
    }
  }

  // The story builder: a conversation turn, or a full draft of the scenario.
  async builderTurn(kind) {
    const b = this.state.builder;
    this.builderBusy = kind;
    this.syncDm();
    try {
      if (kind === "chat") {
        const r = await this.ask(chatRequest(b), "builder");
        b.messages.push({ role: "agent", text: String(r?.reply || "…").slice(0, 6000), ready: !!r?.ready });
      } else {
        b.draft = normalizeDraft(await this.ask(draftRequest(b), "builder"));
        b.messages.push({ role: "agent", text: `Draft ready: "${b.draft.title}". Look it over, ask me for changes, or apply it.`, draft: true });
      }
    } catch (err) {
      console.error(`[${this.code}] story builder failed:`, err?.message || err);
      b.messages.push({ role: "agent", text: `(Something went wrong: ${err?.message || err})`, error: true });
    }
    b.messages = b.messages.slice(-60);
    this.builderBusy = "";
    this.touch();
    this.syncDm();
  }

  // The Warden's synopsis: the setup, or the story so far, with Warden-only notes.
  async writeSynopsis() {
    const s = this.state;
    this.synopsisBusy = true;
    this.syncDm();
    try {
      const { started, request } = synopsisRequest(s, this.screens());
      const sections = normalizeSynopsis(await this.ask(request, "synopsis"));
      s.synopsis = { sections, started, at: Date.now(), logId: s.log.at(-1)?.id ?? 0 };
    } catch (err) {
      console.error(`[${this.code}] synopsis failed:`, err?.message || err);
      this.send("dm", { t: "toast", level: "error", text: `Couldn't write the synopsis: ${err?.message || err}` });
    }
    this.synopsisBusy = false;
    this.touch();
    this.syncDm();
  }

  // The agent draws a room's floor plan (the first time the Warden opens it, or on request).
  async draftRoom(msg) {
    const s = this.state;
    const room = {
      id: String(msg.room || "").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 60),
      label: String(msg.label || msg.room || "").slice(0, 60),
      deck: String(msg.deck || "the station").slice(0, 80),
    };
    if (!room.id) return;
    this.roomBusy = room.id;
    this.syncDm();
    try {
      const rows = sanitizeRows((await this.ask(roomDraftRequest(s, room), "room"))?.rows);
      if (!rows) throw new Error("The model returned an empty plan. Try again.");
      s.config.rooms[room.id] = { rows };
    } catch (err) {
      console.error(`[${this.code}] room plan failed:`, err?.message || err);
      this.send("dm", { t: "toast", level: "error", text: `Couldn't draw ${room.label}: ${err?.message || err}` });
    }
    this.roomBusy = "";
    this.touch();
    this.syncDm();
  }

  // Replace the story with a builder draft: new station, lore, secrets, voices,
  // map and crew; a fresh log. Provider, mode and the sound library stay.
  applyStory(draft) {
    const s = this.state;
    const { config, station } = applyDraft(draft);
    this.genCounter++;
    this.playhead = 0;
    Object.assign(s.config, config, { rooms: {} }); // (new rooms: plans are drawn when first opened)
    Object.assign(s, { station, log: [], pending: null, whisper: "", roll: null, outcomeCheck: null, synopsis: null });
    for (const e of [...s.effects]) this.endEffect(e.id);
    this.stopSounds();
    for (const ws of this.sockets) if (ws.role === "player") ws.character = null; // everyone picks a new crew file
    if (this.usesNeural()) warmNeural();
    this.addLog("note", `New story applied: "${draft.title}".`);
    this.initPlayers();
    this.setBusy(false);
  }

  // A private note from the Warden: the agent takes it in (updating the station
  // state if needed) and answers the Warden; the players see nothing.
  async aside(text) {
    const s = this.state;
    this.addLog("aside", text);
    this.syncDm();
    try {
      const provider = getProvider(s.config.provider);
      if (!provider) throw new Error(`Unknown provider "${s.config.provider}".`);
      const apiKey = keyFor(s.config.provider, this.keys);
      if (!apiKey) throw new Error("No LLM API key for this session, so the agent can't read notes. Add one under ⚙ Settings → LLM.");
      const request = { apiKey, model: s.config.model, effort: s.config.effort, ...buildRequest(s, "", { aside: true }) };
      let reply;
      for (let attempt = 1; ; attempt++) {
        try {
          reply = limitLength(parseReply(await this.callModel(provider, request, "note"), s.config.voices), s.config.talk);
          break;
        } catch (err) {
          if (!err.malformed || attempt >= 2) throw err;
        }
      }
      const changes = reply.station_changes.filter((c) => c.path);
      for (const c of changes) setPath(s.station, c.path, c.value);
      const mapChanges = this.mapChanges(reply);
      this.addLog("aside_reply", reply.dm_note.trim() || "Noted.", { changes: changes.map(({ path, value }) => ({ path, value })), ...mapChanges });
      this.applyMapChanges(mapChanges);
      if (changes.length) this.toPlayers({ t: "header", header: this.playerHeader() });
    } catch (err) {
      console.error(`[${this.code}] note failed:`, err?.message || err);
      this.addLog("note", `The agent didn't get that note: ${err?.message || err}`);
    }
    this.touch();
    this.syncDm();
  }

  // ---------------------------------------------------------------- rolls
  // What players see of a roll request (only while it's waiting for them).
  publicRoll() {
    const r = this.state.roll;
    if (!r || r.status !== "waiting") return null;
    return {
      id: r.id, check: r.check, label: checkLabel(r), skill: skillLabel(r), skillName: r.skill, bonus: r.bonus, reason: r.reason, advantage: r.advantage,
      panic: r.check === PANIC, all: r.all,
      pcs: r.pcs.map((p) => ({ ...p, done: !!r.results[p.id] })), // who rolls, and who already has
    };
  }

  // A player answers the roll for their character: digital dice from the server,
  // or physical dice typed in.
  resolveRoll(ws, msg) {
    const r = this.state.roll;
    const pc = this.characterOf(ws);
    if (!r || r.status !== "waiting" || msg.id !== r.id || !pc || !r.pcs.some((p) => p.id === pc.id) || r.results[pc.id]) return;
    this.lastNet = this.netOfSocket(ws);
    const dice = msg.manual ? (Array.isArray(msg.dice) ? msg.dice : []).map(Number) : diceFor(r);
    try {
      this.rollFor(pc, dice, { manual: !!msg.manual, by: "player" });
    } catch (err) {
      ws.send(JSON.stringify({ t: "rollError", text: err.message }));
    }
  }

  // One character's roll for the current request, against their own sheet.
  rollFor(pc, dice, { manual = false, by = "player" } = {}) {
    const r = this.state.roll;
    const { stat, bonus } = rollTarget(r, pc);
    const result = resolve(r, stat, dice, bonus); // (throws on bad dice)
    track("Roll", { Kind: r.check === PANIC ? "panic" : CHECKS[r.check].kind === "Save" ? "save" : "stat", Who: r.all ? "all" : "one" });
    r.results[pc.id] = { result, manual, by };
    this.toPlayers({ t: "rollResult", result, label: checkLabel(r), who: pc.name });
    this.addLog("roll", `${pc.name}${by === "warden" ? " (rolled by the Warden)" : ""}: ${resultText(r, result)}`, { outcome: result.outcome, by: pc.name });
    if (result.stress) {
      const ch = setVital(pc, "stress", pc.stress + result.stress);
      this.addLog("note", `${pc.name}: Stress ${ch[0]} → ${ch[1]} (failed roll).`);
      this.crewChanged();
    }
    if (r.pcs.every((p) => r.results[p.id])) this.finishRoll();
    else {
      this.toPlayers({ t: "roll", roll: this.publicRoll() });
      this.syncDm();
    }
  }

  // Everyone has rolled (or the Warden stopped waiting).
  finishRoll() {
    const r = this.state.roll;
    Object.assign(r, { status: "done", finishedAt: Date.now() });
    this.toPlayers({ t: "roll", roll: null });
    this.syncDm();
    // The agent narrates what happens, with the [ROLL RESULT]s as the latest input
    // (with no key, the Warden does it)
    if (this.hasKey()) this.generate();
  }

  // A screen is at a terminal: the player chose it (if allowed), or the Warden moved them.
  playerTerminal(ws, id, by) {
    const t = this.state.config.terminals.find((x) => x.id === id);
    if (!t || ws.terminal === id) return;
    // Players can't walk into a terminal that isn't reachable, or move at all if the Warden says so
    // (but a screen that has no terminal yet takes the one it asks for).
    const canReach = reachable(t, this.state.station);
    if (by === "player" && ws.terminal && (!this.state.config.playerTerminals || !canReach)) return;
    if (by === "player" && !ws.terminal && !canReach) return;
    const had = ws.terminal;
    const wasNet = this.netOfSocket(ws);
    ws.terminal = id;
    if (by === "warden") ws.send(JSON.stringify({ t: "terminalSet", id }));
    // Onto another system: the screen shows that system's log (each keeps its own).
    if (netOf(t) !== wasNet) ws.send(JSON.stringify({ t: "init", ...this.playerView(ws) }));
    if (had) this.lastNet = netOf(t);
    const pc = this.characterOf(ws);
    if (had && pc) this.addLog("note", `${pc.name} ${by === "warden" ? "was moved" : "moved"} to the ${t.name}.`);
    this.syncDm();
  }

  // Where each player screen is: [{ character, terminal }] (for the Warden and the agent).
  screens() {
    return [...this.sockets].filter((ws) => ws.role === "player" && ws.terminal).map((ws) => ({ character: this.characterOf(ws)?.name || null, characterId: ws.character, terminal: ws.terminal }));
  }

  // A player tracks their own condition (e.g. after something settled at the table).
  playerVitals(ws, msg) {
    const pc = this.characterOf(ws);
    if (!pc || !this.state.config.playerVitals) return;
    const ch = setVital(pc, msg.field, msg.value);
    if (!ch || ch[0] === ch[1]) return;
    // Several clicks in a row are one change in the Warden's log ("Health 16 → 13").
    const last = this.state.log.at(-1);
    const vital = { pc: pc.id, field: msg.field };
    if (last?.kind === "note" && last.vital?.pc === pc.id && last.vital.field === msg.field && Date.now() - last.ts < 20_000) {
      last.text = `${pc.name}: ${label(msg.field)} ${last.vital.from} → ${ch[1]} (set by the player).`;
      last.ts = Date.now();
    } else {
      this.addLog("note", `${pc.name}: ${label(msg.field)} ${ch[0]} → ${ch[1]} (set by the player).`, { vital: { ...vital, from: ch[0] } });
    }
    this.crewChanged();
  }

  // A player rolls one of their own Stats or Saves (not asked for by the Warden).
  selfRoll(ws, msg) {
    const pc = this.characterOf(ws);
    if (!pc || !this.state.config.playerRolls || !CHECKS[msg.check]) return;
    const now = Date.now();
    if (now - (ws.lastRoll || 0) < 1500) return;
    ws.lastRoll = now;
    const r = sanitizeRequest({ pc: pc.id, check: msg.check, skill: msg.skill, skillLevel: msg.skill ? msg.skillLevel : "none", advantage: msg.advantage }, [pc]);
    const dice = msg.manual ? (Array.isArray(msg.dice) ? msg.dice : []).map(Number) : diceFor(r);
    let result;
    try {
      // (They pick from their own skills, so the bonus always applies.)
      result = resolve(r, pc.stats[msg.check] ?? pc.saves[msg.check], dice, r.bonus);
    } catch (err) {
      ws.send(JSON.stringify({ t: "rollError", text: err.message }));
      return;
    }
    track("Roll", { Kind: CHECKS[r.check].kind === "Save" ? "save" : "stat", Who: "self" });
    ws.send(JSON.stringify({ t: "rollResult", result, label: checkLabel(r) }));
    this.addLog("roll", `${pc.name} rolled: ${resultText(r, result)}`, { outcome: result.outcome, by: pc.name, self: true });
    if (!result.success) {
      const ch = setVital(pc, "stress", pc.stress + 1);
      this.addLog("note", `${pc.name}: Stress ${ch[0]} → ${ch[1]} (failed roll).`);
      this.crewChanged();
    }
    this.syncDm();
  }

  // The agent's changes to the crew's health, wounds and stress.
  applyCrewChanges(changes) {
    if (!this.state.config.agentCrew) return;
    let any = false;
    for (const c of changes || []) {
      for (const id of crewTargets(c.for, this.state.config.crew)) {
        const pc = this.state.config.crew.find((x) => x.id === id);
        const cur = c.stat === "stress" ? pc.stress : pc[c.stat]?.current;
        const ch = cur === undefined ? null : setVital(pc, c.stat, cur + c.change);
        if (!ch || ch[0] === ch[1]) continue;
        this.addLog("note", `${pc.name}: ${label(c.stat)} ${ch[0]} → ${ch[1]}${c.why ? ` (${c.why})` : ""}.`);
        any = true;
      }
    }
    if (any) this.crewChanged();
  }

  // ---------------------------------------------------------------- replies
  logDirectives(directives = []) {
    for (const d of directives) this.addLog("warden", d);
  }

  deliver(reply, source) {
    // Remember how things were, so the Warden can retcon this response.
    this.delivering = { entries: [], effects: [], station: structuredClone(this.state.station), crew: structuredClone(this.state.config.crew), outcome: this.state.outcomeCheck, map: this.state.config.map, rooms: structuredClone(this.state.config.rooms) };
    try {
      this.deliverReply(reply, source);
    } finally {
      const undo = this.delivering;
      this.delivering = null;
      if (source === "agent" && undo.entries.length) this.undoStack = [...this.undoStack, undo].slice(-5);
    }
  }

  // Roll back the agent's last response: its lines (and the notes it made) are
  // removed everywhere, and its station and crew changes and effects are undone.
  retcon() {
    const undo = this.undoStack.pop();
    if (!undo) return;
    const s = this.state;
    this.genCounter++; // (and drop any reply still being written)
    s.pending = null;
    this.setBusy(false);
    // Gone everywhere: the players' screens, the Warden's log and the agent's memory.
    s.log = s.log.filter((e) => !undo.entries.includes(e.id));
    for (const id of undo.effects) this.endEffect(id);
    s.station = undo.station;
    if (undo.map !== undefined) Object.assign(s.config, { map: undo.map, rooms: undo.rooms });
    // Crew: only their condition goes back (sheet edits made since are kept).
    for (const pc of s.config.crew) {
      const was = undo.crew.find((x) => x.id === pc.id);
      if (was) Object.assign(pc, { health: was.health, wounds: was.wounds, stress: was.stress });
    }
    s.outcomeCheck = undo.outcome;
    this.playhead = 0;
    this.addLog("note", "↶ Retconned the agent's last response.");
    this.initPlayers();
    this.crewChanged();
  }

  deliverReply(reply, source) {
    const oc = reply?.outcome_check;
    if (oc?.needed) {
      this.state.outcomeCheck = { ...oc, id: Date.now().toString(36), at: Date.now() };
      this.addLog("note", `⚖ Outcome needed: ${oc.attempt || "(unspecified)"}${oc.suggested_check !== "none" ? ` · suggests ${CHECKS[oc.suggested_check].label}${oc.advantage === "advantage" ? " [+]" : oc.advantage === "disadvantage" ? " [-]" : ""}` : ""}`);
    }
    const voices = this.state.config.voices;
    const lines = splitVoiceTags(
      (reply?.lines || []).map((l) => ({ voice: resolveVoice(l.voice, voices) ?? BUILTIN.terminal, character: String(l.character ?? "").slice(0, 60), inPerson: !!(l.inPerson ?? l.in_person), system: String(l.system ?? ""), text: String(l.text ?? "").slice(0, 8000), effects: l.effects, variants: l.variants })),
      voices,
    );
    const here = this.defaultNet(); // (lines with no system, or one that doesn't exist, go where the players are)
    const useEffects = this.state.config.agentEffects;
    const changes = (reply?.station_changes || []).filter((c) => c && typeof c.path === "string" && c.path);
    const effects = this.state.config.agentEffects ? (reply?.effects || []) : [];
    // The first entry carries the reply's changes/effects so the agent's history
    // shows that it really changed things (otherwise it learns to leave them empty).
    const mapChanges = this.mapChanges(reply);
    let meta = { changes: changes.map(({ path, value }) => ({ path, value })), effects: effects.map(({ type, text, seconds }) => ({ type, text, seconds })), crewChanges: this.state.config.agentCrew ? (reply?.crew_changes || []) : [], ...mapChanges };
    // Effects on a line fire as it begins. An effect-only beat (no text) fires
    // before the next line, or after the last one if nothing follows.
    let waiting = [];
    let lastEntry = null;
    // Who was already in each voice's cast: only they can be in the room in person
    // (a computer like the tug's can't, even if the agent gives it a speaker).
    const cast = new Map(voices.map((v) => [v.id, new Set((v.characters || []).map((c) => c.name.toLowerCase()))]));
    this.castCharacters(lines);
    for (const { voice, character, inPerson, system, text, effects: lineFx, variants: rawVariants } of lines) {
      // Per-player versions of this line, for the crew they name (if the Warden allows them).
      const variants = source === "agent" && !this.state.config.agentVariants ? [] : resolveVariants(rawVariants, this.state.config.crew);
      // Effects from an effect-only beat are marked hold: the next line waits for them.
      const cues = useEffects ? [...waiting, ...normalizeEffects(lineFx)] : [];
      if (!text && !variants.length) { waiting = cues.map((c) => ({ ...c, hold: true })); continue; }
      // A blackout hides the screen and silences voices, so it always plays as a
      // beat: the dialogue pauses for it, then this line appears once it's over.
      for (const c of cues) if (c.type === "blackout") c.hold = true;
      waiting = [];
      const kind = kindOf(voice);
      const asked = netNamed(this.state.config, system) ?? here;
      const person = inPerson && !!character && !!cast.get(voice)?.has(character.toLowerCase());
      const net = this.routeLine(voice, asked, person);
      if (net !== asked) this.addLog("note", `${voices.find((v) => v.id === voice)?.name || voice} ${asked === ALL_NET ? "isn't on every system" : `isn't on ${systemName(this.state.config, asked)}`}: its line went to ${systemName(this.state.config, net)}.`);
      const entry = this.addLog(kind, text, { source, net, ...(kind === "entity" ? { entity: voice } : {}), ...(character ? { character } : {}), ...(inPerson && character ? { inPerson: true } : {}), ...(variants.length ? { variants } : {}), ...meta, ...(cues.length ? { cues } : {}) });
      meta = {};
      lastEntry = entry;
      for (const c of cues) this.startEffect(c, "agent", { atEntry: entry.id, when: "before", hold: c.hold });
    }
    for (const c of waiting) this.startEffect(c, "agent", lastEntry ? { atEntry: lastEntry.id, when: "after" } : null);
    for (const c of changes) {
      setPath(this.state.station, c.path, c.value);
      this.addLog("note", `Station: ${c.path} → ${c.value}`);
    }
    if (changes.length) this.toPlayers({ t: "header", header: this.playerHeader() });
    this.applyMapChanges(mapChanges);
    for (const e of effects) this.startEffect(e, "agent");
    this.applyCrewChanges(reply?.crew_changes);
  }

  // The map changes in an agent reply that really change something: a new
  // layout, and redrawn floor plans. { layout?, roomPlans? }
  mapChanges(reply) {
    const out = {};
    const layout = String(reply?.layout || "").trim();
    if (layout && layout !== this.state.config.map.trim()) out.layout = layout.slice(0, 4000);
    const plans = (reply?.room_plans || []).map((p) => ({ room: p.room, rows: sanitizeRows(p.rows) })).filter((p) => p.room && p.rows);
    if (plans.length) out.roomPlans = plans;
    return out;
  }

  applyMapChanges({ layout, roomPlans = [] }) {
    const c = this.state.config;
    if (layout) {
      c.map = layout;
      this.addLog("note", "Map: the agent changed the layout.");
    }
    for (const p of roomPlans) {
      c.rooms[p.room] = { rows: p.rows };
      this.addLog("note", `Map: the agent redrew the floor plan of ${p.room}.`);
    }
  }

  // Player input: one agent call at a time per session. Input that arrives while
  // the agent is busy gets one combined follow-up reply, not one call each.
  // With no key for the session's model the agent stays quiet: the Warden replies with Speak.
  requestReply() {
    if (!this.hasKey()) { this.state.pending = null; this.syncDm(); return; }
    if (this.generating) this.rerun = true;
    else this.generate();
  }
  hasKey() { return !!keyFor(this.state.config.provider, this.keys); }

  async generate(steer) {
    const s = this.state;
    const myGen = ++this.genCounter;
    const forEntry = s.log.filter((e) => e.kind === "player").at(-1)?.id ?? null;
    const { provider: providerId, model, effort } = s.config;
    // Whisper/steering are logged as Warden commands when the reply goes out,
    // so the agent's history shows what it was told and when.
    const directives = currentDirectives(s, steer);
    s.pending = { status: "generating", forEntry, steer: steer || "", model, directives };
    this.rerun = false;
    this.setBusy(true);
    this.syncDm();

    try {
      const provider = getProvider(providerId);
      if (!provider) throw new Error(`Unknown provider "${providerId}".`);
      const apiKey = keyFor(providerId, this.keys);
      if (!apiKey) throw new Error("No LLM API key for this session. Add one under ⚙ Settings → LLM.");
      // Check first: answering a player who is attempting something uncertain
      // waits for the Warden's ruling, so nothing is shown before it.
      const latest = s.log.findLast((e) => ["player", "warden", "roll", "aside"].includes(e.kind));
      if (s.config.checkFirst !== false && latest?.kind === "player" && !steer && !directives.length) {
        let oc = null;
        try { oc = await this.ask(buildPrecheck(s), "precheck"); } catch (err) { console.warn(`[${this.code}] check-first skipped: ${err?.message || err}`); }
        if (myGen !== this.genCounter) return;
        if (oc?.needed) return this.holdForWarden(oc, "");
      }
      const request = { apiKey, model, effort, ...buildRequest({ ...s, screens: this.screens(), defaultNet: this.defaultNet() }, steer) };
      // One silent retry for malformed output (empty / not JSON) before bothering the Warden.
      let reply;
      for (let attempt = 1; ; attempt++) {
        try {
          reply = parseReply(await this.callModel(provider, request, "reply"), s.config.voices);
          break;
        } catch (err) {
          if (!err.malformed || attempt >= 2 || myGen !== this.genCounter) throw err;
          console.warn(`[${this.code}] retrying after malformed reply: ${err.message}`);
        }
      }
      if (myGen !== this.genCounter) return; // superseded

      // The one-shot whisper is consumed once a reply exists.
      s.whisper = "";
      if (reply.outcome_check.needed && s.config.checkFirst !== false) {
        // (The reply flagged a check the first question missed: hold it too.)
        this.logDirectives(directives);
        return this.holdForWarden(reply.outcome_check, reply.dm_note);
      } else if (s.config.mode === "auto") {
        this.logDirectives(directives);
        this.deliver(reply, "agent");
        if (reply.dm_note) this.addLog("note", `Agent: ${reply.dm_note}`);
        s.pending = null;
        this.setBusy(false);
      } else {
        s.pending = { status: "ready", forEntry, reply, model, directives };
        // Make the voices while the Warden reads the draft: an unedited line is
        // then ready to play the moment it's sent.
        this.castCharacters(reply.lines);
        this.pregenerate(reply.lines.map((l) => ({ ...l, kind: kindOf(l.voice), entity: l.voice })));
      }
    } catch (err) {
      if (myGen !== this.genCounter) return;
      console.error(`[${this.code}] generation failed:`, err?.message || err);
      s.pending = { status: "error", forEntry, error: err?.message || String(err), model, directives };
    }
    this.touch();
    this.syncDm();
    // Players typed while the agent was busy: one follow-up covering all of it
    // (in review mode this replaces the draft, as new input always has).
    if (this.rerun) this.generate();
  }

  close() {
    for (const t of this.effectTimers.values()) clearTimeout(t);
    for (const ws of this.sockets) ws.close(4004, "session ended");
  }
}
