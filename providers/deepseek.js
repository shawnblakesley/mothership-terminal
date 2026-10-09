import { openAICompatible } from "./openai-compatible.js";

export default openAICompatible({
  id: "deepseek",
  label: "DeepSeek",
  envKey: "DEEPSEEK_API_KEY",
  keyHint: "sk-...",
  keyUrl: "https://platform.deepseek.com/api_keys",
  keyPattern: /^sk-/,
  baseURL: "https://api.deepseek.com",
  models: [
    { id: "deepseek-flash", label: "Flash · $0.15 / $0.60 per MTok", efforts: ["off", "low", "high"] },
    { id: "deepseek-v4-pro", label: "V4 Pro · $0.66 / $1.98", efforts: ["off", "low", "high"] },
  ],
  buildExtras: ({ effort }) =>
    effort && effort !== "off"
      ? { thinking: { type: "enabled" }, reasoning_effort: effort }
      : { thinking: { type: "disabled" } },
});
