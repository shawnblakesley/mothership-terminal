import { test } from "node:test";
import assert from "node:assert/strict";
import { Session } from "../session.js";
import { buildRequest, parseReply } from "../agent.js";
import { kestrelState } from "../scripts/steering-fixtures.mjs";

function setup() {
  Session.prototype.usesNeural = () => false;
  const s = new Session({ code: "MSG", tokenHash: "x", game: {} }, { onChange() {}, onEnd() {} });
  s.touch = () => {};
  s.syncDm = () => {};
  s.initPlayers = () => {};
  s.toPlayers = () => {};
  s.requestReply = () => {};
  const [rook, tick, moll] = s.state.config.crew;
  const screen = (pc, terminal) => {
    const got = [];
    const ws = { role: "player", readyState: 1, character: pc.id, terminal, lastInput: 0, got, send(d) { got.push(JSON.parse(d)); } };
    s.sockets.add(ws);
    return ws;
  };
  const cargo = screen(rook, "cargo"), medbay = screen(tick, "medbay");
  const types = (ws, t) => ws.got.filter((m) => m.t === t);
  return { s, rook, tick, moll, cargo, medbay, screen, types };
}

test("a message goes to the named crewmate's terminal only, from the sender's terminal; the sender sees their own words", () => {
  const { s, cargo, medbay, rook, types } = setup();
  const [, , moll] = s.state.config.crew;
  const third = { role: "player", readyState: 1, character: moll.id, terminal: "airlock", got: [], send(d) { this.got.push(JSON.parse(d)); } };
  s.sockets.add(third);
  s.handlePlayer(cargo, { t: "msg", to: "Tick", text: "Cargo is open. Stay there." });
  const [got] = types(medbay, "msg");
  assert.equal(got.entry.dir, "in");
  assert.equal(got.entry.text, "Cargo is open. Stay there.");
  assert.equal(got.entry.peer, rook.name);
  assert.equal(got.entry.at, "CARGO BAY TERMINAL");
  assert.equal(types(cargo, "msg")[0].entry.dir, "out");
  assert.equal(types(third, "msg").length, 0, "a third player hears nothing");
  const entry = s.state.log.find((e) => e.kind === "msg");
  assert.ok(entry, "the Warden's log has it");
  assert.equal(s.dmView().log.find((e) => e.kind === "msg").text, "Cargo is open. Stay there.");
  assert.equal(s.playerView(third).log.filter((e) => e.kind === "msg").length, 0);
  assert.equal(s.playerView(medbay).log.filter((e) => e.kind === "msg").length, 1);
  assert.equal(s.playerView({ stream: true, role: "player" }).log.filter((e) => e.kind === "msg").length, 0);
});

test("a message to someone on another system fails with NO ROUTE, and to someone not at a terminal with NO SIGNAL", () => {
  const { s, cargo, medbay, types } = setup();
  medbay.terminal = "ship";
  s.handlePlayer(cargo, { t: "msg", to: "Tick", text: "Can you hear me?" });
  assert.match(types(cargo, "msgFail")[0].text, /NO ROUTE/);
  assert.ok(!s.state.log.some((e) => e.kind === "msg"));
  medbay.terminal = null;
  cargo.lastMsg = 0;
  s.handlePlayer(cargo, { t: "msg", to: "Tick", text: "Hello?" });
  assert.match(types(cargo, "msgFail")[1].text, /NO SIGNAL/);
});

test("dead or retired crew can't send messages, and can't receive them", () => {
  const { s, cargo, medbay, tick, rook, types } = setup();
  tick.cond = { ...tick.cond, dead: true };
  s.handlePlayer(cargo, { t: "msg", to: "Tick", text: "Tick?" });
  assert.match(types(cargo, "msgFail")[0].text, /NO SIGNAL/);
  tick.cond.dead = false;
  rook.retired = true;
  s.handlePlayer(cargo, { t: "msg", to: "Tick", text: "One last thing." });
  assert.match(types(cargo, "rollError")[0].text, /no more actions/);
  assert.equal(types(medbay, "msg").length, 0);
});

