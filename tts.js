import { createRequire } from "module";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import readline from "readline";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { EMOTIONS, VOCAL_EVENTS } from "./voices.js";

const require = createRequire(import.meta.url);
let meSpeak = null;

function engine() {
  if (!meSpeak) {
    meSpeak = require("mespeak");
    meSpeak.loadConfig(require("mespeak/src/mespeak_config.json"));
    meSpeak.loadVoice(require("mespeak/voices/en/en-us.json"));
  }
  return meSpeak;
}

const MAX_CHARS = 600;

export function speakable(text) {
  let t = String(text)
    .replace(/[─-▟■-◿]/g, " ")
    .replace(/([=\-_*#~.+|])\1{2,}/g, " ")
    .replace(/[|<>\[\]{}\\^`~*#=_]/g, " ")
    .replace(/\s*\n+\s*/g, (m) => (m.includes("\n\n") ? ". " : ", "))
    .replace(/\s+/g, " ")
    .replace(/(,\s*)+([.!?])/g, "$2")
    .replace(/([.!?:])(\s*[,.])+/g, "$1")
    .trim()
    .toLowerCase();
  if (t.length > MAX_CHARS) {
    const cut = t.slice(0, MAX_CHARS);
    const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf(", "));
    t = (end > MAX_CHARS * 0.5 ? cut.slice(0, end) : cut) + ". end of excerpt.";
  }
  return t;
}

const KOKORO_MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
const TTS_DTYPE = process.env.TTS_DTYPE || "fp32";
const TTS_THREADS = Number(process.env.TTS_THREADS) || os.cpus().length;
let kokoro = null;
let neuralQueue = Promise.resolve();

function neural() {
  kokoro ??= (async () => {
    const [{ KokoroTTS }, { StyleTextToSpeech2Model, AutoTokenizer }] = await Promise.all([import("kokoro-js"), import("@huggingface/transformers")]);
    const [model, tokenizer] = await Promise.all([
      StyleTextToSpeech2Model.from_pretrained(KOKORO_MODEL, {
        dtype: TTS_DTYPE,
        device: "cpu",
        session_options: { intraOpNumThreads: TTS_THREADS, interOpNumThreads: 1 },
      }),
      AutoTokenizer.from_pretrained(KOKORO_MODEL),
    ]);
    const tts = new KokoroTTS(model, tokenizer);
    await tts.generate("Ready.", { voice: "am_michael" });
    return tts;
  })().catch((err) => {
    kokoro = null;
    throw err;
  });
  return kokoro;
}

export function warmNeural() {
  if (kokoro) return;
  const t = Date.now();
  neural()
    .then(() => console.log(`  Human voice model ready (${TTS_DTYPE}, ${TTS_THREADS} threads, ${((Date.now() - t) / 1000).toFixed(1)}s)`))
    .catch((err) => console.warn(`  ! Human voice model failed to load (${err.message}); those voices will use eSpeak.`));
}

const sentenceCase = (t) => t.replace(/(^|[.!?]\s+)([a-z])/g, (_, a, b) => a + b.toUpperCase());

function runNeural(say, { speaker, pace }) {
  const job = neuralQueue.then(async () => {
    const tts = await neural();
    const audio = await tts.generate(sentenceCase(say), { voice: speaker, speed: pace });
    return Buffer.from(audio.toWav());
  });
  neuralQueue = job.catch(() => {});
  return job;
}

// Kitten TTS 2 (Python, github.com/KittenML/KittenTTS) runs in a sidecar: scripts/kitten_tts.py, one JSON line each way.
const KITTEN_PYTHON = process.env.KITTEN_PYTHON || "python";
const KITTEN_SCRIPT = fileURLToPath(new URL("./scripts/kitten_tts.py", import.meta.url));
const KITTEN_TIMEOUT_MS = 90000;
const KITTEN_RETRY_MS = 60000;
let kitten = null;
let kittenRetryAt = 0;

function kittenSidecar() {
  if (kitten || Date.now() < kittenRetryAt) return kitten;
  const t = Date.now();
  // -X utf8: kittenml opens its JSON files without an encoding, which fails on Windows code pages
  const proc = spawn(KITTEN_PYTHON, ["-X", "utf8", KITTEN_SCRIPT], { stdio: ["pipe", "pipe", "inherit"], windowsHide: true });
  const k = (kitten = { proc, jobs: new Map(), next: 0, ready: false });
  readline.createInterface({ input: proc.stdout }).on("line", (line) => {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    if (msg.ready) {
      k.ready = true;
      return console.log(`  Kitten TTS 2 ready (${((Date.now() - t) / 1000).toFixed(1)}s)`);
    }
    const job = k.jobs.get(msg.id);
    if (!job) return;
    k.jobs.delete(msg.id);
    clearTimeout(job.timer);
    if (msg.wav) job.resolve(Buffer.from(msg.wav, "base64"));
    else job.reject(new Error(msg.error || "no audio"));
  });
  const down = (err) => {
    if (kitten !== k) return;
    kitten = null;
    kittenRetryAt = Date.now() + KITTEN_RETRY_MS;
    console.warn(`  ! Kitten TTS 2 stopped (${err.message}); its voices use eSpeak until it restarts. It needs a Python with kittenml and soundfile: set KITTEN_PYTHON to it (now "${KITTEN_PYTHON}").`);
    for (const job of k.jobs.values()) { clearTimeout(job.timer); job.reject(err); }
  };
  proc.on("error", down);
  proc.on("exit", (code) => down(new Error(`exit code ${code}`)));
  proc.stdin.on("error", () => {});
  return k;
}

export function warmKitten() {
  kittenSidecar();
}

// Fails at once while the model is still loading (the first run downloads it), so lines fall back to eSpeak instead of waiting.
function runKitten(say, { voice }) {
  const k = kittenSidecar();
  if (!k?.ready) return Promise.reject(new Error(k ? "still loading" : "not running"));
  const id = ++k.next;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { k.jobs.delete(id); reject(new Error("timed out")); }, KITTEN_TIMEOUT_MS);
    k.jobs.set(id, { resolve, reject, timer });
    k.proc.stdin.write(`${JSON.stringify({ id, text: say, voice })}\n`);
  });
}

// speakable() strips brackets and lowercases; Kitten's tags are kept through it, and sentences get their capitals back.
const KITTEN_TAG = new RegExp(`\\[(?:${EMOTIONS.join("|")})\\]|<(?:${VOCAL_EVENTS.join("|")})>`, "gi");
export function kittenSpeakable(text) {
  const tags = [];
  const hidden = String(text).replace(KITTEN_TAG, (t) => ` \u0001${tags.push(t.toLowerCase()) - 1}\u0002 `);
  return speakable(hidden)
    .replace(/(^|[.!?]\s+)((?:\u0001\d+\u0002\s*)*)([a-z])/g, (_, a, t, b) => a + t + b.toUpperCase())
    .replace(/\u0001(\d+)\u0002/g, (_, i) => tags[i]);
}

const MEM_CACHE_BYTES = 64 * 1024 * 1024;
const DISK_CACHE_BYTES = (Number(process.env.TTS_CACHE_MB) || 200) * 1024 * 1024;
const cache = new Map();
let memBytes = 0;
let diskDir = null;
let diskWrites = 0;

export function setCacheDir(dir) {
  diskDir = dir;
  fs.mkdirSync(diskDir, { recursive: true });
}

function remember(key, job) {
  const entry = { job, bytes: 0 };
  cache.set(key, entry);
  job.then((buf) => {
    if (!buf) return cache.delete(key);
    entry.bytes = buf.length;
    memBytes += buf.length;
    for (const [k, e] of cache) {
      if (memBytes <= MEM_CACHE_BYTES) break;
      if (k === key) continue;
      cache.delete(k);
      memBytes -= e.bytes;
    }
  }, () => cache.delete(key));
}

const diskPath = (key) => path.join(diskDir, `${crypto.createHash("sha256").update(key).digest("hex").slice(0, 40)}.wav`);

function readDisk(key) {
  if (!diskDir) return null;
  try {
    const p = diskPath(key);
    const buf = fs.readFileSync(p);
    fs.utimesSync(p, new Date(), new Date());
    return buf;
  } catch {
    return null;
  }
}

function writeDisk(key, buf) {
  if (!diskDir || !buf) return;
  fs.promises.writeFile(diskPath(key), buf).catch(() => {});
  if (++diskWrites % 25 === 0) pruneDisk();
}

function pruneDisk() {
  try {
    const files = fs.readdirSync(diskDir).map((f) => {
      const st = fs.statSync(path.join(diskDir, f));
      return { f, size: st.size, t: st.mtimeMs };
    }).sort((a, b) => a.t - b.t);
    let total = files.reduce((n, x) => n + x.size, 0);
    for (const x of files) {
      if (total <= DISK_CACHE_BYTES) break;
      fs.rmSync(path.join(diskDir, x.f), { force: true });
      total -= x.size;
    }
  } catch {}
}

export function wavSeconds(buf) {
  if (!buf || buf.length < 44 || buf.toString("latin1", 0, 4) !== "RIFF") return 0;
  let p = 12, byteRate = 0;
  while (p + 8 <= buf.length) {
    const id = buf.toString("latin1", p, p + 4), size = buf.readUInt32LE(p + 4);
    if (id === "fmt ") byteRate = buf.readUInt32LE(p + 16);
    if (id === "data") {
      const rest = buf.length - p - 8;
      return byteRate ? (size && size <= rest ? size : rest) / byteRate : 0;
    }
    p += 8 + size + (size & 1);
  }
  return 0;
}

export function prepare(text, voice) {
  const kittenVoice = voice.engine === "kitten";
  const say = kittenVoice ? kittenSpeakable(text) : speakable(text);
  if (!say.replace(KITTEN_TAG, "").trim()) return null;
  const neural = voice.engine === "neural";
  const opts = kittenVoice ? { engine: "kitten", voice: voice.kitten || "Bruno" }
    : neural ? { engine: "neural", speaker: voice.speaker, pace: voice.pace }
    : { pitch: voice.pitch, speed: voice.speed, wordgap: voice.wordgap, ...(voice.variant ? { variant: voice.variant } : {}) };
  return { say, neural, kitten: kittenVoice, opts, text: neural ? sentenceCase(say) : say, key: `${JSON.stringify(opts)}|${say}` };
}

export function synthesize(text, voice) {
  const prep = prepare(text, voice);
  if (!prep) return Promise.resolve(null);
  const { say, opts, key } = prep, isNeural = prep.neural || prep.kitten;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit.job;
  }
  const espeak = () => engine().speak(prep.kitten ? speakable(say.replace(KITTEN_TAG, " ")) : say, { ...(isNeural ? {} : opts), rawdata: "buffer" }) || null;
  let job;
  if (!isNeural) {
    job = Promise.resolve().then(espeak);
  } else {
    const fromDisk = readDisk(key);
    job = fromDisk
      ? Promise.resolve(fromDisk)
      : (prep.kitten ? runKitten(say, opts) : runNeural(say, opts)).then(
          (buf) => { writeDisk(key, buf); return buf; },
          (err) => {
            console.warn(`${prep.kitten ? "Kitten" : "human"} voice failed (${err.message}); falling back to eSpeak`);
            if (prep.kitten) queueMicrotask(() => cache.delete(key)); // try Kitten again next time; it may have finished loading
            return espeak();
          },
        );
  }
  remember(key, job);
  return job;
}
