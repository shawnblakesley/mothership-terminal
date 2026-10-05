import { openAICompatible } from "./openai-compatible.js";

// Free models on OpenRouter, paid for by nobody: for Wardens who don't want to
// bring a key. The key is the server's (OPENROUTER_API_KEY); Wardens never
// enter one, and the provider only appears when the server has it set.
// OpenRouter rate-limits free models per key, so every session shares one
// allowance; sessions are also capped per day (FREE_CALLS_PER_DAY, session.js).
// "openrouter/free" routes to whichever free model is up; the free lineup
// changes often, so check https://openrouter.ai/models?q=free when editing.
export default {
  ...openAICompatible({
    id: "free",
    label: "Free (shared)",
    envKey: "OPENROUTER_API_KEY",
    keyHint: "no key needed",
    keyUrl: "https://openrouter.ai/models?q=free",
    maxOutput: 16000, // (a whole story draft can need more than a reply)
    baseURL: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1", // (override: development only, e.g. a mock)
    rateLimitText: "the free model's shared limit is used up for now. Try again later, or add your own DeepSeek or Claude key under 🔑 Key.",
    authText: "the server's OpenRouter key was refused. Tell whoever runs this server, or add your own key under 🔑 Key.",
    models: [
      { id: "openrouter/free", label: "Auto · whichever free model is up", efforts: [] },
      { id: "nvidia/nemotron-3-super-120b-a12b:free", label: "Nemotron 3 Super", efforts: [] },
      { id: "google/gemma-4-31b-it:free", label: "Gemma 4 31B", efforts: [] },
    ],
  }),
  serverKeyOnly: true,
};
