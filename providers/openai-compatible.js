export function openAICompatible({ id, label, envKey, keyHint, keyUrl, keyPattern, baseURL, models, maxOutput = 8000, rateLimitText = "rate limited — wait a moment and regenerate.", authText = "authentication failed. Check the API key in the Warden console.", buildExtras = () => ({}) }) {
  return {
    id,
    label,
    envKey,
    keyHint,
    keyUrl,
    keyPattern,
    models,

    async generate({ apiKey, model, effort, system, context, messages, schema, example, maxTokens = 8000 }) {
      if (!apiKey) throw new Error("No LLM API key. Add one under ⚙ Settings → LLM.");
      const spec = models.find((m) => m.id === model) ?? models[0];

      const body = {
        model: spec.id,
        max_tokens: Math.min(maxTokens, maxOutput),
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: `${system}\n\n${context}\n\n${jsonInstructions(schema, example)}` },
          ...messages,
        ],
        ...buildExtras({ model: spec, effort }),
      };

      let res;
      try {
        res = await fetch(`${baseURL}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(180_000),
        });
      } catch (err) {
        throw new Error(`${label}: could not reach the API (${err.message}).`);
      }

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = data?.error?.message || res.statusText;
        if (res.status === 401) throw new Error(`${label}: ${authText}`);
        if (res.status === 402) throw new Error(`${label}: out of credit (402). Top up or switch provider.`);
        if (res.status === 429) throw new Error(`${label}: ${rateLimitText}`);
        throw new Error(`${label} API error ${res.status}: ${msg}`);
      }

      const choice = data?.choices?.[0];
      const text = choice?.message?.content ?? "";
      if (choice?.finish_reason === "length") throw new Error(`${label}: reply was cut off. Regenerate.`);
      if (!text.trim()) throw Object.assign(new Error(`${label}: returned an empty reply. Regenerate.`), { malformed: true });
      return text;
    },
  };
}

// additionalProperties and required only matter to a strict schema validator (Claude's), not to the text a JSON-mode model reads; the example shows every field.
const readable = (schema) => JSON.stringify(schema, (k, v) => (k === "additionalProperties" || (k === "required" && Array.isArray(v)) ? undefined : v));

export function jsonInstructions(schema, example) {
  return `OUTPUT FORMAT
Respond with ONE json object and nothing else, matching this JSON Schema:
${readable(schema)}${example ? `\n\nExample (shape only; include every field):\n${JSON.stringify(example)}` : ""}`;
}
