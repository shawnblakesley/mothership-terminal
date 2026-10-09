import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRequest, buildPrecheck, parseReply } from "../agent.js";
import { chatRequest, draftRequest, pitchesRequest } from "../builder.js";
import { CAMPAIGNS, buildRequest as campaignRequest, newProgress } from "../campaign.js";
import { synopsisRequest } from "../synopsis.js";
import { handoutRequest } from "../handouts.js";
import { draftRequest as roomRequest } from "../rooms.js";
import { jsonInstructions } from "../providers/openai-compatible.js";
import { Session } from "../session.js";
import { kestrelState, haulersState, promptSize } from "../scripts/steering-fixtures.mjs";

// What the agent is told must match _out/tickets/RULES.md. When you add a reply field, describe it in the schema (or name it in the system prompt),
// make parseReply handle it, add a SAMPLE for it below, and raise the budget only on purpose.

// Size of one normal reply's prompt (system + context + history + schema and example), in characters: the measured size plus 10%.
const BUDGET = { kestrel: 57500, haulers: 53500 };

test("a roll of 90-99 that is under the target is told to the agent as the failure it is", () => {
  const state = kestrelState();
  state.log.push({ id: "r1", kind: "roll", text: "SANITY SAVE\nTARGET 95 · ROLLED 93\nFAILURE · +1 STRESS" }, { id: "r2", kind: "roll", text: "FEAR SAVE\nTARGET 50 · ROLLED 40\nSUCCESS" });
  const last = buildRequest(state, "").messages.at(-1).content;
  assert.match(last, /ROLLED 93[\s\S]*90-99 always fails/);
  assert.match(last, /made it by 10/);
});

const everything = (state, steer = "") => {
  const r = buildRequest(state, steer);
  return [r.system, r.context, r.messages.map((m) => m.content).join("\n"), jsonInstructions(r.schema, r.example)].join("\n\n");
};
const full = () => ({ ...kestrelState(), solo: { phase: "play" } });

test("every reply field has a schema description, and every nested field a description or a mention in the system prompt", () => {
  const r = buildRequest(full(), "");
  for (const [k, v] of Object.entries(r.schema.properties)) assert.ok(v.description || r.system.includes(k), `reply field "${k}" needs a description of when to use it`);
  const missing = [];
  const walk = (schema, path) => {
    for (const [k, v] of Object.entries(schema.properties || {})) {
      if (!v.description && !v.enum && !new RegExp(`\\b${k}\\b`).test(r.system)) missing.push(`${path}${k}`);
      walk(v.items?.properties ? v.items : v, `${path}${k}.`);
    }
  };
  walk(r.schema, "");
  assert.deepEqual(missing, [], "describe these in the schema or the system prompt");
});

// One valid value for every reply field. parseReply must turn each into a non-empty, non-default result.
const SAMPLE = {
  lines: [{ voice: "terminal", character: "", system: "", text: "ACCESS NOTED.", effects: [{ type: "static", text: "", seconds: 1 }], variants: [{ for: "Android", text: "hello" }], reveal: "" }],
  station_changes: [{ path: "doors.med_bay", value: "OPEN" }],
  crew_changes: [{ for: "Rook", stat: "stress", change: 1, why: "fright" }],
  item_changes: [{ for: "Rook", action: "add", item: "Flare", why: "found" }],
  attacks: [{ by: "THE COLD", target: "Rook", attack: "" }],
  crew_attacks: [{ by: "Rook", weapon: "Crowbar", target: "THE COLD" }],
  reloads: [{ by: "Rook", weapon: "Revolver" }],
  round: true,
  reveal_death_save: ["Rook"],
  hazards: [{ room: "med_bay", type: "radiation", level: 2 }],
  time_passes: { hours: 2 },
  moves: [{ for: "all", terminal: "MED BAY TERMINAL" }],
  cast_changes: [{ name: "Dr. Imre Salk", room: "med_bay", notes: "hurt", attitude_change: 1, why: "helped", stress_change: 1, panic_check: true }],
  clocks: [{ action: "start", label: "reactor breach", seconds: 120 }],
  handouts: [{ title: "MEMO", text: "Read this.", for: "", voice: "" }],
  found_docs: [{ id: "doc-1", for: "" }],
  layout: "Deck 1 · Bay: bay=Bay",
  room_plans: [{ room: "bay", rows: ["###", "#.#", "###"] }],
  effects: [{ type: "alarm", text: "ALARM", seconds: 3 }],
  outcome_check: { needed: true, attempt: "hack the door", suggested_check: "intellect", advantage: "none", why: "uncertain", on_success: "opens", on_failure: "alarm" },
  story_end: { ended: true, how: "They escaped." },
  dm_note: "a note",
};

