// Fixed game states for measuring and checking the agent's prompts (test/steering.test.js, scripts/measure-prompt.mjs).
// Nothing here calls a model.
import { buildRequest } from "../agent.js";
import { jsonInstructions } from "../providers/openai-compatible.js";

export { kestrelState, haulersState } from "./fixtures.mjs";

// What goes to the model for one normal reply, in characters, split by part.
export function promptSize(state, steer = "") {
  const r = buildRequest(state, steer);
  const messages = r.messages.reduce((n, m) => n + m.content.length, 0);
  const parts = { system: r.system.length, context: r.context.length, messages, format: jsonInstructions(r.schema, r.example).length };
  return { ...parts, total: Object.values(parts).reduce((a, b) => a + b, 0) };
}
