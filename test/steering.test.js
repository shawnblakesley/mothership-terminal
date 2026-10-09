import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRequest, buildPrecheck, parseReply } from "../agent.js";
import { chatRequest, draftRequest, pitchesRequest } from "../builder.js";
import { CAMPAIGNS, buildRequest as campaignRequest, newProgress, factionBrief, stripFactionBrief } from "../campaign.js";
import { synopsisRequest } from "../synopsis.js";
import { handoutRequest } from "../handouts.js";
import { draftRequest as roomRequest } from "../rooms.js";
import { jsonInstructions } from "../providers/openai-compatible.js";
import { Session } from "../session.js";
import { sanitizeShip } from "../ships.js";
import { HAZARDS } from "../hazards.js";
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
// Every field on: a game with no Warden (story_end) and a ship in the story (ship_fight).
const full = () => { const s = kestrelState(); return { ...s, solo: { phase: "play" }, config: { ...s.config, ships: [sanitizeShip({ id: "writ", name: "WRIT OF SEIZURE", weapons: [{ name: "Railgun" }] })] } }; };

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
  ship_fight: { enemy_move: "evade", fuel: 2, enemy_fire: true },
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
  assert.ok(!("ship_fight" in on.schema.properties), "ship_fight is only for a story with ships");
  assert.ok("ship_fight" in buildRequest(full(), "").schema.properties);
  assert.ok("ship_fight" in buildRequest(haulersState(18), "").schema.properties, "a Rim Haulers story with a ship to fight");
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

test("the agent is told about a Death Save rolled in secret, so it can reveal it when someone checks vitals", () => {
  const state = kestrelState();
  const pc = state.config.crew[3];
  assert.doesNotMatch(buildRequest(state, "").context, /rolled in secret/);
  state.deathSaves = { [pc.id]: 6 };
  const ctx = buildRequest(state, "").context;
  assert.match(ctx, new RegExp(`${pc.name}: a Death Save was rolled in secret`));
  assert.doesNotMatch(ctx, /ROLLED 06|\b6\b.*Death Save/, "the result itself stays hidden");
});

