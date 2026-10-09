// Small helpers for tidying what comes in: from the model, the Warden's console or a saved game.

// A name as a key: "Med Bay 2" -> "med-bay-2".
export const keyOf = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
// An id made from a name (crew, cast, terminals): a key, at most 30 characters.
export const slug = (s) => keyOf(s).slice(0, 30);
// A map room's id (lowercase letters, digits, underscores).
export const roomId = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 60);
// A whole number between min and max; def if it isn't a number at all.
export const clampInt = (v, min, max, def) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};
