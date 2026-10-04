// Server-side speech synthesis. Two engines, both local and free:
//   eSpeak (via meSpeak): instant, synthetic; great for machines and monsters.
//   Kokoro (neural): human-sounding; for intercoms, people on comms, etc.
// Both return a dry WAV; the player's browser adds each voice's effects with Web Audio.
import { createRequire } from "module";

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
// (no key, no cost). The ~90 MB model downloads once on first use and is
// cached under node_modules/@huggingface/transformers/.cache.
// It runs at roughly real time on a CPU, so calls are queued one at a time.
// ---------------------------------------------------------------------------

const KOKORO_MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
let kokoro = null; // Promise<KokoroTTS>
let neuralQueue = Promise.resolve();

function neural() {
  kokoro ??= import("kokoro-js")
    .then(({ KokoroTTS }) => KokoroTTS.from_pretrained(KOKORO_MODEL, { dtype: "q8", device: "cpu" }))
    .catch((err) => {
      kokoro = null; // allow a retry later
      throw err;
    });
  return kokoro;
}

// Load the model in the background so the first human line isn't slower.
export function warmNeural() {
  if (kokoro) return; // already loaded or loading
  const t = Date.now();
  neural()
    .then(() => console.log(`  Human voice model ready (${((Date.now() - t) / 1000).toFixed(1)}s)`))
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

const cache = new Map(); // key -> Promise<Buffer> (small LRU; also dedupes concurrent requests)

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
  if (cache.has(key)) {
    const hit = cache.get(key);
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const espeak = () => engine().speak(say, { ...(isNeural ? {} : opts), rawdata: "buffer" }) || null;
  const job = isNeural
    ? runNeural(say, opts).catch((err) => {
        console.warn(`human voice failed (${err.message}); falling back to eSpeak`);
        return espeak();
      })
    : Promise.resolve().then(espeak);
  cache.set(key, job);
  job.then((buf) => { if (!buf) cache.delete(key); }, () => cache.delete(key));
  if (cache.size > 60) cache.delete(cache.keys().next().value);
  return job;
}
