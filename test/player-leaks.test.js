import { test } from "node:test";
import assert from "node:assert/strict";
import { Session } from "../session.js";
import { playerEntry, playerStation, sealStation } from "../redact.js";
import { normalizeDraft, applyDraft, draftRequest } from "../builder.js";
import { CAMPAIGNS, buildRequest, newProgress } from "../campaign.js";

function session() {
  Session.prototype.usesNeural = () => false;
  const s = new Session({ code: "LEAK", tokenHash: "x", game: {} }, { onChange() {}, onEnd() {} });
  s.touch = () => {};
  s.syncDm = () => {};
  return s;
}
const socket = (s, extra = {}) => ({ role: "player", readyState: 1, sent: [], terminal: s.state.config.terminals[0].id, send(d) { this.sent.push(d); }, ...extra });

const REPLY = {
  lines: [{ voice: "terminal", text: "The dock is quiet." }],
  cast_changes: [{ name: "Hesper Quill", room: "visitor_dock", notes: "ZZNOTES met the crew", why: "ZZSECRETWHY" }],
  hazards: [{ room: "mary", type: "fire", level: 2, why: "ZZHAZARD" }],
  clocks: [{ label: "Dock timer", seconds: 60 }],
  item_changes: [{ crew: "x", add: "ZZITEM" }],
  crew_changes: [{ crew: "x", stat: "strength", delta: 1, why: "ZZCREW" }],
  moves: [{ who: "x", to: "ZZMOVE" }],
  time_passes: { hours: 3 },
  station_changes: [{ path: "doors.mary", value: "OPEN" }, { path: "secret.vault.lockdown", value: "ZZSECRETSTATION" }, { path: "secrets.x", value: "ZZPLURAL" }],
};
const BAD = ["ZZNOTES", "ZZSECRETWHY", "ZZHAZARD", "ZZITEM", "ZZCREW", "ZZMOVE", "ZZSECRETSTATION", "ZZPLURAL", "castChanges", "hazardChanges", "clockChanges", "itemChanges", "crewChanges", "timePasses", "moves"];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test("a player's line carries only what players see, never the agent's action list", async () => {
  const s = session();
  const ws = socket(s);
  s.sockets.add(ws);
  s.deliverReply({ ...REPLY }, "agent");
  await wait(1500);
  const lines = ws.sent.filter((d) => JSON.parse(d).t === "line");
  assert.ok(lines.length, "the line reached the player");
  for (const d of lines) for (const bad of BAD) assert.ok(!d.includes(bad), `${bad} leaked in a line`);
  const entry = JSON.parse(lines[0]).entry;
  assert.equal(entry.text, "The dock is quiet.");
  assert.equal(entry.changes, undefined, "players never get the station changes");
});

test("the init log, for players and stream sockets, never carries the agent's action list", async () => {
  const s = session();
  s.sockets.add(socket(s));
  s.deliverReply({ ...REPLY }, "agent");
  await wait(1500);
  assert.ok(s.state.log.some((e) => e.castChanges), "the Warden's own log keeps the full action list");
  for (const ws of [socket(s), socket(s, { stream: true })]) {
    const init = JSON.stringify(s.playerView(ws));
    for (const bad of ws.stream ? BAD.filter((b) => !b.startsWith("ZZ")) : BAD) assert.ok(!init.includes(bad), `${bad} leaked in init (stream: ${!!ws.stream})`);
    assert.ok(init.includes("The dock is quiet."));
  }
});

test("playerEntry is a whitelist", () => {
  const e = { id: 1, kind: "terminal", text: "hi", ts: 5, castChanges: [1], mystery: "x", changes: [{ path: "secret.a", value: 1 }] };
  assert.deepEqual(playerEntry(e), { id: 1, kind: "terminal", text: "hi", ts: 5 });
});

test("a secrets key (plural) is hidden from the players' map", () => {
  const out = playerStation({ doors: { a: "OPEN" }, secrets: "x", power: { Secrets_vault: "y", level: 1 } });
  assert.deepEqual(out, { doors: { a: "OPEN" }, power: { level: 1 } });
});

