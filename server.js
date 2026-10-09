import "./logsafe.js";
import { rememberSecret } from "./redact.js";
import express from "express";
import http from "http";
import fs from "fs";
import crypto from "crypto";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer } from "ws";
import { synthesize, setCacheDir, warmNeural } from "./tts.js";
import { sanitizeVoices, speechParts, voiceFor } from "./voices.js";
import { speakingVoice } from "./cast.js";
import { setPortraitsDir, savePortrait, portraitPath, portraitType, deleteSessionPortraits, MAX_PORTRAIT_BYTES } from "./portraits.js";
import { getProvider, looksLikeKey, catalog, offered, fixSelection, LOCAL_KEYS } from "./providers/index.js";
import { Session, SPOKEN_KINDS, defaultGame, hashToken } from "./session.js";
import { setSoundsDir, saveSound, soundPath, deleteSoundFile, deleteSessionSounds, MAX_SOUND_BYTES } from "./sounds.js";
import { track, gauge } from "./telemetry.js";
import { startDiscord } from "./discordbot.js";
for (const p of ["DEEPSEEK_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY", "DISCORD_BOT_TOKEN"]) rememberSecret(process.env[p]);

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const BASE = (process.env.BASE_PATH || "").replace(/\/+$/, "").replace(/^(?!\/)(.)/, "/$1");
const DATA_DIR = process.env.DATA_DIR || path.join(here, "data");
const SESSIONS_DIR = path.join(DATA_DIR, "sessions");
const SESSION_TTL_DAYS = Number(process.env.SESSION_TTL_DAYS || 14);
const MAX_SESSIONS = Number(process.env.MAX_SESSIONS || 300);

const sessions = new Map();
const saveTimers = new Map();

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function newCode() {
  for (;;) {
    const bytes = crypto.randomBytes(6);
    const code = [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
    if (!sessions.has(code)) return code;
  }
}
const normCode = (c) => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);

function scheduleSave(session) {
  clearTimeout(saveTimers.get(session.code));
  saveTimers.set(session.code, setTimeout(() => {
    saveTimers.delete(session.code);
    if (!sessions.has(session.code)) return;
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    const file = path.join(SESSIONS_DIR, `${session.code}.json`);
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(session));
    fs.renameSync(`${file}.tmp`, file);
  }, 500));
}

function addSession(saved) {
  const session = new Session(saved, { onChange: scheduleSave, onEnd: (s) => deleteSession(s.code) });
  sessions.set(session.code, session);
  return session;
}

function newSession(game) {
  const code = newCode();
  const token = crypto.randomBytes(24).toString("base64url");
  const session = addSession({ code, tokenHash: hashToken(token), game });
  scheduleSave(session);
  return { session, token };
}

function createSession(keys = {}, provider = "") {
  const game = defaultGame(keys);
  if (provider) Object.assign(game.config, fixSelection({ provider }));
  const { session, token } = newSession(game);
  Object.assign(session.keys, keys);
  track("SessionCreated", { Provider: provider || Object.keys(keys)[0] });
  return { session, token };
}

function deleteSession(code, reason = "warden") {
  const s = sessions.get(code);
  if (!s) return;
  track("SessionEnded", { Reason: reason });
  s.close();
  sessions.delete(code);
  clearTimeout(saveTimers.get(code));
  fs.rmSync(path.join(SESSIONS_DIR, `${code}.json`), { force: true });
  deleteSessionSounds(code);
  deleteSessionPortraits(code);
}

function loadSessions() {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  for (const f of fs.readdirSync(SESSIONS_DIR).filter((n) => n.endsWith(".json"))) {
    try {
      addSession(JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, f), "utf8")));
    } catch (err) {
      console.warn(`  ! Skipping unreadable session ${f}: ${err.message}`);
    }
  }
}

function sweep() {
  const cutoff = Date.now() - SESSION_TTL_DAYS * 86400_000;
  for (const s of [...sessions.values()]) if (s.lastActive < cutoff && !s.sockets.size) deleteSession(s.code, "expired");
}

