import { test } from "node:test";
import assert from "node:assert/strict";
import { Session } from "../session.js";
import { campaignById, newProgress, finishInto, sanitizeProgress } from "../campaign.js";
import { snapshotStory, coldOpenRequest, normalizeColdOpen, introRecap, sanitizeColdOpen } from "../coldopen.js";

const c = campaignById("rim-haulers");
const story = (id) => c.stories.find((s) => s.id === id);

const logState = () => ({
  config: {
    voices: [
      { id: "terminal", name: "MARY" },
      { id: "intercom", name: "CB RADIO" },
      { id: "the_cold", name: "THE COLD", adversary: { revealed: false, picture: "aaaaaaaaaaaa.png", credit: "" } },
      { id: "stowaway", name: "THE STOWAWAY", adversary: { revealed: true, picture: "bbbbbbbbbbbb.png", credit: "someone" } },
    ],
    cast: [{ name: "Wanda Okafor", portrait: "cccccccccccc.png" }, { name: "Silent Sam", portrait: "dddddddddddd.png" }],
  },
  log: [
    { id: 1, kind: "terminal", text: "CARGO SEAL INTACT." },
    { id: 2, kind: "player", by: "Okafor", text: "open the container" },
    { id: 3, kind: "entity", entity: "intercom", character: "Wanda Okafor", text: "Don't open it." },
    { id: 4, kind: "entity", entity: "the_cold", text: "Let us in." },
    { id: 5, kind: "entity", entity: "stowaway", text: "I was only hungry." },
    { id: 6, kind: "warden", text: "PRIVATE COMMAND: kill Okafor" },
    { id: 7, kind: "aside", text: "PRIVATE NOTE" },
    { id: 8, kind: "note", text: "Rook died: shot. Their file goes on the memorial (High Score 1)." },
    { id: 9, kind: "note", text: "Station: doors.cargo -> OPEN" },
  ],
  synopses: { sofar: { sections: [{ heading: "So far", audience: "players", text: "- They opened the seal." }, { heading: "What's really going on", audience: "warden", text: "- WARDEN ONLY" }] } },
});

test("the snapshot of a finished story keeps what the players saw and hides the adversary they never met", () => {
  const snap = snapshotStory(logState());
  assert.ok(snap.key.includes("TERMINAL: CARGO SEAL INTACT."));
  assert.ok(snap.key.includes("INTERCOM: Don't open it.".replace("INTERCOM", "CB RADIO · WANDA OKAFOR")));
  assert.ok(snap.key.includes("??? : Let us in.".replace("??? :", "???:")), "the unseen adversary speaks as ???");
  assert.ok(snap.key.includes("THE STOWAWAY: I was only hungry."));
  assert.ok(snap.key.some((l) => /Rook died/.test(l)));
  assert.doesNotMatch(JSON.stringify([snap.key, snap.figures, snap.wrap]), /PRIVATE|THE COLD|Silent Sam|WARDEN ONLY|doors\.cargo/);
  assert.deepEqual(snap.hidden, ["THE COLD"]);
  assert.deepEqual(snap.figures.map((f) => f.name), ["Wanda Okafor", "THE STOWAWAY"], "only the cast who spoke and the adversaries revealed");
  assert.equal(snap.figures[1].pic, "bbbbbbbbbbbb.png");
  assert.equal(snap.wrap, "- They opened the seal.");
});

test("finishing a story keeps the snapshot on the campaign entry, and it survives a save", () => {
  const p = newProgress(c);
  p.current = "first_shift";
  finishInto(p, c, { crew: [], cast: [] }, "They delivered it.", [], null, snapshotStory(logState()));
  assert.equal(p.done[0].recap.hidden[0], "THE COLD");
  const back = sanitizeProgress(JSON.parse(JSON.stringify(p)));
  assert.deepEqual(back.done[0].recap, p.done[0].recap);
  p.recap = { for: "quarantine", first: false, beats: [{ line: "A line.", who: "Wanda Okafor", kind: "cast", pic: "cccccccccccc.png", credit: "" }], hook: "Next." };
  assert.deepEqual(sanitizeProgress(JSON.parse(JSON.stringify(p))).recap, p.recap);
});

test("the request gives the model the unseen names as never to name, and no Warden-only text", () => {
  const p = newProgress(c);
  p.current = "first_shift";
  finishInto(p, c, { crew: [], cast: [] }, "Okafor lived. THE COLD took the cargo.", [], null, snapshotStory(logState()));
  const r = coldOpenRequest(c, p.done[0], story("quarantine"), p);
  assert.match(r.context, /NEVER NAME: THE COLD/);
  assert.doesNotMatch(r.context, /THE COLD took/, "the outcome note is scrubbed too");
  assert.match(r.context, /\?\?\? took the cargo/);
  assert.doesNotMatch(r.context, /WARDEN ONLY|PRIVATE/);
  assert.match(r.context, /NEW STORY: QUARANTINE/);
});

