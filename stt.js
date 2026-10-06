// Server-side speech-to-text for the Warden's Listen, in browsers without their
// own speech recognition (Firefox). Whisper, a small open model run locally like
// the Kokoro voices (no key, no cost). The console finds the phrases (it cuts at
// pauses) and sends each one as 16 kHz mono 16-bit PCM; we return its text.
// The model downloads once on first use and is cached under
// node_modules/@huggingface/transformers/.cache.
//   STT_MODEL   default Xenova/whisper-base.en (Xenova/whisper-tiny.en: smaller, faster, less accurate)
//   STT_DTYPE   fp32 (default; fastest on CPUs, as with the voices) | q8 (smallest)
//   STT_THREADS CPU threads for the model (default: all cores)
// Calls are queued one at a time.
import os from "os";

const STT_MODEL = process.env.STT_MODEL || "Xenova/whisper-base.en";
const STT_DTYPE = process.env.STT_DTYPE || "fp32";
const STT_THREADS = Number(process.env.STT_THREADS) || os.cpus().length;
export const STT_RATE = 16000;
export const MAX_PHRASE_SECONDS = 30;

let asr = null; // Promise<pipeline>
let queue = Promise.resolve();

function model() {
  asr ??= (async () => {
    const t = Date.now();
    const { pipeline } = await import("@huggingface/transformers");
    const p = await pipeline("automatic-speech-recognition", STT_MODEL, {
      dtype: STT_DTYPE,
      device: "cpu",
      session_options: { intraOpNumThreads: STT_THREADS, interOpNumThreads: 1 },
    });
    console.log(`  Speech-to-text model ready (${STT_MODEL}, ${STT_DTYPE}, ${((Date.now() - t) / 1000).toFixed(1)}s)`);
    return p;
  })().catch((err) => {
    asr = null; // allow a retry later
    throw err;
  });
  return asr;
}

// What Whisper "hears" in silence or noise, and its sound labels: not speech.
const NOT_SPEECH = /^(thank you|thanks for watching|you|bye|okay|so)\.?$/i;
export function cleanTranscript(text) {
  const t = String(text || "")
    .replace(/\[[^\]]*\]|\([^)]*\)|\*[^*]*\*/g, " ") // [BLANK_AUDIO], (music), *coughs*
    .replace(/\s+/g, " ")
    .trim();
  return /[a-z0-9]/i.test(t) && !NOT_SPEECH.test(t) ? t : "";
}

// Start loading the model (Listen was switched on), so the first phrase isn't slow.
export function warmStt() {
  model().catch((err) => console.warn(`  ! Speech-to-text model failed to load (${err.message}).`));
}

// pcm: a Buffer of little-endian 16-bit samples at 16 kHz.
export function transcribe(pcm) {
  const job = queue.then(async () => {
    const n = Math.min(pcm.length >> 1, STT_RATE * MAX_PHRASE_SECONDS);
    const audio = new Float32Array(n);
    for (let i = 0; i < n; i++) audio[i] = pcm.readInt16LE(i * 2) / 32768;
    const out = await (await model())(audio);
    return cleanTranscript(out?.text);
  });
  queue = job.catch(() => {});
  return job;
}
