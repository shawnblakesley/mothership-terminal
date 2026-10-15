import test from "node:test";
import assert from "node:assert/strict";
import { splitExpression, stripExpression, hasExpression, sanitizeVoices } from "../voices.js";
import { prepare } from "../tts.js";
import { Session } from "../session.js";
import { playerEntry } from "../redact.js";

test("the agent's markup is spoken by a Kitten voice and stripped everywhere it is shown", () => {
  Session.prototype.usesNeural = () => false;
  const s = new Session({ code: "KITN", tokenHash: "x", game: {} }, { onChange() {}, onEnd() {} });
  s.touch = () => {};
  s.syncDm = () => {};
  s.speech.speak = async () => null;
  s.state.config.voices.find((v) => v.id === "narrator").voice = { engine: "kitten", kitten: "Victoria", speaker: "bm_george", pace: 1 };
  s.deliverReply({ lines: [
    { voice: "narrator", text: "[tender] The lights dim. <sigh> Something (((breathes)))." },
    { voice: "terminal", text: "<sigh> [ OK ] DOOR SEALED." },
  ] }, "agent");
  const narr = s.state.log.find((e) => e.text.startsWith("The lights"));
  assert.equal(narr.text, "The lights dim.\nSomething breathes.");
  assert.equal(narr.say, "[tender] The lights dim.\n[tender] <sigh> Something (((breathes))).");
  assert.equal(playerEntry(narr).say, undefined);
  const term = s.state.log.find((e) => e.text.includes("DOOR SEALED"));
  assert.equal(term.text, "[ OK ] DOOR SEALED.");
  assert.equal(term.say, undefined);
});

test("Kitten markup is shown stripped and spoken line for line, each line keeping the emotion", () => {
  const { text, say } = splitExpression("[nervous] I hear it. <gasp>\nIt's (((here))).\n<sigh>\nRun!");
  assert.equal(text, "I hear it.\nIt's here.\nRun!");
  assert.equal(say, "[nervous] I hear it. <gasp>\n[nervous] It's (((here))).\n[nervous] <sigh> Run!");
});

test("only Kitten's own tags are markup: terminal brackets and spacing survive", () => {
  assert.equal(hasExpression("[ OK ] <ERROR>  READY"), false);
  assert.equal(stripExpression("NAME    ROOM\n[sad] fine <laugh> ok"), "NAME    ROOM\nfine ok");
});

test("a Kitten voice is sanitized and prepared with its tags kept", () => {
  const [, , v] = sanitizeVoices([{ id: "x", voice: { engine: "kitten", kitten: "Frank" } }]);
  assert.equal(v.voice.engine, "kitten");
  assert.equal(v.voice.kitten, "Frank");
  assert.equal(sanitizeVoices([{ id: "y", voice: { engine: "kitten", kitten: "Nobody" } }])[2].voice.kitten, "Bruno");
  const job = prepare("[sad] THE DOOR IS SEALED. <sigh>", v.voice);
  assert.equal(job.kitten, true);
  assert.equal(job.say, "[sad] The door is sealed. <sigh>");
  assert.equal(prepare("<sigh>", v.voice), null);
});
