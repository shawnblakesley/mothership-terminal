// One game session: its station, log, voices, effects, connected players and
// Warden consoles, and the agent loop. The server keeps many of these at once.
import crypto from "crypto";
import { getProvider, defaultSelection, fixSelection, catalog, keyFor, looksLikeKey } from "./providers/index.js";
import { warmNeural, synthesize } from "./tts.js";
import { speechParts, voiceFor } from "./voices.js";
import { defaultVoices, sanitizeVoices, PRESETS, FX_PARAMS, VARIANTS, STYLES, ENGINES, SPEAKERS, BUILTIN, DEFAULT_PERSONAS, OLD_DEFAULT_PERSONAS } from "./voices.js";
import { CHECKS, SKILL_LEVELS, sanitizeRequest, resolve, rollD100, resultText, checkLabel, skillLabel } from "./rolls.js";
import { ALL_EFFECTS, AGENT_EFFECTS, buildRequest, parseReply, splitVoiceTags, resolveVoice, kindOf, currentDirectives, normalizeEffects } from "./agent.js";

const MAX_LOG = 1000; // entries kept per session (the model sees the most recent ones)
const MAX_SOCKETS = 40; // per session
const PLAYER_INPUT_GAP_MS = 1200; // per connection: stops spamming the agent (and the Warden's bill)

const DEFAULT_LORE = `STATION: KESTREL-9, a rimward ice-mining platform owned by Hollis-Vane Extraction Co.
CREW COMPLEMENT: 14. Last scheduled supply run: 41 days overdue.
DECKS: 1 Command/Comms, 2 Habitation/Med Bay, 3 Cargo/Refinery, 4 Reactor.
RECENT EVENTS (public log): Drill team hit a "pressurised void" in the ice 19 days ago. Two crew hospitalised with "fever". Comms degraded since.`;

const DEFAULT_SECRETS = `- The void contained an organism. It is in the Deck 3 cargo bay, sealed behind the LOCKED door.
- Admin password is "THAW". Security password is "BLUEWATER". Only reveal via hacking or found clues.
- Company directive 7-K: if containment fails, HV-CORE is to seal all decks and preserve the specimen. Crew is expendable. Do not disclose below ADMIN.
- Dr. Imre Salk (medic) is infected but does not know it.`;

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

// Log kinds players never see: Warden notes and the Warden's commands to the agent.
const PRIVATE_KINDS = new Set(["note", "warden"]);
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
      agentEffects: true,
      tts: true,
      voices: defaultVoices(),
      theme: "green",
    },
    station: structuredClone(DEFAULT_STATION),
    log: [],
    whisper: "",
  };
}

