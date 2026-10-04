// Base for any provider that speaks the OpenAI chat-completions format
// (DeepSeek, OpenRouter, Groq, Together, a local Ollama/LM Studio, ...).
// These APIs don't enforce a JSON schema, so the schema goes into the prompt
// and the server validates whatever comes back.

export function openAICompatible({ id, label, envKey, keyHint, keyUrl, keyPattern, baseURL, models, buildExtras = () => ({}) }) {
  return {
    id,
    label,
    envKey,
    keyHint,
    keyUrl,
    keyPattern,
    models,

    async generate({ apiKey, model, effort, system, context, messages, schema, example }) {
      if (!apiKey) throw new Error("No LLM API key. Add one under ⚙ Settings → LLM.");
      const spec = models.find((m) => m.id === model) ?? models[0];

      const body = {
        model: spec.id,
        max_tokens: 8000,
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
        if (res.status === 401) throw new Error(`${label}: authentication failed. Check the API key in the Warden console.`);
        if (res.status === 402) throw new Error(`${label}: out of credit (402). Top up or switch provider.`);
        if (res.status === 429) throw new Error(`${label}: rate limited — wait a moment and regenerate.`);
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

// `example` is an optional sample reply from the app, so the model copies the shape.
function jsonInstructions(schema, example) {
  return `OUTPUT FORMAT
Respond with ONE json object and nothing else, matching this JSON Schema:
${JSON.stringify(schema)}${example ? `\n\nExample (shape only):\n${JSON.stringify(example)}` : ""}`;
}
