// Server-side speech synthesis. Two engines, both local and free:
//   eSpeak (via meSpeak): instant, synthetic; great for machines and monsters.
//   Kokoro (neural): human-sounding; for intercoms, people on comms, etc.
// Both return a dry WAV; the player's browser adds each voice's effects with Web Audio.
import { createRequire } from "module";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

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

// Turn terminal output (ASCII tables, separators, ALL CAPS) into something
// eSpeak reads naturally.
export function speakable(text) {
  let t = String(text)
    .replace(/[─-▟■-◿]/g, " ") // box drawing, blocks, geometric glyphs
    .replace(/([=\-_*#~.+|])\1{2,}/g, " ") // runs like ===== or ......
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

// ---------------------------------------------------------------------------
// Human-sounding voices: Kokoro, a small open neural TTS model run locally
// (no key, no cost). The model downloads once on first use and is cached under
// node_modules/@huggingface/transformers/.cache.
//
// Speed: full precision (fp32) runs ~4x faster on CPUs than the 8-bit model,
// which has to be de-quantised as it goes (measured: 0.24x vs 0.96x real time
// on a desktop, 0.83x vs 1.74x on a 2-vCPU server). It costs ~300 MB more RAM.
//   TTS_DTYPE   fp32 (default) | fp16 | q8 (smallest, slowest)
//   TTS_THREADS CPU threads for the model (default: all cores)
// Calls are queued one at a time; a warm-up run happens at load.
// ---------------------------------------------------------------------------

const KOKORO_MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
const TTS_DTYPE = process.env.TTS_DTYPE || "fp32";
const TTS_THREADS = Number(process.env.TTS_THREADS) || os.cpus().length;
let kokoro = null; // Promise<KokoroTTS>
let neuralQueue = Promise.resolve();

function neural() {
  kokoro ??= (async () => {
    const [{ KokoroTTS }, { StyleTextToSpeech2Model, AutoTokenizer }] = await Promise.all([import("kokoro-js"), import("@huggingface/transformers")]);
    // Built by hand (not KokoroTTS.from_pretrained) so the CPU thread count can be set.
    const [model, tokenizer] = await Promise.all([
      StyleTextToSpeech2Model.from_pretrained(KOKORO_MODEL, {
        dtype: TTS_DTYPE,
        device: "cpu",
        session_options: { intraOpNumThreads: TTS_THREADS, interOpNumThreads: 1 },
      }),
      AutoTokenizer.from_pretrained(KOKORO_MODEL),
    ]);
    const tts = new KokoroTTS(model, tokenizer);
    await tts.generate("Ready.", { voice: "am_michael" }); // the first run is slow; get it out of the way
    return tts;
  })().catch((err) => {
    kokoro = null; // allow a retry later
    throw err;
  });
  return kokoro;
}

// Load (and warm up) the model in the background so the first human line isn't slower.
export function warmNeural() {
  if (kokoro) return; // already loaded or loading
  const t = Date.now();
  neural()
    .then(() => console.log(`  Human voice model ready (${TTS_DTYPE}, ${TTS_THREADS} threads, ${((Date.now() - t) / 1000).toFixed(1)}s)`))
    .catch((err) => console.warn(`  ! Human voice model failed to load (${err.message}); those voices will use eSpeak.`));
}

// Kokoro reads lowercase text more naturally than ALL CAPS, but likes sentence case.
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

// ---------------------------------------------------------------------------
// Caching. Memory: recent clips (also dedupes simultaneous requests, e.g. a
// pre-generated line and the players' fetch of it). Disk: human-voice clips
// survive restarts, so repeated lines (announcements, tests) are instant.
// ---------------------------------------------------------------------------

const MEM_CACHE_BYTES = 64 * 1024 * 1024;
const DISK_CACHE_BYTES = (Number(process.env.TTS_CACHE_MB) || 200) * 1024 * 1024;
const cache = new Map(); // key -> { job: Promise<Buffer|null>, bytes }
let memBytes = 0;
let diskDir = null;
let diskWrites = 0;

// Called by the server with its data directory.
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
    fs.utimesSync(p, new Date(), new Date()); // mark as recently used
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

// Keep the disk cache under its size cap, dropping the least recently used clips.
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

// Length of a WAV clip in seconds (0 if it can't be read).
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

// `voice` is a base-voice object from voices.js:
//   { engine: "espeak", variant, pitch, speed, wordgap }  synthetic
//   { engine: "neural", speaker, pace }                   human-sounding (Kokoro)
// The browser-side effect chain (public/voice.js) adds the character either way.
export function synthesize(text, voice) {
  const say = speakable(text);
  if (!say) return Promise.resolve(null);
  const isNeural = voice.engine === "neural";
  const opts = isNeural
    ? { engine: "neural", speaker: voice.speaker, pace: voice.pace }
    : { pitch: voice.pitch, speed: voice.speed, wordgap: voice.wordgap, ...(voice.variant ? { variant: voice.variant } : {}) };
  const key = `${JSON.stringify(opts)}|${say}`;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key); // move to most-recent
    cache.set(key, hit);
    return hit.job;
  }
  const espeak = () => engine().speak(say, { ...(isNeural ? {} : opts), rawdata: "buffer" }) || null;
  let job;
  if (!isNeural) {
    job = Promise.resolve().then(espeak);
  } else {
    const fromDisk = readDisk(key);
    job = fromDisk
      ? Promise.resolve(fromDisk)
      : runNeural(say, opts).then(
          (buf) => { writeDisk(key, buf); return buf; },
          (err) => {
            console.warn(`human voice failed (${err.message}); falling back to eSpeak`);
            return espeak();
          },
        );
  }
  remember(key, job);
  return job;
}
