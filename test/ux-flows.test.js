import { test } from "node:test";
import assert from "node:assert/strict";
import { Session } from "../session.js";
import { RIM_HAULERS as c } from "../campaigns/rim-haulers.js";
import { newProgress, composeDraft } from "../campaign.js";
import { normalizeDraft } from "../builder.js";
import { sanitizeCrew } from "../crew.js";
import { handleChargen } from "../chargen.js";

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

const player = (character) => ({ role: "player", character, readyState: 1, sent: [], send(m) { this.sent.push(JSON.parse(m)); } });

// A campaign between stories with its crew, as the Downtime panel sees it.
function downtimeSession() {
  const s = session();
  const p = newProgress(c, () => 5);
  p.done = [{ id: "x", outcome: "", at: 1 }];
  p.at = "halfway_house";
  s.state.campaign = p;
  s.state.config.crew = sanitizeCrew(structuredClone(p.crew));
  return s;
}

test("Rest Save for everyone rolls at once for characters nobody plays and waits only for the seated ones", () => {
  const s = downtimeSession(), crew = s.state.config.crew;
  assert.ok(crew.length >= 4);
  const seated = crew[2];
  s.sockets.add(player(seated.id));
  s.downtimeGo({ kind: "rest", pc: "all", opts: {} });
  assert.equal(s.state.roll.status, "waiting");
  assert.deepEqual(s.state.roll.pcs.map((x) => x.id), [seated.id], "the first two were rolled for; the seated player's roll waits");
  const byWarden = s.state.log.filter((e) => e.kind === "roll" && /rolled by the Warden/.test(e.text));
  assert.equal(byWarden.length, 2);
  for (const pc of [crew[0], crew[1]]) assert.ok(byWarden.some((e) => e.text.startsWith(pc.name)), `${pc.name} was rolled for`);
  s.rollFor(seated, [40], { by: "player" });
  assert.equal(s.dtQueue.length, 0, "the queue is done");
  const all = s.state.log.filter((e) => e.kind === "roll");
  assert.equal(all.length, crew.length, "everyone rolled exactly once");
  assert.ok(all.find((e) => e.text.startsWith(seated.name) && !/rolled by the Warden/.test(e.text)), "the seated player's own roll");
});

test("a character played on Discord counts as played: the everyone queue waits for them", () => {
  const s = downtimeSession(), crew = s.state.config.crew;
  s.state.discordPlayers = { u1: { crew: crew[0].id, name: "Ana" } };
  s.downtimeGo({ kind: "rest", pc: "all", opts: {} });
  assert.deepEqual(s.state.roll.pcs.map((x) => x.id), [crew[0].id]);
});

test("a single Rest Save for an absent character still waits for the Warden to press Roll for them", () => {
  const s = downtimeSession(), crew = s.state.config.crew;
  s.downtimeGo({ kind: "rest", pc: crew[1].id, opts: {} });
  assert.equal(s.state.roll.status, "waiting");
  assert.equal(s.state.log.filter((e) => e.kind === "roll").length, 0);
});

test("an auto-rolled Rest Save follows the rules: the worst Save, the ones digit, a failure is +1 Stress", () => {
  for (const [dice, stress] of [[24, 6], [95, 9]]) {
    const s = downtimeSession(), pc = s.state.config.crew[0];
    Object.assign(pc, { stress: 10, minStress: 2, saves: { sanity: 30, fear: 40, body: 50 } });
    pc.stress = dice === 95 ? 8 : 10;
    s.sockets.add(player(pc.id));
    s.downtimeGo({ kind: "rest", pc: pc.id, opts: {} });
    s.rollFor(pc, [dice], { by: "player" });
    assert.equal(pc.stress, stress, `rolled ${dice} against the worst Save (30)`);
  }
});

// Ticket 42: a plain new story gives every player a new crew to choose from; a campaign story keeps the files players hold.
test("a new story drops seated players back to the crew picker, but a campaign story keeps their claims", () => {
  const draft = () => normalizeDraft(composeDraft(c, c.stories[0], { cast: {} }, {}));
  const kept = sanitizeCrew(structuredClone(newProgress(c, () => 5).crew));
  const s = session(), ws = player(kept[0].id), dead = player(kept[1].id);
  kept[1].cond = { ...(kept[1].cond || {}), dead: "Warden" };
  s.sockets.add(ws);
  s.sockets.add(dead);
  s.applyStory(draft(), (config) => { config.crew = structuredClone(kept); }, true);
  assert.equal(ws.character, kept[0].id, "the campaign story keeps a playable character's claim");
  assert.equal(dead.character, null, "but not a dead one's");
  s.applyStory(draft());
  assert.equal(ws.character, null, "a plain story swap clears every claim: the player is sent to the picker");
});

test("the hazard log names the room, not its id", () => {
  const s = session();
  s.state.config.map = "Deck 2 · Offices: inspector_office=Inspector's Office, galley";
  s.setHazard("inspector_office", "fire", 1);
  const line = s.state.log.findLast((e) => /^Hazard in/.test(e.text)).text;
  assert.match(line, /^Hazard in Inspector's Office:/);
  assert.doesNotMatch(line, /inspector_office/);
});

test("the player header carries the story title", () => {
  const s = session();
  s.state.config.title = "HOT LOAD";
  assert.equal(s.playerHeader().title, "HOT LOAD");
  s.state.config.title = "";
  assert.equal(s.playerHeader().title, s.state.config.stationName);
});

test("rolling a creation step twice says what to do next instead of reading as a failure", () => {
  const s = session();
  s.state.config.playerCreate = true;
  s.state.config.crew = s.state.config.crew.slice(0, 2);
  const ws = player("");
  handleChargen(s, ws, { t: "cgStart" });
  handleChargen(s, ws, { t: "cgRoll", what: "health" });
  handleChargen(s, ws, { t: "cgRoll", what: "health" });
  assert.match(ws.sent.at(-1).error, /already rolled.*Press Enter to go on/i);
});
