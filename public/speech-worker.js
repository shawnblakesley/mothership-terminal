const MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
const status = { espeak: false, neural: false };
let espeak = null, kokoro = null, queue = Promise.resolve();

const report = () => postMessage({ status: { ...status } });

async function loadCommonJs(url, require) {
  const src = await (await fetch(url)).text();
  const module = { exports: {} };
  new Function("module", "exports", "require", src)(module, module.exports, require);
  return module.exports;
}

async function startEspeak() {
  const ESpeak = await loadCommonJs("vendor/mespeak/src/ESpeak.js");
  const meSpeak = await loadCommonJs("vendor/mespeak/src/index.js", () => ESpeak);
  const [config, voice] = await Promise.all(["vendor/mespeak/src/mespeak_config.json", "vendor/mespeak/voices/en/en-us.json"].map((u) => fetch(u).then((r) => r.json())));
  meSpeak.loadConfig(config);
  meSpeak.loadVoice(voice);
  espeak = meSpeak;
  status.espeak = true;
  report();
}

function soundsLikeSpeech(samples, sampleRate, { gaps = false } = {}) {
  if (!samples?.length) return false;
  let sum = 0, crossings = 0;
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i];
    if (!Number.isFinite(x)) return false;
    sum += x * x;
    if (i && (samples[i - 1] < 0) !== (x < 0)) crossings++;
  }
  const rms = Math.sqrt(sum / samples.length), zcr = crossings / samples.length;
  if (rms < 0.003 || zcr > 0.32) return false;
  if (!gaps) return true;
  const frame = Math.round(sampleRate * 0.02), levels = [];
  for (let i = 0; i + frame <= samples.length; i += frame) {
    let e = 0;
    for (let j = i; j < i + frame; j++) e += samples[j] * samples[j];
    levels.push(Math.sqrt(e / frame));
  }
  const loudest = Math.max(...levels);
  return levels.filter((l) => l < loudest * 0.1).length / levels.length > 0.08;
}

async function startKokoro() {
  const { KokoroTTS } = await import("./vendor/kokoro/kokoro.web.js");
  const gpu = await navigator.gpu?.requestAdapter().catch(() => null);
  const tries = [...(gpu ? [{ dtype: "fp32", device: "webgpu" }] : []), { dtype: "q8", device: "wasm" }];
  for (const how of tries) {
    try {
      const tts = await KokoroTTS.from_pretrained(MODEL, how);
      const test = await tts.generate("Testing the station intercom. One, two, three.", { voice: "am_michael" });
      if (!soundsLikeSpeech(test.audio, test.sampling_rate, { gaps: true })) throw new Error("its test sentence came out as noise");
      kokoro = tts;
      status.neural = true;
      report();
      return;
    } catch (err) {
      console.warn(`Human voices on ${how.device} (${how.dtype}) failed: ${err.message}`);
    }
  }
  throw new Error("no way to run them here that sounds right; the server makes them");
}

async function speak({ engine, text, opts }) {
  if (engine === "neural") {
    if (!kokoro) throw new Error("human voices not loaded");
    const audio = await kokoro.generate(text, { voice: opts.speaker, speed: opts.pace });
    if (!soundsLikeSpeech(audio.audio, audio.sampling_rate)) throw new Error("that line came out as noise");
    return audio.toWav();
  }
  if (!espeak) throw new Error("eSpeak not loaded");
  const bytes = espeak.speak(text, { ...opts, rawdata: "array" });
  if (!bytes) throw new Error("eSpeak made nothing");
  return Uint8Array.from(bytes).buffer;
}

onmessage = ({ data }) => {
  if (data.start) {
    startEspeak().catch((err) => console.warn(`eSpeak failed to load: ${err.message}`));
    startKokoro().catch((err) => {
      console.warn(`Human voices failed to load: ${err.message}`);
      status.neuralFailed = true;
      report();
    });
    return;
  }
  queue = queue.then(() => speak(data).then(
    (wav) => postMessage({ id: data.id, wav }, [wav]),
    (err) => postMessage({ id: data.id, error: String(err?.message || err) }),
  ));
};
