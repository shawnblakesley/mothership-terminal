import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mockServer } from "../scripts/mock-llm.mjs";
// The provider reads DEEPSEEK_BASE_URL when it is first imported, so the mock must be listening before the app modules load.
const server = mockServer();
await new Promise((r) => server.listen(0, "127.0.0.1", r));
process.env.DEEPSEEK_BASE_URL = `http://127.0.0.1:${server.address().port}`;
const { buildRequest, buildPrecheck, parseReply } = await import("../agent.js");
const { chatRequest, draftRequest, pitchesRequest, normalizeDraft, normalizePitches, applyDraft } = await import("../builder.js");
const { CAMPAIGNS, buildRequest: campaignRequest, composeDraft, newProgress } = await import("../campaign.js");
const { coldOpenRequest, normalizeColdOpen } = await import("../coldopen.js");
const { synopsisRequest, recapRequest, normalizeSynopsis, normalizeRecap, SYNOPSIS_KINDS } = await import("../synopsis.js");
const { handoutRequest, normalizeHandout } = await import("../handouts.js");
const { draftRequest: roomRequest, sanitizeRows } = await import("../rooms.js");
const { kestrelState, haulersState } = await import("../scripts/fixtures.mjs");
const deepseek = (await import("../providers/deepseek.js")).default;
after(() => server.close());

const ask = (request) => deepseek.generate({ apiKey: "sk-mock", model: "deepseek-flash", effort: "off", ...request });
const json = async (request) => JSON.parse(await ask(request));

test("a game reply parses and is the one mock narrator line", async () => {
  const s = kestrelState();
  const r = parseReply(await ask(buildRequest(s, "")), s.config.voices, s.config.talk);
  assert.equal(r.lines.length, 1);
  assert.match(r.lines[0].text, /^MOCK: /);
  assert.equal(r.attacks.length + r.crew_changes.length + r.station_changes.length, 0);
  assert.equal(r.outcome_check.needed, false);
  const aside = parseReply(await ask(buildRequest(s, "", { aside: true })), s.config.voices, s.config.talk);
  assert.equal(aside.lines.length, 1);
});

test("the check-first precheck says no check is needed", async () => {
  const p = await json(buildPrecheck(kestrelState()));
  assert.equal(p.needed, false);
  assert.equal(p.suggested_check, "none");
});

test("Story Builder chat, draft and pitches are accepted", async () => {
  const b = { messages: [], draft: null };
  const chat = await json(chatRequest(b));
  assert.match(chat.reply, /^MOCK/);
  const d = normalizeDraft(await json(draftRequest(b)));
  assert.equal(d.title, "Mock Scenario");
  const { config } = applyDraft(d);
  assert.equal(config.stationName, "MOCK STATION");
  assert.equal(normalizePitches(await json(pitchesRequest(["x"]))).length, 4);
});

test("a campaign story build composes into a draft the app applies", async () => {
  const c = CAMPAIGNS[0], story = c.stories[0], p = newProgress(c);
  p.current = story.id;
  const raw = await json(campaignRequest(c, story, p));
  assert.ok(raw.lore && raw.computer);
  const { config } = applyDraft(normalizeDraft(composeDraft(c, story, p, raw)));
  assert.ok(config.voices.length);
});

test("the cold open, synopses, recaps, handout and room plan are accepted", async () => {
  const c = CAMPAIGNS[0], story = c.stories[0], p = newProgress(c);
  const last = { id: c.stories[0].id, recap: { figures: [], hidden: [] }, outcome: "done" };
  const co = normalizeColdOpen(await json(coldOpenRequest(c, last, c.stories[1], p)), last.recap, c.stories[1]);
  assert.ok(co.beats.length >= 2);

  const s = kestrelState();
  for (const kind of SYNOPSIS_KINDS) assert.ok(normalizeSynopsis(await json(synopsisRequest(s, [], kind).request)).length, kind);
  assert.ok(normalizeRecap(await json(recapRequest(s, "they left"))).sections.length);
  const h = haulersState();
  const withCampaign = await json(recapRequest(h, "they docked", { job: story.job, stakes: [], late: false }));
  assert.equal(withCampaign.delivery, "full");
  assert.ok(normalizeRecap(withCampaign).sections.length);

  assert.ok(normalizeHandout(await json(handoutRequest(s, "a memo", "MEMO", ""))).text);
  assert.ok(sanitizeRows((await json(roomRequest(s, { id: "med_bay", label: "Med Bay", deck: "deck 2" }))).rows));
});

test("stream:true is answered as server-sent events", async () => {
  const res = await fetch(`${process.env.DEEPSEEK_BASE_URL}/v1/chat/completions`, { method: "POST", body: JSON.stringify({ stream: true, messages: [] }) });
  const text = await res.text();
  assert.match(text, /^data: /);
  assert.match(text, /data: \[DONE\]\s*$/);
});
