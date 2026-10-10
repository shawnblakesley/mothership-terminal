import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { Session } from "../session.js";
import { RIM_HAULERS as c } from "../campaigns/rim-haulers.js";
import { newProgress, finishInto, sanitizeProgress } from "../campaign.js";

function make(saved = {}) {
  Session.prototype.usesNeural = () => false;
  const s = new Session({ code: "TEST", tokenHash: "x", ...saved }, { onChange() {}, onEnd() {} });
  s.touch = () => {};
  s.syncDm = () => {};
  s.toPlayers = () => {};
  s.initPlayers = () => {};
  s.send = () => {};
  return s;
}
const restart = (s) => make(JSON.parse(JSON.stringify(s)));

function withUndo(s, n = 1) {
  for (let i = 0; i < n; i++) {
    const before = s.state.log.length;
    s.deliver({ lines: [{ text: `Line ${i}`, voice: "narrator" }] }, "agent");
    if (s.state.log.length === before) throw new Error("the reply logged nothing");
  }
}

test("Retcon survives a restart, with the same cap", () => {
  const s = make();
  withUndo(s, 7);
  assert.equal(s.undoStack.length, 5);
  const r = restart(s);
  assert.equal(r.undoStack.length, 5);
  assert.ok(r.state.log.some((e) => e.text === "Line 6"));
  r.retcon();
  assert.ok(!r.state.log.some((e) => e.text === "Line 6"));
  assert.equal(r.undoStack.length, 4);
});

test("a bad or partial undo stack loads as empty, never half-restored", () => {
  const s = make();
  withUndo(s, 2);
  const saved = JSON.parse(JSON.stringify(s));
  const old = structuredClone(saved);
  delete old.undoStack[1].ship;
  assert.deepEqual(make(old).undoStack, []);
  for (const bad of [null, "x", {}, [null], [{}], 5]) assert.deepEqual(make({ ...saved, undoStack: bad }).undoStack, []);
  delete saved.undoStack;
  assert.deepEqual(make(saved).undoStack, []);
});

test("queued hazard rolls and hours survive a restart; junk loads as empty", () => {
  const s = make();
  s.hazardUnits = [{ u: "hour" }, { u: "round" }];
  s.hazardNeeds = [{ pc: "a", check: "body", reason: "Hypoxia" }];
  const r = restart(s);
  assert.deepEqual(r.hazardUnits, s.hazardUnits);
  assert.deepEqual(r.hazardNeeds, s.hazardNeeds);
  const j = JSON.parse(JSON.stringify(s));
  const bad = make({ ...j, hazardUnits: "no", hazardNeeds: [null, 3, { check: "x" }] });
  assert.deepEqual(bad.hazardUnits, []);
  assert.deepEqual(bad.hazardNeeds, [{ check: "x" }]);
});

test("screen effects and sector votes do not survive; the Warden is told once, only when something was dropped", () => {
  const quiet = restart(make());
  assert.ok(!quiet.state.log.some((e) => /server restarted: /.test(e.text)));
  const s = make();
  s.state.effects.push({ id: "e1", effect: "glitch" });
  s.sectorVotes.set({}, "story-x");
  const json = JSON.parse(JSON.stringify(s));
  const r = make(json);
  assert.deepEqual(r.state.effects, []);
  assert.equal(r.sectorVotes.size, 0);
  const notes = r.state.log.filter((e) => /The server restarted: screen effects ended and the sector vote was cleared\./.test(e.text));
  assert.equal(notes.length, 1);
  assert.equal(notes[0].kind, "note");
  assert.ok(!("dropped" in JSON.parse(JSON.stringify(r))));
});

test("README says what survives a restart", () => {
  assert.match(fs.readFileSync(new URL("../README.md", import.meta.url), "utf8"), /survive[s]? a (server )?restart/i);
});

function played() {
  const p = newProgress(c, () => 5);
  p.current = c.stories[0].id;
  return p;
}

test("an abandoned story is tagged for the Warden only and finishing it clears the tag", () => {
  const p = played(), id = p.current;
  p.abandoned = [{ id, at: 1 }];
  p.current = c.stories[1].id;
  assert.deepEqual(sanitizeProgress(p).abandoned.map((x) => x.id), [id]);
  p.current = id;
  finishInto(p, c, { crew: [], cast: [] }, "Done at last.", [], null, null);
  assert.deepEqual(p.abandoned, []);
  assert.ok(p.done.some((d) => d.id === id));
});

test("the players' sector view carries no abandoned list", async () => {
  const { sectorPayload } = await import("../campaign.js");
  const p = played();
  p.abandoned = [{ id: c.stories[1].id, at: 1 }];
  assert.ok(!JSON.stringify(sectorPayload(c, p)).includes("abandoned"));
});

test("the Warden's story list marks an abandoned unfinished story ABANDONED", () => {
  const src = fs.readFileSync(new URL("../public/dm.js", import.meta.url), "utf8");
  assert.match(src, /cmpAbandoned = \(p, s, d\) => !d && p\.current !== s\.id && \(p\.abandoned/);
  assert.match(src, /Abandoned unfinished: no fee, no faction change \(house rule\)/);
  assert.equal((src.match(/\$\{cmpAbandoned\(p, s, d\)\}/g) || []).length, 2);
});
