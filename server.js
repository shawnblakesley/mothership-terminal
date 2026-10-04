import express from "express";
import http from "http";
import fs from "fs";
import crypto from "crypto";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer } from "ws";
import { synthesize, setCacheDir, warmNeural } from "./tts.js";
import { sanitizeVoices, voiceFor, speechParts } from "./voices.js";
import { getProvider, looksLikeKey, catalog } from "./providers/index.js";
import { Session, SPOKEN_KINDS, defaultGame, hashToken } from "./session.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
// Mount point, e.g. "/mothership" when served at shawnofthe.dev/mothership/. Empty = site root.
const BASE = (process.env.BASE_PATH || "").replace(/\/+$/, "").replace(/^(?!\/)(.)/, "/$1");
const DATA_DIR = process.env.DATA_DIR || path.join(here, "data");
const SESSIONS_DIR = path.join(DATA_DIR, "sessions");
const SESSION_TTL_DAYS = Number(process.env.SESSION_TTL_DAYS || 14);
const MAX_SESSIONS = Number(process.env.MAX_SESSIONS || 300);

// ---------------------------------------------------------------------------
// Sessions: many games at once, each with a join code and a Warden token.
// ---------------------------------------------------------------------------

const sessions = new Map(); // code -> Session
const saveTimers = new Map();

// No 0/O/1/I/L: codes get read out loud across a table.
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

function createSession(keys = {}) {
  const code = newCode();
  const token = crypto.randomBytes(24).toString("base64url");
  const session = addSession({ code, tokenHash: hashToken(token), game: defaultGame(keys) });
  Object.assign(session.keys, keys);
  scheduleSave(session);
  return { session, token };
}

function deleteSession(code) {
  const s = sessions.get(code);
  if (!s) return;
  s.close();
  sessions.delete(code);
  clearTimeout(saveTimers.get(code));
  fs.rmSync(path.join(SESSIONS_DIR, `${code}.json`), { force: true });
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

// Idle sessions expire so the server doesn't fill up.
function sweep() {
  const cutoff = Date.now() - SESSION_TTL_DAYS * 86400_000;
  for (const s of [...sessions.values()]) if (s.lastActive < cutoff && !s.sockets.size) deleteSession(s.code);
}

// Before sessions existed there was one game in data/state.json: keep it as a session.
function importLegacyGame() {
  const legacy = path.join(DATA_DIR, "state.json");
  if (!fs.existsSync(legacy)) return null;
  try {
    const game = JSON.parse(fs.readFileSync(legacy, "utf8"));
    const code = newCode();
    const token = crypto.randomBytes(24).toString("base64url");
    const session = addSession({ code, tokenHash: hashToken(token), game });
    scheduleSave(session);
    fs.renameSync(legacy, `${legacy}.imported`);
    return { session, token };
  } catch (err) {
    console.warn(`  ! Couldn't import data/state.json: ${err.message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Small per-IP rate limiter (the public internet will poke at this).
// ---------------------------------------------------------------------------

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

// The real client address, for rate limits. Behind CloudFront + Caddy, Caddy
// passes CloudFront's X-Forwarded-For through as X-CDN-Forwarded-For; CloudFront
// appends the viewer's IP as its LAST entry (earlier entries can be forged by the
// browser). The origin only accepts CloudFront traffic: see deploy/Caddyfile.
function clientIp(req) {
  const cdn = req.headers["x-cdn-forwarded-for"];
  if (cdn) return String(cdn).split(",").at(-1).trim();
  const cf = req.headers["cloudfront-viewer-address"];
  if (cf) return String(cf).replace(/:\d+$/, "");
  return req.socket.remoteAddress || "";
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

const app = express();
app.disable("x-powered-by");
app.use((_req, res, next) => {
  res.set({ "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" });
  next();
});

const router = express.Router();
const pub = path.join(here, "public");
const noStore = (res) => res.set("Cache-Control", "no-store");

router.get("/", (_req, res) => noStore(res).sendFile(path.join(pub, "player.html")));
router.get("/dm", (_req, res) => noStore(res).sendFile(path.join(pub, "dm.html")));
// "you" = the address rate limits use for this request (checks proxy setup).
router.get("/healthz", (req, res) => res.json({ ok: true, sessions: sessions.size, you: clientIp(req) }));
// Revalidate on every load (cheap with ETags) so players never run stale code after a deploy.
router.use(express.static(pub, { index: false, maxAge: 0 }));

// Providers and models for the "start a session" form (no keys involved).
router.get("/api/providers", (_req, res) => res.json(catalog().map(({ configured, ...p }) => p)));

// Start a session: the Warden brings their own API key (kept in memory only).
router.post("/api/sessions", express.json({ limit: "4kb" }), (req, res) => {
  noStore(res);
  if (limited(`create:${clientIp(req)}`, 10, 3600_000)) return res.status(429).json({ error: "Too many new sessions from this address. Try again later." });
  const provider = getProvider(req.body?.provider);
  const key = String(req.body?.apiKey || "").trim();
  if (!provider) return res.status(400).json({ error: "Pick a provider." });
  if (!looksLikeKey(provider.id, key)) return res.status(400).json({ error: `That doesn't look like a ${provider.label} API key (expected ${provider.keyHint}).` });
  sweep();
  if (sessions.size >= MAX_SESSIONS) return res.status(503).json({ error: "The server is full right now. Try again later." });
  const { session, token } = createSession({ [provider.id]: key });
  console.log(`  + session ${session.code} created (${provider.id})`);
  res.json({ code: session.code, token });
});

// Does a session exist? (The join screen checks codes before connecting.)
router.get("/api/sessions/:code", (req, res) => {
  noStore(res);
  if (limited(`lookup:${clientIp(req)}`, 30, 60_000)) return res.status(429).json({ error: "Slow down." });
  const s = sessions.get(normCode(req.params.code));
  if (!s) return res.status(404).json({ error: "No session with that code." });
  res.json({ code: s.code, stationName: s.state.config.stationName });
});

// Warden-only: hear a voice with any text (the "Test" button).
router.post("/api/sessions/:code/tts-test", express.json({ limit: "20kb" }), async (req, res) => {
  noStore(res);
  const s = sessions.get(normCode(req.params.code));
  if (!s || !s.checkToken(req.get("x-warden-token"))) return res.status(403).end();
  if (limited(`tts-test:${s.code}`, 30, 60_000)) return res.status(429).end();
  try {
    // The id goes last: the console sends the whole voice, whose own id must not win.
    const [voice] = sanitizeVoices([{ ...req.body?.voice, id: "test" }]).filter((v) => v.id === "test");
    const wav = await synthesize(String(req.body?.text || "Testing. One, two, three.").slice(0, 500), voice.voice);
    if (!wav) return res.status(204).end();
    res.set("Content-Type", "audio/wav").send(wav);
  } catch (err) {
    console.error("tts test failed:", err?.message || err);
    res.status(500).end();
  }
});

// Spoken audio for a log line players can already see (so it can't read
// arbitrary text, Warden notes or commands).
router.get("/api/sessions/:code/tts/:id", async (req, res) => {
  noStore(res);
  const s = sessions.get(normCode(req.params.code));
  const entry = s?.state.log.find((e) => e.id === Number(req.params.id));
  if (!s || !s.state.config.tts || !entry || entry.hidden || !SPOKEN_KINDS.has(entry.kind)) return res.status(404).end();
  try {
    // ?part=N: just that text line (human voices are fetched line by line so speech starts sooner).
    const text = req.query.part === undefined ? entry.text : speechParts(entry.text)[Number(req.query.part)];
    if (text === undefined) return res.status(404).end();
    const wav = await synthesize(text, voiceFor(s.state.config.voices, entry).voice);
    if (!wav) return res.status(204).end();
    res.set("Content-Type", "audio/wav").send(wav);
  } catch (err) {
    console.error("tts failed:", err?.message || err);
    res.status(500).end();
  }
});

if (BASE) {
  // "/mothership" -> "/mothership/" so the pages' relative links resolve under the mount point.
  app.use((req, res, next) => {
    const [p, q] = req.originalUrl.split("?");
    if (p === BASE) return res.redirect(301, `${BASE}/${q ? `?${q}` : ""}`);
    if (p === "/") return res.redirect(302, `${BASE}/`);
    next();
  });
}
app.use(BASE || "/", router);

// ---------------------------------------------------------------------------
// WebSockets: players join by code; Wardens also prove their token, sent as
// the first message (not in the URL, so it never lands in access logs).
// ---------------------------------------------------------------------------

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: `${BASE}/ws`, maxPayload: 256 * 1024 });

