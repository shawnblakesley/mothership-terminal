// Panic on the player's own screen: a short treatment for each Panic Table result (1-20).
// Presentation only. It never touches Stress, stats or conditions, and it undoes everything it touched when it ends.
// The server decides who sees what: only the panicking player gets { role: "self" }; Close crew get a flash for Jumpy.
(() => {
  const root = () => {
    let r = document.getElementById("panicfx");
    if (!r) { r = document.createElement("div"); r.id = "panicfx"; r.setAttribute("aria-hidden", "true"); document.body.append(r); }
    return r;
  };
  const crt = () => document.getElementById("crt");
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const reduced = () => document.body.classList.contains("calm") || matchMedia("(prefers-reduced-motion: reduce)").matches;
  const snd = () => window.FX?.Sound;
  const audio = () => { const s = snd(); return s && s.ok() ? s : null; };
  const SCRAMBLE = "ABCDEFGHJKLMNPRSTUVWXYZ#%&?";

  // Everything a treatment touches goes through the kit, so ending (or being cut off) undoes all of it.
  function makeKit(ctx, gentle) {
    const undo = [], timers = [];
    const t = {
      ctx, gentle,
      el(cls, html = "", parent = root()) {
        const e = document.createElement("div");
        e.className = `pf ${cls}`;
        e.innerHTML = html;
        parent.append(e);
        undo.push(() => e.remove());
        return e;
      },
      cls(el, ...names) { el.classList.add(...names); undo.push(() => el.classList.remove(...names)); },
      at(ms, fn) { timers.push(setTimeout(fn, ms)); },
      every(ms, fn) { const i = setInterval(fn, ms); undo.push(() => clearInterval(i)); },
      undo(fn) { undo.push(fn); },
      end() {
        timers.forEach(clearTimeout);
        undo.splice(0).reverse().forEach((f) => { try { f(); } catch {} });
      },
      // sound, always quiet and always stopped
      thump(f0 = 90, dur = 0.18, gain = 0.45) {
        const S = audio(); if (!S) return;
        const now = S.ctx.currentTime, o = S.ctx.createOscillator(), g = S.out(gain);
        o.type = "sine";
        o.frequency.setValueAtTime(f0, now); o.frequency.exponentialRampToValueAtTime(Math.max(20, f0 * 0.4), now + dur);
        g.gain.setValueAtTime(gain, now); g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
        o.connect(g); o.start(now); o.stop(now + dur + 0.03);
      },
      tone(freq, secs, gain = 0.04, type = "sine", wobble = 0) {
        const S = audio(); if (!S) return;
        const o = S.ctx.createOscillator(), g = S.out(gain);
        o.type = type; o.frequency.value = freq;
        let lfo, depth;
        if (wobble) { lfo = S.ctx.createOscillator(); depth = S.ctx.createGain(); lfo.frequency.value = wobble; depth.gain.value = freq * 0.06; lfo.connect(depth); depth.connect(o.frequency); lfo.start(); }
        o.connect(g); o.start();
        const stop = () => { try { o.stop(); lfo?.stop(); } catch {} g.disconnect(); };
        undo.push(stop);
        timers.push(setTimeout(stop, secs * 1000));
      },
      // filtered noise that swells and fades in a pattern: breathing, whispering
      swell(secs, { period = 1, freq = 600, type = "lowpass", q = 0.7, gain = 0.06, sweep = 0 } = {}) {
        const S = audio(); if (!S) return;
        const src = S.ctx.createBufferSource(), f = S.ctx.createBiquadFilter(), g = S.out(0.0001);
        src.buffer = S.noiseBuffer(); src.loop = true;
        f.type = type; f.frequency.value = freq; f.Q.value = q;
        const now = S.ctx.currentTime;
        for (let at = 0, i = 0; at < secs; at += period, i++) {
          g.gain.setTargetAtTime(gain * rand(0.6, 1), now + at, period * 0.18);
          g.gain.setTargetAtTime(0.0001, now + at + period * 0.45, period * 0.12);
          if (sweep) f.frequency.setTargetAtTime(freq + rand(-sweep, sweep), now + at, 0.1);
        }
        src.connect(f); f.connect(g); src.start();
        const stop = () => { try { src.stop(); } catch {} g.disconnect(); };
        undo.push(stop);
        timers.push(setTimeout(stop, secs * 1000));
      },
      beat(strong = 1) { t.thump(70, 0.14, 0.42 * strong); timers.push(setTimeout(() => t.thump(55, 0.18, 0.3 * strong), 140)); },
      pulse() { if (!gentle) { crt().classList.add("pf-pulse"); setTimeout(() => crt().classList.remove("pf-pulse"), 110); } },
    };
    return t;
  }

  // Static, optionally with a dim tall shape in it (a smear, not a face).
  function drawStatic(canvas, shape = 0) {
    const g = canvas.getContext("2d"), w = canvas.width, h = canvas.height, im = g.createImageData(w, h), d = im.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let v = Math.random() * 255;
        if (shape) {
          const u = x / w, s = y / h;
          const body = Math.exp(-(((u - 0.62) / 0.05) ** 2)) * Math.min(1, Math.max(0, (s - 0.22) * 6)) * Math.min(1, Math.max(0, (0.98 - s) * 8));
          const shoulders = Math.exp(-(((u - 0.62) / 0.12) ** 2)) * Math.exp(-(((s - 0.4) / 0.08) ** 2));
          v *= 1 - shape * Math.min(0.92, body + shoulders * 0.7);
        }
        const i = (y * w + x) * 4;
        d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
      }
    }
    g.putImageData(im, 0, 0);
  }
  const staticCanvas = (t, cls, shape = 0, animate = true) => {
    const c = document.createElement("canvas");
    c.width = 128; c.height = 72; c.className = `pf ${cls}`;
    root().append(c);
    t.undo(() => c.remove());
    drawStatic(c, shape);
    if (animate && !t.gentle) t.every(80, () => drawStatic(c, shape));
    return c;
  };

  const FLOOD = ["I CAN'T", "TOO MUCH", "NO NO NO", "WHAT DO I DO", "SOMEONE", "LOOK OUT", "HOW MANY", "BREATHE", "TOO LOUD", "WHERE IS", "NOT AGAIN", "GET OUT", "I CAN'T BREATHE", "HELP", "NOW NOW NOW"];

  // Each treatment: (kit) => milliseconds it runs. Gentle (reduced motion) versions use slow fades only.
  const T = {
    1(t) { // Adrenaline Rush: sharper, brighter, fast heartbeat
      t.cls(crt(), "pf-sharp");
      const beats = 9;
      for (let i = 0; i < beats; i++) t.at(300 + i * 400, () => { t.beat(); t.pulse(); });
      t.el("pf-glow");
      return 4200;
    },
    2(t) { // Nervous: a jolt
      t.cls(crt(), t.gentle ? "pf-soft-flash" : "pf-jolt");
      t.thump(110, 0.12, 0.4); t.at(90, () => t.thump(160, 0.06, 0.2));
      if (t.gentle) t.el("pf-flash gentle");
      return 1500;
    },
    3(t) { // Jumpy: a bigger jolt and a flash
      t.cls(crt(), t.gentle ? "pf-soft-flash" : "pf-jolt-big");
      t.el(`pf-flash${t.gentle ? " gentle" : ""}`);
      t.thump(120, 0.16, 0.5); t.at(120, () => t.thump(170, 0.08, 0.3));
      return 1900;
    },
    4(t) { // Overwhelmed: text floods and stacks
      const box = t.el("pf-flood");
      const add = () => {
        const line = document.createElement("div");
        line.textContent = pick(FLOOD);
        line.style.fontSize = `${rand(0.9, 2.6).toFixed(2)}em`;
        line.style.marginLeft = `${rand(0, 60).toFixed(0)}%`;
        if (t.gentle) line.className = "soft";
        box.append(line);
        while (box.children.length > 70) box.firstChild.remove();
      };
      t.every(t.gentle ? 420 : 70, add);
      t.swell(5.4, { period: 0.5, freq: 300, gain: 0.05 });
      return 5800;
    },
    5(t) { // Coward: the cursor flees to the corner
      const input = t.ctx.input, r = (input || document.body).getBoundingClientRect();
      t.cls(crt(), "pf-nocaret");
      const c = t.el("pf-cursor", "&#9608;");
      const x0 = r.left + 14, y0 = r.top + r.height / 2 - 12;
      c.style.transform = `translate(${x0}px, ${y0}px)`;
      const corner = x0 < innerWidth / 2 ? [innerWidth - 40, innerHeight - 40] : [8, 8];
      t.at(500, () => {
        c.classList.add("flee");
        c.style.transform = `translate(${corner[0]}px, ${corner[1]}px)`;
        [520, 440, 360, 300].forEach((f, i) => t.at(i * 260, () => t.tone(f, 0.08, 0.03, "square")));
      });
      if (!t.gentle) t.at(2300, () => c.classList.add("shiver"));
      return 5200;
    },
    6(t) { // Frightened: what frightened them, as ??? in large type
      const e = t.el("pf-big", "???");
      if (t.gentle) e.classList.add("soft");
      t.tone(48, 3.6, 0.07, "sine", 0.4);
      t.thump(70, 0.5, 0.35);
      return 4200;
    },
    7(t) { // Nightmares: dark, with eyes in it for an instant
      const dark = t.el("pf-dark");
      requestAnimationFrame(() => requestAnimationFrame(() => dark.classList.add("on")));
      t.at(2300, () => {
        const eyes = t.el("pf-eyes");
        for (let i = 0; i < 3; i++) {
          const pair = document.createElement("div");
          pair.className = "pair";
          pair.style.left = `${rand(8, 84).toFixed(0)}%`; pair.style.top = `${rand(12, 78).toFixed(0)}%`;
          pair.style.setProperty("--s", rand(0.7, 1.8).toFixed(2));
          pair.innerHTML = "<i></i><i></i>";
          eyes.append(pair);
        }
        t.thump(60, 0.3, 0.3);
        t.at(t.gentle ? 1100 : 380, () => eyes.remove());
      });
      t.at(3200, () => dark.classList.remove("on"));
      t.tone(40, 4, 0.06, "sine", 0.3);
      return 4900;
    },
    8(t) { // Loss of Confidence: the skills list flickers and one entry goes grey
      let lost = -1, found = false;
      const lists = () => document.querySelectorAll("#side .cs-skills .cs-list, #crewfile-body .cs-skills .cs-list");
      const tick = (on) => {
        for (const list of lists()) {
          found = true;
          if (lost < 0 || lost >= list.children.length) lost = Math.floor(rand(0, list.children.length));
          list.classList.toggle("pf-dip", on && !t.gentle);
          list.children[lost]?.classList.add("pf-lost");
        }
      };
      t.every(t.gentle ? 400 : 110, () => tick(Math.random() < 0.5));
      t.at(150, () => { tick(true); if (!found) t.el("pf-caption", "A SKILL SLIPS AWAY."); });
      t.undo(() => { for (const list of lists()) { list.classList.remove("pf-dip"); list.querySelectorAll(".pf-lost").forEach((e) => e.classList.remove("pf-lost")); } });
      for (let i = 0; i < 5; i++) t.at(200 + i * 330, () => snd()?.tick());
      return 4600;
    },
    9(t) { // Deflated: the colour drains
      t.cls(crt(), "pf-gray");
      t.tone(180, 2.4, 0.04, "triangle", 0.2);
      t.at(300, () => t.tone(120, 2, 0.03, "triangle"));
      return 5600;
    },
    10(t) { // Doomed: one line
      const dark = t.el("pf-dark");
      requestAnimationFrame(() => requestAnimationFrame(() => dark.classList.add("on")));
      const line = t.el("pf-line", "<span></span>");
      const text = "IT'S ALREADY OVER.", out = line.firstChild;
      let i = 0;
      t.at(900, () => t.every(t.gentle ? 40 : 95, () => { if (i < text.length) out.textContent = text.slice(0, ++i); }));
      t.at(4300, () => { dark.classList.remove("on"); line.classList.add("gone"); });
      t.tone(52, 4.5, 0.06, "sine");
      return 5400;
    },
    11(t) { // Suspicious: the others' names scramble
      const me = t.ctx.me, others = (t.ctx.crew || []).filter((c) => c.id !== me?.id);
      const words = new Set();
      for (const c of others) for (const w of c.name.split(/[\s"'“”‘’]+/)) if (w.length >= 3) words.add(w.toUpperCase());
      const scope = () => document.querySelectorAll("#side, #crewfile-body, #cb-crew");
      const orig = new Map();
      const scramble = (w) => [...w].map(() => pick(SCRAMBLE)).join("");
      const sweep = (final) => {
        let n = 0;
        for (const el of scope()) {
          const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const base = orig.has(node) ? orig.get(node) : node.data;
            const up = base.toUpperCase();
            let hit = false;
            let text = base;
            for (const w of words) {
              let at = up.indexOf(w);
              while (at >= 0) { hit = true; text = text.slice(0, at) + (final ? w : scramble(w)) + text.slice(at + w.length); at = up.indexOf(w, at + w.length); }
            }
            if (hit) { if (!orig.has(node)) orig.set(node, base); node.data = text; n++; }
          }
        }
        return n;
      };
      const settle = () => { for (const [node, text] of orig) if (node.isConnected) node.data = text; orig.clear(); };
      let any = 0;
      t.every(t.gentle ? 500 : 130, () => { any += sweep(false) ? 1 : 0; });
      t.at(200, () => { if (!any && !sweep(false)) t.el("pf-caption", "WHO IS THAT, REALLY?"); });
      t.undo(settle);
      t.swell(3.6, { period: 0.9, type: "bandpass", freq: 2200, q: 3, gain: 0.04, sweep: 700 });
      return 4200;
    },
    12(t) { // Haunted: a whisper and a shape in the static
      const c = staticCanvas(t, "pf-static", 0.85);
      if (t.gentle) c.classList.add("soft");
      t.swell(4.6, { period: 0.7, type: "bandpass", freq: 2600, q: 5, gain: 0.07, sweep: 900 });
      return 5200;
    },
    13(t) { // Death Wish: red edges
      t.el(`pf-edges${t.gentle ? " soft" : ""}`);
      t.tone(55, 5, 0.05, "sine"); t.tone(58.5, 5, 0.04, "sine");
      return 5600;
    },
    14(t) { // Prophetic Vision: two seconds of the adversary's picture, heavily glitched; static only if there is none
      const src = t.ctx.vision;
      const box = t.el(`pf-vision${t.gentle ? " soft" : ""}`);
      const pic = document.createElement("canvas");
      pic.width = 320; pic.height = 180;
      box.append(pic);
      const g = pic.getContext("2d");
      const img = new Image();
      let ready = false;
      img.referrerPolicy = "no-referrer";
      if (src) { img.onload = () => { ready = true; }; img.src = src; }
      const draw = () => {
        g.fillStyle = "#000"; g.fillRect(0, 0, 320, 180);
        if (!ready || !img.naturalWidth) return;
        const k = Math.min(300 / img.naturalWidth, 170 / img.naturalHeight), w = img.naturalWidth * k, h = img.naturalHeight * k;
        g.drawImage(img, (320 - w) / 2, (180 - h) / 2, w, h);
        if (t.gentle) return;
        for (let i = 0; i < 7; i++) { const y = rand(0, 170), hh = rand(3, 26); g.drawImage(pic, 0, y, 320, hh, rand(-26, 26), y, 320, hh); }
        if (Math.random() < 0.25) { g.globalCompositeOperation = "difference"; g.fillStyle = "#fff"; g.fillRect(0, rand(0, 150), 320, rand(4, 30)); g.globalCompositeOperation = "source-over"; }
      };
      const noise = staticCanvas(t, "pf-static over", 0);
      t.every(t.gentle ? 400 : 70, draw);
      t.undo(() => noise.remove());
      t.swell(1.9, { period: 0.4, type: "highpass", freq: 3000, gain: 0.06 });
      t.tone(260, 1.8, 0.025, "sawtooth", 7);
      return 2100;
    },
    15(t) { // Catatonic: the input freezes and a flatline plays
      const form = document.getElementById("inputrow");
      if (form) { form.inert = true; t.undo(() => { form.inert = false; t.ctx.focusInput?.(); }); }
      t.el("pf-dim");
      t.el("pf-flat");
      t.tone(1000, 5.6, 0.035, "sine");
      return 6000;
    },
    16(t) { // Rage: red flood and heavy breathing
      t.el(`pf-rage${t.gentle ? " soft" : ""}`);
      t.swell(5.2, { period: 1.1, freq: 420, gain: 0.12 });
      t.tone(70, 5, 0.04, "sawtooth", 3);
      return 5600;
    },
    17(t) { // Spiraling: the screen slowly turns a few degrees and back
      if (t.gentle) { t.el("pf-dark soft on"); t.tone(110, 3, 0.03, "sine", 0.6); return 3500; }
      t.cls(crt(), "pf-spiral");
      t.tone(110, 6.4, 0.035, "sine", 0.5);
      return 7000;
    },
    18(t) { // Compounding Problems is two results played back to back (see play); on its own, a short pile-up of static and a jolt
      staticCanvas(t, "pf-static soft");
      t.cls(crt(), t.gentle ? "pf-soft-flash" : "pf-jolt");
      t.thump(100, 0.2, 0.4);
      return 2400;
    },
    19(t) { // Heart attack, or for an android a shutdown and reboot
      if (t.ctx.android) {
        if (t.gentle) {
          const d = t.el("pf-dark");
          requestAnimationFrame(() => requestAnimationFrame(() => d.classList.add("on")));
          t.at(2600, () => d.classList.remove("on"));
        } else {
          t.el("pf-half top"); t.el("pf-half bot"); t.el("pf-seam");
          t.at(200, () => t.tone(900, 0.5, 0.04, "sawtooth", 0));
          t.at(900, () => t.thump(50, 0.6, 0.4));
        }
        const log = t.el("pf-boot", "<span></span>"), out = log.firstChild;
        const lines = ["SYSTEM FAULT.", "POWER LOST.", "", "REBOOTING...", "CHECKING MEMORY... OK", "ONLINE."];
        let i = 0;
        t.at(3000, () => t.every(500, () => { if (i < lines.length) { out.textContent += `${lines[i++]}\n`; snd()?.tick(); } }));
        return 7000;
      }
      const gaps = [350, 430, 300, 420, 260, 200, 500, 700];
      let at = 300;
      gaps.forEach((gap, i) => { t.at(at, () => { t.beat(1 - i * 0.07); t.pulse(); }); at += gap; });
      t.at(at + 500, () => { t.el("pf-dark on"); t.tone(1000, 2.2, 0.03, "sine"); });
      return at + 3200;
    },
    20(t) { // Retire: fade to a closed card
      const d = t.el("pf-dark slow");
      requestAnimationFrame(() => requestAnimationFrame(() => d.classList.add("on")));
      const name = String(t.ctx.me?.name || "").toUpperCase();
      const card = t.el("pf-card", `<b>CREW FILE CLOSED</b>${name ? `<span>${name.replace(/[&<>"]/g, "")}</span>` : ""}`);
      t.at(2400, () => card.classList.add("on"));
      t.at(6200, () => { card.classList.remove("on"); d.classList.remove("on"); });
      t.tone(60, 6, 0.05, "sine");
      return 7800;
    },
  };

  // The flash on a Close player's screen when someone Jumpy goes off
  T.near = (t) => { t.el(`pf-flash${t.gentle ? " gentle" : ""}`); t.thump(150, 0.1, 0.25); return 700; };

  let current = null, token = 0;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  function stop() {
    token++;
    if (current) { current.end(); current = null; }
    document.getElementById("panicfx")?.replaceChildren();
  }

  async function playOne(key, ctx) {
    const treat = T[key];
    if (!treat) return;
    const t = makeKit(ctx, reduced());
    current = t;
    const my = token;
    const ms = treat(t);
    await wait(ms);
    if (my !== token) return;
    t.end();
    current = null;
  }

  async function play(msg, ctx = {}) {
    stop();
    const my = token;
    const seq = (msg.seq || []).filter((n) => Number.isInteger(n) && n >= 1 && n <= 20);
    const full = { ...ctx, android: !!msg.android, vision: typeof msg.vision === "string" ? msg.vision : "" };
    if (msg.role === "near") return playOne("near", full);
    for (let i = 0; i < seq.length; i++) {
      await playOne(seq[i], full);
      if (my !== token) return;
      if (i < seq.length - 1) await wait(400);
      if (my !== token) return;
    }
  }

  window.PanicFx = { play, stop, reduced, treatments: Object.keys(T).filter((k) => /^\d+$/.test(k)).map(Number) };
})();