test("parseReply handles every reply field", () => {
  const state = full();
  const r = buildRequest(state, "");
  const voices = state.config.voices;
  const empty = parseReply("{}", voices);
  for (const k of Object.keys(r.schema.properties)) {
    assert.ok(k in SAMPLE, `add a SAMPLE for the new reply field "${k}" in test/steering.test.js`);
    const got = parseReply(JSON.stringify({ [k]: SAMPLE[k] }), voices);
    assert.ok(k in got, `parseReply drops "${k}"`);
    assert.notDeepEqual(got[k], empty[k], `parseReply ignores the value of "${k}"`);
  }
});

test("the example reply has exactly the schema's fields", () => {
  for (const state of [kestrelState(), full(), { ...kestrelState(), config: { ...kestrelState().config, agentCrew: false, agentEffects: false, agentVariants: false } }]) {
    const r = buildRequest(state, "");
    assert.deepEqual(Object.keys(r.example), Object.keys(r.schema.properties));
    assert.deepEqual(r.schema.required, Object.keys(r.schema.properties));
  }
});

test("known-wrong rule phrases are in no prompt", () => {
  const c = CAMPAIGNS[0];
  const story = c.stories[0];
  const p = newProgress(c);
  p.current = story.id;
  const state = haulersState(0);
  const prompts = [
    everything(kestrelState()), everything(full()), everything(state), everything(kestrelState(), "seal all doors"),
    JSON.stringify(buildPrecheck(kestrelState())),
    JSON.stringify(chatRequest({ messages: [], draft: null })), JSON.stringify(draftRequest({ messages: [], draft: null })), JSON.stringify(pitchesRequest()),
    JSON.stringify(campaignRequest(c, story, p)),
    JSON.stringify(synopsisRequest(kestrelState(), [], "sofar").request), JSON.stringify(handoutRequest(kestrelState(), "a memo", "MEMO", "Salk")),
    JSON.stringify(roomRequest(kestrelState(), "med_bay")),
  ];
  const wrong = [
    [/\banxious\b/i, "Anxious is not on the Panic Table (2 is Nervous)"],
    [/panic[^.\n]{0,50}collaps|collaps[^.\n]{0,50}panic/i, "no Panic result is a collapse"],
    [/roll twice more/i, "Compounding Problems: roll twice on the table (Minimum Stress +1)"],
    [/prophetic vision[^.\n]{0,80}\+1 stress/i, "Prophetic Vision is Minimum Stress +2"],
    [/damage[^.\n]{0,40}\bignored\b[^.\n]{0,25}\buntil\b|\buntil (the )?armou?r\b/i, "damage under the armor's AP is ignored entirely; at or over AP it destroys the armor"],
    [/pump shotgun/i, "the weapon is the Combat Shotgun"],
  ];
  for (const [i, text] of prompts.entries()) for (const [re, why] of wrong) assert.ok(!re.test(text), `prompt ${i} matches ${re}: ${why}`);
});

test("a prompt is built from the features that are on, not with 'don't use X' notes", () => {
  const base = kestrelState();
  const off = { ...base, config: { ...base.config, agentCrew: false, agentEffects: false, agentVariants: false } };
  const r = buildRequest(off, "");
  const all = everything(off);
  for (const k of ["crew_changes", "item_changes", "attacks", "crew_attacks", "round", "reveal_death_save", "effects", "story_end"]) assert.ok(!(k in r.schema.properties), `${k} is in the schema while its feature is off`);
  assert.ok(!("variants" in r.schema.properties.lines.items.properties) && !("effects" in r.schema.properties.lines.items.properties));
  for (const word of ["SCREEN EFFECTS", "AVAILABLE EFFECTS", "AVAILABLE SOUNDS", "PER-PLAYER VARIATIONS", "CREW AND COMBAT", "crew_changes", "reveal_death_save", "variants"]) assert.ok(!all.includes(word), `"${word}" is in the prompt while its feature is off`);
  assert.ok(!/disabled|must be \[\]/i.test(all), "the prompt tells the agent about switched-off features instead of leaving them out");
  const on = buildRequest(kestrelState(), "");
  for (const k of ["crew_changes", "attacks", "crew_attacks", "round", "reveal_death_save", "effects"]) assert.ok(k in on.schema.properties, `${k} missing while its feature is on`);
  assert.ok(!("story_end" in on.schema.properties), "story_end is only for a game with no Warden");
  assert.ok("story_end" in buildRequest(full(), "").schema.properties);
});

