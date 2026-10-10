import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Session } from "../session.js";
import { campaignById, newProgress } from "../campaign.js";
import { decideCharacter, newDraft, rollFor, viewOf } from "../chargen.js";

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const dmHtml = read("public/dm.html");

function msgSetup() {
  Session.prototype.usesNeural = () => false;
  const s = new Session({ code: "MSG", tokenHash: "x", game: {} }, { onChange() {}, onEnd() {} });
  s.touch = () => {};
  s.syncDm = () => {};
  s.initPlayers = () => {};
  s.toPlayers = () => {};
  s.requestReply = () => {};
  const [rook, tick] = s.state.config.crew;
  const ws = { role: "player", readyState: 1, character: rook.id, terminal: "cargo", lastInput: 0, got: [], send(d) { this.got.push(JSON.parse(d)); } };
  s.sockets.add(ws);
  return { s, ws, tick };
}

test("a failed crew message says why: not at a terminal, on another system, or no such name", () => {
  const { s, ws } = msgSetup();
  s.handlePlayer(ws, { t: "msg", to: "Tick", text: "Hello?" });
  assert.match(ws.got.find((m) => m.t === "msgFail").text, /^NO SIGNAL \(THEY ARE NOT AT A TERMINAL ON THIS SYSTEM\)$/);
  ws.got.length = 0;
  ws.lastMsg = 0;
  s.handlePlayer(ws, { t: "msg", to: "Bob", text: "hi" });
  assert.match(ws.got.find((m) => m.t === "msgFail").text, /^NO SUCH CREWMEMBER \(USE A FIRST NAME OR NICKNAME/);
  const tickScreen = { role: "player", readyState: 1, character: s.state.config.crew[1].id, terminal: "ship", lastInput: 0, got: [], send(d) { this.got.push(JSON.parse(d)); } };
  s.sockets.add(tickScreen);
  ws.got.length = 0;
  ws.lastMsg = 0;
  s.handlePlayer(ws, { t: "msg", to: "Tick", text: "Hello?" });
  assert.match(ws.got.find((m) => m.t === "msgFail").text, /^NO ROUTE \(THEY ARE AT A TERMINAL ON ANOTHER SYSTEM\)$/);
});

test("the first story's cold open is logged as a title card, not as a recap that players never see", async () => {
  Session.prototype.usesNeural = () => false;
  const s = new Session({ code: "TEST", tokenHash: "x", game: {} }, { onChange() {}, onEnd() {} });
  s.touch = () => {};
  s.syncDm = () => {};
  s.send = () => {};
  s.initPlayers = () => {};
  s.speech = { speak: async () => null, detach() {} };
  s.toPlayers = () => {};
  const c = campaignById("rim-haulers");
  s.state.campaign = newProgress(c);
  await s.playRecap({ for: c.stories[0].id, beats: [], hook: "A hook." });
  const note = s.state.log.filter((e) => e.kind === "note").at(-1).text;
  assert.match(note, /^Cold open: the title card plays on every screen/);
  assert.match(note, /nothing to recap/);
  assert.ok(!/Previously on/.test(note));
  await s.playRecap({ for: c.stories[0].id, beats: [{ line: "They ran the blockade.", who: "" }], hook: "A hook." });
  assert.match(s.state.log.filter((e) => e.kind === "note").at(-1).text, /^Cold open: "Previously on RIM HAULERS" plays on every screen/);
});

test("accepting a replacement character puts it in the old one's place", () => {
  Session.prototype.usesNeural = () => false;
  const s = new Session({ code: "ACC", tokenHash: "x", game: {} }, { onChange() {}, onEnd() {} });
  s.touch = () => {};
  s.syncDm = () => {};
  s.initPlayers = () => {};
  s.toPlayers = () => {};
  const sheet = structuredClone(s.state.config.crew[0]);
  sheet.name = "Dmitri 'Crowbar' Velez";
  s.state.newChars = [{ id: "n1", sheet, history: [], replaces: s.state.config.crew[0].id }];
  assert.equal(decideCharacter(s, true, "n1"), "");
  const old = s.state.config.crew.find((c) => c.name !== sheet.name && c.replacedBy);
  assert.ok(old, "the old file points at its replacement");
  assert.equal(s.state.config.crew.find((c) => c.id === old.replacedBy).name, sheet.name);
});

test("a typed or rolled gear result is the die that is recorded, with the same two digits the player sees", () => {
  const d = newDraft();
  d.className = "Marine";
  rollFor(d, "trinket", { typed: [7] });
  rollFor(d, "patch", { typed: [51] });
  assert.deepEqual(d.dice.trinket, [7]);
  assert.match(d.history[0], /Trinket \(d100\): 07 \(physical dice, typed in\)$/);
  assert.match(d.history[1], /Patch \(d100\): 51 \(physical dice, typed in\)$/);
  const v = viewOf(d);
  assert.deepEqual(v.rolls.trinket.dice, [7]);
});

test("every Warden dialog has an accessible name, and every tab strip is a tablist", () => {
  for (const m of dmHtml.matchAll(/<dialog id="(\w+)"([^>]*)>/g)) {
    const by = /aria-labelledby="(\w+)"/.exec(m[2]);
    assert.ok(by || /aria-label=/.test(m[2]), `${m[1]} has no name`);
    if (by) assert.ok(new RegExp(`id="${by[1]}"`).test(dmHtml), `${m[1]} points at a missing id ${by[1]}`);
  }
  for (const m of dmHtml.matchAll(/<div class="tabs seg"[^>]*>/g)) assert.match(m[0], /role="tablist"/);
  const js = read("public/dm.js");
  assert.match(js, /setAttribute\("role", "tab"\)/);
  assert.match(js, /setAttribute\("aria-selected"/);
});

test("fields named only by a placeholder also have a name", () => {
  for (const id of ["compose", "docTitle", "docText", "bInput", "testText", "standingOrders", "wardenLink", "station", "mapLayout", "soundFile", "portraitFile", "advFile"]) {
    const tag = new RegExp(`<(?:input|textarea|select)[^>]*id="${id}"[^>]*>`).exec(dmHtml)?.[0];
    assert.ok(tag, id);
    assert.match(tag, /aria-label=/, `${id} has no name`);
  }
});

test("the Story Builder box says Enter sends and Enter sends it", () => {
  assert.match(dmHtml, /id="bHint"[^>]*>Enter sends/);
  assert.match(read("public/dm.js"), /\$\("bInput"\)\.addEventListener\("keydown", \(e\) => \{ if \(e\.key === "Enter" && !e\.shiftKey/);
});

test("the player screens speak of the AI, not a Warden, in a game without one; skip and withdrawal land focus and close the viewer", () => {
  const js = read("public/player.js");
  assert.match(js, /keeper = \(\) => \(solo \? "the AI" : "the Warden"\)/);
  assert.match(js, /Document withdrawn/);
  assert.match(js, /setAttribute\("aria-label", `Crew message /);
  assert.match(js, /accepted your character\. You are now/);
  assert.match(js, /if \(!\$\("crewpick"\)\.hidden\) focusPick\(\);\s*else if \(!document\.body\.classList\.contains\("panel-open"\) && !input\.disabled\) input\.focus\(\)/);
  const cg = read("public/chargen.js");
  assert.match(cg, /TYPE A NAME TO CONTINUE/);
  assert.match(cg, /WILL HAVE TO FILL/);
  assert.match(read("public/player.html"), /id="cg-why"[^>]*role="status"/);
});
