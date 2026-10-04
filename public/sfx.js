// The Warden's sound library on the player screen: one-shots (an attack, a
// scream) and loops (a low growl, ambience). Everything plays through the
// terminal's master volume (FX.Sound.bus), so the VOL meter and mute apply.
// Exposes window.Sfx.
(() => {
  const buffers = new Map(); // sound id -> Promise<AudioBuffer|null>
  const wanted = new Map(); // pid -> play request ({ pid, id, loop, volume }) still to start or playing
  const live = new Map(); // pid -> { src, gain }
  let urlFor = (id) => id;

  const ready = () => window.FX && FX.Sound.ok();

  function load(id) {
    if (!buffers.has(id)) {
      buffers.set(id, fetch(urlFor(id))
        .then((r) => (r.ok ? r.arrayBuffer() : null))
        .then((b) => (b ? FX.Sound.ctx.decodeAudioData(b) : null))
        .catch(() => null)
        .then((buf) => { if (!buf) buffers.delete(id); return buf; })); // let a failed load retry
    }
    return buffers.get(id);
  }

  async function start(req) {
    const buf = await load(req.id);
    // Stopped (or already started) while loading? Then never mind.
    if (!buf || wanted.get(req.pid) !== req || live.has(req.pid)) return;
    const c = FX.Sound.ctx;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = !!req.loop;
    const gain = c.createGain();
    // Loops fade in like a sound rising out of the station; one-shots hit at once.
    gain.gain.setValueAtTime(req.loop ? 0 : req.volume, c.currentTime);
    if (req.loop) gain.gain.linearRampToValueAtTime(req.volume, c.currentTime + 1.5);
    src.connect(gain).connect(FX.Sound.bus());
    src.onended = () => {
      if (live.get(req.pid)?.src === src) { live.delete(req.pid); wanted.delete(req.pid); }
    };
    live.set(req.pid, { src, gain });
    src.start();
  }

  // Start whatever should be playing. Loops that arrive before the terminal's
  // audio is unlocked (a key press) start once it is.
  function sync() {
    if (!ready()) return;
    for (const req of wanted.values()) if (!live.has(req.pid)) start(req);
  }
  setInterval(sync, 1000);

  function play(req) {
    // A one-shot only makes sense now: if sound is off, skip it rather than play it late.
    if (!req.loop && !ready()) return;
    wanted.set(req.pid, req);
    sync();
  }

  function stop(pid) {
    wanted.delete(pid);
    const s = live.get(pid);
    if (!s) return;
    live.delete(pid);
    const t = FX.Sound.ctx.currentTime;
    s.gain.gain.cancelScheduledValues(t);
    s.gain.gain.setValueAtTime(s.gain.gain.value, t);
    s.gain.gain.linearRampToValueAtTime(0, t + 0.8);
    try { s.src.stop(t + 0.85); } catch {}
  }

  function stopAll() {
    for (const pid of [...wanted.keys(), ...live.keys()]) stop(pid);
  }

  function setVolume(pid, volume) {
    const req = wanted.get(pid);
    if (req) req.volume = volume;
    const s = live.get(pid);
    if (s) s.gain.gain.setTargetAtTime(volume, FX.Sound.ctx.currentTime, 0.15);
  }

  window.Sfx = {
    setUrl(fn) { urlFor = fn; },
    play,
    stop,
    stopAll,
    setVolume,
    // On (re)connect: the loops that should be running now.
    sync(list) {
      const keep = new Set(list.map((p) => p.pid));
      for (const pid of [...wanted.keys()]) if (!keep.has(pid)) stop(pid);
      for (const p of list) if (!wanted.has(p.pid)) wanted.set(p.pid, p);
      sync();
    },
    // Warden console: listen to a sound locally (its own audio, not the players').
    preview: (() => {
      let ctx = null, cur = null;
      return async (url, volume = 0.8) => {
        ctx ??= new (window.AudioContext || window.webkitAudioContext)();
        await ctx.resume();
        try { cur?.stop(); } catch {}
        const buf = await fetch(url).then((r) => r.arrayBuffer()).then((b) => ctx.decodeAudioData(b)).catch(() => null);
        if (!buf) return null;
        const src = ctx.createBufferSource();
        const g = ctx.createGain();
        g.gain.value = volume;
        src.buffer = buf;
        src.connect(g).connect(ctx.destination);
        src.start();
        cur = src;
        return { duration: buf.duration, stop: () => { try { src.stop(); } catch {} } };
      };
    })(),
  };
})();
