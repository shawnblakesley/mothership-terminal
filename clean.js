export const keyOf = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
export const slug = (s) => keyOf(s).slice(0, 30);
export const roomId = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 60);
export const clampInt = (v, min, max, def) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};
