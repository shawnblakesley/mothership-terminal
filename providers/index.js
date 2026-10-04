// Provider registry. To add a provider, write a module that exports
// { id, label, envKey, models: [{ id, label, efforts }], isConfigured(), generate() }
// (see claude.js, or reuse openai-compatible.js) and add it below.
//
// Order matters: the default for a new session is the first configured
// provider's first model, so keep both lists cheapest-first.

import deepseek from "./deepseek.js";
import claude from "./claude.js";

export const PROVIDERS = [deepseek, claude];

export function getProvider(id) {
  return PROVIDERS.find((p) => p.id === id);
}

// The cheapest model you have a key for (or the cheapest overall if no keys yet).
export function defaultSelection() {
  const p = PROVIDERS.find((x) => x.isConfigured()) ?? PROVIDERS[0];
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

// What the DM console needs to draw the pickers.
export function catalog() {
  return PROVIDERS.map((p) => ({
    id: p.id,
    label: p.label,
    envKey: p.envKey,
    configured: p.isConfigured(),
    models: p.models.map(({ id, label, efforts }) => ({ id, label, efforts })),
  }));
}
