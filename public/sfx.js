(() => {
  const buffers = new Map();
  const wanted = new Map();
  const live = new Map();
  let urlFor = (id) => id;

  const ready = () => window.FX && FX.Sound.ok();

  function load(id) {
    if (!buffers.has(id)) {
      buffers.set(id, fetch(urlFor(id))
        .then((r) => (r.ok ? r.arrayBuffer() : null))
        .then((b) => (b ? FX.Sound.ctx.decodeAudioData(b) : null))
        .catch(() => null)
        .then((buf) => { if (!buf) buffers.delete(id); return buf; }));
    }
    return buffers.get(id);
  }

  async function start(req) {
    const buf = await load(req.id);
    if (!buf || wanted.get(req.pid) !== req || live.has(req.pid)) return;
    const c = FX.Sound.ctx;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = !!req.loop;
    const gain = c.createGain();
    gain.gain.setValueAtTime(req.loop ? 0 : req.volume, c.currentTime);
    if (req.loop) gain.gain.linearRampToValueAtTime(req.volume, c.currentTime + 1.5);
    src.connect(gain).connect(FX.Sound.bus());
    src.onended = () => {
      if (live.get(req.pid)?.src === src) { live.delete(req.pid); wanted.delete(req.pid); }
    };
    live.set(req.pid, { src, gain });
    src.start();
  }

  function sync() {
    if (!ready()) return;
    for (const req of wanted.values()) if (!live.has(req.pid)) start(req);
  }
  setInterval(sync, 1000);

  function play(req) {
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
    sync(list) {
      const keep = new Set(list.map((p) => p.pid));
      for (const pid of [...wanted.keys()]) if (!keep.has(pid)) stop(pid);
      for (const p of list) if (!wanted.has(p.pid)) wanted.set(p.pid, p);
      sync();
    },
  };
})();
