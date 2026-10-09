import { prepare, synthesize, wavSeconds } from "./tts.js";

const CACHE_BYTES = 32 * 1024 * 1024;
const WAIT_MS = { espeak: 8000, neural: 30000 };
const BACKOFF_MS = 60000;

export class VoiceRelay {
  engine = null;
  jobs = new Map();
  cache = new Map();
  bytes = 0;
  nextJob = 0;
  backoffUntil = 0;

  attach(ws, { neural = false } = {}) {
    this.engine = { ws, neural: !!neural };
  }

  detach(ws) {
    if (this.engine?.ws !== ws) return;
    this.engine = null;
    for (const job of [...this.jobs.values()]) job.fail();
  }

  usable(neural) {
    const e = this.engine;
    return !!e && e.ws.readyState === 1 && (!neural || e.neural) && Date.now() >= this.backoffUntil;
  }

  speak(text, voice, fx = {}) {
    const job = prepare(text, voice);
    if (!job) return Promise.resolve(null);
    const onServer = () => synthesize(text, voice).then((wav) => (wav ? { wav, seconds: wavSeconds(wav) / (fx.rate || 1), composed: false } : null));
    if (!this.usable(job.neural)) return onServer();
    const key = `${job.key}|${JSON.stringify(fx)}`;
    const hit = this.cache.get(key);
    if (hit) {
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit.clip;
    }
    const entry = { clip: this.ask(job, fx).catch(onServer), bytes: 0 };
    this.cache.set(key, entry);
    entry.clip.then((clip) => {
      if (!clip?.composed) return this.cache.delete(key);
      entry.bytes = clip.wav.length;
      this.bytes += entry.bytes;
      for (const [k, e] of this.cache) {
        if (this.bytes <= CACHE_BYTES) break;
        if (k === key) continue;
        this.cache.delete(k);
        this.bytes -= e.bytes;
      }
    });
    return entry.clip;
  }

  ask(job, fx) {
    const id = String(++this.nextJob);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.backoffUntil = Date.now() + BACKOFF_MS;
        fail();
      }, job.neural ? WAIT_MS.neural : WAIT_MS.espeak);
      const end = () => { clearTimeout(timer); this.jobs.delete(id); };
      const fail = () => { end(); reject(new Error("no clip from the Warden's console")); };
      this.jobs.set(id, { fail, done: (clip) => { end(); resolve(clip); } });
      this.engine.ws.send(JSON.stringify({ t: "speak", id, engine: job.neural ? "neural" : "espeak", text: job.text, opts: job.opts, fx }));
    });
  }

  receive(id, wav, seconds) {
    const job = this.jobs.get(String(id));
    if (!job) return false;
    if (!(seconds > 0 && seconds < 600) || !wavSeconds(wav)) job.fail();
    else job.done({ wav, seconds, composed: true });
    return true;
  }

  failed(id) {
    this.jobs.get(String(id))?.fail();
  }
}
