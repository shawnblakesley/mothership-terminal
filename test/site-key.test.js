import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
process.env.NODE_ENV = "production";
process.env.ANTHROPIC_API_KEY = "sk-ant-sitekey-0000000000000";
process.env.CLAUDE_KEY_PASSWORD = "open-sesame-42";
const { keyFor, sitePassword, catalog } = await import("../providers/index.js");
const { Session } = await import("../session.js");
const { redact, rememberSecret } = await import("../redact.js");

function session(saved = {}) {
  Session.prototype.usesNeural = () => false;
  const sent = [];
  const s = new Session({ code: "SITE", tokenHash: "x", game: {}, ...saved }, { onChange() {}, onEnd() {} });
  Object.assign(s, { touch() {}, syncDm() {}, toPlayers() {}, send: (_to, m) => sent.push(m), initPlayers() {}, sendHeader() {} });
  return { s, sent };
}
const ws = (ip) => ({ clientIp: ip });
const key = (s, text, ip = "1.1.1.1", provider = "claude") => s.handleDm({ t: "apiKey", provider, key: text }, ws(ip));

test("the site password gives a Claude session the server key, in production, and it survives a save and load", () => {
  const { s } = session();
  key(s, "open-sesame-42");
  assert.equal(keyFor("claude", s.keys), process.env.ANTHROPIC_API_KEY);
  assert.deepEqual(s.state.siteKeys, ["claude"]);
  assert.equal(catalog(s.keys).find((p) => p.id === "claude").siteKey, true);
  const saved = JSON.parse(JSON.stringify(s.toJSON()));
  assert.ok(!JSON.stringify(saved).includes("open-sesame-42"));
  const { s: again } = session({ game: saved.game });
  assert.equal(keyFor("claude", again.keys), process.env.ANTHROPIC_API_KEY);
  assert.equal(keyFor("claude", {}), "", "no password, no server key");
  key(again, "sk-ant-own-key-000000000000000");
  assert.equal(keyFor("claude", again.keys), "sk-ant-own-key-000000000000000");
  assert.deepEqual(again.state.siteKeys, []);
});

test("wrong passwords fail, the 11th try from one address is refused, a real-looking key still works", () => {
  const { s, sent } = session();
  for (let i = 0; i < 10; i++) key(s, `nope-${i}`, "2.2.2.2");
  assert.equal(keyFor("claude", s.keys), "");
  assert.match(sent.at(-1).text, /Not a valid/);
  key(s, "open-sesame-42", "2.2.2.2");
  assert.match(sent.at(-1).text, /Too many tries/);
  assert.equal(keyFor("claude", s.keys), "");
  key(s, "sk-ant-real-looking-0000000000", "2.2.2.2");
  assert.equal(keyFor("claude", s.keys), "sk-ant-real-looking-0000000000");
  assert.equal(sitePassword("claude", "open-sesame-42", "3.3.3.3"), "ok");
});

test("the password unlocks nothing but Claude, and the feature needs both settings", () => {
  const { s } = session();
  process.env.DEEPSEEK_API_KEY = "sk-deepseek-server-0000000000";
  try {
    key(s, "open-sesame-42", "4.4.4.4", "deepseek");
    assert.equal(keyFor("deepseek", s.keys), "");
    assert.equal(keyFor("free", s.keys), "");
  } finally { delete process.env.DEEPSEEK_API_KEY; }
  for (const k of ["ANTHROPIC_API_KEY", "CLAUDE_KEY_PASSWORD"]) {
    const was = process.env[k];
    delete process.env[k];
    try {
      assert.equal(sitePassword("claude", "open-sesame-42", "5.5.5.5"), "");
      const { s: t } = session();
      key(t, "open-sesame-42", "5.5.5.5");
      assert.equal(keyFor("claude", t.keys), "");
    } finally { process.env[k] = was; }
  }
});

test("the password is redacted from logs", () => {
  assert.match(fs.readFileSync(new URL("../server.js", import.meta.url), "utf8"), /"CLAUDE_KEY_PASSWORD"\]\) rememberSecret/);
  rememberSecret(process.env.CLAUDE_KEY_PASSWORD);
  assert.ok(!redact("tried open-sesame-42 here").includes("open-sesame-42"));
});
