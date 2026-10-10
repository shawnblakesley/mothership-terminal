import crypto from "node:crypto";
import deepseek from "./deepseek.js";
import claude from "./claude.js";
import free from "./free.js";

export const PROVIDERS = [deepseek, claude, free];

const ALLOW_SERVER_KEYS = process.env.ALLOW_SERVER_KEYS === "1";

export function getProvider(id) {
  return PROVIDERS.find((p) => p.id === id);
}

export const LOCAL_KEYS = Symbol.for("mothership.localKeys");
const DEV_SERVER = process.env.NODE_ENV !== "production";

export const SITE_KEYS = Symbol.for("mothership.siteKeys");
export const siteKeyOn = () => !!(process.env.ANTHROPIC_API_KEY && process.env.CLAUDE_KEY_PASSWORD);
const digest = (s) => crypto.createHash("sha256").update(String(s)).digest();
const wrong = new Map();
// "ok" for the site password, "limited" after 10 wrong tries from one address in 10 minutes, else "" (counted). Light protection, in memory.
export function sitePassword(providerId, text, ip) {
  const t = String(text || "").trim();
  if (providerId !== "claude" || !siteKeyOn() || !t || looksLikeKey(providerId, t)) return "";
  const now = Date.now();
  let w = wrong.get(ip);
  if (!w || now - w.start > 600_000) wrong.set(ip, (w = { start: now, n: 0 }));
  if (w.n >= 10) return "limited";
  if (crypto.timingSafeEqual(digest(t), digest(process.env.CLAUDE_KEY_PASSWORD))) return "ok";
  w.n++;
  return "";
}

export function keyFor(providerId, sessionKeys = {}) {
  const p = getProvider(providerId);
  if (providerId === "claude" && sessionKeys[SITE_KEYS] && siteKeyOn()) return process.env.ANTHROPIC_API_KEY;
  if (p?.serverKeyOnly) return process.env[p.envKey] || "";
  const serverKeys = ALLOW_SERVER_KEYS || (DEV_SERVER && !!sessionKeys[LOCAL_KEYS]);
  return sessionKeys[providerId] || (serverKeys && p ? process.env[p.envKey] : "") || "";
}

export const offered = (p) => !p.serverKeyOnly || !!process.env[p.envKey];

export function defaultSelection(sessionKeys = {}) {
  const p = PROVIDERS.find((x) => keyFor(x.id, sessionKeys)) ?? PROVIDERS[0];
  const m = p.models[0];
  return { provider: p.id, model: m.id, effort: m.efforts[0] ?? "" };
}

export function fixSelection({ provider, model, effort }) {
  const p = getProvider(provider);
  if (!p) return defaultSelection();
  const m = p.models.find((x) => x.id === model) ?? p.models[0];
  const e = m.efforts.includes(effort) ? effort : (m.efforts[0] ?? "");
  return { provider: p.id, model: m.id, effort: e };
}

export function catalog(sessionKeys = {}) {
  return PROVIDERS.filter(offered).map((p) => ({
    id: p.id,
    label: p.label,
    free: !!p.serverKeyOnly,
    keyHint: p.keyHint,
    keyUrl: p.keyUrl,
    configured: !!keyFor(p.id, sessionKeys),
    ...(p.id === "claude" && sessionKeys[SITE_KEYS] && siteKeyOn() ? { siteKey: true } : {}),
    models: p.models.map(({ id, label, efforts }) => ({ id, label, efforts })),
  }));
}

export function looksLikeKey(providerId, key) {
  const k = String(key || "").trim();
  if (k.length < 20 || k.length > 300 || /\s/.test(k)) return false;
  const p = getProvider(providerId);
  return !p?.keyPattern || p.keyPattern.test(k);
}
