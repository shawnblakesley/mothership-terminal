import Anthropic from "@anthropic-ai/sdk";

// Models are listed cheapest-first; the first one is the default.
const MODELS = [
  { id: "claude-haiku-4-5", label: "Haiku 4.5 · $1 / $5 per MTok", efforts: [] },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5 · $2 / $10", efforts: ["low", "medium", "high"], fallbacks: true },
  { id: "claude-opus-5-5", label: "Opus 5.5 · $4 / $20", efforts: ["low", "medium", "high"], fallbacks: true },
];

let client = null;

export default {
  id: "claude",
  label: "Claude (Anthropic)",
  envKey: "ANTHROPIC_API_KEY",
  models: MODELS,

  isConfigured() {
    return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_PROFILE);
  },

  async generate({ model, effort, system, context, messages, schema }) {
    client ??= new Anthropic();
    const spec = MODELS.find((m) => m.id === model) ?? MODELS[0];

    const params = {
      model: spec.id,
      max_tokens: 16000,
      // Stable prompt first (cacheable), per-turn GM context second.
      system: [
        { type: "text", text: system, cache_control: { type: "ephemeral" } },
        { type: "text", text: context },
      ],
      messages,
      output_config: {
        format: { type: "json_schema", schema },
        ...(spec.efforts.includes(effort) ? { effort } : {}),
      },
    };

    let response;
    try {
      response = spec.fallbacks
        ? await client.beta.messages.create({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" })
        : await client.messages.create(params);
    } catch (err) {
      throw new Error(describeError(err));
    }

    if (response.stop_reason === "refusal") {
      throw new Error(`Model declined (${response.stop_details?.category ?? "no category"}). Reply manually, or steer and regenerate.`);
    }
    const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    if (response.stop_reason === "max_tokens") throw new Error("Reply was cut off (max_tokens). Regenerate.");
    return text;
  },
};

function describeError(err) {
  if (err instanceof Anthropic.AuthenticationError) return "Claude: authentication failed — check ANTHROPIC_API_KEY.";
  if (err instanceof Anthropic.RateLimitError) return "Claude: rate limited — wait a moment and regenerate.";
  if (err instanceof Anthropic.APIConnectionError) return "Claude: could not reach the API — check your connection.";
  if (err instanceof Anthropic.APIError) return `Claude API error ${err.status}: ${err.message}`;
  if (/authentication method/i.test(err?.message || "")) return "Claude: no API key — set ANTHROPIC_API_KEY in .env and restart.";
  return `Claude: ${err?.message || err}`;
}
