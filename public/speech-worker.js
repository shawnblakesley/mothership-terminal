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

async function startKokoro() {
  const { KokoroTTS } = await import("./vendor/kokoro/kokoro.web.js");
  const gpu = await navigator.gpu?.requestAdapter().catch(() => null);
  const tts = await KokoroTTS.from_pretrained(MODEL, gpu ? { dtype: "fp32", device: "webgpu" } : { dtype: "q8", device: "wasm" });
  await tts.generate("Ready.", { voice: "am_michael" });
  kokoro = tts;
  status.neural = true;
  report();
}

async function speak({ engine, text, opts }) {
  if (engine === "neural") {
    if (!kokoro) throw new Error("human voices not loaded");
    return (await kokoro.generate(text, { voice: opts.speaker, speed: opts.pace })).toWav();
  }
  if (!espeak) throw new Error("eSpeak not loaded");
  const bytes = espeak.speak(text, { ...opts, rawdata: "array" });
  if (!bytes) throw new Error("eSpeak made nothing");
  return Uint8Array.from(bytes).buffer;
}

onmessage = ({ data }) => {
  if (data.start) {
    startEspeak().catch((err) => console.warn(`eSpeak failed to load: ${err.message}`));
    startKokoro().catch((err) => console.warn(`Human voices failed to load: ${err.message}`));
    return;
  }
  queue = queue.then(() => speak(data).then(
    (wav) => postMessage({ id: data.id, wav }, [wav]),
    (err) => postMessage({ id: data.id, error: String(err?.message || err) }),
  ));
};