test("check-first knows the faction standings, so a held attempt gets the house-rule [+] or [-]", () => {
  const state = haulersState(0);
  state.campaign.factions.union = 2;
  assert.match(buildPrecheck(state).context, /FACTION STANDING \(campaign house rule[\s\S]*\[\+\] on the crew's social rolls with The Union/);
  assert.doesNotMatch(buildPrecheck(kestrelState()).context, /FACTION STANDING/);
});

test("the faction standings go out once per reply: in the context, not again in the standing orders", () => {
  const state = haulersState(0);
  const r = buildRequest(state, "");
  assert.equal(r.context.split("FACTION STANDING (").length - 1, 1);
  assert.doesNotMatch(r.system, /FACTION STANDING \(/);
});

test("the length reminder on the player's message names the setting's limits", () => {
  const state = kestrelState();
  state.config.talk = "terse";
  assert.match(buildRequest(state, "").messages.at(-1).content, /LENGTH TERSE: 2 lines at most/);
  assert.match(buildRequest(state, "").context, /TERSE, a hard limit\): at most 2 lines/);
});

test("hazard rules that are this app's reading say so", () => {
  for (const k of ["fire", "explosion"]) assert.match(HAZARDS[k].rule, /^This app/, k);
});

test("saved sheets: Heavy Machinery becomes Industrial Equipment, the bonus kept, on every crew list", () => {
  const sheet = (skills) => ({ name: "Rook", className: "Teamster", skills });
  const game = {
    config: { stationName: "KESTREL-9", crew: [sheet(["Zero-G +10", "Heavy Machinery +10", "Mechanical Repair +15"]), { ...sheet([{ name: "Heavy Machinery", bonus: 10 }, { name: "Industrial Equipment", bonus: 10 }]), name: "Two" }] },
    storyStart: { config: { crew: [sheet(["Heavy Machinery"])] } },
  };
  const s = new Session({ code: "T", tokenHash: "x", game }, { onChange() {}, onEnd() {} });
  const names = (pc) => pc.skills.map((k) => `${k.name} +${k.bonus}`);
  assert.deepEqual(names(s.state.config.crew[0]), ["Zero-G +10", "Industrial Equipment +10", "Mechanical Repair +15"]);
  assert.deepEqual(names(s.state.config.crew[1]), ["Industrial Equipment +10"]);
  assert.deepEqual(s.state.storyStart.config.crew[0].skills, ["Industrial Equipment"]);
  assert.ok(s.state.config.upgrades.includes("industrial-equipment"));
  const rook = new Session({ code: "T2", tokenHash: "x", game: {} }, { onChange() {}, onEnd() {} }).state.config.crew[0];
  assert.ok(names(rook).includes("Industrial Equipment +10") && !names(rook).some((k) => /Heavy/.test(k)), "KESTREL-9's Rook");
});

test("Retcon takes back an ending the agent wrote in a game with no Warden, even after the recap", async () => {
  const s = session();
  s.soloChanged = () => {};
  s.state.solo = { phase: "play", pitches: [], busy: "", error: "", opened: true };
  let release;
  s.ask = () => new Promise((ok) => { release = () => ok({ verdict: "They escaped.", sections: [] }); });
  const before = s.state.log.length;
  s.deliver({ lines: [{ voice: "terminal", text: "UNDOCKING." }], story_end: { ended: true, how: "They escaped." } }, "agent");
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(s.state.solo.phase, "ended");
  release();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(s.state.solo.busy, "", "the recap is done");
  s.retcon();
  assert.equal(s.state.solo.phase, "play");
  assert.ok(!s.state.log.some((e) => /The story ended/.test(e.text)), "the ending's log note goes too");
  assert.equal(s.state.log.filter((e) => !/Retconned/.test(e.text)).length, before);
  // A recap still being written when the ending is retconned changes nothing.
  s.deliver({ lines: [{ voice: "terminal", text: "UNDOCKING." }], story_end: { ended: true, how: "Again." } }, "agent");
  await new Promise((r) => setTimeout(r, 5));
  s.retcon();
  release();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(s.state.solo.phase, "play");
  assert.ok(!s.state.solo.busy && !s.state.solo.recap, "a late recap is dropped");
});

const LONG = "One. Two. Three. Four. Five.";
const reply = (lines) => JSON.stringify({ lines });

test("the length setting trims each line as the model wrote it, before a speaker's consecutive lines are merged", () => {
  const voices = kestrelState().config.voices;
  const salk = (text) => ({ voice: "intercom", character: "Dr. Imre Salk", text });
  const terse = parseReply(reply([salk(LONG), salk(LONG), salk("Six.")]), voices, "terse").lines;
  assert.equal(terse.length, 1, "Salk's lines are still merged");
  assert.equal(terse[0].text, "One. Two.\nOne. Two.", "2 lines of 2 sentences; the third line is dropped");
  const brief = parseReply(reply([salk(LONG), { voice: "terminal", text: "A\nB\nC\nD\nE\nF\nG\nH\nI\nJ" }]), voices, "brief").lines;
  assert.equal(brief[0].text, "One. Two. Three.");
  assert.equal(brief[1].text.split("\n").length, 8, "a printout keeps 8 rows at BRIEF");
  assert.equal(parseReply(reply([salk(LONG)]), voices, "long").lines[0].text, LONG, "EXPANSIVE has no limit");
  assert.equal(parseReply(reply([salk(LONG)]), voices).lines[0].text, LONG, "no setting given, nothing trimmed");
  assert.equal(parseReply(reply([salk("Dr. Okonkwo lied. Mr. Vane knew. Then it came.")]), voices, "terse").lines[0].text, "Dr. Okonkwo lied. Mr. Vane knew.", "titles don't end a sentence");
});

test("Review mode drafts are trimmed to the length setting; the Warden's own edit is delivered as written; private notes still work", async () => {
  const s = session();
  Object.assign(s.state.config, { mode: "review", checkFirst: false, talk: "terse" });
  s.modelAccess = () => ({ provider: { id: "stub" }, apiKey: "x" });
  s.callModel = async () => reply([{ voice: "terminal", text: "1\n2\n3\n4\n5\n6" }, { voice: "intercom", character: "Dr. Imre Salk", text: LONG }]);
  s.pregenerate = () => {};
  s.addLog("player", "status?");
  await s.generate();
  assert.deepEqual(s.state.pending.reply.lines.map((l) => l.text), ["1\n2\n3\n4", "One. Two."]);
  s.handleDm({ t: "approve", reply: { lines: [{ voice: "intercom", character: "Dr. Imre Salk", text: LONG }], station_changes: [], crew_changes: [], effects: [] } });
  assert.ok(s.state.log.some((e) => e.text.replace(/\n/g, " ") === LONG), "the Warden's edit isn't trimmed");
  s.callModel = async () => JSON.stringify({ lines: [{ voice: "terminal", text: "1\n2\n3\n4\n5\n6" }], dm_note: "Noted, and it stays private." });
  await s.aside("What is Salk hiding?");
  assert.equal(s.state.log.at(-1).kind, "aside_reply");
  assert.equal(s.state.log.at(-1).text, "Noted, and it stays private.");
});

test("a player's panic: the app applies its Stress, Maximum Wounds and Retire, so neither the agent nor the Warden repeats them", () => {
  const state = kestrelState();
  state.log.push({ id: "p1", kind: "roll", text: "PANIC CHECK\nSTRESS 6 · ROLLED 2 (D20)\nPANIC", by: "Rook", panicEffect: "Nervous: +1 Stress." });
  const r = buildRequest(state, "");
  assert.match(r.messages.at(-1).content, /Nervous: \+1 Stress\. Show it in the fiction now\. The app has already applied its Stress, Maximum Wounds and Retire: no crew_changes for them; Conditions and timed \[\+\]\/\[-\] are the Warden's/);
  assert.match(r.context, /the app applies its Stress, Maximum Wounds and Retire, so no crew_changes for that character/);
  state.solo = { phase: "play" };
  const solo = buildRequest(state, "");
  assert.match(solo.messages.at(-1).content, /yours to keep in mind/);
  assert.doesNotMatch(solo.system + solo.context, /apply any Stress it gives through crew_changes/);
  assert.match(solo.system + solo.context, /don't repeat them in crew_changes/);
});

test("the narrator's third person is in the protocol, so saved personas get it too; check-first knows what the station state allows", () => {
  const state = kestrelState();
  state.config.voices.find((v) => v.id === "narrator").persona = "A custom narrator.";
  assert.match(buildRequest(state, "").system, /role="the narrator: the scene itself, in the third person; it never speaks to anyone or says &quot;you&quot;"/);
  assert.match(buildPrecheck(state).system, /station state already allows: undocking once departure clearance reads GRANTED/);
});

test("saved campaign stories lose the faction standings frozen into their standing orders; the arc and the story's own orders stay", () => {
  const c = CAMPAIGNS[0], p = newProgress(c);
  p.factions = { union: 2 };
  const story = c.stories.find((x) => x.finale) || c.stories[0];
  const arc = `CAMPAIGN STORY ${story.n} of ${c.stories.length}: ${story.title}.\nTHE ADVERSARY is ${story.adversary.name}.`;
  const old = `${arc}\n${factionBrief(c, story, p)}\n\nKeep the radio chatter salty.`;
  assert.match(old, /THE FINALE:/);
  assert.equal(stripFactionBrief(old), `${arc}\n\nKeep the radio chatter salty.`);
  assert.equal(stripFactionBrief(`${arc}\n${factionBrief(c, c.stories[0], p)}`), arc);
  const game = { config: { stationName: "WELLHEAD", standingOrders: old, upgrades: ["industrial-equipment"] }, storyStart: { config: { standingOrders: old } } };
  const s = new Session({ code: "T3", tokenHash: "x", game }, { onChange() {}, onEnd() {} });
  assert.equal(s.state.config.standingOrders, `${arc}\n\nKeep the radio chatter salty.`);
  assert.equal(s.state.storyStart.config.standingOrders, `${arc}\n\nKeep the radio chatter salty.`);
  assert.ok(s.state.config.upgrades.includes("faction-orders"));
  const later = new Session({ code: "T4", tokenHash: "x", game: { config: { standingOrders: old, upgrades: ["faction-orders"] } } }, { onChange() {}, onEnd() {} });
  assert.equal(later.state.config.standingOrders, old, "runs once: orders the Warden writes later are theirs");
});
