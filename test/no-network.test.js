import { test } from "node:test";
import assert from "node:assert/strict";
import https from "node:https";

test("the unit-test guard refuses a call to a real API", async () => {
  await assert.rejects(async () => fetch("https://api.deepseek.com/chat/completions", { method: "POST" }), /unit tests must not call the network: api\.deepseek\.com/);
  assert.throws(() => https.request("https://api.anthropic.com/v1/messages"), /must not call the network/);
});

test("no API key or bot token reaches the unit tests", () => {
  for (const k of ["DEEPSEEK_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY", "DISCORD_BOT_TOKEN"]) assert.equal(process.env[k], undefined, k);
});
