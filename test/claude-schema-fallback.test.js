import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

// A stand-in for the Anthropic API on localhost: a strict schema is refused as too large, JSON text comes back in a code fence.
function fakeAnthropic() {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const r = JSON.parse(body);
      seen.push(r);
      res.setHeader("content-type", "application/json");
      if (r.output_config?.format) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "The compiled grammar is too large, which would cause performance issues. Simplify your tool schemas or reduce the number of strict tools." } }));
      }
      res.end(JSON.stringify({ id: "msg_1", type: "message", role: "assistant", model: r.model, stop_reason: "end_turn", content: [{ type: "text", text: 'Here it is:\n```json\n{"lines":[]}\n```' }], usage: { input_tokens: 1, output_tokens: 1 } }));
    });
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok({ server, seen, url: `http://127.0.0.1:${server.address().port}` })));
}

test("a schema too large for Claude's strict grammar is sent again as JSON text, and later requests skip the strict try", async () => {
  const { server, seen, url } = await fakeAnthropic();
  const was = process.env.ANTHROPIC_BASE_URL;
  process.env.ANTHROPIC_BASE_URL = url;
  try {
    const { default: claude } = await import("../providers/claude.js");
    const schema = { type: "object", properties: { lines: { type: "array", items: { type: "string" } } }, required: ["lines"], additionalProperties: false };
    const ask = () => claude.generate({ apiKey: "sk-ant-test-fallback", model: "claude-haiku-5-5", effort: "low", system: "S", context: "C", messages: [{ role: "user", content: "hi" }], schema, example: { lines: [] } });
    assert.equal(await ask(), '{"lines":[]}', "the JSON comes back without the fence or the words around it");
    assert.equal(seen.length, 2);
    assert.ok(seen[0].output_config.format, "the first try is strict");
    assert.equal(seen[1].output_config.format, undefined, "the retry is plain text");
    assert.ok(seen[1].system.some((b) => /lines/.test(b.text) && b !== seen[1].system[0]), "the retry carries the schema in the prompt");
    assert.equal(await ask(), '{"lines":[]}');
    assert.equal(seen.length, 3, "the second request goes straight to text");
    assert.equal(seen[2].output_config.format, undefined);
  } finally {
    if (was === undefined) delete process.env.ANTHROPIC_BASE_URL; else process.env.ANTHROPIC_BASE_URL = was;
    server.close();
  }
});
