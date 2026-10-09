import { test } from "node:test";
import assert from "node:assert/strict";
import { Session } from "../session.js";
import { addCast, isCrew } from "../cast.js";
import { playerStation } from "../redact.js";
import { buildRequest } from "../agent.js";
import { kestrelState } from "../scripts/steering-fixtures.mjs";

function session(game = {}) {
  Session.prototype.usesNeural = () => false;
  const s = new Session({ code: "TEST", tokenHash: "x", game }, { onChange() {}, onEnd() {} });
  s.touch = () => {};
  s.syncDm = () => {};
  s.toPlayers = () => {};
  s.send = () => {};
  return s;
}
const castNames = (s) => s.state.config.cast.map((m) => m.name);
const logText = (s) => s.state.log.map((e) => e.text).join("\n");

test("addCast refuses a name that is a player character, however it is written", () => {
  const crew = [{ id: "ines", name: "Dr. Ines Marrow" }];
  const cast = [];
  assert.equal(addCast(cast, "Dr. Ines Marrow", { crew }).member, null);
  assert.equal(addCast(cast, "Ines Marrow (f)", { crew }).member, null);
  assert.equal(addCast(cast, "Marrow", { crew }).member, null);
  assert.deepEqual(cast, []);
  assert.ok(isCrew(crew, "ines"));
  assert.ok(addCast(cast, "Dr. Imre Salk", { crew }).created);
});

test("the agent's cast_changes and channel lines never add or voice a player character", () => {
  const s = session();
  const pc = s.state.config.crew[0].name;
  const before = castNames(s);
  s.deliverReply({ lines: [{ voice: "intercom", character: pc, text: "Hold still." }, { voice: "intercom", character: "Dr. Imre Salk", text: "Stay calm." }], cast_changes: [{ name: pc, room: "med_bay", stress_change: 1, attitude_change: 1 }] }, "agent");
  assert.deepEqual(castNames(s), before);
  assert.ok(!logText(s).includes(pc), "no cast log line or spoken line for the player character");
  assert.ok(logText(s).includes("Stay calm."), "real cast still speak");
});

test("a saved game with a player character in its cast has them taken out", () => {
  const fresh = session();
  const pc = fresh.state.config.crew[0];
  const cast = [...fresh.state.config.cast.map((m) => ({ ...m })), { id: "pc-copy", name: pc.name.toUpperCase(), voice: "", notes: "", room: "mary", portrait: "" }];
  const s = session({ config: { crew: fresh.state.config.crew, cast }, storyStart: { config: { crew: fresh.state.config.crew, cast } } });
  assert.ok(!castNames(s).some((n) => n.toLowerCase() === pc.name.toLowerCase()));
  assert.ok(!s.state.storyStart.config.cast.some((m) => m.id === "pc-copy"));
  assert.equal(castNames(s).length, fresh.state.config.cast.length);
  assert.ok(s.state.config.upgrades.includes("no-pc-cast"));
});

test("the prompt tells the agent the players' characters are not cast", () => {
  assert.match(buildRequest(kestrelState(), "").system, /characters are never cast/);
});

test("the players' map payload has no occupants and no secret or hidden paths", () => {
  const station = { doors: { med_bay: "OPEN" }, occupants: { med_bay: "Salk" }, secret: { vault: { lockdown: "ARMED - trigger: VAULT BREACH" } }, power: { hidden_trigger: "x", level: 80, Secret: "y" }, access_level: "GUEST" };
  assert.deepEqual(playerStation(station), { doors: { med_bay: "OPEN" }, power: { level: 80 }, access_level: "GUEST" });
  assert.ok(station.secret, "the real state is untouched");
  const s = session();
  s.state.mapShown = "iso";
  s.state.station = station;
  const sent = JSON.stringify(s.isoView());
  assert.ok(!/VAULT BREACH|occupants|Salk|trigger/.test(sent));
  assert.ok(sent.includes("OPEN"));
});

test("the agent is told where to put secrets", () => {
  assert.match(buildRequest(kestrelState(), "").system, /path starting "secret\."/);
});