test("the per-reply prompt stays under its size budget", () => {
  const k = promptSize(kestrelState()).total, h = promptSize(haulersState(0)).total;
  assert.ok(k <= BUDGET.kestrel, `KESTREL-9: ${k} characters, budget ${BUDGET.kestrel}`);
  assert.ok(h <= BUDGET.haulers, `Rim Haulers story: ${h} characters, budget ${BUDGET.haulers}`);
});

// The server side of the fields: Review mode applies a draft whole, and Retcon takes back clocks, handouts, found files and moved screens.
function session() {
  Session.prototype.usesNeural = () => false;
  const s = new Session({ code: "TEST", tokenHash: "x", game: {} }, { onChange() {}, onEnd() {} });
  s.touch = () => {};
  s.syncDm = () => {};
  s.toPlayers = () => {};
  s.send = () => {};
  s.initPlayers = () => {};
  return s;
}

test("Review mode: approving a draft applies every field the card lists, not only the editable ones", () => {
  const s = session();
  const [a] = s.state.config.crew;
  const had = a.items.length;
  s.state.pending = { status: "ready", directives: [], reply: { ...parseReply("{}", s.state.config.voices), item_changes: [{ for: a.name, action: "add", item: "Steering Test Flare", why: "found" }], clocks: [{ action: "start", label: "TEST CLOCK", seconds: 60 }], handouts: [{ title: "TEST MEMO", text: "Read me.", for: "", voice: "" }] } };
  s.handleDm({ t: "approve", reply: { lines: [], station_changes: [], crew_changes: [], effects: [] } });
  assert.equal(a.items.length, had + 1);
  assert.ok(s.state.clocks.some((c) => c.label === "TEST CLOCK"));
  assert.ok(s.state.handouts.some((h) => h.title === "TEST MEMO"));
  for (const c of s.state.clocks) s.removeClock(c);
});

test("Retcon takes back clocks, handouts and found files the agent's reply gave out, and brings back a clock it stopped", () => {
  const s = session();
  s.startClock("OLD CLOCK", 600, "dm");
  const handouts = s.state.handouts.length;
  s.state.config.roomDocs = [{ id: "doc-x", room: "med_bay", title: "LOG", text: "text" }];
  s.deliver({ lines: [{ voice: "terminal", text: "Noted." }], clocks: [{ action: "stop", label: "OLD CLOCK", seconds: 0 }, { action: "start", label: "NEW CLOCK", seconds: 90 }], handouts: [{ title: "NEW MEMO", text: "Read me.", for: "", voice: "" }], found_docs: [{ id: "doc-x", for: "" }] }, "agent");
  assert.deepEqual(s.state.clocks.map((c) => c.label), ["NEW CLOCK"]);
  assert.equal(s.state.handouts.length, handouts + 2);
  assert.ok(s.state.found.includes("doc-x"));
  s.retcon();
  assert.deepEqual(s.state.clocks.map((c) => c.label), ["OLD CLOCK"]);
  assert.equal(s.state.handouts.length, handouts);
  assert.ok(!s.state.found.includes("doc-x"));
  for (const c of [...s.state.clocks]) s.removeClock(c);
});

test("Retcon puts a screen the agent moved back where it was", () => {
  const s = session();
  s.state.config.terminals = [{ id: "t1", name: "A", room: "hold", look: [] }, { id: "t2", name: "B", room: "cab", look: [] }];
  const [a] = s.state.config.crew;
  const ws = { role: "player", character: a.id, terminal: "t1", send() {} };
  s.sockets.add(ws);
  s.deliver({ lines: [{ voice: "terminal", text: "You climb into the cab." }], moves: [{ for: a.name, terminal: "B" }] }, "agent");
  assert.equal(ws.terminal, "t2");
  s.retcon();
  assert.equal(ws.terminal, "t1");
});
