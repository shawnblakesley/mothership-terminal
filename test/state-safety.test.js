import { test } from "node:test";
import assert from "node:assert/strict";
import { Session } from "../session.js";
import { RIM_HAULERS as c } from "../campaigns/rim-haulers.js";
import { newProgress } from "../campaign.js";
import { sanitizeCrew, patchCrew } from "../crew.js";

function session(game = {}) {
  Session.prototype.usesNeural = () => false;
  const s = new Session({ code: "TEST", tokenHash: "x", game }, { onChange() {}, onEnd() {} });
  s.touch = () => {};
  s.syncDm = () => {};
  s.toPlayers = () => {};
  s.initPlayers = () => {};
  s.sent = [];
  s.send = (to, m) => s.sent.push(m);
  return s;
}

const crewOf = () => sanitizeCrew(structuredClone(newProgress(c, () => 5).crew));

test("a stale Crew tab save keeps newer Health and an un-retire, applies its own edit and tells the Warden", () => {
  const s = session();
  s.state.config.crew = crewOf();
  const [a, b] = s.state.config.crew;
  a.health.current = a.health.max;
  b.retired = true;
  const base = structuredClone(s.state.config.crew), draft = structuredClone(base);
  a.health.current = 5;
  b.retired = false;
  draft[0].backstory = "Edited note";
  draft[0].health.current = 1;
  draft[1].crime = "New crime";
  s.handleDm({ t: "crew", crew: draft, base });
  const [na, nb] = s.state.config.crew;
  assert.equal(na.health.current, 5);
  assert.equal(na.backstory, "Edited note");
  assert.equal(nb.retired, false);
  assert.equal(nb.crime, "New crime");
  const toast = s.sent.find((m) => m.t === "toast");
  assert.match(toast.text, /one edit was not applied/);
  assert.match(toast.text, /health\.current/);
});

test("an untouched stale draft changes nothing, and added or removed characters still go through", () => {
  const live = crewOf(), base = structuredClone(live);
  live[0].stress = 9;
  const draft = structuredClone(base);
  draft.pop();
  draft.push({ name: "Newcomer" });
  const r = patchCrew(live, base, draft);
  assert.equal(r.stale.length, 0);
  assert.equal(r.crew[0].stress, 9);
  assert.equal(r.crew.length, live.length);
  assert.ok(r.crew.some((x) => x.name === "Newcomer"));
  assert.ok(!r.crew.some((x) => x.id === base.at(-1).id));
});

test("after a restart a saved queued line shows again", () => {
  const s = session({ log: [{ id: 1, kind: "terminal", text: "Hello", ts: 1, queued: true }] });
  assert.equal(s.state.log[0].queued, undefined);
});

test("after a restart an unanswered player line gets a Warden note once", () => {
  const log = [{ id: 1, kind: "terminal", text: "Hi", ts: 1 }, { id: 2, kind: "player", text: "ROSCOE scans the room", by: "Roscoe", ts: 2 }];
  const s = session({ log });
  const notes = s.state.log.filter((e) => e.orphan);
  assert.equal(notes.length, 1);
  assert.match(notes[0].text, /Roscoe/);
  assert.match(notes[0].text, /Generate/);
  const again = session({ log: JSON.parse(JSON.stringify(s.state.log)) });
  assert.equal(again.state.log.filter((e) => e.orphan).length, 1);
  const fine = session({ log: [{ id: 1, kind: "player", text: "x", ts: 1 }, { id: 2, kind: "terminal", text: "ok", ts: 2 }] });
  assert.equal(fine.state.log.filter((e) => e.orphan).length, 0);
});

function campaignSession() {
  const s = session();
  const p = newProgress(c, () => 5);
  p.current = c.stories[0].id;
  s.state.campaign = p;
  return s;
}

test("Play story while another story is current is refused unless the Warden confirms abandoning it", () => {
  const s = campaignSession(), p = s.state.campaign;
  const played = [];
  s.campaignPlay = (id) => played.push(id);
  const other = c.stories[1].id;
  s.handleDm({ t: "campaignPlay", story: other });
  assert.equal(played.length, 0);
  assert.match(s.sent.at(-1).text, /Finish it first/);
  s.handleDm({ t: "campaignPlay", story: other, abandon: true });
  assert.deepEqual(played, [other]);
  s.handleDm({ t: "campaignPlay", story: p.current });
  assert.equal(played.length, 2);
});

test("an abandoned story is recorded when the new one is built, not before", async () => {
  const s = campaignSession(), p = s.state.campaign, was = p.current;
  s.applyStory = () => {};
  s.ask = async () => ({ lore: "x", computer: "y" });
  s.writeRecap = async () => null;
  await s.buildCampaignStory(c, c.stories[1], p);
  assert.deepEqual(p.abandoned.map((x) => x.id), [was]);
  assert.equal(p.current, c.stories[1].id);
  assert.ok(!p.done.some((d) => d.id === was));
  assert.ok(s.state.log.some((e) => /abandoned unfinished/.test(e.text)));
});
