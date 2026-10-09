const held = new Set();
const SHAPES = String.raw`sk-(?:ant-)?[A-Za-z0-9_\-]{8,}|gsk_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|gh[opsu]_[A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9._\-]{12,}`;
const shapesAll = () => new RegExp(SHAPES, "g");
const shapesAny = new RegExp(SHAPES);

export function rememberSecret(value) {
  const s = String(value ?? "").trim();
  if (s.length >= 8) held.add(s);
}

export function redact(text) {
  let s = String(text);
  for (const k of held) if (s.includes(k)) s = s.split(k).join("[redacted]");
  return s.replace(shapesAll(), "[redacted]");
}

// What the players' map may show: not the roster, and nothing the agent keeps under a secret or hidden key.
const HIDDEN_KEY = /^(secret|hidden)([_.-].*)?$/i;
export function playerStation(station) {
  const walk = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !HIDDEN_KEY.test(k)).map(([k, v]) => [k, v && typeof v === "object" && !Array.isArray(v) ? walk(v) : v]));
  const { occupants, ...rest } = station || {};
  return walk(rest);
}

export function looksSecret(text) {
  const s = String(text);
  if (shapesAny.test(s)) return true;
  for (const k of held) if (s.includes(k)) return true;
  return false;
}

const safeString = (a) => {
  if (typeof a === "string") return redact(a);
  if (a instanceof Error) return redact(a.stack || a.message);
  if (a && typeof a === "object") {
    try { return redact(JSON.stringify(a)); } catch { return "[object]"; }
  }
  return a;
};

export function guardConsole() {
  for (const m of ["log", "info", "warn", "error", "debug", "trace"]) {
    const orig = console[m].bind(console);
    console[m] = (...args) => orig(...args.map(safeString));
  }
}
