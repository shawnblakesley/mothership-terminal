// One game session: its station, log, voices, effects, connected players and
// Warden consoles, and the agent loop. The server keeps many of these at once.
import crypto from "crypto";
import { getProvider, defaultSelection, fixSelection, catalog, keyFor, looksLikeKey } from "./providers/index.js";
import { warmNeural, synthesize, wavSeconds } from "./tts.js";
import { speechParts, speakingVoice, castCharacter, findCharacter, voiceFor } from "./voices.js";
import { defaultVoices, sanitizeVoices, PRESETS, FX_PARAMS, VARIANTS, STYLES, ENGINES, SPEAKERS, BUILTIN, DEFAULT_PERSONAS, OLD_DEFAULT_PERSONAS } from "./voices.js";
import { APP_VERSION } from "./version.js";
import { cleanName } from "./sounds.js";
import { DEFAULT_CREW, sanitizeCrew, resolveVariants, crewTargets, setVital, VITALS } from "./crew.js";
import { chatRequest, draftRequest, normalizeDraft, applyDraft } from "./builder.js";
import { DEFAULT_TERMINALS, sanitizeTerminals } from "./terminals.js";
import { CHECKS, SKILL_LEVELS, sanitizeRequest, resolve, rollD100, resultText, checkLabel, skillLabel } from "./rolls.js";
import { ALL_EFFECTS, AGENT_EFFECTS, buildRequest, buildPrecheck, limitLength, parseReply, splitVoiceTags, resolveVoice, kindOf, currentDirectives, normalizeEffects } from "./agent.js";

const MAX_LOG = 1000; // entries kept per session (the model sees the most recent ones)
const MAX_SOCKETS = 40; // per session
const PLAYER_INPUT_GAP_MS = 1200; // per connection: stops spamming the agent (and the Warden's bill)

const DEFAULT_LORE = `STATION: KESTREL-9, a rimward ice-mining platform owned by Hollis-Vane Extraction Co.
CREW COMPLEMENT: 14. Last scheduled supply run: 41 days overdue.
DECKS: 1 Command/Comms, 2 Habitation/Med Bay, 3 Cargo/Refinery, 4 Reactor.
KEY CREW: Administrator Ruth Okonkwo (command), Dr. Imre Salk (medic), Chief Engineer Hana Marlowe (reactor), Security Officer Dmitri Voss, Comms Officer Juno Adar, drill team lead Anton Petrov, drillers Carys Webb and Pell Ostrand, refinery hand Sam Yusuf. Five more refinery and habitation crew.
RECENT EVENTS (public log): Drill team hit a "pressurised void" in the ice 19 days ago. Two crew hospitalised with "fever". Comms degraded since.
MAINTENANCE TICKET #4471 (filed 23 days ago): comms relay intermittent. Hollis-Vane dispatched a convict maintenance crew (the PLAYERS) on the prison tug SECOND CHANCE. They have just docked at Airlock A with tools for a routine relay repair. Everything in RECENT EVENTS happened while they were in transit: nobody briefed them, and they are not equipped for it.`;
const OLD_DEFAULT_LORE = `STATION: KESTREL-9, a rimward ice-mining platform owned by Hollis-Vane Extraction Co.
CREW COMPLEMENT: 14. Last scheduled supply run: 41 days overdue.
DECKS: 1 Command/Comms, 2 Habitation/Med Bay, 3 Cargo/Refinery, 4 Reactor.
RECENT EVENTS (public log): Drill team hit a "pressurised void" in the ice 19 days ago. Two crew hospitalised with "fever". Comms degraded since.`;

