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
const HIDDEN_KEY = /^(secrets?|hidden)([_.-].*)?$/i;
export const hiddenPath = (path) => String(path).split(".").some((k) => HIDDEN_KEY.test(k));
// A log entry as players get it: a whitelist (never the agent's action list of cast, hazards, moves, items, time or station changes).
const ENTRY_FIELDS = ["id", "kind", "text", "ts", "net", "source", "entity", "character", "inPerson", "room", "variants", "reveal", "cues", "timing", "by", "at", "outcome", "shownAs", "speaker", "playing", "dir", "peer"];
export const playerEntry = (e) => {
  if (!e) return e;
  const out = {};
  for (const k of ENTRY_FIELDS) if (e[k] !== undefined) out[k] = e[k];
  return out;
};

// Build-time pass: a station value that holds a code from the story's secrets moves under secret.
const CODE = /\b(?:codes?|passwords?|passcodes?|passphrases?|keys?|overrides?|pin|sequence)\b[^\n]{0,25}?\b([A-Z0-9]+(?:-[A-Z0-9]+)+)/gi;
export function sealStation(station, secrets) {
  const codes = [...new Set([...String(secrets || "").matchAll(CODE)].map((m) => m[1]).filter((c) => c === c.toUpperCase() && c.length >= 6))];
  if (!codes.length) return station;
  const moved = {};
  const walk = (o, path) => {
    for (const [k, v] of Object.entries(o)) {
      if (HIDDEN_KEY.test(k)) continue;
      if (v && typeof v === "object") walk(v, [...path, k]);
      else if (typeof v === "string" && codes.some((c) => v.toUpperCase().includes(c))) { moved[[...path, k].join("_")] = v; delete o[k]; }
    }
  };
  walk(station, []);
  if (Object.keys(moved).length) station.secret = { ...station.secret, ...moved };
  return station;
}

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
