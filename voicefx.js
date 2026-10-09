import { Worker, isMainThread, parentPort } from "worker_threads";
import { FX_PARAMS } from "./voices.js";

const SR = 24000;

function readWav(buf, rate = 1, stereo = false) {
  if (buf.length < 44 || buf.toString("latin1", 0, 4) !== "RIFF") return null;
  let p = 12, fmt = null, data = null;
  while (p + 8 <= buf.length) {
    const id = buf.toString("latin1", p, p + 4), size = buf.readUInt32LE(p + 4);
    if (id === "fmt ") fmt = { format: buf.readUInt16LE(p + 8), channels: buf.readUInt16LE(p + 10), rate: buf.readUInt32LE(p + 12), bits: buf.readUInt16LE(p + 22) };
    if (id === "data") { data = buf.subarray(p + 8, Math.min(buf.length, p + 8 + size)); break; }
    p += 8 + size + (size & 1);
  }
  if (!fmt || !data) return null;
  const float = fmt.format === 3 || (fmt.format === 0xfffe && fmt.bits === 32);
  const bytes = fmt.bits / 8, frames = Math.floor(data.length / (bytes * fmt.channels));
  const sample = (i, ch) => {
    const o = (i * fmt.channels + ch) * bytes;
    return float ? data.readFloatLE(o) : bytes === 2 ? data.readInt16LE(o) / 32768 : 0;
  };
  const step = (fmt.rate / SR) * rate;
  const resample = (pick) => {
    const src = Float64Array.from({ length: frames }, (_, i) => pick(i));
    const out = new Float64Array(Math.max(0, Math.floor((frames - 1) / step)));
    for (let i = 0; i < out.length; i++) {
      const x = i * step, k = Math.floor(x), f = x - k;
      out[i] = src[k] * (1 - f) + (src[k + 1] ?? 0) * f;
    }
    return out;
  };
  if (stereo) return [resample((i) => sample(i, 0)), resample((i) => sample(i, fmt.channels - 1))];
  return resample((i) => {
    let sum = 0;
    for (let ch = 0; ch < fmt.channels; ch++) sum += sample(i, ch);
    return sum / fmt.channels;
  });
}

function biquad(type, freq, q) {
  const w = (2 * Math.PI * Math.min(freq, SR * 0.49)) / SR, cos = Math.cos(w), sin = Math.sin(w);
  let b0, b1, b2, a0, a1, a2;
  if (type === "bandpass") {
    const alpha = sin / (2 * q);
    [b0, b1, b2, a0, a1, a2] = [alpha, 0, -alpha, 1 + alpha, -2 * cos, 1 - alpha];
  } else {
    const alpha = sin / (2 * Math.pow(10, q / 20));
    const lo = type === "lowpass";
    [b0, b1, b2] = lo ? [(1 - cos) / 2, 1 - cos, (1 - cos) / 2] : [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2];
    [a0, a1, a2] = [1 + alpha, -2 * cos, 1 - alpha];
  }
  const B0 = b0 / a0, B1 = b1 / a0, B2 = b2 / a0, A1 = a1 / a0, A2 = a2 / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return (x) => {
    const y = B0 * x + B1 * x1 + B2 * x2 - A1 * y1 - A2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    return y;
  };
}

function delayLine(maxSeconds) {
  const n = Math.ceil(maxSeconds * SR) + 4, buf = new Float64Array(n);
  let w = 0;
  return {
    read(seconds) {
      const d = Math.max(1, seconds * SR), k = Math.floor(d), f = d - k;
      const a = buf[(w - k + n) % n], b = buf[(w - k - 1 + n) % n];
      return a * (1 - f) + b * f;
    },
    write(x) { buf[w] = x; w = (w + 1) % n; },
  };
}

function noise(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296) * 2 - 1;
}

function fft(re, im, inv) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inv ? 2 : -2) * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
  if (inv) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

const IMPULSE_SECONDS = 4.5;
const IMPULSE_LEN = Math.floor(SR * IMPULSE_SECONDS);
let impulse = null;
const impulseSpectra = new Map();
function impulseSpectrum(size) {
  if (!impulse) {
    const len = IMPULSE_LEN, rnd = noise(9);
    impulse = [0, 1].map(() => Float64Array.from({ length: len }, (_, i) => rnd() * Math.pow(1 - i / len, 2.6)));
    let power = 0;
    for (const ch of impulse) for (const x of ch) power += x * x;
    power = Math.max(Math.sqrt(power / (2 * len)), 0.000125);
    const scale = (1 / power) * 0.00125 * (44100 / SR);
    for (const ch of impulse) for (let i = 0; i < len; i++) ch[i] *= scale;
  }
  if (!impulseSpectra.has(size)) {
    impulseSpectra.clear();
    impulseSpectra.set(size, impulse.map((ch) => {
      const re = new Float64Array(size), im = new Float64Array(size);
      re.set(ch.subarray(0, size));
      fft(re, im, false);
      return { re, im };
    }));
  }
  return impulseSpectra.get(size);
}

function convolve(input, n) {
  let size = 1;
  while (size < input.length + IMPULSE_LEN) size <<= 1;
  const spec = impulseSpectrum(size);
  const xr = new Float64Array(size), xi = new Float64Array(size);
  xr.set(input);
  fft(xr, xi, false);
  return spec.map(({ re, im }) => {
    const r = new Float64Array(size), i = new Float64Array(size);
    for (let k = 0; k < size; k++) { r[k] = xr[k] * re[k] - xi[k] * im[k]; i[k] = xr[k] * im[k] + xi[k] * re[k]; }
    fft(r, i, true);
    return r.subarray(0, n);
  });
}

