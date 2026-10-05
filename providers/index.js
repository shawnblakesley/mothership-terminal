// Provider registry. To add a provider, write a module that exports
// { id, label, envKey, keyHint, models: [{ id, label, efforts }], generate() }
// (see claude.js, or reuse openai-compatible.js) and add it below.
//
// API keys belong to sessions: each Warden pastes their own key in the console.
// Keys from the server's environment are only used when ALLOW_SERVER_KEYS=1
// (handy for a private LAN install; never set it on a public server).
//
// A provider with serverKeyOnly (free.js) always uses the server's key and
// never takes one from a Warden; it's offered only when that key is set.
//
// Order matters: a new session defaults to the first provider it has a key
// for, and its first model, so keep model lists cheapest-first. The free
// provider goes last so a Warden's own key always wins.

import deepseek from "./deepseek.js";
import claude from "./claude.js";
import free from "./free.js";

export const PROVIDERS = [deepseek, claude, free];

const ALLOW_SERVER_KEYS = process.env.ALLOW_SERVER_KEYS === "1";

export function getProvider(id) {
  return PROVIDERS.find((p) => p.id === id);
}

// The key a session should use for a provider: its own, or (opt-in) the server's.
// A session started on this computer (server.js isLocalRequest) carries
// LOCAL_KEYS: it may use the server's own keys from .env, like a pasted one.
// Never on a production server, whatever a saved session says.
export const LOCAL_KEYS = Symbol.for("mothership.localKeys");
const DEV_SERVER = process.env.NODE_ENV !== "production";

export function keyFor(providerId, sessionKeys = {}) {
  const p = getProvider(providerId);
  if (p?.serverKeyOnly) return process.env[p.envKey] || "";
  const serverKeys = ALLOW_SERVER_KEYS || (DEV_SERVER && !!sessionKeys[LOCAL_KEYS]);
  return sessionKeys[providerId] || (serverKeys && p ? process.env[p.envKey] : "") || "";
}

// Is this provider offered at all? (The free one only with the server's key.)
export const offered = (p) => !p.serverKeyOnly || !!process.env[p.envKey];

// The cheapest model the session has a key for (or the cheapest overall).
export function defaultSelection(sessionKeys = {}) {
  const p = PROVIDERS.find((x) => keyFor(x.id, sessionKeys)) ?? PROVIDERS[0];
  const m = p.models[0];
  return { provider: p.id, model: m.id, effort: m.efforts[0] ?? "" };
}

// Repair a (provider, model, effort) triple so it's always valid.
export function fixSelection({ provider, model, effort }) {
  const p = getProvider(provider);
  if (!p) return defaultSelection();
  const m = p.models.find((x) => x.id === model) ?? p.models[0];
  const e = m.efforts.includes(effort) ? effort : (m.efforts[0] ?? "");
  return { provider: p.id, model: m.id, effort: e };
}

// What the Warden console needs to draw the pickers (never the keys themselves).
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

// Light shape check so typos are caught before the first reply fails.
export function looksLikeKey(providerId, key) {
  const k = String(key || "").trim();
  if (k.length < 20 || k.length > 300 || /\s/.test(k)) return false;
  const p = getProvider(providerId);
  return !p?.keyPattern || p.keyPattern.test(k);
}