function importLegacyGame() {
  const legacy = path.join(DATA_DIR, "state.json");
  if (!fs.existsSync(legacy)) return null;
  try {
    const made = newSession(JSON.parse(fs.readFileSync(legacy, "utf8")));
    fs.renameSync(legacy, `${legacy}.imported`);
    return made;
  } catch (err) {
    console.warn(`  ! Couldn't import data/state.json: ${err.message}`);
    return null;
  }
}

const buckets = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now - b.start > windowMs) {
    buckets.set(key, { start: now, n: 1 });
    return false;
  }
  return ++b.n > max;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (now - b.start > 3600_000) buckets.delete(k);
}, 600_000).unref();

function clientIp(req) {
  const cdn = req.headers["x-cdn-forwarded-for"];
  if (cdn) return String(cdn).split(",").at(-1).trim();
  const cf = req.headers["cloudfront-viewer-address"];
  if (cf) return String(cf).replace(/:\d+$/, "");
  return req.socket.remoteAddress || "";
}

const app = express();
app.disable("x-powered-by");
app.use((_req, res, next) => {
  res.set({ "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" });
  next();
});

const router = express.Router();
const pub = path.join(here, "public");
const noStore = (res) => res.set("Cache-Control", "no-store");

const PUBLIC_URL = (process.env.PUBLIC_URL || "").replace(/\/+$/, "");
const escAttr = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
function previewTags(req) {
  const base = PUBLIC_URL || `${req.protocol}://${req.get("host")}${BASE}`;
  const s = sessions.get(normCode(req.query.s));
  const title = s ? `Join the crew aboard ${s.state.config.stationName}` : "Station Terminal";
  const desc = s
    ? `A Mothership session is under way. Session code ${s.code}: open the link and pick your crew file.`
    : "A Mothership RPG terminal: an AI runs the station, its voices and its horrors. Join a game with its code, or start one.";
  const og = [["og:type", "website"], ["og:site_name", "Mothership Terminal"], ["og:title", title], ["og:description", desc],
    ["og:url", s ? `${base}/?s=${s.code}` : `${base}/`], ["og:image", `${base}/og-image.jpg`], ["og:image:width", "1200"], ["og:image:height", "630"],
    ["og:image:alt", "JOIN THE CREW, on a green terminal screen over a heart monitor going flat"]];
  return [...og.map(([p, c]) => `<meta property="${p}" content="${escAttr(c)}">`),
    `<meta name="description" content="${escAttr(desc)}">`, '<meta name="twitter:card" content="summary_large_image">', '<meta name="theme-color" content="#3bff7a">'].join("\n  ");
}
router.get("/", (req, res) => {
  track("PageView", { Page: "player" });
  const html = fs.readFileSync(path.join(pub, "player.html"), "utf8").replace("<!-- link preview -->", previewTags(req));
  noStore(res).type("html").send(html);
});
router.get("/dm", (_req, res) => { track("PageView", { Page: "warden" }); noStore(res).sendFile(path.join(pub, "dm.html")); });
router.get("/stream", (_req, res) => { track("PageView", { Page: "stream" }); noStore(res).sendFile(path.join(pub, "player.html")); });
router.get("/healthz", (req, res) => res.json({ ok: true, sessions: sessions.size, you: clientIp(req) }));
router.use("/vendor/three/addons", express.static(path.join(here, "node_modules", "three", "examples", "jsm"), { index: false, maxAge: "7d" }));
router.use("/vendor/three", express.static(path.join(here, "node_modules", "three", "build"), { index: false, maxAge: "7d" }));
router.use("/vendor/kokoro", express.static(path.join(here, "node_modules", "kokoro-js", "dist"), { index: false, maxAge: "7d" }));
router.use("/vendor/mespeak", express.static(path.join(here, "node_modules", "mespeak"), { index: false, maxAge: "7d" }));
router.use(express.static(pub, { index: false, maxAge: 0 }));

function isLocalRequest(req) {
  if (process.env.NODE_ENV === "production" || req.headers["x-forwarded-for"] || req.headers["x-origin-secret"]) return false;
  const ip = String(req.socket.remoteAddress || "");
  const host = String(req.headers.host || "").replace(/:\d+$/, "").toLowerCase();
  return ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(ip) && ["localhost", "127.0.0.1", "[::1]"].includes(host);
}

