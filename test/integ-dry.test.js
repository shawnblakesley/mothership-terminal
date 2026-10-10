import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

// Keeps the live regression scenarios from rotting without spending a token: --dry builds every scenario's request and calls no model.
test("every integration scenario still builds its request (regress --dry)", () => {
  const env = { ...process.env };
  for (const k of ["DEEPSEEK_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY", "INTEG"]) delete env[k];
  const out = execFileSync(process.execPath, ["test/integ/regress.mjs", "--dry", "--runs=1"], { env, encoding: "utf8" });
  const m = out.match(/(\d+)\/(\d+) scenarios passed; \d+\/\d+ runs; 0 model calls/);
  assert.ok(m, out);
  assert.equal(m[1], m[2]);
  assert.ok(Number(m[2]) >= 40);
});