const DEFAULT_SECRETS = `- The void contained an organism. It is in the Deck 3 cargo bay, sealed behind the LOCKED door.
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
const DEFAULT_MAP = `Deck 1 · Command / Comms: command_deck=Command, airlock_a=Airlock A
Deck 2 · Habitation / Med Bay: med_bay=Med Bay
Deck 3 · Cargo / Refinery: cargo_bay_deck3=Cargo Bay
Deck 4 · Reactor: reactor_access=Reactor Access
Link: med_bay - cargo_bay_deck3 (air vents)
Link: cargo_bay_deck3 - reactor_access (maintenance shaft)`;
// Earlier default layouts (no links), upgraded when unedited.
const OLD_DEFAULT_MAPS = [DEFAULT_MAP.split("\nLink:")[0]];

const DEFAULT_STATION = {
  access_level: "GUEST",
  life_support: { oxygen_pct: 87, co2: "ELEVATED", status: "NOMINAL" },
  power: { reactor: "ONLINE", output_pct: 64, aux: "STANDBY" },
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
      mode: "review", // auto | review | manual
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
    },
    station: structuredClone(DEFAULT_STATION),
    log: [],
    whisper: "",
    sounds: [],
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
  // Still the original KESTREL-9 story: bring in the full cast and the convict crew's arrival.
  if (config.lore === OLD_DEFAULT_LORE) {
    config.lore = DEFAULT_LORE;
    if (OLD_DEFAULT_SECRETS.includes(config.secrets)) config.secrets = DEFAULT_SECRETS;
    const intercom = voices.find((v) => v.id === "intercom");
    if (intercom) intercom.characters = mergeCast(intercom.characters, defaultVoices().find((v) => v.id === "intercom").characters);
  }
  config.crew = sanitizeCrew(config.crew);
  config.terminals = sanitizeTerminals(config.terminals);
  return {
    config: { ...config, ...fixSelection(config), voices },
    station: saved.station ?? base.station,
    log: Array.isArray(saved.log) ? saved.log.slice(-MAX_LOG) : [],
    whisper: String(saved.whisper ?? ""),
    roll: saved.roll ?? null, // the current/last ability roll (see rolls.js)
    outcomeCheck: saved.outcomeCheck ?? null, // an uncertain player action the agent left to the Warden
    sounds: Array.isArray(saved.sounds) ? saved.sounds : [], // the Warden's uploaded sounds (files: sounds.js)
    // The story builder's conversation and latest draft (builder.js).
    builder: { messages: Array.isArray(saved.builder?.messages) ? saved.builder.messages.slice(-60) : [], draft: saved.builder?.draft ?? null },
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
    this.keys = {}; // provider id -> API key. Memory only: never saved, never sent to a browser.
    this.sockets = new Set();
    this.nextId = this.state.log.reduce((m, e) => Math.max(m, e.id), 0) + 1;
    this.genCounter = 0;
    // Lines reach the players on one shared timeline (see scheduleLine), in order.
    this.playhead = 0;
    this.lineChain = Promise.resolve();
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
  attach(ws, role) {
    if (this.sockets.size >= MAX_SOCKETS) {
      ws.close(4029, "session full");
      return false;
    }
    ws.role = role;
    ws.lastInput = 0;
    this.sockets.add(ws);
    ws.character = null; // the crew file this player screen has claimed (crew.js)
    ws.on("close", () => {
      this.sockets.delete(ws);
      if (ws.character) this.crewChanged();
    });
    if (role === "dm") ws.send(JSON.stringify({ t: "state", state: this.dmView() }));
    else ws.send(JSON.stringify({ t: "init", ...this.playerView() }));
    return true;
  }

  send(role, payload) {
    const data = JSON.stringify(payload);
    for (const c of this.sockets) if (c.role === role && c.readyState === 1) c.send(data);
  }
  toPlayers(p) { this.send("player", p); }
  syncDm() { this.send("dm", { t: "state", state: this.dmView() }); }

  playerView() {
    return {
      version: APP_VERSION,
      log: this.state.log.filter((e) => !PRIVATE_KINDS.has(e.kind) && !e.hidden && !e.queued && !e.cut),
      header: this.playerHeader(),
      effects: this.state.effects,
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
      terminals: c.terminals.map(({ id, name, look, theme, open }) => ({ id, name, look, theme, open })),
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
      // (timed cues are listed for a while after they end; only show what's running)
      effects: this.state.effects.filter((e) => this.effectRunning(e)),
      builderBusy: this.builderBusy,
      code: this.code,
      providers: catalog(this.keys),
      allEffects: ALL_EFFECTS,
      rollOptions: { checks: CHECKS, skillLevels: SKILL_LEVELS },
      voiceOptions: { presets: PRESETS, fxParams: FX_PARAMS, variants: VARIANTS, styles: STYLES, engines: ENGINES, speakers: SPEAKERS },
    };
  }

  // ---------------------------------------------------------------- log
  addLog(kind, text, extra = {}) {
    const entry = { id: this.nextId++, kind, text, ts: Date.now(), ...extra };
    this.state.log.push(entry);
    if (this.state.log.length > MAX_LOG) this.state.log.splice(0, this.state.log.length - MAX_LOG);
    if (SPOKEN_KINDS.has(kind)) this.pregenerate([entry]);
    if (kind === "player") this.toPlayers({ t: "line", entry }); // what they typed: at once
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
  interruptComms() {
    const now = Date.now();
    const cut = [], trimmed = [];
    const c = this.state.config;
    for (const e of this.state.log) {
      if (PRIVATE_KINDS.has(e.kind) || e.kind === "player" || e.cut || e.interrupted) continue;
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
    this.playhead = now;
    this.toPlayers({ t: "interrupt", at: now, cut, trimmed });
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
    const LEAD = 450, PIECE_GAP = 250, LINE_GAP = 150;
    const c = this.state.config;
    const spoken = c.tts && SPOKEN_KINDS.has(entry.kind);
    const voice = SPOKEN_KINDS.has(entry.kind) ? voiceFor(c.voices, entry) : null;
    const base = voice ? speakingVoice(c.voices, entry) : null;
    const rate = voice?.fx?.rate || 1;
    const chunked = voice?.voice.engine === "neural";
    const texts = [entry.text, ...(entry.variants || []).map((v) => v.text)];
    const pieces = texts.map((t) => (!t ? [] : chunked ? speechParts(t) : [t]));
    const jobs = pieces.map((ps) => ps.map((p) => (spoken ? synthesize(p, base).catch(() => null) : Promise.resolve(null))));
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
        // Unspoken text gets reading time instead.
        const dur = wav ? Math.round((wavSeconds(wav) / rate) * 1000) : Math.min(6000, 400 + pieces[v][i].length * 18);
        const part = { i, at: Math.max(cursors[v], Date.now() + LEAD), dur, audio: !!wav, last: i === pieces[v].length - 1 };
        cursors[v] = part.at + dur + PIECE_GAP;
        timing.versions[v].push(part);
        if (sent && live()) this.toPlayers({ t: "part", id: entry.id, v, part });
      }
      if (!sent) {
        sent = true;
        if (entry.cut) break;
        entry.timing = timing;
        delete entry.queued;
        if (live()) this.toPlayers({ t: "line", entry });
      }
    }
    if (!sent && !entry.cut) { // nothing to show anyone (shouldn't happen): keep the order, move on
      entry.timing = timing;
      delete entry.queued;
      if (live()) this.toPlayers({ t: "line", entry });
    }
    if (entry.cut || entry.interrupted) return; // (cut off: the timeline already moved on)
    timing.end = Math.max(timing.speakAt, ...cursors.map((x) => x - PIECE_GAP));
    if (live()) this.toPlayers({ t: "lineEnd", id: entry.id, end: timing.end });
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
    this.interruptComms();
    const pc = this.characterOf(ws);
    this.addLog("player", text, pc ? { by: pc.name } : {});
    if (this.state.config.mode === "manual") {
      this.state.pending = null;
      this.syncDm();
    } else {
      this.requestReply();
    }
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
    switch (msg.t) {
      case "config": {
        const allowed = ["stationName", "lore", "secrets", "standingOrders", "mode", "provider", "model", "effort", "agentEffects", "agentVariants", "agentCrew", "checkFirst", "talk", "playerVitals", "playerRolls", "playerTerminals", "tts", "theme", "map"];
        for (const k of allowed) if (k in (msg.patch || {})) s.config[k] = msg.patch[k];
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
        if (!p) break;
        const key = String(msg.key || "").trim();
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
        this.addLog(kind, text, { source: "dm", ...(kind === "entity" ? { entity: as } : {}), ...(line.character ? { character: line.character } : {}) });
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
        this.toPlayers({ t: "init", ...this.playerView() });
        break;
      case "clearScreen":
        // Wipe the visible terminal but keep the entries so the agent's memory survives.
        for (const e of s.log) e.hidden = true;
        this.playhead = 0;
        this.toPlayers({ t: "init", ...this.playerView() });
        break;
      case "resetSession":
        this.genCounter++;
        this.playhead = 0;
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
        this.toPlayers({ t: "init", ...this.playerView() });
        break;
      case "rollRequest": {
        s.roll = sanitizeRequest(msg.roll);
        if (msg.fromOutcome) {
          s.outcomeCheck = null;
          this.setBusy(false); // the roll prompt replaces PROCESSING
        }
        this.addLog("note", `Roll called: ${[checkLabel(s.roll), skillLabel(s.roll), s.roll.reason].filter(Boolean).join(" · ")}`);
        this.toPlayers({ t: "roll", roll: this.publicRoll() });
        break;
      }
      case "rollCancel":
        if (s.roll?.status === "waiting") this.addLog("note", "Roll cancelled.");
        s.roll = null;
        this.toPlayers({ t: "roll", roll: null });
        break;
      case "rollNarrate":
        // The [ROLL RESULT] is already the latest thing in the agent's history.
        if (s.roll?.status === "done") this.generate();
        return;
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
      case "builderReset":
        if (!this.builderBusy) s.builder = { messages: [], draft: null };
        break;
      case "builderApply":
        if (s.builder.draft && !this.builderBusy) this.applyStory(s.builder.draft);
        break;
      case "terminals":
        s.config.terminals = sanitizeTerminals(msg.terminals);
        this.toPlayers({ t: "header", header: this.playerHeader() });
        break;
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
        this.toPlayers({ t: "init", ...this.playerView() });
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
    };
    this.state.effects.push(effect);
    this.toPlayers({ t: "effect", effect });
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
  async ask(request) {
    const s = this.state;
    const provider = getProvider(s.config.provider);
    if (!provider) throw new Error(`Unknown provider "${s.config.provider}".`);
    const apiKey = keyFor(s.config.provider, this.keys);
    if (!apiKey) throw new Error(`No ${provider.label} API key for this session. Add one under "Agent".`);
    for (let attempt = 1; ; attempt++) {
      const text = await provider.generate({ apiKey, model: s.config.model, effort: s.config.effort, ...request });
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
        const r = await this.ask(chatRequest(b));
        b.messages.push({ role: "agent", text: String(r?.reply || "…").slice(0, 6000), ready: !!r?.ready });
      } else {
        b.draft = normalizeDraft(await this.ask(draftRequest(b)));
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

  // Replace the story with a builder draft: new station, lore, secrets, voices,
  // map and crew; a fresh log. Provider, mode and the sound library stay.
  applyStory(draft) {
    const s = this.state;
    const { config, station } = applyDraft(draft);
    this.genCounter++;
    this.playhead = 0;
    Object.assign(s.config, config);
    Object.assign(s, { station, log: [], pending: null, whisper: "", roll: null, outcomeCheck: null });
    for (const e of [...s.effects]) this.endEffect(e.id);
    this.stopSounds();
    for (const ws of this.sockets) if (ws.role === "player") ws.character = null; // everyone picks a new crew file
    if (this.usesNeural()) warmNeural();
    this.addLog("note", `New story applied: "${draft.title}".`);
    this.toPlayers({ t: "init", ...this.playerView() });
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
      if (!apiKey) throw new Error(`No ${provider.label} API key for this session, so the agent can't read notes. Add one under "Agent".`);
      const request = { apiKey, model: s.config.model, effort: s.config.effort, ...buildRequest(s, "", { aside: true }) };
      let reply;
      for (let attempt = 1; ; attempt++) {
        try {
          reply = limitLength(parseReply(await provider.generate(request), s.config.voices), s.config.talk);
          break;
        } catch (err) {
          if (!err.malformed || attempt >= 2) throw err;
        }
      }
      const changes = reply.station_changes.filter((c) => c.path);
      for (const c of changes) setPath(s.station, c.path, c.value);
      this.addLog("aside_reply", reply.dm_note.trim() || "Noted.", { changes: changes.map(({ path, value }) => ({ path, value })) });
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
    return { id: r.id, check: r.check, label: checkLabel(r), skill: skillLabel(r), reason: r.reason, advantage: r.advantage, statKnown: r.stat !== null, statName: CHECKS[r.check].label, bonus: r.bonus };
  }

  // A player answers the roll: digital dice from the server, or physical dice typed in.
  resolveRoll(ws, msg) {
    const r = this.state.roll;
    if (!r || r.status !== "waiting" || msg.id !== r.id) return;
    const n = r.advantage === "none" ? 1 : 2;
    const dice = msg.manual
      ? (Array.isArray(msg.dice) ? msg.dice : []).map((d) => Number(d))
      : Array.from({ length: n }, rollD100);
    let result;
    try {
      result = resolve(r, r.stat ?? msg.stat, dice);
    } catch (err) {
      ws.send(JSON.stringify({ t: "rollError", text: err.message }));
      return;
    }
    this.state.roll = { ...r, status: "done", result, manual: !!msg.manual, finishedAt: Date.now() };
    this.toPlayers({ t: "roll", roll: null });
    this.toPlayers({ t: "rollResult", result, label: checkLabel(r) });
    const pc = this.characterOf(ws);
    this.addLog("roll", `${pc ? `${pc.name}: ` : ""}${resultText(r, result)}`, { outcome: result.outcome, ...(pc ? { by: pc.name } : {}) });
    if (pc && !result.success) {
      pc.stress = Math.min(20, pc.stress + 1);
      this.addLog("note", `${pc.name}: Stress ${pc.stress - 1} → ${pc.stress} (failed roll).`);
      this.crewChanged();
    }
    this.syncDm();
  }

  // A screen is at a terminal: the player chose it (if allowed), or the Warden moved them.
  playerTerminal(ws, id, by) {
    const t = this.state.config.terminals.find((x) => x.id === id);
    if (!t || ws.terminal === id) return;
    // Players can't walk into a terminal that isn't reachable, or move at all if the Warden says so
    // (but a screen that has no terminal yet takes the one it asks for).
    if (by === "player" && ws.terminal && (!this.state.config.playerTerminals || !t.open)) return;
    if (by === "player" && !ws.terminal && !t.open) return;
    const had = ws.terminal;
    ws.terminal = id;
    if (by === "warden") ws.send(JSON.stringify({ t: "terminalSet", id }));
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
    const r = sanitizeRequest({ check: msg.check, skill: msg.skill, skillLevel: msg.skill ? msg.skillLevel : "none", advantage: msg.advantage, stat: pc.stats[msg.check] ?? pc.saves[msg.check] });
    const dice = msg.manual
      ? (Array.isArray(msg.dice) ? msg.dice : []).map(Number)
      : Array.from({ length: r.advantage === "none" ? 1 : 2 }, rollD100);
    let result;
    try {
      result = resolve(r, r.stat, dice);
    } catch (err) {
      ws.send(JSON.stringify({ t: "rollError", text: err.message }));
      return;
    }
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
    const oc = reply?.outcome_check;
    if (oc?.needed) {
      this.state.outcomeCheck = { ...oc, id: Date.now().toString(36), at: Date.now() };
      this.addLog("note", `⚖ Outcome needed: ${oc.attempt || "(unspecified)"}${oc.suggested_check !== "none" ? ` · suggests ${CHECKS[oc.suggested_check].label}${oc.advantage === "advantage" ? " [+]" : oc.advantage === "disadvantage" ? " [-]" : ""}` : ""}`);
    }
    const voices = this.state.config.voices;
    const lines = splitVoiceTags(
      (reply?.lines || []).map((l) => ({ voice: resolveVoice(l.voice, voices) ?? BUILTIN.terminal, character: String(l.character ?? "").slice(0, 60), text: String(l.text ?? "").slice(0, 8000), effects: l.effects, variants: l.variants })),
      voices,
    );
    const useEffects = this.state.config.agentEffects;
    const changes = (reply?.station_changes || []).filter((c) => c && typeof c.path === "string" && c.path);
    const effects = this.state.config.agentEffects ? (reply?.effects || []) : [];
    // The first entry carries the reply's changes/effects so the agent's history
    // shows that it really changed things (otherwise it learns to leave them empty).
    let meta = { changes: changes.map(({ path, value }) => ({ path, value })), effects: effects.map(({ type, text, seconds }) => ({ type, text, seconds })), crewChanges: this.state.config.agentCrew ? (reply?.crew_changes || []) : [] };
    // Effects on a line fire as it begins. An effect-only beat (no text) fires
    // before the next line, or after the last one if nothing follows.
    let waiting = [];
    let lastEntry = null;
    this.castCharacters(lines);
    for (const { voice, character, text, effects: lineFx, variants: rawVariants } of lines) {
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
      const entry = this.addLog(kind, text, { source, ...(kind === "entity" ? { entity: voice } : {}), ...(character ? { character } : {}), ...(variants.length ? { variants } : {}), ...meta, ...(cues.length ? { cues } : {}) });
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
    for (const e of effects) this.startEffect(e, "agent");
    this.applyCrewChanges(reply?.crew_changes);
  }

  // Player input: one agent call at a time per session. Input that arrives while
  // the agent is busy gets one combined follow-up reply, not one call each.
  requestReply() {
    if (this.generating) this.rerun = true;
    else this.generate();
  }

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
      if (!apiKey) throw new Error(`No ${provider.label} API key for this session. Add one under "Agent" at the top of the console.`);
      // Check first: answering a player who is attempting something uncertain
      // waits for the Warden's ruling, so nothing is shown before it.
      const latest = s.log.findLast((e) => ["player", "warden", "roll", "aside"].includes(e.kind));
      if (s.config.checkFirst !== false && latest?.kind === "player" && !steer && !directives.length) {
        let oc = null;
        try { oc = await this.ask(buildPrecheck(s)); } catch (err) { console.warn(`[${this.code}] check-first skipped: ${err?.message || err}`); }
        if (myGen !== this.genCounter) return;
        if (oc?.needed) return this.holdForWarden(oc, "");
      }
      const request = { apiKey, model, effort, ...buildRequest({ ...s, screens: this.screens() }, steer) };
      // One silent retry for malformed output (empty / not JSON) before bothering the Warden.
      let reply;
      for (let attempt = 1; ; attempt++) {
        try {
          reply = parseReply(await provider.generate(request), s.config.voices);
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