test("the Warden holds the next message: it arrives after the delay, or when released, or never; the sender sees it go either way", async () => {
  const { s, cargo, medbay, rook, types } = setup();
  s.handleDm({ t: "msgHold", pc: rook.id, seconds: 0, never: false });
  s.handlePlayer(cargo, { t: "msg", to: "Tick", text: "First." });
  assert.equal(types(cargo, "msg").length, 1, "the sender sees their own message go");
  assert.equal(types(medbay, "msg").length, 0, "held");
  const e = s.state.log.findLast((x) => x.kind === "msg");
  assert.equal(e.state, "held");
  assert.equal(s.state.msgHolds[rook.id], undefined, "the hold is for one message");
  cargo.lastMsg = 0;
  s.handlePlayer(cargo, { t: "msg", to: "Tick", text: "Second." });
  assert.equal(types(medbay, "msg").length, 1, "the next goes straight through");
  s.handleDm({ t: "msgRelease", id: e.id });
  assert.deepEqual(types(medbay, "msg").map((m) => m.entry.text), ["Second.", "First."]);
  s.handleDm({ t: "msgHold", pc: rook.id, seconds: 0.05, never: false });
  s.handleDm({ t: "msgHold", pc: rook.id, off: true });
  cargo.lastMsg = 0;
  s.handlePlayer(cargo, { t: "msg", to: "Tick", text: "Third." });
  assert.equal(types(medbay, "msg").length, 3, "a cancelled hold lets it through");
  s.state.msgHolds[rook.id] = { seconds: 1, never: false };
  cargo.lastMsg = 0;
  s.handlePlayer(cargo, { t: "msg", to: "Tick", text: "Late." });
  const late = s.state.log.findLast((x) => x.kind === "msg");
  assert.equal(late.state, "held");
  late.releaseAt = Date.now() + 20;
  const { resumeMessages } = await import("../crewmsg.js");
  resumeMessages(s);
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(late.state, "sent");
  assert.equal(types(medbay, "msg").at(-1).entry.text, "Late.");
  s.handleDm({ t: "msgHold", pc: rook.id, seconds: 0, never: true });
  cargo.lastMsg = 0;
  s.handlePlayer(cargo, { t: "msg", to: "Tick", text: "Lost." });
  assert.equal(s.state.log.findLast((x) => x.kind === "msg").state, "dropped");
  assert.equal(types(medbay, "msg").length, 4, "a message that never arrives is never sent to the reader");
  assert.equal(types(cargo, "msg").at(-1).entry.text, "Lost.");
});

test("an altered message reaches its reader changed; the sender's echo keeps what they typed", () => {
  const { s, cargo, medbay, rook, types } = setup();
  s.handleDm({ t: "msgHold", pc: rook.id, seconds: 0 });
  s.handlePlayer(cargo, { t: "msg", to: "Tick", text: "Stay in the med bay." });
  const e = s.state.log.findLast((x) => x.kind === "msg");
  s.handleDm({ t: "msgAlter", id: e.id, text: "Come to the cargo bay. Alone." });
  s.handleDm({ t: "msgRelease", id: e.id });
  assert.equal(types(medbay, "msg")[0].entry.text, "Come to the cargo bay. Alone.");
  assert.equal(types(cargo, "msg")[0].entry.text, "Stay in the med bay.");
  assert.equal(e.edited, "warden");
  assert.equal(s.playerView(cargo).log.at(-1).text, "Stay in the med bay.");
  s.handleDm({ t: "msgAlter", id: e.id, text: "Never mind." });
  assert.deepEqual(types(medbay, "msgEdit").map((m) => m.text), ["Never mind."]);
});

test("a forged message appears to come from the crewmate, is marked in the Warden's log, and the sender never sees it", () => {
  const { s, cargo, medbay, tick, rook, types } = setup();
  s.handleDm({ t: "msgForge", as: "Rook", to: "Tick", text: "Open the cargo door. Now." });
  const got = types(medbay, "msg")[0].entry;
  assert.deepEqual([got.dir, got.peer, got.at, got.text], ["in", rook.name, "CARGO BAY TERMINAL", "Open the cargo door. Now."]);
  assert.deepEqual(Object.keys(got).sort(), ["at", "dir", "id", "kind", "peer", "text", "ts"], "no sign of the forgery on the wire");
  assert.equal(types(cargo, "msg").length, 0, "the supposed sender is told nothing");
  const e = s.state.log.findLast((x) => x.kind === "msg");
  assert.equal(e.by, "warden");
  const forged = s.dmView().log.find((x) => x.id === e.id);
  assert.equal(forged.by, "warden");
  assert.equal(s.playerView(medbay).log.at(-1).text, "Open the cargo door. Now.");
  assert.equal(s.playerView(cargo).log.filter((x) => x.kind === "msg").length, 0);
  s.handleDm({ t: "msgForge", as: "Rook", to: "Rook", text: "x" });
  assert.equal(s.state.log.filter((x) => x.kind === "msg").length, 1);
  assert.ok(tick);
});