const FX_DEFAULTS = Object.fromEntries(Object.entries(FX_PARAMS).map(([k, [, , def]]) => [k, def]));
function render(wav, fx = {}) {
  if (fx === null) {
    const [left, right] = readWav(wav, 1, true) || [];
    return left?.length ? pcm48(left, right, left.length) : null;
  }
  const p = { ...FX_DEFAULTS, ...fx };
  const src = readWav(wav, p.rate || 1);
  if (!src || !src.length) return null;
  const len = src.length;
  let tail = 0.05;
  if (p.echo > 0) tail = Math.max(tail, Math.min(6, p.echoTime * (p.echoFeedback > 0.01 ? Math.log(0.001 / p.echo) / Math.log(p.echoFeedback) + 1 : 1)));
  if (p.reverb > 0) tail = Math.max(tail, IMPULSE_SECONDS);
  const n = len + Math.ceil(tail * SR);

  const hp = biquad("highpass", p.highpass, 0.7), lp = biquad("lowpass", p.lowpass, 0.7);
  const shape = p.drive > 0 ? (x) => Math.tanh(Math.max(-1, Math.min(1, x)) * p.drive) / Math.tanh(p.drive) : null;
  const comb = p.comb > 0 ? delayLine(0.05) : null;
  const chorus = p.chorus > 0 ? [[0.019, 0.23], [0.031, 0.31]].map(([base, hz]) => ({ base, hz, line: delayLine(0.1) })) : [];
  const echo = p.echo > 0 ? { line: delayLine(1.5), dark: biquad("lowpass", 2600, 0.7) } : null;
  const hiss = p.noise > 0 ? { rnd: noise(7), band: biquad("bandpass", 1800, 0.8) } : null;
  const noiseEnd = len, noiseFade = Math.round(0.15 * SR);

  const out = new Float64Array(n);
  const verbIn = p.reverb > 0 ? new Float64Array(n) : null;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let pre = lp(hp(i < len ? src[i] : 0));
    if (shape) pre = shape(pre);
    let bus = pre * (1 - p.ringMix);
    if (p.ringMix > 0) bus += pre * Math.sin(2 * Math.PI * p.ringFreq * t) * p.ringMix;
    let y = bus * p.dry;
    let v = bus * 0.5;
    if (comb) {
      const d = comb.read(p.combMs / 1000);
      comb.write(bus + d * 0.45);
      y += d * p.comb;
    }
    for (const c of chorus) {
      c.line.write(bus);
      const d = c.line.read(c.base + 0.005 * Math.sin(2 * Math.PI * c.hz * t));
      y += d * p.chorus;
      v += d * p.chorus;
    }
    if (echo) {
      const dark = echo.dark(echo.line.read(p.echoTime));
      echo.line.write(bus + dark * p.echoFeedback);
      y += dark * p.echo;
      v += dark * p.echo;
    }
    if (hiss) {
      const env = i < noiseEnd ? 1 : Math.max(0, 1 - (i - noiseEnd) / noiseFade);
      const h = hiss.band(hiss.rnd()) * p.noise * 0.12 * env;
      y += h;
    }
    out[i] = y;
    if (verbIn) verbIn[i] = v;
  }

  const [left, right] = verbIn ? convolve(verbIn, n).map((ch) => ch.map((x, i) => out[i] + x * p.reverb)) : [out, out];
  let end = n;
  while (end > len && Math.abs(left[end - 1]) < 1e-4 && Math.abs(right[end - 1]) < 1e-4) end--;
  return pcm48(left, right, end);
}

function pcm48(left, right, end) {
  const pcm = Buffer.alloc(end * 2 * 4);
  const s16 = (x) => Math.max(-32768, Math.min(32767, Math.round(x * 32767)));
  for (let i = 0; i < end; i++) {
    for (let h = 0; h < 2; h++) {
      const f = h / 2;
      const l = left[i] * (1 - f) + (left[i + 1] ?? 0) * f, r = right[i] * (1 - f) + (right[i + 1] ?? 0) * f;
      const o = (i * 2 + h) * 4;
      pcm.writeInt16LE(s16(l), o);
      pcm.writeInt16LE(s16(r), o + 2);
    }
  }
  return pcm;
}

if (!isMainThread && parentPort) {
  parentPort.on("message", ({ id, wav, fx }) => {
    let pcm = null;
    try { pcm = render(Buffer.from(wav), fx); } catch (err) { console.warn(`[voicefx] ${err.message}`); }
    parentPort.postMessage({ id, pcm }, pcm ? [pcm.buffer] : []);
  });
}

let worker = null, nextId = 0;
const waiting = new Map();
export function renderVoice(wav, fx) {
  if (!worker) {
    worker = new Worker(new URL(import.meta.url));
    worker.unref();
    worker.on("message", ({ id, pcm }) => { waiting.get(id)?.(pcm ? Buffer.from(pcm) : null); waiting.delete(id); });
    worker.on("error", (err) => {
      console.warn(`[voicefx] worker failed: ${err.message}`);
      for (const done of waiting.values()) done(null);
      waiting.clear();
      worker = null;
    });
  }
  const id = ++nextId;
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    worker.postMessage({ id, wav, fx });
  });
}
