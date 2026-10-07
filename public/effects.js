// Screen effects for the player terminal. Exposes window.FX.
(() => {
  const layer = () => document.getElementById("fx");
  const crt = () => document.getElementById("crt");
  const active = new Map(); // id -> { effect, el, stop() }

  // ---------------------------------------------------------------- audio
  const Sound = {
    ctx: null,
    muted: false,
    unlock() {
      if (this.muted) return;
      if (!this.ctx) {
        try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
      }
      if (this.ctx.state === "suspended") this.ctx.resume();
    },
    // Everything (effects and speech) goes through one master bus so the
    // player's volume control affects it all.
    volume: 1,
    bus() {
      if (!this.master) {
        this.master = this.ctx.createGain();
        this.master.gain.value = this.volume;
        this.master.connect(this.ctx.destination);
      }
      return this.master;
    },
    setVolume(v) {
      this.volume = v;
      if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
    },
    out(gain = 0.2) {
      const g = this.ctx.createGain();
      g.gain.value = gain;
      g.connect(this.bus());
      return g;
    },
    ok() { return !this.muted && this.ctx && this.ctx.state === "running"; },
    tick() {
      if (!this.ok()) return;
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      const g = this.out(0.025);
      o.type = "square";
      o.frequency.value = 1800 + Math.random() * 400;
      g.gain.setValueAtTime(0.025, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.02);
      o.connect(g); o.start(t); o.stop(t + 0.025);
    },
    beep(freq = 880, dur = 0.08, gain = 0.06, type = "square") {
      if (!this.ok()) return;
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      const g = this.out(gain);
      o.type = type; o.frequency.value = freq;
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); o.start(t); o.stop(t + dur + 0.02);
    },
    noiseBuffer() {
      if (this._nb) return this._nb;
      const len = this.ctx.sampleRate * 2;
      const b = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      return (this._nb = b);
    },
    burst(dur = 0.25, gain = 0.3, freq = 900) {
      if (!this.ok()) return;
      const t = this.ctx.currentTime;
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer();
      const f = this.ctx.createBiquadFilter();
      f.type = "lowpass"; f.frequency.value = freq;
      const g = this.out(gain);
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f); f.connect(g); src.start(t); src.stop(t + dur);
    },
    // Looping sounds return a stop() function.
    noiseLoop(gain = 0.05) {
      if (!this.ok()) return () => {};
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer(); src.loop = true;
      const f = this.ctx.createBiquadFilter();
      f.type = "bandpass"; f.frequency.value = 2500; f.Q.value = 0.6;
      const g = this.out(gain);
      src.connect(f); f.connect(g); src.start();
      return () => { try { src.stop(); } catch {} g.disconnect(); };
    },
    siren() {
      if (!this.ok()) return () => {};
      const o = this.ctx.createOscillator();
      const lfo = this.ctx.createOscillator();
      const depth = this.ctx.createGain();
      const g = this.out(0.07);
      o.type = "sawtooth"; o.frequency.value = 700;
      lfo.type = "sine"; lfo.frequency.value = 1.6; depth.gain.value = 260;
      lfo.connect(depth); depth.connect(o.frequency);
      o.connect(g); o.start(); lfo.start();
      return () => { try { o.stop(); lfo.stop(); } catch {} g.disconnect(); };
    },
    klaxon() {
      if (!this.ok()) return () => {};
      let on = true;
      const blast = () => {
        if (!on) return;
        this.beep(330, 0.55, 0.08, "square");
        setTimeout(() => on && this.beep(262, 0.55, 0.08, "square"), 600);
      };
      blast();
      const iv = setInterval(blast, 2200);
      return () => { on = false; clearInterval(iv); };
    },
    // A horror sting, for a reveal (under a second): a quick hiss swelling up, then the
    // clash: a sharp crack over a sub-bass hit, and a bright dissonant chord ringing
    // out. (into: any AudioContext and node, for testing.)
    sting(into) {
      if (!into && !this.ok()) return;
      const ctx = into?.ctx || this.ctx, dest = into?.dest || this.bus();
      const t0 = into?.at ?? ctx.currentTime, hit = t0 + 0.12;
      const out = ctx.createGain(); out.gain.value = 0.4; out.connect(dest);
      const noise = () => {
        const len = ctx.sampleRate, b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        const src = ctx.createBufferSource(); src.buffer = b; return src;
      };
      const env = (g, at, peak, attack, decay) => {
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(peak, at + attack);
        g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
      };
      // 1. the swell: a quick hiss rising into the hit
      { const n = noise(), f = ctx.createBiquadFilter(), g = ctx.createGain();
        f.type = "bandpass"; f.Q.value = 1.5;
        f.frequency.setValueAtTime(800, t0); f.frequency.exponentialRampToValueAtTime(5000, hit);
        g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.2, hit - 0.005); g.gain.exponentialRampToValueAtTime(0.0001, hit + 0.03);
        n.connect(f); f.connect(g); g.connect(out); n.start(t0); n.stop(hit + 0.05); }
      // 2. the hit: a sharp crack on top of a short sub-bass thud and low boom
      { const n = noise(), f = ctx.createBiquadFilter(), g = ctx.createGain();
        f.type = "highpass"; f.frequency.value = 2500;
        env(g, hit, 0.35, 0.002, 0.06); n.connect(f); f.connect(g); g.connect(out); n.start(hit); n.stop(hit + 0.1); }
      { const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = "sine"; o.frequency.setValueAtTime(85, hit); o.frequency.exponentialRampToValueAtTime(32, hit + 0.6);
        env(g, hit, 0.32, 0.004, 0.65); o.connect(g); g.connect(out); o.start(hit); o.stop(hit + 0.7); }
      { const n = noise(), f = ctx.createBiquadFilter(), g = ctx.createGain();
        f.type = "lowpass"; f.frequency.value = 260;
        env(g, hit, 0.28, 0.003, 0.4); n.connect(f); f.connect(g); g.connect(out); n.start(hit); n.stop(hit + 0.45); }
      // 3. the clash: a bright dissonant cluster (a tritone, and a semitone rub up high), ringing out
      { const f = ctx.createBiquadFilter(), g = ctx.createGain();
        f.type = "lowpass"; f.Q.value = 3;
        f.frequency.setValueAtTime(4200, hit); f.frequency.exponentialRampToValueAtTime(2600, hit + 0.75); // (no sweep: a steady ring, not a whirl)
        g.gain.setValueAtTime(0.0001, hit); g.gain.exponentialRampToValueAtTime(0.34, hit + 0.008); g.gain.exponentialRampToValueAtTime(0.11, hit + 0.25); g.gain.exponentialRampToValueAtTime(0.04, hit + 0.6); g.gain.exponentialRampToValueAtTime(0.0001, hit + 0.75);
        for (const [hz, det] of [[110, -2], [155.6, 2], [233, -2], [246.9, 3], [329.6, -2]]) { // (the semitone rub up high: harsh, not warbling)
          const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = hz; o.detune.value = det;
          o.connect(f); o.start(hit); o.stop(hit + 0.8);
        }
        f.connect(g); g.connect(out); }
      return hit + 0.78 - t0; // (how long it lasts)
    },
    powerDown() {
      if (!this.ok()) return;
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      const g = this.out(0.12);
      o.type = "sawtooth";
      o.frequency.setValueAtTime(420, t);
      o.frequency.exponentialRampToValueAtTime(30, t + 1.4);
      g.gain.setValueAtTime(0.12, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
      o.connect(g); o.start(t); o.stop(t + 1.6);
    },
  };

  // ---------------------------------------------------------------- helpers
  const rand = (a, b) => a + Math.random() * (b - a);
  const el = (cls, html = "") => {
    const d = document.createElement("div");
    d.className = cls;
    d.innerHTML = html;
    return d;
  };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  function fullCanvas() {
    const c = document.createElement("canvas");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = innerWidth * dpr;
    c.height = innerHeight * dpr;
    const ctx = c.getContext("2d");
    ctx.scale(dpr, dpr);
    return { c, ctx, w: innerWidth, h: innerHeight };
  }

  // Blood and goo can be wiped off the glass by dragging across them. The
  // overlay itself never takes the mouse (clicks go through to the buttons and
  // text underneath); the drag is watched on the whole page instead.
  // others: offscreen canvases holding the same picture, wiped too (so drips that
  // are still being revealed from them don't bring wiped liquid back).
  function makeWipeable(c, ctx, others = []) {
    let last = null, dragged = 0;
    const wipe = (x, y) => {
      for (const k of [ctx, ...others]) {
        k.save();
        k.globalCompositeOperation = "destination-out";
        k.lineCap = "round";
        k.lineWidth = 70;
        k.strokeStyle = "rgba(0,0,0,0.35)";
        k.beginPath(); k.moveTo(last[0], last[1]); k.lineTo(x, y); k.stroke();
        k.restore();
      }
    };
    const down = (e) => { last = [e.clientX, e.clientY]; dragged = 0; };
    const move = (e) => {
      if (!c.isConnected) return off();
      if (!last || !(e.buttons & 1)) return;
      dragged += Math.hypot(e.clientX - last[0], e.clientY - last[1]);
      // A real drag (not a click): wipe, and don't select text while doing it.
      if (dragged > 8) {
        document.body.style.userSelect = "none";
        getSelection()?.removeAllRanges();
        wipe(e.clientX, e.clientY);
      }
      last = [e.clientX, e.clientY];
    };
    const up = () => { last = null; document.body.style.userSelect = ""; };
    const off = () => {
      removeEventListener("pointerdown", down, true);
      removeEventListener("pointermove", move, true);
      removeEventListener("pointerup", up, true);
    };
    addEventListener("pointerdown", down, true);
    addEventListener("pointermove", move, true);
    addEventListener("pointerup", up, true);
    c.style.pointerEvents = "none";
  }

  const TAU = Math.PI * 2;

  // Smooth value noise in 0..1, summed over a few octaves: organic edges, veins, mottling.
  function makeNoise() {
    const p = [...Array(256).keys()];
    for (let i = 255; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
    const P = new Uint8Array(512);
    for (let i = 0; i < 512; i++) P[i] = p[i & 255];
    const V = Float32Array.from({ length: 256 }, () => Math.random());
    const fade = (t) => t * t * (3 - 2 * t);
    const n = (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y), u = fade(x - xi), v = fade(y - yi);
      const a = V[P[(xi & 255) + P[yi & 255]]], b = V[P[((xi + 1) & 255) + P[yi & 255]]];
      const c = V[P[(xi & 255) + P[(yi + 1) & 255]]], d = V[P[((xi + 1) & 255) + P[(yi + 1) & 255]]];
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    };
    return (x, y, oct = 3) => {
      let s = 0, amp = 0.5, f = 1, norm = 0;
      for (let o = 0; o < oct; o++) { s += n(x * f, y * f) * amp; norm += amp; amp *= 0.5; f *= 2; }
      return s / norm;
    };
  }

  // A liquid on the glass, as a thickness at every (CSS) pixel. Droplets add to it;
  // where it passes a threshold there is liquid, and its slope catches the light.
  function liquidField(w, h) {
    const F = new Float32Array(w * h);
    // A droplet at (x, y): radius r, strength a, stretched k times along angle ang.
    const drop = (x, y, r, a = 1.6, ang = 0, k = 1) => {
      const R = r * Math.max(1, k);
      const x0 = Math.max(0, Math.floor(x - R)), x1 = Math.min(w - 1, Math.ceil(x + R));
      const y0 = Math.max(0, Math.floor(y - R)), y1 = Math.min(h - 1, Math.ceil(y + R));
      if (x0 > x1 || y0 > y1) return;
      const ca = Math.cos(ang), sa = Math.sin(ang), r2 = r * r;
      for (let py = y0; py <= y1; py++) {
        const dy = py - y;
        for (let px = x0; px <= x1; px++) {
          const dx = px - x, u = (dx * ca + dy * sa) / k, v = -dx * sa + dy * ca;
          const d2 = (u * u + v * v) / r2;
          if (d2 < 1) { const t = 1 - d2; F[py * w + px] += a * t * t; }
        }
      }
    };
    return { F, w, h, drop };
  }

  // Light the liquid. paint(th, n, x, y, nx, ny, v) gives [r, g, b, a] for a pixel of
  // thickness th (0 at the edge .. 1 thick; v is the raw depth), noise n and surface normal (nx, ny);
  // a sharp highlight from the top left is added on top (it's wet).
  function shadeLiquid(fl, noise, paint, { edge = 0.22, relief = 14, gloss = 0.85, shine = 70 } = {}) {
    const { F, w, h } = fl, T = 0.5;
    const img = new ImageData(w, h), D = img.data;
    const hx = -0.42, hy = -0.56, hz = 1.71, hl = Math.hypot(hx, hy, hz); // halfway between the light and the eye
    // The surface's height: it rises at the edges and levels off (a pool is flat on top),
    // so the light catches the curve round each drop's rim.
    const H = (f) => (f > 0.3 ? 1 - Math.exp(-(f - 0.3) * 1.6) : 0);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x, f = F[i];
        if (f < T - edge) continue;
        const nz = noise(x / 26, y / 26, 3);
        const v = f + (nz - 0.5) * edge * 2; // (ragged, organic edges)
        if (v < T - 0.035) continue;
        const cover = Math.min(1, (v - (T - 0.035)) / 0.07); // anti-aliased edge
        const th = Math.max(0, Math.min(1, (v - T) / 1.4));
        let nx = -(H(F[i + 1]) - H(F[i - 1])) * relief, ny = -(H(F[i + w]) - H(F[i - w])) * relief;
        const nl = Math.hypot(nx, ny, 1);
        nx /= nl; ny /= nl;
        const s = Math.max(0, (nx * hx + ny * hy + hz / nl) / hl);
        const spec = Math.pow(s, shine) * gloss;
        const [r, g, b, a] = paint(th, nz, x, y, nx, ny, v);
        const o = i * 4;
        D[o] = Math.max(0, Math.min(255, r + 255 * spec));
        D[o + 1] = Math.max(0, Math.min(255, g + 255 * spec));
        D[o + 2] = Math.max(0, Math.min(255, b + 255 * spec));
        D[o + 3] = Math.max(0, Math.min(255, (a + spec * 0.5) * 255 * cover));
      }
    }
    const out = document.createElement("canvas");
    out.width = w; out.height = h;
    out.getContext("2d").putImageData(img, 0, 0);
    return out;
  }

  // A drip running down from (x, y): a thin trail, a heavier bead at its head.
  // top / bottom: its thickness where it leaves the pool, and just above the bead.
  function dripPath(fl, x, y, len, r0, { wobble = 0.3, bead = 1.6, beads = 0, top = 1, bottom = 0.65, stretch = 1.25 } = {}) {
    let px = x;
    for (let d = 0; d < len; d += 1.5) {
      px += Math.sin((y + d) / 31) * wobble * 0.2 + rand(-0.12, 0.12);
      const t = d / len;
      fl.drop(px, y + d, r0 * (top + (bottom - top) * Math.pow(t, 0.6)), 1.6);
      if (beads && Math.random() < beads / len * 1.5) fl.drop(px, y + d, r0 * 1.2, 1.7, Math.PI / 2, 1.5);
    }
    fl.drop(px, y + len - r0 * bead * 0.3, r0 * bead, 1.8, Math.PI / 2, stretch);
    return { x: px, end: y + len + r0 * bead };
  }

  // Liquid that runs: the finished picture is drawn at once except for the drips,
  // which are uncovered a little each frame as they run down.
  // more: other layers drawn and uncovered the same way ([{ ctx, src }], e.g. goo's glow).
  function runLiquid(c, ctx, full, drips, speed, more = []) {
    const layers = [{ ctx, src: full }, ...more];
    for (const L of layers) {
      L.ctx.drawImage(L.src, 0, 0);
      for (const d of drips) L.ctx.clearRect(d.x0, d.y, d.w, d.end - d.y + 4);
    }
    makeWipeable(c, ctx, [full.getContext("2d"), ...more.flatMap((L) => [L.ctx, L.src.getContext("2d")])]);
    let raf;
    const step = () => {
      let running = false;
      for (const d of drips) {
        if (d.y >= d.end + 4) continue;
        running = true;
        if (Math.random() < 0.004) d.v *= 0.4; // (it catches, then creeps on)
        else d.v = Math.min(d.max, d.v + d.max * 0.01);
        const y1 = Math.min(d.end + 4, d.y + d.v * speed);
        const hgt = Math.max(1, Math.ceil(y1 - d.y));
        for (const L of layers) {
          L.ctx.clearRect(d.x0, d.y, d.w, hgt);
          L.ctx.drawImage(L.src, d.x0, d.y, d.w, hgt, d.x0, d.y, d.w, hgt);
        }
        d.y = y1;
      }
      if (running) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }

  // Where a pool's lower edge is, straight down from (x, y): drips start there.
  function poolBottom(fl, x, y) {
    const { F, w, h } = fl;
    let yy = Math.max(0, Math.floor(y)), xi = Math.max(0, Math.min(w - 1, Math.round(x)));
    while (yy < h - 1 && F[yy * w + xi] > 0.5) yy++;
    return yy;
  }

  // ---------------------------------------------------------------- effects
  const builders = {
    // Blood on the glass: a heavy impact spatter, nearly black where it pooled and
    // a translucent red at its thin edges, darker at the rims where it's drying,
    // with spatter and mist flung out from it and drips running down.
    blood(fx) {
      const { c, ctx, w, h } = fullCanvas();
      c.className = "fx-canvas fx-blood";
      const pools = liquidField(w, h), noise = makeNoise(), tone = makeNoise();
      const splats = 1 + fx.intensity;
      const starts = [];
      for (let s = 0; s < splats; s++) {
        const cx = rand(w * 0.12, w * 0.88), cy = rand(h * 0.08, h * 0.62);
        const R = rand(34, 70) * (0.75 + fx.intensity * 0.22);
        const flung = rand(0, TAU); // the direction it came from: spatter streams the other way
        // The body: overlapping masses, heavier at the centre.
        for (let i = 0; i < 26; i++) {
          const a = rand(0, TAU), d = R * Math.pow(Math.random(), 1.6) * 0.6;
          pools.drop(cx + Math.cos(a) * d, cy + Math.sin(a) * d, R * rand(0.32, 0.72), rand(1.4, 2.0));
        }
        // Fingers thrown out of it, each ending in a bead, some breaking off into a teardrop.
        const arms = 7 + Math.floor(rand(0, 9));
        for (let i = 0; i < arms; i++) {
          const a = rand(0, TAU), len = R * rand(0.7, 2.3) * (Math.cos(a - flung) > 0.4 ? 1.5 : 1);
          let x = cx, y = cy;
          for (let t = 0; t <= 1; t += 0.06) {
            x = cx + Math.cos(a + Math.sin(t * 6) * 0.04) * len * t;
            y = cy + Math.sin(a + Math.sin(t * 6) * 0.04) * len * t;
            pools.drop(x, y, R * 0.2 * (1 - t * 0.72), 1.5, a, 1.5);
          }
          pools.drop(x, y, R * 0.11, 1.8);
          if (Math.random() < 0.6) {
            const d = len * rand(1.12, 1.45);
            pools.drop(cx + Math.cos(a) * d, cy + Math.sin(a) * d, R * rand(0.05, 0.09), 1.8, a, rand(1.8, 3));
          }
        }
        // Satellite droplets: smaller and more stretched the further they flew.
        for (let i = 0; i < 140; i++) {
          const a = Math.random() < 0.55 ? flung + rand(-0.8, 0.8) : rand(0, TAU);
          const far = Math.pow(Math.random(), 1.5) * 3.8, d = R * (0.9 + far);
          const r = Math.max(1, R * 0.1 * (1.3 - far / 4.2) * rand(0.35, 1.2));
          pools.drop(cx + Math.cos(a) * d, cy + Math.sin(a) * d, r, rand(1.4, 2), a, 1 + far * 0.7);
        }
        // A fine mist around it all.
        for (let i = 0; i < 700; i++) {
          const a = rand(0, TAU), d = R * rand(0.8, 5.2);
          pools.drop(cx + Math.cos(a) * d, cy + Math.sin(a) * d, rand(0.6, 1.7), rand(1.2, 2.2));
        }
        // Drips, from the bottom of the pool.
        for (let i = 0; i < 2 + fx.intensity * 2; i++) starts.push({ x: cx + rand(-R, R) * 0.55, y: cy, len: rand(50, 160) * (0.6 + fx.intensity * 0.45), r0: rand(2, 4.2) });
      }
      const drips = starts.map((s) => {
        const y = poolBottom(pools, s.x, s.y) - 2;
        const { x, end } = dripPath(pools, s.x, y, s.len, s.r0, { wobble: 0.6 });
        const half = s.r0 * 2.4 + 6 + Math.abs(x - s.x);
        return { x0: Math.floor(Math.min(s.x, x) - half), w: Math.ceil(Math.abs(x - s.x) + half * 2), y: y + 3, end, v: 0, max: rand(0.35, 1.1) };
      });
      const full = shadeLiquid(pools, noise, (th, n, x, y) => {
        const k = Math.min(1, th * 2.2), rim = th < 0.025 ? 1 - th / 0.025 : 0;
        const mottle = tone(x / 60, y / 60, 2);
        const r = (180 - 112 * k) * (0.85 + mottle * 0.3) - rim * 25;
        return [r, 10 - 8 * k + mottle * 5, 16 - 12 * k, 0.8 + 0.19 * k + rim * 0.06];
      }, { edge: 0.12, relief: 9, gloss: 0.75, shine: 70 });
      layer().append(c);
      Sound.burst(0.35, 0.5, 500);
      return { el: c, stop: runLiquid(c, ctx, full, drips, 1) };
    },

    // Goo: alien ichor, thick and translucent, dark with a sick bioluminescent green,
    // threaded with darker veins, an oily sheen that shifts colour where the light
    // catches it, and bubbles caught inside. It sags from the top in heavy strands.
    goo(fx) {
      const { c, ctx, w, h } = fullCanvas();
      c.className = "fx-canvas fx-goo";
      const fl = liquidField(w, h), noise = makeNoise(), veins = makeNoise(), glow = makeNoise(), lie = makeNoise();
      // The sheet along the top, its lower edge sagging into lobes.
      const band = h * (0.05 + fx.intensity * 0.04);
      for (let x = -30; x < w + 30; x += 12) {
        const depth = band * (0.55 + lie(x / 220, 0.5, 2) * 1.1);
        fl.drop(x, -depth * 0.25, depth * 1.05, 1.9, Math.PI / 2, 1);
      }
      const lobes = [];
      for (let i = 0; i < 3 + fx.intensity * 3; i++) {
        const x = rand(0, w), depth = band * (0.55 + lie(x / 220, 0.5, 2) * 1.1);
        const r = rand(14, 34) * (0.8 + fx.intensity * 0.15);
        fl.drop(x, depth * 0.55 + r * 0.5, r, 1.7, Math.PI / 2, rand(1.3, 2)); // (swelling out of the sheet)
        fl.drop(x, depth * 0.45, r * 0.8, 1.6, Math.PI / 2, 1.4);
        lobes.push({ x, y: depth * 0.55 + r * 0.7 });
      }
      // Globs flung across the glass: rounder and heavier than blood, a few beads round them.
      for (let i = 0; i < 2 * fx.intensity; i++) {
        const cx = rand(w * 0.08, w * 0.92), cy = rand(h * 0.25, h * 0.85), R = rand(22, 58);
        for (let j = 0; j < 14; j++) {
          const a = rand(0, TAU), d = R * Math.pow(Math.random(), 1.3) * 0.65;
          fl.drop(cx + Math.cos(a) * d, cy + Math.sin(a) * d, R * rand(0.35, 0.75), rand(1.5, 2.1), rand(0, TAU), rand(1, 1.6));
        }
        for (let j = 0; j < 18; j++) {
          const a = rand(0, TAU), d = R * rand(0.9, 2.2);
          fl.drop(cx + Math.cos(a) * d, cy + Math.sin(a) * d, R * rand(0.06, 0.16), 1.8, a, rand(1, 1.8));
        }
        lobes.push({ x: cx, y: cy, glob: R });
      }
      // Strands hanging down, slow and heavy: a thin neck, beads along it, a fat drop at the end.
      const drips = [];
      for (let i = 0; i < 4 + fx.intensity * 4; i++) {
        const from = lobes[Math.floor(rand(0, lobes.length))] || { x: rand(0, w), y: band };
        const sx = from.x + rand(-12, 12) * (from.glob ? from.glob / 20 : 1);
        const y = poolBottom(fl, sx, from.y) - 3;
        const len = rand(60, h * (0.18 + fx.intensity * 0.12));
        const r0 = rand(1.8, 3.4);
        const { x, end } = dripPath(fl, sx, y, len, r0, { wobble: 0.35, bead: rand(1.5, 2.1), beads: rand(0, 2), top: 2.2, bottom: 1.2, stretch: 1.7 });
        const half = r0 * 4 + 8 + Math.abs(x - sx);
        drips.push({ x0: Math.floor(Math.min(sx, x) - half), w: Math.ceil(Math.abs(x - sx) + half * 2), y: y + 4, end, v: 0, max: rand(0.12, 0.45) });
      }
      const full = shadeLiquid(fl, noise, (th, n, x, y, nx, ny, depth) => {
        const k = Math.max(0, Math.min(1, (depth - 0.5) / 3.5)); // (thin strands stay light; the deep sheet goes dark)
        // Veins: fine dark threads, fading in and out.
        const vein = Math.max(0, 1 - Math.abs(veins(x / 30, y / 30, 3) - 0.5) * 70) * Math.min(1, th * 4) * Math.pow(glow(x / 140 + 7, y / 140, 1), 1.5) * 1.6;
        // A sick light from inside, in patches.
        const lit = Math.pow(glow(x / 90, y / 90, 2), 4) * 1.6 * Math.min(1, th * 3);
        let r = 50 - 40 * k + lit * 30, g = 105 - 78 * k + lit * 115, b = 30 - 20 * k + lit * 22;
        r -= vein * 8; g -= vein * 30; b -= vein * 8;
        // The oily film: its colour turns with the slope of the surface.
        const slope = Math.min(1, Math.hypot(nx, ny) * 3), film = (nx * 2 + ny * 3 + n * 4) * 3;
        r += slope * 0.3 * (70 + 70 * Math.sin(film)); g += slope * 0.3 * (40 + 40 * Math.sin(film + 2.1)); b += slope * 0.3 * (100 + 90 * Math.sin(film + 4.2));
        return [r, g, b, 0.55 + 0.38 * k];
      }, { edge: 0.14, relief: 7, gloss: 0.85, shine: 30 });
      // Bubbles and motes caught in the thick of it.
      const fctx = full.getContext("2d");
      for (let i = 0, tries = 0; i < 26 * fx.intensity && tries < 4000; tries++) {
        const x = rand(0, w), y = rand(0, h);
        if (fl.F[(y | 0) * w + (x | 0)] < 1.4) continue;
        i++;
        const r = rand(1.5, 6);
        fctx.fillStyle = "rgba(10,30,8,0.25)";
        fctx.beginPath(); fctx.arc(x, y, r, 0, TAU); fctx.fill();
        fctx.strokeStyle = "rgba(190,255,170,0.35)"; fctx.lineWidth = 0.8;
        fctx.beginPath(); fctx.arc(x, y, r, 0, TAU); fctx.stroke();
        fctx.strokeStyle = "rgba(255,255,255,0.7)"; fctx.lineWidth = Math.max(0.8, r * 0.3);
        fctx.beginPath(); fctx.arc(x, y, r * 0.55, Math.PI * 1.1, Math.PI * 1.55); fctx.stroke();
      }
      // It's alive: its inner light (and the motes in it) on a layer of its own that
      // throbs, while the whole mass breathes (player.css .fx-goo).
      const glowSrc = document.createElement("canvas");
      glowSrc.width = w; glowSrc.height = h;
      const gsctx = glowSrc.getContext("2d"), gimg = gsctx.createImageData(w, h), G = gimg.data;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const f = fl.F[y * w + x];
          if (f < 0.75) continue;
          const lit = (Math.pow(glow(x / 90, y / 90, 2), 3) * 2.2 + 0.08) * Math.min(1, (f - 0.5) * 1.5);
          if (lit < 0.03) continue;
          const o = (y * w + x) * 4;
          G[o] = 140; G[o + 1] = 255; G[o + 2] = 110; G[o + 3] = Math.min(255, lit * 230);
        }
      }
      gsctx.putImageData(gimg, 0, 0);
      for (let i = 0, tries = 0; i < 40 * fx.intensity && tries < 4000; tries++) {
        const x = rand(0, w), y = rand(0, h);
        if (fl.F[(y | 0) * w + (x | 0)] < 0.9) continue;
        i++;
        const g = gsctx.createRadialGradient(x, y, 0, x, y, rand(2, 5));
        g.addColorStop(0, "rgba(200,255,140,0.85)"); g.addColorStop(1, "rgba(120,255,80,0)");
        gsctx.fillStyle = g; gsctx.fillRect(x - 6, y - 6, 12, 12);
      }
      const glowC = document.createElement("canvas");
      glowC.width = w; glowC.height = h;
      glowC.className = "fx-canvas goo-glow";
      const box = el("fx-goo");
      c.className = "fx-canvas";
      box.append(c, glowC);
      box.style.setProperty("--beat", `${rand(2.6, 3.6).toFixed(2)}s`); // (each its own pulse)
      layer().append(box);
      Sound.burst(0.6, 0.35, 250);
      return { el: box, stop: runLiquid(c, ctx, full, drips, 1, [{ ctx: glowC.getContext("2d"), src: glowSrc }]) };
    },

    // A crack in the glass: a crushed point of impact, jagged cracks running out of
    // it and branching, rings of fracture between them, facets catching the light,
    // and the light splitting faintly red and blue along the breaks.
    crack() {
      const { c, ctx, w, h } = fullCanvas();
      c.className = "fx-canvas fx-crack";
      const ox = rand(w * 0.2, w * 0.8), oy = rand(h * 0.2, h * 0.8), far = Math.hypot(w, h);
      // A jagged line between two points (midpoint displacement).
      const jag = (x1, y1, x2, y2, rough, depth) => {
        let pts = [[x1, y1], [x2, y2]];
        for (let d = 0; d < depth; d++) {
          const next = [pts[0]];
          for (let i = 1; i < pts.length; i++) {
            const [ax, ay] = pts[i - 1], [bx, by] = pts[i], len = Math.hypot(bx - ax, by - ay);
            const off = len * rough * rand(-1, 1), nx = -(by - ay) / (len || 1), ny = (bx - ax) / (len || 1);
            next.push([(ax + bx) / 2 + nx * off, (ay + by) / 2 + ny * off], pts[i]);
          }
          pts = next;
        }
        return pts;
      };
      const cracks = []; // { pts, w0, w1, a }
      const n = 11 + Math.floor(rand(0, 8));
      const angles = Array.from({ length: n }, (_, i) => (i / n) * TAU + rand(-0.22, 0.22)).sort((a, b) => a - b);
      const radials = angles.map((a) => {
        const len = far * rand(0.3, 0.9);
        const pts = jag(ox, oy, ox + Math.cos(a) * len, oy + Math.sin(a) * len, 0.11, 5); // (straight runs, sharp kinks)
        cracks.push({ pts, w0: 1.7, w1: 0.35, a: 0.95 });
        // Branches splitting off it.
        for (let b = 0; b < 1 + Math.floor(rand(0, 3)); b++) {
          const at = pts[Math.floor(pts.length * rand(0.15, 0.75))], ba = a + rand(0.25, 0.65) * (Math.random() < 0.5 ? -1 : 1), bl = len * rand(0.12, 0.38);
          cracks.push({ pts: jag(at[0], at[1], at[0] + Math.cos(ba) * bl, at[1] + Math.sin(ba) * bl, 0.12, 4), w0: 1, w1: 0.3, a: 0.8 });
        }
        return pts;
      });
      const pointAt = (pts, r) => pts.find(([x, y]) => Math.hypot(x - ox, y - oy) >= r) || pts[pts.length - 1];
      // Rings of fracture between neighbouring cracks, bowing in toward the impact.
      const r0 = rand(26, 40);
      for (let k = 1; k <= 5; k++) {
        const r = r0 * Math.pow(1.75, k);
        for (let i = 0; i < n; i++) {
          if (Math.random() > 0.8 - k * 0.11) continue;
          const [ax, ay] = pointAt(radials[i], r * rand(0.9, 1.1)), [bx, by] = pointAt(radials[(i + 1) % n], r * rand(0.9, 1.1));
          const mx = (ax + bx) / 2, my = (ay + by) / 2, pull = rand(0.06, 0.16);
          const cx = mx + (ox - mx) * pull, cy = my + (oy - my) * pull;
          const pts = [...jag(ax, ay, cx, cy, 0.05, 3), ...jag(cx, cy, bx, by, 0.05, 3).slice(1)];
          cracks.push({ pts, w0: 1.1 - k * 0.12, w1: 0.9 - k * 0.12, a: 0.8 - k * 0.08 });
        }
      }
      // Faint light through the impact.
      const halo = ctx.createRadialGradient(ox, oy, 0, ox, oy, r0 * 4);
      halo.addColorStop(0, "rgba(200,255,225,0.1)"); halo.addColorStop(1, "rgba(200,255,225,0)");
      ctx.fillStyle = halo; ctx.fillRect(ox - r0 * 4, oy - r0 * 4, r0 * 8, r0 * 8);
      // A dark hollow where it struck: over the shards, and again (smaller) over the
      // cracks, so they run into the dark instead of meeting in a bright point.
      const hole = r0 * rand(0.8, 1.1);
      const chipped = Array.from({ length: 25 }, () => rand(0.85, 1.05));
      const hollow = (size, core) => {
        const dark = ctx.createRadialGradient(ox, oy, 0, ox, oy, hole * size);
        dark.addColorStop(0, `rgba(0,0,0,${core})`); dark.addColorStop(0.45, `rgba(1,3,2,${core * 0.85})`);
        dark.addColorStop(0.75, "rgba(3,8,6,0.3)"); dark.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = dark;
        ctx.beginPath();
        chipped.forEach((m, i) => { // (not a perfect circle: chipped)
          const a = (i / 24) * TAU, rr = hole * size * m;
          i ? ctx.lineTo(ox + Math.cos(a) * rr, oy + Math.sin(a) * rr) : ctx.moveTo(ox + Math.cos(a) * rr, oy + Math.sin(a) * rr);
        });
        ctx.fill();
      };
      // Facets near the centre catching the light.
      for (let i = 0; i < n; i++) {
        if (Math.random() < 0.45) continue;
        const k = 1 + Math.floor(rand(0, 2)), ra = r0 * Math.pow(1.75, k - 1), rb = r0 * Math.pow(1.75, k);
        const p = [pointAt(radials[i], ra), pointAt(radials[i], rb), pointAt(radials[(i + 1) % n], rb), pointAt(radials[(i + 1) % n], ra)];
        const g = ctx.createLinearGradient(p[0][0], p[0][1], p[2][0], p[2][1]);
        g.addColorStop(0, `rgba(235,255,240,${rand(0.06, 0.2).toFixed(2)})`); g.addColorStop(1, "rgba(235,255,240,0)");
        ctx.fillStyle = g;
        ctx.beginPath(); p.forEach(([x, y], j) => (j ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.fill();
      }
      // The crushed point of impact: small shards, each a little different.
      for (let ring = 0; ring < 3; ring++) {
        const ra = r0 * 0.38 * ring, rb = r0 * 0.38 * (ring + 1), m = 7 + ring * 5;
        for (let j = 0; j < m; j++) {
          const a0 = (j / m) * TAU + rand(-0.1, 0.1), a1 = ((j + 1) / m) * TAU + rand(-0.1, 0.1);
          const q = [[ra, a0], [rb * rand(0.85, 1.15), a0], [rb * rand(0.85, 1.15), a1], [ra, a1]].map(([r, a]) => [ox + Math.cos(a) * r, oy + Math.sin(a) * r]);
          ctx.fillStyle = Math.random() < 0.25 ? `rgba(0,0,0,${rand(0.2, 0.5).toFixed(2)})` : `rgba(225,255,235,${rand(0.05, 0.45).toFixed(2)})`;
          ctx.strokeStyle = "rgba(240,255,245,0.55)"; ctx.lineWidth = 0.6;
          ctx.beginPath(); q.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.fill(); ctx.stroke();
        }
      }
      hollow(1.7, 0.95);
      ctx.strokeStyle = "rgba(140,255,190,0.22)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(ox, oy, hole * 1.05, 0, TAU); ctx.stroke();
      // Each crack: a dark shadow, the light splitting red and blue, then the bright break.
      const glint = makeNoise();
      cracks.forEach((cr, j) => { cr.lit = cr.pts.map((_, i) => 0.25 + 0.75 * Math.pow(glint(i / 7, j * 3.7), 1.8) * 1.6); });
      const strokeAll = (style, extra, dx, dy, alpha, catchLight = false) => {
        ctx.strokeStyle = style; ctx.lineCap = "round"; ctx.lineJoin = "round";
        for (const cr of cracks) {
          const pts = cr.pts, last = pts.length - 1;
          ctx.globalAlpha = cr.a * alpha;
          for (let i = 1; i <= last; i++) {
            if (catchLight) ctx.globalAlpha = Math.min(1, cr.a * alpha * cr.lit[i]);
            ctx.lineWidth = Math.max(0.3, cr.w0 + (cr.w1 - cr.w0) * (i / last) + extra);
            ctx.beginPath(); ctx.moveTo(pts[i - 1][0] + dx, pts[i - 1][1] + dy); ctx.lineTo(pts[i][0] + dx, pts[i][1] + dy); ctx.stroke();
          }
        }
        ctx.globalAlpha = 1;
      };
      strokeAll("rgba(0,0,0,0.6)", 2.2, 0.8, 1, 1);
      strokeAll("rgba(255,70,70,0.3)", 0, 1, 0, 1);
      strokeAll("rgba(80,200,255,0.3)", 0, -1, 0, 1);
      // Something cold glowing through the breaks near the impact.
      ctx.save();
      ctx.shadowColor = "rgba(110,255,170,0.9)"; ctx.shadowBlur = 10;
      ctx.strokeStyle = "rgba(120,255,175,0.5)"; ctx.lineCap = "round";
      for (const pts of radials) {
        for (let i = 1; i < pts.length; i++) {
          const d = Math.hypot(pts[i][0] - ox, pts[i][1] - oy);
          if (d > r0 * 6) break;
          ctx.globalAlpha = 0.35 * (1 - d / (r0 * 6));
          ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.moveTo(pts[i - 1][0], pts[i - 1][1]); ctx.lineTo(pts[i][0], pts[i][1]); ctx.stroke();
        }
      }
      ctx.restore();
      strokeAll("rgba(228,255,238,0.95)", 0, 0, 0, 1, true);
      hollow(1, 0.97);
      // Hairline whiskers off the main cracks.
      ctx.strokeStyle = "rgba(225,255,235,0.45)"; ctx.lineWidth = 0.5;
      for (const pts of radials) {
        for (let i = 4; i < pts.length; i += Math.floor(rand(3, 9))) {
          const [x, y] = pts[i], a = rand(0, TAU), l = rand(3, 11);
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
        }
      }
      layer().append(c);
      Sound.burst(0.15, 0.7, 3000);
      Sound.burst(0.4, 0.3, 1200);
      return { el: c };
    },

    // Ice: frost creeping in over the glass from every edge. Crystals grow inward as
    // feathery branches that split at sixty degrees, as real frost does, fogging the
    // glass round them into a haze that's thickest at the edges, with a few glints.
    // It reaches in unevenly, in drifts (further at higher intensity), then holds.
    ice(fx) {
      const { c, ctx, w, h } = fullCanvas();
      c.className = "fx-canvas fx-ice";
      const k = fx.intensity || 2, reach = Math.min(w, h) * (0.07 + 0.05 * k), drift = makeNoise(), bend = makeNoise();
      // A soft puff of frost, stamped along the branches as they grow.
      const puff = document.createElement("canvas");
      puff.width = puff.height = 32;
      const pctx = puff.getContext("2d"), pg = pctx.createRadialGradient(16, 16, 0, 16, 16, 16);
      pg.addColorStop(0, "rgba(210,232,255,0.13)"); pg.addColorStop(1, "rgba(210,232,255,0)");
      pctx.fillStyle = pg; pctx.fillRect(0, 0, 32, 32);
      const tips = [];
      const seed = (x, y, ang) => {
        const len = reach * (0.3 + drift(x / 150, y / 150, 2) * 1.1) * rand(0.75, 1.15);
        tips.push({ x, y, ang, left: len, len, gen: 0, w: rand(1.1, 1.7), next: rand(8, 20), curl: rand(-0.0035, 0.0035) });
      };
      for (let x = rand(0, 20); x < w; x += rand(22, 46)) { seed(x, -2, Math.PI / 2 + rand(-0.45, 0.45)); seed(x, h + 2, -Math.PI / 2 + rand(-0.45, 0.45)); }
      for (let y = rand(0, 20); y < h; y += rand(22, 46)) { seed(-2, y, rand(-0.45, 0.45)); seed(w + 2, y, Math.PI + rand(-0.45, 0.45)); }
      // Rime along the very edges.
      const rime = (x0, y0, x1, y1, rx, ry, rw, rh) => {
        const g = ctx.createLinearGradient(x0, y0, x1, y1);
        g.addColorStop(0, "rgba(225,240,255,0.32)"); g.addColorStop(1, "rgba(225,240,255,0)");
        ctx.fillStyle = g; ctx.fillRect(rx, ry, rw, rh);
      };
      rime(0, 0, 0, 16, 0, 0, w, 16); rime(0, h, 0, h - 16, 0, h - 16, w, 16);
      rime(0, 0, 16, 0, 0, 0, 16, h); rime(w, 0, w - 16, 0, w - 16, 0, 16, h);
      const glint = (x, y) => {
        const r = rand(2.5, 6);
        ctx.strokeStyle = "rgba(245,252,255,0.85)"; ctx.lineWidth = 0.7;
        ctx.beginPath(); ctx.moveTo(x - r, y); ctx.lineTo(x + r, y); ctx.moveTo(x, y - r); ctx.lineTo(x, y + r); ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,0.9)"; ctx.beginPath(); ctx.arc(x, y, 0.9, 0, TAU); ctx.fill();
      };
      layer().append(c);
      Sound.burst(0.25, 0.12, 5000);
      let raf, last = performance.now(), crackle = 0;
      const step = (now) => {
        const dt = Math.min(50, now - last);
        last = now;
        const grow = dt * 0.028 * (0.75 + k * 0.15);
        ctx.lineCap = "round";
        // One stroke per generation (all its new segments at once).
        const paths = [new Path2D(), new Path2D(), new Path2D(), new Path2D()];
        for (let i = tips.length - 1; i >= 0; i--) {
          const t = tips[i];
          const d = Math.min(t.left, grow * (t.gen ? 0.85 : 1));
          t.ang += t.curl * d; // (fronds sweep as they grow)
          const ang = t.ang + (bend(t.x / 28, t.y / 28) - 0.5) * 0.3;
          const nx = t.x + Math.cos(ang) * d, ny = t.y + Math.sin(ang) * d;
          paths[t.gen].moveTo(t.x, t.y); paths[t.gen].lineTo(nx, ny);
          // Haze: thick where the frost starts at the edge, thin further in.
          if (Math.random() < (t.gen === 0 && t.left > t.len * 0.55 ? 0.4 : 0.035)) { const s = 26 - t.gen * 5; ctx.drawImage(puff, nx - s / 2, ny - s / 2, s, s); }
          t.x = nx; t.y = ny; t.left -= d; t.next -= d;
          // Side branches at sixty degrees, shorter each generation.
          if (t.next <= 0 && t.gen < 3 && t.left > 4 && tips.length < 2500) {
            t.next = rand(9, 24) * (1 + t.gen * 0.8);
            const len = Math.min(t.left + 10, reach * 0.35) * rand(0.25, 0.6) / (1 + t.gen * 0.6);
            for (const s of [-1, 1]) {
              if (Math.random() < 0.55) tips.push({ x: t.x, y: t.y, ang: t.ang + s * (Math.PI / 3) + rand(-0.1, 0.1), left: len, len, gen: t.gen + 1, w: t.w * 0.62, next: rand(4, 9), curl: t.curl * 1.3 + rand(-0.003, 0.003) });
            }
          }
          if (t.left <= 0) {
            if (t.gen === 0 && Math.random() < 0.18) glint(t.x, t.y);
            tips.splice(i, 1);
          }
        }
        paths.forEach((p, g) => {
          ctx.strokeStyle = `rgba(222,240,255,${(0.8 - g * 0.16).toFixed(2)})`;
          ctx.lineWidth = Math.max(0.35, 1.3 - g * 0.32);
          ctx.stroke(p);
        });
        if ((crackle += dt) > 140 && tips.length) { crackle = 0; if (Math.random() < 0.5) Sound.burst(0.04, 0.05, rand(4000, 7000)); }
        if (tips.length) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
      return { el: c, stop: () => cancelAnimationFrame(raf) };
    },

    alarm(fx) {
      const d = el("fx-alarm", `<div class="box"><div class="warn">⚠ INTRUSION DETECTED ⚠</div>
        <div class="sub">${esc(fx.text || "UNAUTHORIZED ACCESS ATTEMPT LOGGED")}</div>
        <div class="trace">TRACING SOURCE<span class="dots"></span></div></div>`);
      layer().append(d);
      return { el: d, stop: Sound.siren() };
    },

    redalert(fx) {
      const d = el("fx-redalert", `<div class="strip">■ RED ALERT ■ ${esc(fx.text || "STATION EMERGENCY")} ■ RED ALERT ■</div>`);
      layer().append(d);
      return { el: d, stop: Sound.klaxon() };
    },

    // The display glitches: it jumps and tears, and its text corrupts (corruptText).
    glitch(fx) {
      const root = crt();
      root.classList.add("glitching", `glitch-${fx.intensity}`);
      const iv = setInterval(() => {
        root.style.setProperty("--gx", `${rand(-8, 8) * fx.intensity}px`);
        root.style.setProperty("--gy", `${rand(-3, 3) * fx.intensity}px`);
        root.style.setProperty("--gs", `${rand(0, 100)}%`);
        if (Math.random() < 0.25) Sound.burst(0.06, 0.15, 4000);
      }, 90);
      const text = corruptText(fx);
      return {
        el: text.el,
        stop: () => { clearInterval(iv); root.classList.remove("glitching", `glitch-${fx.intensity}`); text.stop(); },
      };
    },

    static(fx) {
      const c = document.createElement("canvas");
      c.className = "fx-canvas fx-static";
      c.width = 320; c.height = 200;
      c.style.opacity = String(0.12 + fx.intensity * 0.1);
      const ctx = c.getContext("2d");
      const img = ctx.createImageData(c.width, c.height);
      let raf, f = 0;
      const step = () => {
        if (f++ % 2 === 0) {
          for (let i = 0; i < img.data.length; i += 4) {
            const v = Math.random() * 255;
            img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
          }
          ctx.putImageData(img, 0, 0);
        }
        raf = requestAnimationFrame(step);
      };
      step();
      layer().append(c);
      const stopNoise = Sound.noiseLoop(0.02 * fx.intensity);
      return { el: c, stop: () => { cancelAnimationFrame(raf); stopNoise(); } };
    },

    blackout(fx) {
      const d = el("fx-blackout", fx.text ? `<div class="aux">${esc(fx.text)}</div>` : "");
      layer().append(d);
      Sound.powerDown();
      return { el: d, exitClass: "restoring", exitMs: 1600 };
    },

    lockout(fx) {
      const d = el("fx-lockout", `<div class="box"><div class="big">TERMINAL LOCKED</div>
        <div class="sub">${esc(fx.text || "SECURITY LOCKOUT IN EFFECT")}</div></div>`);
      layer().append(d);
      Sound.beep(220, 0.4, 0.1); setTimeout(() => Sound.beep(160, 0.6, 0.1), 420);
      return { el: d };
    },

    banner(fx) {
      const d = el("fx-banner", `<div class="txt">${esc(fx.text || "WARNING")}</div>`);
      layer().append(d);
      Sound.beep(660, 0.2, 0.08); setTimeout(() => Sound.beep(990, 0.25, 0.08), 220);
      return { el: d };
    },

    corrupt(fx) { return builders.glitch(fx); }, // (an old name: corrupted text is part of the glitch now)
  };

  // The screen's text decays (part of the glitch): characters turn to junk in sick
  // colours, words rot in runs, letters sprout stacked marks, lines lurch sideways,
  // the colours split, and bands of the screen invert and shift hue. It reaches the
  // header too (not the clock or the buttons). Everything is put back when it ends.
  function corruptText(fx) {
    const glyphs = "▓▒░█▄▀■□◊¥§¤ØÆ#%&@!?/\\|<>{}[]~^*ΞΨΔ∑∂∆≡≠∞";
    const tints = ["cr-red", "cr-mag", "cr-cyan", "cr-white", "cr-inv", "cr-dim"];
    const marks = () => { let m = ""; for (let i = 0, n = 1 + ((Math.random() * 4) | 0); i < n; i++) m += String.fromCharCode(0x300 + ((Math.random() * 0x70) | 0)); return m; };
    const k = fx.intensity || 2;
    const root = crt();
    root.classList.add("corrupting");
    const bands = el("fx-corrupt");
    layer().append(bands);
    const targets = () => [
      ...[...document.querySelectorAll("#lines .line.done")].map((l) => l.querySelector(".lt") || l), // (beside a portrait: just its text)
      ...["hdr-station", "hdr-os", "hdr-access"].map((id) => document.getElementById(id)).filter(Boolean),
    ];
    const rot = (orig) => {
      const p = 0.05 * k + Math.random() * 0.06;
      let out = "", run = 0;
      for (const ch of orig) {
        if (ch === "\n") { out += "\n"; run = 0; continue; }
        if (!run && ch !== " " && Math.random() < p * 0.12) run = 3 + ((Math.random() * 8) | 0); // (a whole stretch goes)
        const hit = run > 0 || (ch !== " " && Math.random() < p);
        if (run > 0) run--;
        if (!hit) { out += esc(ch); continue; }
        const g = Math.random() < 0.7 ? glyphs[(Math.random() * glyphs.length) | 0] : ch;
        const z = Math.random() < 0.18 * k ? marks() : "";
        out += `<span class="${tints[(Math.random() * tints.length) | 0]}">${esc(g)}${z}</span>`;
      }
      return out;
    };
    const iv = setInterval(() => {
      for (const t of targets()) {
        if (t.dataset.orig === undefined) t.dataset.orig = t.textContent;
        t.innerHTML = rot(t.dataset.orig);
        // Now and then a line lurches sideways and goes off-colour.
        const line = t.closest(".line") || t;
        if (Math.random() < 0.06 * k) line.style.setProperty("--cs", `${rand(-14, 14) * k}px`), line.classList.add("cr-shift");
        else line.classList.remove("cr-shift");
      }
      // The colours split and jitter.
      root.style.setProperty("--cx", `${rand(-2.5, 2.5) * k}px`);
      // Bands of the screen tear: inverted, or the wrong colours.
      bands.innerHTML = Array.from({ length: Math.random() < 0.35 ? 0 : 1 + ((Math.random() * 2 * k) | 0) }, () =>
        `<i class="${["b-inv", "b-hue", "b-sat"][(Math.random() * 3) | 0]}" style="top:${rand(0, 98).toFixed(1)}%;height:${rand(2, 6 + 10 * k).toFixed(0)}px"></i>`).join("");
      if (Math.random() < 0.15) Sound.burst(0.05, 0.12, 3000);
    }, 110);
    return {
      el: bands,
      stop: () => {
        clearInterval(iv);
        root.classList.remove("corrupting");
        root.style.removeProperty("--cx");
        for (const t of document.querySelectorAll("#crt [data-orig]")) {
          t.textContent = t.dataset.orig;
          delete t.dataset.orig;
        }
        for (const l of document.querySelectorAll("#crt .cr-shift")) l.classList.remove("cr-shift");
        bands.innerHTML = "";
      },
    };
  }

  // fx.quiet: no sound (e.g. a terminal's permanent blood or crack, drawn on arrival).
  function start(fx) {
    if (active.has(fx.id) || !builders[fx.type]) return;
    const wasMuted = Sound.muted;
    if (fx.quiet) Sound.muted = true;
    let handle;
    try { handle = builders[fx.type](fx) || {}; } finally { Sound.muted = wasMuted; }
    if (handle.el) handle.el.classList.add("fx-in");
    active.set(fx.id, { effect: fx, ...handle });
    document.dispatchEvent(new CustomEvent("fxchange"));
  }

  function end(id) {
    const h = active.get(id);
    if (!h) return;
    active.delete(id);
    h.stop?.();
    if (h.el) {
      h.el.style.pointerEvents = "none";
      h.el.classList.add(h.exitClass || "fx-out");
      setTimeout(() => h.el.remove(), h.exitMs || 1500);
    }
    document.dispatchEvent(new CustomEvent("fxchange"));
  }

  function sync(list) {
    const ids = new Set(list.map((f) => f.id));
    for (const id of [...active.keys()]) if (!ids.has(id) && !id.startsWith("decor-")) end(id); // (a terminal's own look stays)
    for (const f of list) start(f);
  }

  const has = (type) => [...active.values()].some((h) => h.effect.type === type);

  window.FX = { start, end, sync, has, Sound };
})();
