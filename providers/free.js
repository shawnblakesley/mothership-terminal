import { openAICompatible } from "./openai-compatible.js";

export default {
  ...openAICompatible({
    id: "free",
    label: "Free (shared)",
    envKey: "OPENROUTER_API_KEY",
    keyHint: "no key needed",
    keyUrl: "https://openrouter.ai/models?q=free",
    maxOutput: 16000,
    baseURL: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
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