router.get("/api/providers", (req, res) => {
  const local = isLocalRequest(req);
  res.json(catalog(local ? { [LOCAL_KEYS]: true } : {}).map(({ configured, ...p }) => ({ ...p, ...(local && configured && !p.free ? { localKey: true } : {}) })));
});

router.post("/api/sessions", express.json({ limit: "4kb" }), (req, res) => {
  noStore(res);
  if (limited(`create:${clientIp(req)}`, 10, 3600_000)) return res.status(429).json({ error: "Too many new sessions from this address. Try again later." });
  const provider = getProvider(req.body?.provider);
  const key = String(req.body?.apiKey || "").trim();
  rememberSecret(key);
  if (!provider || !offered(provider)) return res.status(400).json({ error: "Pick a provider." });
  const localKey = !key && !provider.serverKeyOnly && isLocalRequest(req) && !!process.env[provider.envKey];
  if (!provider.serverKeyOnly && !localKey && !looksLikeKey(provider.id, key)) return res.status(400).json({ error: `That doesn't look like a ${provider.label} API key (expected ${provider.keyHint}).` });
  sweep();
  if (sessions.size >= MAX_SESSIONS) return res.status(503).json({ error: "The server is full right now. Try again later." });
  const { session, token } = provider.serverKeyOnly ? createSession({}, provider.id)
    : localKey ? createSession({ [LOCAL_KEYS]: true }, provider.id)
    : createSession({ [provider.id]: key });
  if (localKey) session.useLocalKeys();
  if (req.body?.solo === true) session.startSolo();
  console.log(`  + session ${session.code} created (${provider.id}${localKey ? ", this computer's key" : ""}${req.body?.solo === true ? ", no Warden" : ""})`);
  res.json({ code: session.code, token });
});

const sessionOf = (req) => sessions.get(normCode(req.params.code));
const wardenOf = (req) => {
  const s = sessionOf(req);
  return s?.checkToken(req.get("x-warden-token")) ? s : null;
};

async function sendWav(res, job, empty, what) {
  try {
    const clip = await job();
    const wav = Buffer.isBuffer(clip) ? clip : clip?.wav;
    if (!wav) return res.status(empty).end();
    if (clip.composed) res.set({ "X-Voice-Composed": "1", "X-Speech-Seconds": String(clip.seconds) });
    res.set("Content-Type", "audio/wav").send(wav);
  } catch (err) {
    console.error(`${what} failed:`, err?.message || err);
    res.status(500).end();
  }
}

router.get("/api/sessions/:code", (req, res) => {
  noStore(res);
  if (limited(`lookup:${clientIp(req)}`, 30, 60_000)) return res.status(429).json({ error: "Slow down." });
  const s = sessionOf(req);
  if (!s) return res.status(404).json({ error: "No session with that code." });
  res.json({ code: s.code, stationName: s.state.config.stationName });
});

router.post("/api/sessions/:code/tts-test", express.json({ limit: "20kb" }), async (req, res) => {
  noStore(res);
  const s = wardenOf(req);
  if (!s) return res.status(403).end();
  if (limited(`tts-test:${s.code}`, 30, 60_000)) return res.status(429).end();
  await sendWav(res, () => {
    const [voice] = sanitizeVoices([{ ...req.body?.voice, id: "test" }]).filter((v) => v.id === "test");
    return synthesize(String(req.body?.text || "Testing. One, two, three.").slice(0, 500), voice.voice);
  }, 204, "tts test");
});

router.get("/api/sessions/:code/tts/:id", async (req, res) => {
  noStore(res);
  const s = sessionOf(req);
  const entry = s?.state.log.find((e) => e.id === Number(req.params.id));
  if (!s || !s.speaksOnScreens() || !entry || entry.hidden || !SPOKEN_KINDS.has(entry.kind)) return res.status(404).end();
  const whole = req.query.v === undefined ? entry.text : entry.variants?.[Number(req.query.v)]?.text;
  const text = whole === undefined ? undefined : req.query.part === undefined ? whole : speechParts(whole)[Number(req.query.part)];
  if (text === undefined) return res.status(404).end();
  const c = s.state.config;
  await sendWav(res, () => s.speech.speak(text, speakingVoice(c, entry), entry.inPerson ? {} : voiceFor(c.voices, entry)?.fx || {}), 204, "tts");
});

