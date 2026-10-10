import Anthropic from "@anthropic-ai/sdk";
import { jsonInstructions } from "./openai-compatible.js";

const MODELS = [
  { id: "claude-haiku-5-5", label: "Haiku 5.5 · $0.10 / $0.50 per MTok", efforts: ["low", "medium", "high"] },
  { id: "claude-haiku-4-5", label: "Haiku 4.5 · $1 / $5", efforts: [] },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5 · $2 / $10", efforts: ["low", "medium", "high"], fallbacks: true },
  { id: "claude-opus-5-5", label: "Opus 5.5 · $4 / $20", efforts: ["low", "medium", "high"], fallbacks: true },
];

// Schemas Anthropic refused to compile as a strict grammar (too large): those requests go as JSON text with the schema in the prompt, as for DeepSeek.
const tooLarge = new Set();
const grammarTooLarge = (err) => err instanceof Anthropic.BadRequestError && /grammar is too large|schema is too (large|complex)/i.test(err.message || "");
// The JSON object in a text reply, without code fences or words around it.
const jsonOnly = (text) => { const a = text.indexOf("{"), b = text.lastIndexOf("}"); return a >= 0 && b > a ? text.slice(a, b + 1) : text; };

const clients = new Map();
function clientFor(apiKey) {
  if (!clients.has(apiKey)) {
    if (clients.size > 200) clients.delete(clients.keys().next().value);
    clients.set(apiKey, new Anthropic({ apiKey }));
  }
  return clients.get(apiKey);
}

export default {
  id: "claude",
  label: "Claude (Anthropic)",
  envKey: "ANTHROPIC_API_KEY",
  keyHint: "sk-ant-... or the site password",
  keyUrl: "https://console.anthropic.com/settings/keys",
  keyPattern: /^sk-ant-/,
  models: MODELS,

  async generate({ apiKey, model, effort, system, context, messages, schema, example }) {
    if (!apiKey) throw new Error("No LLM API key. Add one under ⚙ Settings → LLM.");
    const client = clientFor(apiKey);
    const spec = MODELS.find((m) => m.id === model) ?? MODELS[0];

    const key = schema ? JSON.stringify(schema) : "";
    const request = (strict) => ({
      model: spec.id,
      max_tokens: 16000,
      system: [
        { type: "text", text: system, cache_control: { type: "ephemeral" } },
        { type: "text", text: context },
        ...(schema && !strict ? [{ type: "text", text: jsonInstructions(schema, example) }] : []),
      ],
      messages,
      output_config: {
        ...(strict ? { format: { type: "json_schema", schema } } : {}),
        ...(spec.efforts.includes(effort) ? { effort } : {}),
      },
    });
    const send = (params) => spec.fallbacks
      ? client.beta.messages.create({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" })
      : client.messages.create(params);

    let strict = !!schema && !tooLarge.has(key), response;
    try {
      try {
        response = await send(request(strict));
      } catch (err) {
        if (!strict || !grammarTooLarge(err)) throw err;
        tooLarge.add(key);
        strict = false;
        response = await send(request(false));
      }
    } catch (err) {
      throw new Error(describeError(err));
    }

    if (response.stop_reason === "refusal") {
      throw new Error(`Model declined (${response.stop_details?.category ?? "no category"}). Reply manually, or steer and regenerate.`);
    }
    const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    if (response.stop_reason === "max_tokens") throw new Error("Reply was cut off (max_tokens). Regenerate.");
    return schema && !strict ? jsonOnly(text) : text;
  },
};

function describeError(err) {
  if (err instanceof Anthropic.AuthenticationError) return "Claude: authentication failed. Check the API key in the Warden console.";
  if (err instanceof Anthropic.RateLimitError) return "Claude: rate limited — wait a moment and regenerate.";
  if (err instanceof Anthropic.APIConnectionError) return "Claude: could not reach the API — check your connection.";
  if (err instanceof Anthropic.APIError) return `Claude API error ${err.status}: ${err.message}`;
  if (/authentication method/i.test(err?.message || "")) return "No LLM API key. Add one under ⚙ Settings → LLM.";
  return `Claude: ${err?.message || err}`;
}