// Heartbeat: keeps quiet connections open through CloudFront and proxies (which
// drop idle WebSockets) and clears out ones whose client vanished.
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30_000).unref();

wss.on("connection", (ws, req) => {
  ws.isAlive = true;
  ws.on("pong", () => (ws.isAlive = true));
  const url = new URL(req.url, "http://x");
  const ip = clientIp(req);
  if (limited(`ws:${ip}`, 60, 60_000)) return ws.close(4029, "too many connections");
  const session = sessions.get(normCode(url.searchParams.get("s")));
  if (!session) return ws.close(4004, "no such session");
  const wantsDm = url.searchParams.get("role") === "dm";

  let joined = false;
  if (!wantsDm) joined = session.attach(ws, "player");
  const authTimer = wantsDm ? setTimeout(() => !joined && ws.close(4001, "auth timeout"), 10_000) : null;

  ws.on("message", (raw) => {
    if (limited(`msg:${ip}`, 240, 60_000)) return;
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    try {
      if (!joined) {
        // Warden handshake: { t: "auth", token }
        if (msg.t !== "auth" || limited(`auth:${ip}`, 20, 600_000) || !session.checkToken(msg.token)) return ws.close(4003, "forbidden");
        clearTimeout(authTimer);
        joined = session.attach(ws, "dm");
        return;
      }
      if (ws.role === "dm") session.handleDm(msg);
      else session.handlePlayer(ws, msg);
    } catch (err) {
      console.error(`[${session.code}] handler error`, err);
    }
  });
});

// ---------------------------------------------------------------------------

// Never let one bad request take every game down.
process.on("unhandledRejection", (err) => console.error("unhandled:", err));

setCacheDir(path.join(DATA_DIR, "tts-cache"));
// Every new session has a human-voiced intercom, so load + warm the model now, not on the first line.
warmNeural();
loadSessions();
sweep();
setInterval(sweep, 3600_000).unref();
const imported = importLegacyGame();

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
    console.log(`  Then paste your API key under "Agent".`);
  }
  if (process.env.ALLOW_SERVER_KEYS === "1") console.log("\n  ! ALLOW_SERVER_KEYS=1: sessions without their own key will use this server's keys.");
  console.log("");
});
