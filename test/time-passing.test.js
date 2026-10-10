import { test } from "node:test";
import assert from "node:assert/strict";
import { Session } from "../session.js";
import { campaignById, newProgress, carryInto, laneBetween } from "../campaign.js";
import { sanitizeCrew } from "../crew.js";

const c = campaignById("rim-haulers");

function session() {
  Session.prototype.usesNeural = () => false;
  const s = new Session({ code: "TEST", tokenHash: "x", game: {} }, { onChange() {}, onEnd() {} });
  Object.assign(s, { touch() {}, syncDm() {}, toPlayers() {}, send() {}, initPlayers() {}, sectorSync() {}, sendHeader() {} });
  return s;
}

function playing(id) {
  const s = session();
  const p = s.state.campaign = newProgress(c, () => 3);
  p.current = id;
  carryInto(s.state.config, c, c.stories.find((x) => x.id === id), p, s.state.station);
  s.state.storyStart = structuredClone({ config: s.state.config, station: s.state.station, synopses: {}, at: 1 });
  return s;
}

function downtime() {
  const s = session();
  const p = newProgress(c, () => 5);
  p.done = [{ id: "x", outcome: "", at: 1 }];
  p.at = "halfway_house";
  s.state.campaign = p;
  s.state.config.crew = sanitizeCrew(structuredClone(p.crew));
  return s;
}

test("ticket 92: Retcon of a reply with time_passes takes back its hours, its hazard roll and the queue", () => {
  const s = session();
  const [a] = s.state.config.crew;
  a.cond.active = 0;
  s.deliver({ lines: [], time_passes: { hours: 20 } }, "agent");
  assert.equal(s.state.roll?.status, "waiting", "20 hours without rest called an Exhaustion Save");
  assert.ok(a.cond.active > 0);
  s.hazardUnits.push({ u: "hour" });
  s.retcon();
  assert.equal(s.state.roll, null);
  assert.equal(s.hazardWork(), 0);
  assert.equal(a.cond.active, 0);
});

test("ticket 92: Retcon leaves a roll the Warden had open before the reply", () => {
  const s = session();
  s.handleDm({ t: "rollRequest", roll: { pc: "all", check: "fear" } });
  const id = s.state.roll.id;
  s.deliver({ lines: [{ voice: "narrator", text: "Something." }], time_passes: { hours: 1 } }, "agent");
  s.retcon();
  assert.equal(s.state.roll?.id, id);
});

test("ticket 94: finishing a lane story passes the lane's days once and ages timed conditions", () => {
  const s = playing("long_haul");
  const story = c.stories.find((x) => x.id === "long_haul"), lane = laneBetween(c, story.from, story.to);
  const pc = s.state.config.crew[0];
  pc.cond.cryo = 400;
  s.handleDm({ t: "campaignFinish", outcome: "ok", delivery: "full" });
  assert.equal(s.state.campaign.downtime.day, lane.days);
  assert.equal(pc.cond.cryo, 400 - lane.days * 24);
  assert.ok(s.state.log.some((e) => new RegExp(`${lane.days} days pass on`).test(e.text)));
  s.handleDm({ t: "campaignFinish", outcome: "ok", delivery: "full" });
  assert.equal(s.state.campaign.downtime.day, lane.days, "finishing again passes nothing");
});

test("ticket 94: a story at a place passes no days", () => {
  const s = playing("cinders_reach");
  s.handleDm({ t: "campaignFinish", outcome: "ok", delivery: "full" });
  assert.equal(s.state.campaign.downtime.day, 0);
});

test("ticket 62: an hour of Pass time bleeds, burns and brings a Lethal Injury's Death Save due", () => {
  const s = session();
  const [a, b, d] = s.state.config.crew;
  a.cond.bleeding = 2;
  b.cond.fire = true;
  d.deathSaveIn = 6;
  s.passTime(1);
  assert.ok(a.health.current < a.health.max || a.wounds.current > 0, "Bleeding did damage");
  assert.ok(b.health.current < b.health.max || b.wounds.current > 0, "burning did damage");
  assert.notEqual(s.state.deathSaves?.[a.id], undefined, "Bleeding for the hour ends in a Death Save");
  assert.notEqual(s.state.deathSaves?.[d.id], undefined);
  assert.equal(d.deathSaveIn, undefined);
  assert.ok(s.state.log.some((e) => /Bleeding 2.*whole hour/.test(e.text)));
});

test("ticket 64: short-term recovery and the Rest Save are once per character per day", () => {
  const s = downtime();
  const [a] = s.state.config.crew;
  const roll = (kind) => { s.state.roll = null; s.downtimeGo({ kind, pc: a.id, opts: {} }); if (s.state.roll) s.rollFor(a, [10], { by: "warden" }); };
  a.health.current = 1;
  roll("recovery");
  assert.equal(a.health.current, a.health.max);
  a.health.current = 1;
  const before = s.state.log.length;
  roll("recovery");
  assert.equal(a.health.current, 1, "refused the same day");
  assert.ok(s.state.log.slice(before).some((e) => /already had a short-term recovery today/.test(e.text)));
  a.stress = 6;
  roll("rest");
  const after = a.stress;
  roll("rest");
  assert.equal(a.stress, after, "no second Rest Save today");
  s.state.campaign.downtime.day += 1;
  roll("recovery");
  assert.equal(a.health.current, a.health.max, "allowed again after a day");
});