router.post("/api/sessions/:code/spoken/:id", express.raw({ type: () => true, limit: 16 * 1024 * 1024 }), (req, res) => {
  noStore(res);
  const s = wardenOf(req);
  if (!s) return res.status(403).end();
  const wav = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  res.status(s.speech.receive(req.params.id, wav, Number(req.get("x-speech-seconds"))) ? 204 : 404).end();
});

router.get("/api/sessions/:code/handouts/:id/audio/:part", async (req, res) => {
  noStore(res);
  const s = sessionOf(req);
  if (!s) return res.status(404).end();
  if (limited(`logaudio:${clientIp(req)}`, 240, 60_000)) return res.status(429).end();
  await sendWav(res, () => s.handoutAudio(String(req.params.id), Number(req.params.part)), 404, "audio log");
});

router.post("/api/sessions/:code/sounds", express.raw({ type: () => true, limit: MAX_SOUND_BYTES + 1024 }), (req, res) => {
  noStore(res);
  const s = wardenOf(req);
  if (!s) return res.status(403).json({ error: "Not this session's Warden." });
  if (limited(`sound-up:${s.code}`, 60, 600_000)) return res.status(429).json({ error: "Too many uploads. Wait a few minutes." });
  try {
    const sound = saveSound(s.code, s.state.sounds, Buffer.isBuffer(req.body) ? req.body : null, req.query.name, req.query.seconds);
    s.addSound(sound);
    res.json(sound);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete("/api/sessions/:code/sounds/:id", (req, res) => {
  noStore(res);
  const s = wardenOf(req);
  if (!s) return res.status(403).end();
  const sound = s.removeSound(req.params.id);
  if (sound) deleteSoundFile(s.code, sound);
  res.status(sound ? 204 : 404).end();
});

router.get("/api/sessions/:code/sounds/:id", (req, res) => {
  const s = sessionOf(req);
  const sound = s?.state.sounds.find((x) => x.id === req.params.id);
  if (!sound) return res.status(404).end();
  res.set({ "Content-Type": sound.type, "Cache-Control": "private, max-age=604800, immutable" });
  res.sendFile(soundPath(s.code, sound), (err) => err && !res.headersSent && res.status(404).end());
});

router.post("/api/sessions/:code/portraits", express.raw({ type: () => true, limit: MAX_PORTRAIT_BYTES + 1024 }), (req, res) => {
  noStore(res);
  const s = wardenOf(req);
  if (!s) return res.status(403).json({ error: "Not this session's Warden." });
  if (limited(`portrait-up:${s.code}`, 60, 600_000)) return res.status(429).json({ error: "Too many uploads. Wait a few minutes." });
  try {
    res.json({ file: savePortrait(s.code, Buffer.isBuffer(req.body) ? req.body : null) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/api/sessions/:code/portraits/:file", (req, res) => {
  const s = sessionOf(req);
  const file = s && portraitPath(s.code, req.params.file);
  if (!file) return res.status(404).end();
  res.set({ "Content-Type": portraitType(req.params.file), "Cache-Control": "private, max-age=604800, immutable" });
  res.sendFile(file, (err) => err && !res.headersSent && res.status(404).end());
});

router.use((err, req, res, next) => {
  if (err?.type === "entity.too.large" && req.path.endsWith("/portraits")) return res.status(413).json({ error: "That picture is too big." });
  if (err?.type === "entity.too.large") return res.status(413).json({ error: `Sounds can be up to ${MAX_SOUND_BYTES / 1048576} MB each.` });
  next(err);
});

if (BASE) {
  app.use((req, res, next) => {
    const [p, q] = req.originalUrl.split("?");
    if (p === BASE) return res.redirect(301, `${BASE}/${q ? `?${q}` : ""}`);
    if (p === "/") return res.redirect(302, `${BASE}/`);
    next();
  });
}
app.use(BASE || "/", router);

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: `${BASE}/ws`, maxPayload: 256 * 1024 });

setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30_000).unref();

setInterval(() => {
  let activeSessions = 0, players = 0, wardens = 0;
  for (const s of sessions.values()) {
    if (s.sockets.size) activeSessions++;
    for (const w of s.sockets) w.role === "dm" ? wardens++ : players++;
  }
  gauge({ activeSessions, players, wardens, storedSessions: sessions.size });
}, 60_000).unref();

wss.on("connection", (ws, req) => {
  ws.isAlive = true;
  ws.on("pong", () => (ws.isAlive = true));
  const url = new URL(req.url, "http://x");
  const ip = clientIp(req);
  if (limited(`ws:${ip}`, 60, 60_000)) return ws.close(4029, "too many connections");
  const session = sessions.get(normCode(url.searchParams.get("s")));
  if (!session) return ws.close(4004, "no such session");
  const wantsDm = url.searchParams.get("role") === "dm";
  const wantsStream = !wantsDm && url.searchParams.has("stream");

  let joined = false;
  if (!wantsDm && !wantsStream) joined = session.attach(ws, "player", { terminal: url.searchParams.get("term") || "" });
  if (joined) track("PlayerJoined");
  const authTimer = wantsDm || wantsStream ? setTimeout(() => !joined && ws.close(4001, "auth timeout"), 10_000) : null;

  ws.on("message", (raw) => {
    if (limited(`msg:${ip}`, 240, 60_000)) return;
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    try {
      if (!joined) {
        if (msg.t !== "auth" || limited(`auth:${ip}`, 20, 600_000) || !(wantsStream ? session.checkStreamKey(msg.token) : session.checkToken(msg.token))) return ws.close(4003, "forbidden");
        clearTimeout(authTimer);
        joined = wantsStream ? session.attach(ws, "player", { stream: true }) : session.attach(ws, "dm");
        if (joined) track(wantsStream ? "StreamJoined" : "WardenJoined");
        return;
      }
      if (ws.role === "dm") session.handleDm(msg, ws);
      else session.handlePlayer(ws, msg);
    } catch (err) {
      console.error(`[${session.code}] handler error`, err);
    }
  });
});

process.on("unhandledRejection", (err) => console.error("unhandled:", err));

setCacheDir(path.join(DATA_DIR, "tts-cache"));
setSoundsDir(path.join(DATA_DIR, "sounds"));
setPortraitsDir(path.join(DATA_DIR, "portraits"));
warmNeural();
loadSessions();
sweep();
setInterval(sweep, 3600_000).unref();
const imported = importLegacyGame();
startDiscord((code) => sessions.get(code));

server.listen(PORT, "0.0.0.0", () => {
  const lan = Object.values(os.networkInterfaces()).flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal).map((i) => i.address);
  console.log(`\n  MOTHERSHIP TERMINAL online · ${sessions.size} saved session(s)\n`);
  console.log(`  Start or open a session (Warden):  http://localhost:${PORT}${BASE}/dm`);
  console.log(`  Players join at:                   http://localhost:${PORT}${BASE}/`);
  for (const ip of lan) console.log(`                                     http://${ip}:${PORT}${BASE}/`);
  if (imported) {
    console.log(`\n  Your previous game was imported as session ${imported.session.code}.`);
    console.log(`  Open its Warden console once with this link (it's remembered after that):`);
    console.log(`  http://localhost:${PORT}${BASE}/dm?s=${imported.session.code}#token=${imported.token}`);
    console.log(`  Then paste your API key under ⚙ Settings → LLM.`);
  }
  if (process.env.OPENROUTER_API_KEY) console.log("\n  Free models are on: sessions can use OpenRouter's free models with this server's key.");
  if (process.env.ALLOW_SERVER_KEYS === "1") console.log("\n  ! ALLOW_SERVER_KEYS=1: sessions without their own key will use this server's keys.");
  console.log("");
});
