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
    // A horror sting, for a reveal (about 1 s): a quick hiss swelling up, then a sharp
    // crack over a sub-bass hit, a bright dissonant chord snapping shut, and a high
    // screech sliding down. (into: any AudioContext and node, for testing.)
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
      // 3. the stab: a bright dissonant cluster (a tritone, and a semitone rub up high), snapping shut
      { const f = ctx.createBiquadFilter(), g = ctx.createGain();
        f.type = "lowpass"; f.Q.value = 3;
        f.frequency.setValueAtTime(4200, hit); f.frequency.exponentialRampToValueAtTime(600, hit + 0.85);
        g.gain.setValueAtTime(0.0001, hit); g.gain.exponentialRampToValueAtTime(0.34, hit + 0.008); g.gain.exponentialRampToValueAtTime(0.13, hit + 0.3); g.gain.exponentialRampToValueAtTime(0.06, hit + 0.72); g.gain.exponentialRampToValueAtTime(0.0001, hit + 0.86);
        for (const [hz, det] of [[110, -2], [155.6, 2], [233, -2], [246.9, 3], [329.6, -2]]) { // (the semitone rub up high: harsh, not warbling)
          const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = hz; o.detune.value = det;
          o.connect(f); o.start(hit); o.stop(hit + 0.9);
        }
        f.connect(g); g.connect(out); }
      // 4. the screech: high and thin, sliding down fast
      { const o = ctx.createOscillator(), lfo = ctx.createOscillator(), depth = ctx.createGain(), f = ctx.createBiquadFilter(), g = ctx.createGain();
        o.type = "sawtooth";
        o.frequency.setValueAtTime(2600, hit); o.frequency.exponentialRampToValueAtTime(1100, hit + 0.85);
        lfo.frequency.value = 6; depth.gain.value = 8; // (a faint tremble, not a warble) lfo.connect(depth); depth.connect(o.frequency);
        f.type = "bandpass"; f.frequency.value = 2000; f.Q.value = 2.5;
        g.gain.setValueAtTime(0.0001, hit); g.gain.exponentialRampToValueAtTime(0.16, hit + 0.06); g.gain.exponentialRampToValueAtTime(0.09, hit + 0.55); g.gain.exponentialRampToValueAtTime(0.045, hit + 0.75); g.gain.exponentialRampToValueAtTime(0.0001, hit + 0.86);
        o.connect(f); f.connect(g); g.connect(out); o.start(hit); lfo.start(hit); o.stop(hit + 0.9); lfo.stop(hit + 0.9); }
      return hit + 0.88 - t0; // (how long it lasts)
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

  // Players can drag across blood/goo to smear it off the glass.
  // Blood and goo can be wiped off the glass by dragging across them. The
  // overlay itself never takes the mouse (clicks go through to the buttons and
  // text underneath); the drag is watched on the whole page instead.
  function makeWipeable(c, ctx) {
    let last = null, dragged = 0;
    const wipe = (x, y) => {
      ctx.save();
      ctx.globalCompositeOperation = "destination-out";
      ctx.lineCap = "round";
      ctx.lineWidth = 70;
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.beginPath(); ctx.moveTo(last[0], last[1]); ctx.lineTo(x, y); ctx.stroke();
      ctx.restore();
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

  function blob(ctx, x, y, r, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    const n = 10 + Math.floor(Math.random() * 8);
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rr = r * rand(0.7, 1.25);
      const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath(); ctx.fill();
  }

  // ---------------------------------------------------------------- effects
  const builders = {
    blood(fx) {
      const { c, ctx, w, h } = fullCanvas();
      c.className = "fx-canvas";
      const n = fx.intensity * 2 + 1;
      const drips = [];
      const colors = ["rgba(110,0,0,0.92)", "rgba(140,6,6,0.88)", "rgba(80,0,0,0.95)"];
      for (let s = 0; s < n; s++) {
        const cx = rand(w * 0.1, w * 0.9), cy = rand(h * 0.05, h * 0.75);
        const R = rand(30, 70) * (0.7 + fx.intensity * 0.3);
        const col = colors[s % colors.length];
        for (let i = 0; i < 9; i++) blob(ctx, cx + rand(-R, R) * 0.5, cy + rand(-R, R) * 0.5, R * rand(0.35, 0.8), col);
        // spatter spikes + droplets
        for (let i = 0; i < 26; i++) {
          const a = rand(0, Math.PI * 2), d = R * rand(1, 3.2);
          const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
          ctx.strokeStyle = col; ctx.lineWidth = rand(1, 4); ctx.lineCap = "round";
          ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * R * 0.7, cy + Math.sin(a) * R * 0.7); ctx.lineTo(x, y); ctx.stroke();
          blob(ctx, x, y, rand(2, 7), col);
        }
        for (let i = 0; i < 3 + fx.intensity; i++) {
          drips.push({ x: cx + rand(-R, R) * 0.6, y: cy + rand(0, R * 0.4), r: rand(3, 7), v: rand(0.4, 1.4), life: rand(80, 320), col });
        }
      }
      layer().append(c);
      makeWipeable(c, ctx, () => document.getElementById("in")?.focus());
      Sound.burst(0.35, 0.5, 500);
      let raf;
      const step = () => {
        for (const d of drips) {
          if (d.life <= 0) continue;
          ctx.fillStyle = d.col;
          ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2); ctx.fill();
          d.y += d.v; d.v *= 0.997; d.r = Math.max(1.5, d.r * 0.9995); d.life--;
        }
        raf = requestAnimationFrame(step);
      };
      step();
      return { el: c, stop: () => cancelAnimationFrame(raf) };
    },

    goo(fx) {
      const { c, ctx, w, h } = fullCanvas();
      c.className = "fx-canvas fx-goo";
      const col = () => `rgba(${rand(90, 140) | 0},${rand(200, 255) | 0},${rand(30, 80) | 0},${rand(0.5, 0.7)})`;
      // A wavy sheet along the top edge
      const band = h * (0.06 + fx.intensity * 0.06);
      ctx.fillStyle = col();
      ctx.beginPath(); ctx.moveTo(0, 0);
      for (let x = 0; x <= w + 40; x += 40) ctx.lineTo(x, band + Math.sin(x / 70) * 18 + rand(-10, 10));
      ctx.lineTo(w, 0); ctx.closePath(); ctx.fill();
      // Random globs
      for (let i = 0; i < 5 * fx.intensity; i++) blob(ctx, rand(0, w), rand(0, h * 0.8), rand(20, 90), col());
      const drips = [];
      for (let i = 0; i < 10 * fx.intensity; i++) {
        drips.push({ x: rand(0, w), y: band * rand(0.6, 1), r: rand(6, 16), v: rand(0.15, 0.7), life: rand(300, 1400), col: col() });
      }
      layer().append(c);
      makeWipeable(c, ctx, () => document.getElementById("in")?.focus());
      Sound.burst(0.6, 0.35, 250);
      let raf;
      const step = () => {
        for (const d of drips) {
          if (d.life <= 0) continue;
          ctx.fillStyle = d.col;
          ctx.beginPath(); ctx.arc(d.x + Math.sin(d.y / 40) * 1.5, d.y, d.r, 0, Math.PI * 2); ctx.fill();
          d.y += d.v; d.life--;
          if (Math.random() < 0.002) d.v *= 0.5; // occasional stall
        }
        raf = requestAnimationFrame(step);
      };
      step();
      return { el: c, stop: () => cancelAnimationFrame(raf) };
    },

    crack() {
      const w = innerWidth, h = innerHeight;
      const ox = rand(w * 0.2, w * 0.8), oy = rand(h * 0.2, h * 0.8);
      let paths = "";
      const rays = 9 + Math.floor(rand(0, 6));
      for (let i = 0; i < rays; i++) {
        let a = (i / rays) * Math.PI * 2 + rand(-0.2, 0.2), x = ox, y = oy, d = "M" + x + " " + y;
        const len = rand(0.5, 1.2) * Math.max(w, h);
        for (let s = 0; s < len; s += rand(20, 60)) {
          a += rand(-0.25, 0.25);
          x += Math.cos(a) * rand(20, 60); y += Math.sin(a) * rand(20, 60);
          d += ` L${x.toFixed(1)} ${y.toFixed(1)}`;
        }
        paths += `<path d="${d}"/>`;
      }
      for (let r = 1; r <= 3; r++) {
        const rad = r * rand(25, 45);
        let d = "";
        for (let i = 0; i <= rays; i++) {
          const a = (i / rays) * Math.PI * 2;
          const rr = rad * rand(0.8, 1.2);
          d += `${i ? "L" : "M"}${(ox + Math.cos(a) * rr).toFixed(1)} ${(oy + Math.sin(a) * rr).toFixed(1)} `;
        }
        paths += `<path d="${d}" opacity="0.7"/>`;
      }
      const d = el("fx-crack", `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
        <g class="shadow">${paths}</g><g class="line">${paths}</g>
        <circle cx="${ox}" cy="${oy}" r="10" class="impact"/></svg>`);
      layer().append(d);
      Sound.burst(0.15, 0.7, 3000);
      Sound.burst(0.4, 0.3, 1200);
      return { el: d };
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

    glitch(fx) {
      const root = crt();
      root.classList.add("glitching", `glitch-${fx.intensity}`);
      const iv = setInterval(() => {
        root.style.setProperty("--gx", `${rand(-8, 8) * fx.intensity}px`);
        root.style.setProperty("--gy", `${rand(-3, 3) * fx.intensity}px`);
        root.style.setProperty("--gs", `${rand(0, 100)}%`);
        if (Math.random() < 0.25) Sound.burst(0.06, 0.15, 4000);
      }, 90);
      return {
        el: null,
        stop: () => { clearInterval(iv); root.classList.remove("glitching", `glitch-${fx.intensity}`); },
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

    corrupt(fx) {
      const glyphs = "▓▒░█▄▀■□◊¥§¤ØÆ#%&@!?/\\|<>{}[]~^*";
      const iv = setInterval(() => {
        const lines = document.querySelectorAll("#lines .line.done");
        for (const el of lines) {
          const line = el.querySelector(".lt") || el; // (beside a portrait: just its text)
          if (!line.dataset.orig) line.dataset.orig = line.textContent;
          const orig = line.dataset.orig;
          const p = 0.04 * fx.intensity + Math.random() * 0.05;
          let out = "";
          for (const ch of orig) out += ch !== "\n" && ch !== " " && Math.random() < p ? glyphs[(Math.random() * glyphs.length) | 0] : ch;
          line.textContent = out;
        }
      }, 120);
      return {
        el: null,
        stop: () => {
          clearInterval(iv);
          for (const line of document.querySelectorAll("#lines .line[data-orig], #lines .line .lt[data-orig]")) {
            line.textContent = line.dataset.orig;
            delete line.dataset.orig;
          }
        },
      };
    },
  };

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
