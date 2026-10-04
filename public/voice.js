// Spoken lines. The server returns dry eSpeak audio; this file gives each voice
// its character with one configurable Web Audio chain (parameters in voices.js:
// rate, band filters, drive, ring mod, comb, chorus, echo, reverb, radio noise).
// Lines play one at a time, fetched ahead so there's no gap between them.
//
// Used by the player screen (through FX.Sound's master volume) and by the DM
// console's "Test" button (its own audio context).
(() => {
  const queue = [];
  let playing = false;
  let gen = 0; // bumped by stop(): any in-flight line or loop sees it and quits
  let master = null;
  let impulse = null;
  let ownCtx = null;
  let blocked = () => false;

  const ctx = () => window.FX?.Sound?.ctx || ownCtx || (ownCtx = new (window.AudioContext || window.webkitAudioContext)());
  const ready = () => (window.FX ? FX.Sound.ok() : true);
  const destination = () => (window.FX ? FX.Sound.bus() : ctx().destination);

  function getMaster() {
    if (!master) {
      master = ctx().createGain();
      master.connect(destination());
    }
    return master;
  }

  // Player: speak a log line (audio from `url`) with its voice's effect settings.
  function say(url, fx) {
    if (!ready() || blocked()) return;
    enqueue(fetch(url), fx);
  }

  // Warden console: hear a voice (unsaved settings included) with sample text.
  function test(voice, text, url, token) {
    stop();
    ctx().resume?.();
    enqueue(
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Warden-Token": token },
        body: JSON.stringify({ voice, text }),
      }),
      voice.fx,
    );
  }

  function enqueue(response, fx) {
    const audio = response
      .then((r) => (r.ok && r.status !== 204 ? r.arrayBuffer() : null))
      .then((buf) => (buf ? ctx().decodeAudioData(buf) : null))
      .catch(() => null);
    queue.push({ audio, fx: fx || {} });
    if (!playing) next(gen);
  }

  async function next(myGen) {
    if (myGen !== gen) return;
    const item = queue.shift();
    if (!item) { playing = false; return; }
    playing = true;
    const buffer = await item.audio;
    if (myGen !== gen) return;
    if (blocked()) return stop();
    if (!buffer || !ready()) return next(myGen);
    await play(buffer, item.fx, myGen);
    setTimeout(() => next(myGen), 250);
  }

  function play(buffer, fx, myGen) {
    return new Promise((resolve) => {
      const c = ctx();
      const src = c.createBufferSource();
      src.buffer = buffer;
      const sources = chain(c, src, getMaster(), fx, buffer.duration);
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
        // Let reverb/echo tails ring out before stopping modulators and noise.
        setTimeout(() => sources.forEach((s) => { try { s.stop(); } catch {} }), 6000);
      };
      src.onended = finish;
      // stop() can't reach this source directly, so watch for it.
      const watch = setInterval(() => {
        if (myGen !== gen) { clearInterval(watch); try { src.stop(); } catch {} finish(); }
      }, 100);
      src.addEventListener("ended", () => clearInterval(watch));
      sources.forEach((s) => s.start());
      src.start();
    });
  }

  // -------------------------------------------------------------- helpers
  const gain = (c, v) => { const g = c.createGain(); g.gain.value = v; return g; };
  const filter = (c, type, freq, q = 0.7) => {
    const f = c.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    return f;
  };

  function saturator(c, amount) {
    const ws = c.createWaveShaper();
    const n = 1024, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = Math.tanh(x * amount) / Math.tanh(amount); }
    ws.curve = curve;
    return ws;
  }

  function reverbImpulse(c, seconds = 4.5, decay = 2.6) {
    if (impulse && impulse.sampleRate === c.sampleRate) return impulse;
    const len = Math.floor(c.sampleRate * seconds);
    impulse = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = impulse.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return impulse;
  }

  // -------------------------------------------------------------- the chain
  // Returns extra sources (oscillators, noise) that must start/stop with the line.
  function chain(c, src, out, fx, duration) {
    const p = {
      rate: 1, highpass: 80, lowpass: 9000, drive: 0, ringMix: 0, ringFreq: 55, comb: 0, combMs: 6,
      chorus: 0, echo: 0, echoTime: 0.4, echoFeedback: 0.35, reverb: 0, noise: 0, dry: 1, ...fx,
    };
    const extras = [];
    src.playbackRate.value = p.rate;

    // Tone shaping: band-limit, then optional saturation.
    let pre = src.connect(filter(c, "highpass", p.highpass)).connect(filter(c, "lowpass", p.lowpass));
    if (p.drive > 0) pre = pre.connect(saturator(c, p.drive));

    // Ring modulator blended with the clean signal into one bus.
    const bus = gain(c, 1);
    pre.connect(gain(c, 1 - p.ringMix)).connect(bus);
    if (p.ringMix > 0) {
      const ring = gain(c, 0);
      const carrier = c.createOscillator();
      carrier.frequency.value = p.ringFreq;
      carrier.connect(ring.gain);
      pre.connect(ring).connect(gain(c, p.ringMix)).connect(bus);
      extras.push(carrier);
    }

    bus.connect(gain(c, p.dry)).connect(out);

    // Shared reverb, fed by the voice, chorus and echoes.
    let verb = null;
    if (p.reverb > 0) {
      verb = c.createConvolver();
      verb.buffer = reverbImpulse(c);
      verb.connect(gain(c, p.reverb)).connect(out);
      bus.connect(gain(c, 0.5)).connect(verb);
    }

    // Metallic comb resonance.
    if (p.comb > 0) {
      const d = c.createDelay(0.05);
      d.delayTime.value = p.combMs / 1000;
      bus.connect(d).connect(gain(c, 0.45)).connect(d);
      d.connect(gain(c, p.comb)).connect(out);
    }

    // Two slowly wavering delay lines: a drifting, many-voiced chorus.
    if (p.chorus > 0) {
      for (const [base, rate] of [[0.019, 0.23], [0.031, 0.31]]) {
        const d = c.createDelay(0.1);
        d.delayTime.value = base;
        const lfo = c.createOscillator();
        lfo.frequency.value = rate;
        lfo.connect(gain(c, 0.005)).connect(d.delayTime);
        bus.connect(d);
        d.connect(gain(c, p.chorus)).connect(out);
        if (verb) d.connect(gain(c, p.chorus)).connect(verb);
        extras.push(lfo);
      }
    }

    // Feedback echo that darkens as it repeats.
    if (p.echo > 0) {
      const d = c.createDelay(1.5);
      d.delayTime.value = p.echoTime;
      const dark = filter(c, "lowpass", 2600);
      bus.connect(d).connect(dark).connect(gain(c, p.echoFeedback)).connect(d);
      dark.connect(gain(c, p.echo)).connect(out);
      if (verb) dark.connect(gain(c, p.echo)).connect(verb);
    }

    // Radio hiss under the voice, for as long as it speaks.
    if (p.noise > 0) {
      const len = Math.ceil(c.sampleRate * 2);
      const nb = c.createBuffer(1, len, c.sampleRate);
      const data = nb.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      const n = c.createBufferSource();
      n.buffer = nb;
      n.loop = true;
      const g = gain(c, p.noise * 0.12);
      n.connect(filter(c, "bandpass", 1800, 0.8)).connect(g).connect(out);
      g.gain.setValueAtTime(p.noise * 0.12, c.currentTime + duration / p.rate);
      g.gain.linearRampToValueAtTime(0, c.currentTime + duration / p.rate + 0.15);
      extras.push(n);
    }

    return extras;
  }

  function stop() {
    gen++;
    queue.length = 0;
    playing = false;
    if (master) {
      const old = master;
      master = null;
      old.gain.setTargetAtTime(0, ctx().currentTime, 0.03); // also silences reverb/echo tails
      setTimeout(() => old.disconnect(), 300);
    }
  }

  window.Voice = {
    say,
    test,
    stop,
    // e.g. Voice.setBlocked(() => FX.has("blackout")): nothing speaks while it's true.
    setBlocked(fn) { blocked = fn; },
  };
})();