test("the beats: 6 at most, hidden names scrubbed, pictures only for figures the players know", () => {
  const snap = snapshotStory(logState());
  const raw = {
    beats: [
      { line: "Okafor warned them off.", who: "wanda okafor" },
      { line: "THE COLD asked to be let in.", who: "THE COLD" },
      { line: "A stowaway was only hungry.", who: "THE STOWAWAY" },
      { line: "Someone made up.", who: "Nobody Known" },
      { line: "Four.", who: "" }, { line: "Five.", who: "" }, { line: "Six.", who: "" }, { line: "Seven.", who: "" },
    ],
    hook: "THE COLD is waiting.",
  };
  const r = normalizeColdOpen(raw, snap, story("quarantine"));
  assert.equal(r.beats.length, 6);
  assert.deepEqual(r.beats.slice(0, 4).map((b) => [b.who, b.pic]), [["Wanda Okafor", "cccccccccccc.png"], ["???", ""], ["THE STOWAWAY", "bbbbbbbbbbbb.png"], ["", ""]]);
  assert.doesNotMatch(JSON.stringify(r), /THE COLD/);
  assert.equal(r.hook, "??? is waiting.");
  assert.throws(() => normalizeColdOpen({ beats: [{ line: "One.", who: "" }], hook: "" }, snap, story("quarantine")), /too short/);
  assert.deepEqual(sanitizeColdOpen(r), r);
});

test("the first story gets the campaign's tagline as its intro", () => {
  const r = introRecap(c, story("first_shift"));
  assert.deepEqual(r.beats, []);
  assert.equal(r.first, true);
  assert.match(r.hook, /Whether it's blockade running/);
});

function session() {
  Session.prototype.usesNeural = () => false;
  const s = new Session({ code: "TEST", tokenHash: "x", game: {} }, { onChange() {}, onEnd() {} });
  s.touch = () => {};
  s.syncDm = () => {};
  s.send = () => {};
  s.initPlayers = () => {};
  s.sendHeader = () => {};
  s.sectorSync = () => {};
  s.syncHazards = () => {};
  s.speech = { speak: async () => null, detach() {} };
  s.sent = [];
  s.toPlayers = (m) => s.sent.push(m);
  s.ask = async (req) => (/cold open/.test(req.system)
    ? { beats: [{ line: "Okafor warned them off.", who: "Wanda Okafor" }, { line: "THE COLD asked to be let in.", who: "THE COLD" }, { line: "The seal held.", who: "" }, { line: "The job paid.", who: "" }], hook: "A cold wind blows from QUARANTINE." }
    : { lore: "L", computer: { persona: "P" }, secrets: "", standingOrders: "", station: [], broadcastPersona: "B", voices: [{ id: "intercom", name: "CB RADIO", preset: "intercom", systems: [] }], cast: [], terminals: [], documents: [] });
  return s;
}

test("building the next story writes the cold open from the last one, plays it on every screen, and holds the opening scene until it ends", async () => {
  const s = session();
  s.state.campaign = newProgress(c);
  const p = s.state.campaign;
  await s.buildCampaignStory(c, story("first_shift"), p);
  const first = s.sent.find((m) => m.t === "coldopen");
  assert.ok(first, "the first story opens on the tagline");
  assert.deepEqual(first.cards, []);
  assert.match(first.title.line, /^RIM HAULERS · STORY 1 · FIRST SHIFT$/);
  assert.match(first.title.hook, /blockade running/);

  s.state.log = logState().log;
  s.state.config.voices.push(...logState().config.voices.filter((v) => v.adversary));
  s.state.config.cast.push({ name: "Wanda Okafor", portrait: "cccccccccccc.png" });
  finishInto(p, c, s.state.config, "Okafor lived.", [], null, snapshotStory(s.state));
  s.sent.length = 0;
  s.playhead = 0;
  await s.buildCampaignStory(c, story("quarantine"), p);
  const m = s.sent.find((x) => x.t === "coldopen");
  assert.equal(m.campaign, "RIM HAULERS");
  assert.equal(m.cards.length, 4);
  assert.match(m.cards[0].src, /portraits\//, "a known cast member's picture");
  assert.equal(m.cards[1].src, "", "the unseen adversary is ??? with no picture");
  assert.equal(m.cards[1].who, "???");
  assert.doesNotMatch(JSON.stringify(m), /THE COLD/);
  assert.equal(m.title.line, "RIM HAULERS · STORY 2 · QUARANTINE");
  assert.ok(m.cards[0].at < m.cards[1].at && m.cards[3].at < m.title.at && m.title.at + m.title.dur < m.end, "in order, then the title card");
  assert.ok(s.playhead >= m.end, "lines after the cold open wait for it");
  assert.equal(p.recap.for, "quarantine");
});

test("the cold open can be switched off, and still replayed with the Previously on button", async () => {
  const s = session();
  s.state.campaign = newProgress(c);
  s.state.config.coldOpen = false;
  await s.buildCampaignStory(c, story("first_shift"), s.state.campaign);
  assert.ok(!s.sent.some((m) => m.t === "coldopen"));
  assert.ok(s.state.campaign.recap, "written anyway");
  s.handleDm({ t: "campaignRecap" });
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(s.sent.some((m) => m.t === "coldopen"));
});

test("a recap that fails to write doesn't stop the story", async () => {
  const s = session();
  const p = (s.state.campaign = newProgress(c));
  p.done.push({ id: "first_shift", outcome: "Done.", at: 1 });
  const ask = s.ask;
  s.ask = async (req) => (/cold open/.test(req.system) ? { beats: [] } : ask(req));
  await s.buildCampaignStory(c, story("quarantine"), p);
  assert.equal(p.current, "quarantine");
  assert.equal(p.recap, null);
  assert.ok(!s.sent.some((m) => m.t === "coldopen"));
});
