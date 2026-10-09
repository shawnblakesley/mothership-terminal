(() => {
  const RATE = 24000;
  let worker = null, ready = { espeak: false, neural: false }, next = 0;
  const waiting = new Map();

  function start(onChange) {
    if (worker) return;
    worker = new Worker("speech-worker.js", { type: "module" });
    worker.onmessage = ({ data }) => {
      if (data.status) { ready = data.status; onChange(ready); return; }
      waiting.get(data.id)?.(data);
      waiting.delete(data.id);
    };
    worker.postMessage({ start: true });
  }

  function stop() {
    worker?.terminate();
    worker = null;
    ready = { espeak: false, neural: false };
    for (const done of waiting.values()) done({ error: "stopped" });
    waiting.clear();
  }

  const raw = (engine, text, opts) => new Promise((resolve, reject) => {
    if (!worker) return reject(new Error("not started"));
    const id = ++next;
    waiting.set(id, (d) => (d.wav ? resolve(d.wav) : reject(new Error(d.error))));
    worker.postMessage({ id, engine, text, opts });
  });

  async function make(engine, text, opts, fx) {
    const decoded = await new OfflineAudioContext(1, 1, RATE).decodeAudioData(await raw(engine, text, opts));
    const { buffer, seconds } = await Voice.compose(decoded, fx);
    return { wav: encodeWav(buffer), seconds };
  }

  function encodeWav(b) {
    const channels = b.numberOfChannels, frames = b.length, bytes = frames * channels * 2;
    const view = new DataView(new ArrayBuffer(44 + bytes));
    const text = (o, s) => [...s].forEach((ch, i) => view.setUint8(o + i, ch.charCodeAt(0)));
    text(0, "RIFF"); view.setUint32(4, 36 + bytes, true); text(8, "WAVE");
    text(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
    view.setUint32(24, b.sampleRate, true); view.setUint32(28, b.sampleRate * channels * 2, true); view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true);
    text(36, "data"); view.setUint32(40, bytes, true);
    const data = [...Array(channels)].map((_, ch) => b.getChannelData(ch));
    for (let i = 0, o = 44; i < frames; i++) {
      for (let ch = 0; ch < channels; ch++, o += 2) view.setInt16(o, Math.max(-32768, Math.min(32767, Math.round(data[ch][i] * 32767))), true);
    }
    return view.buffer;
  }

  window.Speech = { start, stop, make, get ready() { return ready; } };
})();