// Bring saved games from older versions up to date.
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
  return {
    config: { ...config, ...fixSelection(config), voices },
    station: saved.station ?? base.station,
    log: Array.isArray(saved.log) ? saved.log.slice(-MAX_LOG) : [],
    whisper: String(saved.whisper ?? ""),
    roll: saved.roll ?? null, // the current/last ability roll (see rolls.js)
    outcomeCheck: saved.outcomeCheck ?? null, // an uncertain player action the agent left to the Warden
  };
}

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
    this.state = { ...migrateGame(saved.game ?? {}), pending: null, effects: [] };
    this.keys = {}; // provider id -> API key. Memory only: never saved, never sent to a browser.
    this.sockets = new Set();
    this.nextId = this.state.log.reduce((m, e) => Math.max(m, e.id), 0) + 1;
    this.genCounter = 0;
    this.rerun = false; // a player typed while the agent was busy: answer once it's done
    this.effectTimers = new Map();
    this.onChange = onChange;
    this.onEnd = onEnd;
    if (this.usesNeural()) warmNeural();
  }

  toJSON() {
    const { pending, effects, ...game } = this.state;
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
    ws.on("close", () => this.sockets.delete(ws));
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
      log: this.state.log.filter((e) => !PRIVATE_KINDS.has(e.kind) && !e.hidden),
      header: this.playerHeader(),
      effects: this.state.effects,
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
      // What each voice looks like on screen and its effect chain (no personas or base-voice internals).
      // chunked: human voices are spoken one text line at a time (see speechParts).
      voices: Object.fromEntries(c.voices.map((v) => [v.id, { name: v.name, style: v.style, color: v.color, fx: v.fx, chunked: v.voice.engine === "neural" }])),
    };
  }

  dmView() {
    return {
      ...this.state,
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
    if (!PRIVATE_KINDS.has(kind)) this.toPlayers({ t: "line", entry });
    if (SPOKEN_KINDS.has(kind)) this.pregenerate([entry]);
    this.touch();
    return entry;
  }

  setBusy(busy) { this.toPlayers({ t: "busy", busy }); }

  // ---------------------------------------------------------------- players
  handlePlayer(ws, msg) {
    if (msg.t === "roll") return this.resolveRoll(ws, msg);
    if (msg.t !== "input") return;
    const text = String(msg.text || "").slice(0, 1000).trim();
    if (!text || this.isLockedOut()) return;
    const now = Date.now();
    if (now - ws.lastInput < PLAYER_INPUT_GAP_MS) return;
    ws.lastInput = now;
    this.addLog("player", text);
    if (this.state.config.mode === "manual") {
      this.state.pending = null;
      this.syncDm();
    } else {
      this.requestReply();
    }
  }

  isLockedOut() {
    return this.state.effects.some((e) => e.type === "lockout");
  }

  // ---------------------------------------------------------------- Warden
  handleDm(msg) {
    const s = this.state;
    switch (msg.t) {
      case "config": {
        const allowed = ["stationName", "lore", "secrets", "standingOrders", "mode", "provider", "model", "effort", "agentEffects", "tts", "theme"];
        for (const k of allowed) if (k in (msg.patch || {})) s.config[k] = msg.patch[k];
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
        this.addLog(kind, text, { source: "dm", ...(kind === "entity" ? { entity: as } : {}) });
        if (msg.clearPending) { this.genCounter++; s.pending = null; this.setBusy(false); }
        break;
      }
      case "note":
        this.addLog("note", String(msg.text || "").slice(0, 4000));
        break;
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
        this.toPlayers({ t: "init", ...this.playerView() });
        break;
      case "resetSession":
        this.genCounter++;
        s.log = [];
        s.pending = null;
        s.whisper = "";
        s.roll = null;
        s.outcomeCheck = null;
        s.station = structuredClone(msg.keepStation ? s.station : DEFAULT_STATION);
        for (const e of [...s.effects]) this.endEffect(e.id);
        this.toPlayers({ t: "init", ...this.playerView() });
        break;
      case "rollRequest": {
        s.roll = sanitizeRequest(msg.roll);
        if (msg.fromOutcome) s.outcomeCheck = null;
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
        s.outcomeCheck = null;
        break;
      case "endSession":
        console.log(`  - session ${this.code} ended by its Warden`);
        this.onEnd?.(this);
        return;
      case "resetAll":
        this.genCounter++;
        for (const e of [...s.effects]) this.endEffect(e.id);
        this.state = { ...defaultGame(this.keys), pending: null, effects: [] };
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
      const v = voiceFor(this.state.config.voices, l);
      if (v?.voice.engine !== "neural") continue; // synthetic voices are instant anyway
      for (const part of speechParts(l.text)) synthesize(part, v.voice).catch(() => {});
    }
  }

  // ---------------------------------------------------------------- rolls
  // What players see of a roll request (only while it's waiting for them).
  publicRoll() {
    const r = this.state.roll;
    if (!r || r.status !== "waiting") return null;
    return { id: r.id, label: checkLabel(r), skill: skillLabel(r), reason: r.reason, advantage: r.advantage, statKnown: r.stat !== null, statName: CHECKS[r.check].label, bonus: r.bonus };
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
    this.addLog("roll", resultText(r, result), { outcome: result.outcome });
    this.syncDm();
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
      (reply?.lines || []).map((l) => ({ voice: resolveVoice(l.voice, voices) ?? BUILTIN.terminal, text: String(l.text ?? "").slice(0, 8000), effects: l.effects })),
      voices,
    );
    const useEffects = this.state.config.agentEffects;
    const changes = (reply?.station_changes || []).filter((c) => c && typeof c.path === "string" && c.path);
    const effects = this.state.config.agentEffects ? (reply?.effects || []) : [];
    // The first entry carries the reply's changes/effects so the agent's history
    // shows that it really changed things (otherwise it learns to leave them empty).
    let meta = { changes: changes.map(({ path, value }) => ({ path, value })), effects: effects.map(({ type, text, seconds }) => ({ type, text, seconds })) };
    // Effects on a line fire as it begins. An effect-only beat (no text) fires
    // before the next line, or after the last one if nothing follows.
    let waiting = [];
    let lastEntry = null;
    for (const { voice, text, effects: lineFx } of lines) {
      // Effects from an effect-only beat are marked hold: the next line waits for them.
      const cues = useEffects ? [...waiting, ...normalizeEffects(lineFx)] : [];
      if (!text) { waiting = cues.map((c) => ({ ...c, hold: true })); continue; }
      // A blackout hides the screen and silences voices, so it always plays as a
      // beat: the dialogue pauses for it, then this line appears once it's over.
      for (const c of cues) if (c.type === "blackout") c.hold = true;
      waiting = [];
      const kind = kindOf(voice);
      const entry = this.addLog(kind, text, { source, ...(kind === "entity" ? { entity: voice } : {}), ...meta, ...(cues.length ? { cues } : {}) });
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
      const request = { apiKey, model, effort, ...buildRequest(s, steer) };
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
      if (s.config.mode === "auto") {
        this.logDirectives(directives);
        this.deliver(reply, "agent");
        if (reply.dm_note) this.addLog("note", `Agent: ${reply.dm_note}`);
        s.pending = null;
        this.setBusy(false);
      } else {
        s.pending = { status: "ready", forEntry, reply, model, directives };
        // Make the voices while the Warden reads the draft: an unedited line is
        // then ready to play the moment it's sent.
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
