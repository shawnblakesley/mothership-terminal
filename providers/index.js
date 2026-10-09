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

export function keyFor(providerId, sessionKeys = {}) {
  const p = getProvider(providerId);
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
    models: p.models.map(({ id, label, efforts }) => ({ id, label, efforts })),
  }));
}

export function looksLikeKey(providerId, key) {
  const k = String(key || "").trim();
  if (k.length < 20 || k.length > 300 || /\s/.test(k)) return false;
  const p = getProvider(providerId);
  return !p?.keyPattern || p.keyPattern.test(k);
}
