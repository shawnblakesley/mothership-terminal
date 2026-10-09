import { test } from "node:test";
import assert from "node:assert/strict";
import { Session } from "../session.js";
import { campaignById, newProgress, carryInto } from "../campaign.js";

const c = campaignById("rim-haulers");

// A campaign story in play: the live crew is built from the campaign's, as when a story begins.
function playing() {
  Session.prototype.usesNeural = () => false;
  const s = new Session({ code: "TEST", tokenHash: "x", game: {} }, { onChange() {}, onEnd() {} });
  Object.assign(s, { touch() {}, syncDm() {}, toPlayers() {}, send() {}, initPlayers() {}, sectorSync() {}, sendHeader() {} });
  const p = s.state.campaign = newProgress(c, () => 3);
  p.current = "cinders_reach";
  carryInto(s.state.config, c, c.stories.find((x) => x.id === p.current), p, s.state.station);
  s.state.storyStart = structuredClone({ config: s.state.config, station: s.state.station, synopses: {}, at: 1 });
  return s;
}
const finish = (s) => s.handleDm({ t: "campaignFinish", outcome: "ok", delivery: "full" });
const live = (s, id) => s.state.config.crew.find((x) => x.id === id);
const camp = (s, id) => s.state.campaign.crew.find((x) => x.id === id);

test("ticket 54: a death marked between stories is still there when the next story is built", () => {
  const s = playing();
  finish(s);
  const id = s.state.config.crew[1].id;
  s.handleDm({ t: "crewState", pc: id, state: "deceased" });
  assert.ok(live(s, id).cond.dead);
  assert.ok(camp(s, id).cond.dead, "the campaign copy follows");
  const next = structuredClone(s.state.config);
  carryInto(next, c, c.stories[1], s.state.campaign, structuredClone(s.state.station));
  assert.ok(next.crew.find((x) => x.id === id).cond.dead);
});

test("ticket 54: a retirement and a Crew-tab edit between stories reach the campaign copy", () => {
  const s = playing();
  finish(s);
  const [a, b] = s.state.config.crew;
  s.handleDm({ t: "crewState", pc: a.id, state: "retired" });
  const crew = structuredClone(s.state.config.crew);
  crew[1].items = [...crew[1].items, "Crowbar"];
  s.handleDm({ t: "crew", crew });
  assert.equal(camp(s, a.id).retired, true);
  assert.ok(camp(s, b.id).items.includes("Crowbar"));
});

test("ticket 54: edits between stories keep credits as the campaign has them, and a resupply is not undone", () => {
  const s = playing();
  finish(s);
  const p = s.state.campaign, id = p.crew[0].id;
  p.crew[0].credits = 5000;
  p.money = 40000;
  s.moneySync();
  s.handleDm({ t: "crewState", pc: id, state: "retired" });
  assert.equal(camp(s, id).credits, 5000);
  const before = camp(s, id).items.length;
  s.handleDm({ t: "campaignBuy", to: id, lines: { aid: 1 }, pay: "rig" });
  assert.equal(camp(s, id).items.length, before + 1);
  assert.equal(live(s, id).items.length, before + 1, "the live sheet has the kit");
  s.handleDm({ t: "crewState", pc: id, state: "playing" });
  assert.equal(camp(s, id).items.length, before + 1, "a later edit does not drop it");
});

test("ticket 55: a transfer made mid-story survives Restart and Finish, ledger and balances agreeing", () => {
  const s = playing();
  const p = s.state.campaign, id = p.crew[0].id;
  p.money = 21945;
  const start = camp(s, id).credits;
  s.handleDm({ t: "campaignMoney", from: "rig", to: id, amount: 300 });
  assert.equal(p.money, 21645);
  s.handleDm({ t: "resetSession" });
  assert.equal(live(s, id).credits, start + 300, "the restart keeps the transfer on the live sheet");
  assert.equal(camp(s, id).credits, start + 300);
  assert.equal(p.money, 21645);
  finish(s);
  assert.equal(camp(s, id).credits, start + 300, "finishing keeps it");
  assert.ok(p.ledger.some((e) => e.acct === id && e.amount === 300));
  assert.ok(p.ledger.some((e) => e.acct === "rig" && e.amount === -300));
});