test("the agent's crew_message forges or alters, and Retcon takes both back", () => {
  const { s, cargo, medbay, rook, types } = setup();
  s.handlePlayer(cargo, { t: "msg", to: "Tick", text: "Stay put." });
  const real = s.state.log.findLast((x) => x.kind === "msg");
  s.deliver({ lines: [{ voice: "terminal", text: "A relay chirps." }], crew_message: { as: "Rook", to: "Tick", text: "Come to me, quick.", alter: 0 } }, "agent");
  const forged = s.state.log.findLast((x) => x.kind === "msg");
  assert.notEqual(forged.id, real.id);
  assert.equal(forged.by, "agent");
  assert.equal(types(medbay, "msg").at(-1).entry.text, "Come to me, quick.");
  s.deliver({ lines: [{ voice: "terminal", text: "Static." }], crew_message: { as: "", to: "", text: "Stay put and trust me.", alter: real.id } }, "agent");
  assert.equal(real.text, "Stay put and trust me.");
  assert.equal(real.edited, "agent");
  assert.equal(types(cargo, "msg")[0].entry.text, "Stay put.", "the sender's echo is untouched");
  s.retcon();
  assert.equal(real.text, "Stay put.");
  assert.ok(!real.edited);
  s.retcon();
  assert.ok(!s.state.log.some((x) => x.id === forged.id), "the forged message is gone");
  assert.equal(s.playerView(medbay).log.filter((x) => x.kind === "msg").length, 1);
  assert.ok(rook);
});

test("Review mode: approving a draft applies the forged crew message the card lists", () => {
  const { s, medbay, types } = setup();
  s.state.pending = { status: "ready", directives: [], reply: { ...parseReply("{}", s.state.config.voices), crew_message: { as: "Rook", to: "Tick", text: "Where are you?", alter: 0 } } };
  s.handleDm({ t: "approve", reply: { lines: [], station_changes: [], crew_changes: [], effects: [] } });
  assert.equal(types(medbay, "msg")[0].entry.text, "Where are you?");
});

test("the agent reads crew messages as private player talk, and knows which were forged or changed", () => {
  const state = kestrelState();
  state.log.push(
    { id: 901, kind: "msg", from: "Rook", to: "Tick", text: "Wait for me.", sent: "Wait for me.", by: "player", state: "sent", ts: 1 },
    { id: 902, kind: "msg", from: "Rook", to: "Tick", text: "Run.", sent: "Wait for me.", by: "player", edited: "warden", state: "sent", ts: 2 },
    { id: 903, kind: "msg", from: "Rook", to: "Tick", text: "Open it.", sent: "", by: "agent", state: "sent", ts: 3 },
  );
  const r = buildRequest(state, "");
  const all = r.messages.map((m) => m.content).join("\n");
  assert.match(all, /\[CREW MESSAGE #901, private\] ROOK to TICK: "Wait for me\."/);
  assert.match(all, /#902[^\n]*ROOK sent "Wait for me\."; TICK was shown "Run\."/);
  assert.match(all, /#903[^\n]*forged by you, never sent by Rook/);
  assert.ok("crew_message" in r.schema.properties);
  assert.match(r.system, /CREW MESSAGES/);
  const solo = { ...state, config: { ...state.config, crew: state.config.crew.slice(0, 1) } };
  assert.ok(!("crew_message" in buildRequest(solo, "").schema.properties), "one player has nobody to message");
});

test("a player who reconnects and claims their crew file gets their messages back", () => {
  const { s, cargo, medbay, rook, screen } = setup();
  s.handlePlayer(cargo, { t: "msg", to: "Tick", text: "Stay put." });
  const again = screen({ id: "x" }, "cargo");
  again.character = undefined;
  again.got.length = 0;
  s.handlePlayer(again, { t: "claim", id: rook.id });
  const init = again.got.find((m) => m.t === "init");
  assert.deepEqual(init.log.filter((e) => e.kind === "msg").map((e) => [e.dir, e.text]), [["out", "Stay put."]]);
  assert.ok(medbay);
});
