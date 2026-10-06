// Listen, for browsers without their own speech recognition (Firefox): record
// the microphone, cut it into phrases at the pauses, and hand each phrase over
// as 16 kHz mono 16-bit PCM (the server's Whisper writes it down; see stt.js).
//
//   const rec = await PhraseRecorder.start({ onPhrase(pcm), onSpeaking(bool) });
//   rec.stop();
(function () {
  const RATE = 16000;
  const END_SILENCE_MS = 800; // a pause this long ends the phrase
  const MIN_SPEECH_MS = 250; // shorter blips (a cough, a click) are dropped
  const MAX_PHRASE_MS = 25000; // a phrase this long is sent anyway
  const PREROLL_MS = 350; // kept from just before the voice started (its first sound)

  // Passes the microphone's samples to the page in blocks of ~2048.
  const WORKLET = `registerProcessor("tap", class extends AudioWorkletProcessor {
    constructor() { super(); this.buf = new Float32Array(2048); this.n = 0; }
    process(inputs) {
      const ch = inputs[0][0];
      if (ch) for (let i = 0; i < ch.length; i++) {
        this.buf[this.n++] = ch[i];
        if (this.n === this.buf.length) { this.port.postMessage(this.buf.slice()); this.n = 0; }
      }
      return true;
    }
  });`;

  // Average down to 16 kHz, as 16-bit samples.
  function toPcm16(blocks, rate) {
    const total = blocks.reduce((n, b) => n + b.length, 0);
    const all = new Float32Array(total);
    let o = 0;
    for (const b of blocks) { all.set(b, o); o += b.length; }
    const step = rate / RATE, n = Math.floor(total / step);
    const out = new Int16Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.floor(i * step), z = Math.max(a + 1, Math.floor((i + 1) * step));
      let sum = 0;
      for (let j = a; j < z; j++) sum += all[j];
      out[i] = Math.max(-32768, Math.min(32767, Math.round((sum / (z - a)) * 32767)));
    }
    return out;
  }

  async function start({ onPhrase, onSpeaking = () => {} }) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    const ctx = new AudioContext();
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
    try { await ctx.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
    const src = ctx.createMediaStreamSource(stream);
    const tap = new AudioWorkletNode(ctx, "tap");
    src.connect(tap);
    const rate = ctx.sampleRate;

    // A simple voice detector: louder than the room's background noise (which it
    // keeps learning while nobody speaks) means speech.
    let floor = 0.004, speaking = false, speechMs = 0, phraseMs = 0, quietMs = 0;
    let blocks = [], preroll = [];
    const finish = () => {
      if (speechMs >= MIN_SPEECH_MS) onPhrase(toPcm16(blocks, rate));
      blocks = []; speaking = false; speechMs = phraseMs = quietMs = 0;
      onSpeaking(false);
    };
    tap.port.onmessage = ({ data: block }) => {
      const ms = (block.length / rate) * 1000;
      let sum = 0;
      for (let i = 0; i < block.length; i++) sum += block[i] * block[i];
      const rms = Math.sqrt(sum / block.length);
      const loud = rms > Math.max(0.012, floor * 3);
      if (!speaking) {
        floor = floor * 0.95 + Math.min(rms, 0.05) * 0.05;
        preroll.push(block);
        while (preroll.length * ms > PREROLL_MS) preroll.shift();
        if (!loud) return;
        speaking = true;
        blocks = preroll; preroll = [];
        onSpeaking(true);
      } else blocks.push(block);
      phraseMs += ms;
      if (loud) { speechMs += ms; quietMs = 0; } else quietMs += ms;
      if (quietMs >= END_SILENCE_MS || phraseMs >= MAX_PHRASE_MS) finish();
    };

    return {
      stop() {
        if (speaking) finish(); // (what was being said when it was switched off still counts)
        tap.port.onmessage = null;
        src.disconnect();
        tap.disconnect();
        for (const t of stream.getTracks()) t.stop();
        ctx.close();
      },
    };
  }

  window.PhraseRecorder = { start, supported: !!(navigator.mediaDevices?.getUserMedia && window.AudioWorkletNode) };
})();