test("sealStation moves station values holding a story code under secret", () => {
  const st = { doors: { vault: "LOCKED (0-0-0-0)", med: "OPEN" }, systems: { dish: "TRACKING, shutdown requires code RELAY-QUIET-0" } };
  sealStation(st, "- Dish shutdown code: RELAY-QUIET-0\n- vault code 0-0-0-0");
  const shown = JSON.stringify(playerStation(st));
  assert.ok(!shown.includes("RELAY-QUIET-0") && !shown.includes("0-0-0-0"));
  assert.ok(shown.includes("OPEN"));
  assert.ok(st.secret.systems_dish.includes("RELAY-QUIET-0"));
});

test("a built story keeps its codes out of the players' map", () => {
  const raw = {
    title: "T", pitch: "p", stationName: "DEAD AIR", theme: "green", lore: "l", secrets: "- Dish shutdown code: RELAY-QUIET-0\n- Vault code 0-0-0-0", standingOrders: "",
    computer: { name: "C", persona: "p" },
    station: [{ path: "systems.dish", value: "shutdown requires code RELAY-QUIET-0" }, { path: "doors.mary", value: "LOCKED" }],
    map: "Deck 1 · Main: mary=Mary", voices: [], cast: [], terminals: [], crew: [], documents: [],
  };
  const built = applyDraft(normalizeDraft(raw));
  const shown = JSON.stringify(playerStation(built.station));
  assert.ok(!shown.includes("RELAY-QUIET-0"));
  assert.ok(shown.includes("LOCKED"));
  assert.ok(JSON.stringify(built.station.secret).includes("RELAY-QUIET-0"), "the Warden still has it");
});

test("both builder prompts tell the model to keep codes and triggers under secret.", () => {
  assert.match(draftRequest({ messages: [] }).system, /path starting "secret\."/);
  const c = CAMPAIGNS[0];
  assert.match(buildRequest(c, c.stories[0], newProgress(c)).system, /path starting "secret\."/);
});

test("room contents are Warden-side: no player payload carries them, the Warden still does", () => {
  const s = session();
  s.state.station.contents = { cargo_bay_deck3: "the organism" };
  s.state.mapShown = "iso";
  const ws = socket(s);
  s.sockets.add(ws);
  s.syncIso();
  s.state.station.contents.cargo_bay_deck3 = "the organism, grown";
  s.syncIso();
  assert.ok(ws.sent.some((d) => d.includes('"isoMap"')), "the iso map was sent");
  for (const d of ws.sent) assert.ok(!d.includes("organism"), "iso map leaked contents");
  for (const p of [ws, socket(s, { stream: true })]) assert.ok(!JSON.stringify(s.playerView(p)).includes("organism"), "init leaked contents");
  assert.ok(!JSON.stringify(playerStation(s.state.station)).includes("organism"));
  assert.ok(JSON.stringify(s.dmView()).includes("organism"), "the Warden still sees it");
});

test("every built secret is guarded and listed as locked at GUEST access", async () => {
  const { buildRequest: agentRequest } = await import("../agent.js");
  const raw = { title: "T", lore: "l", secrets: "- THE CULT: the captain leads it.\n- THE CODE: 4471. Do not disclose below CREW.\n\n- THE SHIP: bugged below security", computer: { name: "C", persona: "p" }, map: "Deck 1 · Main: mary=Mary" };
  const d = normalizeDraft(raw);
  const lines = d.secrets.split("\n").filter(Boolean);
  assert.equal(lines.length, 3);
  for (const l of lines) assert.match(l, /below (CREW|SECURITY|ADMIN)/i);
  assert.match(lines[0], /Do not disclose below ADMIN\.$/);
  assert.equal(lines[1], "- THE CODE: 4471. Do not disclose below CREW.");
  const state = session().state;
  state.config.secrets = d.secrets;
  state.station.access_level = "GUEST";
  assert.match(agentRequest(state, "").context, /LOCKED AT GUEST ACCESS: THE CULT; THE CODE; THE SHIP\./);
});

test("both builder prompts ask for secrets that end in a below-access marker", () => {
  assert.match(draftRequest({ messages: [] }).system, /ending "Do not disclose below CREW\."/);
  const c = CAMPAIGNS[0];
  assert.match(buildRequest(c, c.stories[0], newProgress(c)).system, /ending "Do not disclose below CREW\."/);
});
