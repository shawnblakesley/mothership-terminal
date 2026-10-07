// LLM keys must never reach a log. Two layers:
//   - the keys sessions actually hold are remembered (in memory only) and
//     replaced wherever they'd appear, whatever their shape;
//   - anything shaped like a credential (sk-..., sk-ant-..., gsk_..., AWS and GitHub
//     keys, bearer tokens) is replaced too.
// guardConsole() puts every console line through redact(); telemetry.js drops
// any event that would contain one (looksSecret).

const held = new Set();
const SHAPES = String.raw`sk-(?:ant-)?[A-Za-z0-9_\-]{8,}|gsk_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|gh[opsu]_[A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9._\-]{12,}`;
const shapesAll = () => new RegExp(SHAPES, "g");
const shapesAny = new RegExp(SHAPES);

// A key a session (or the server) holds.
export function rememberSecret(value) {
  const s = String(value ?? "").trim();
  if (s.length >= 8) held.add(s);
}

export function redact(text) {
  let s = String(text);
  for (const k of held) if (s.includes(k)) s = s.split(k).join("[redacted]");
  return s.replace(shapesAll(), "[redacted]");
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

// Every console line, from this app or its libraries, is redacted.
export function guardConsole() {
  for (const m of ["log", "info", "warn", "error", "debug", "trace"]) {
    const orig = console[m].bind(console);
    console[m] = (...args) => orig(...args.map(safeString));
  }
}
