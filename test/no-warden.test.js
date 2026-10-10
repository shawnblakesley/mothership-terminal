import { test, mock } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { Session } from "../session.js";
import { campaignById, jobsAt, newProgress } from "../campaign.js";
import { restAndRecover, downtimeLines } from "../downtime-lite.js";
import { sanitizeCrew } from "../crew.js";

const c = campaignById("rim-haulers");
function session() {
  Session.prototype.usesNeural = () => false;
  const s = new Session({ code: "TEST", tokenHash: "x", game: {} }, { onChange() {}, onEnd() {} });
  Object.assign(s, { touch() {}, syncDm() {}, toPlayers() {}, send() {}, initPlayers() {}, soloPitches: async () => {}, sendHeader() {} });
  return s;
}
const rig = (ds) => () => ds.shift();
const pc = (over = {}) => sanitizeCrew([{ name: "Ada", saves: { sanity: 40, fear: 25, body: 50 }, health: { current: 3, max: 12 }, wounds: { current: 1, max: 2 }, stress: 6, minStress: 2, ...over }])[0];

test("the job board carries the money strip and the exact amounts the confirms quote", () => {
  const p = newProgress(c);
  const j = jobsAt(c, p);
  assert.equal(j.debt, p.debt);
  assert.equal(j.dispatch, null);
  p.resources.fuel = 0;
  p.money = 0;
  const stuck = jobsAt(c, p);
  assert.equal(stuck.dispatch.units, 1);
  assert.equal(stuck.dispatch.cost, stuck.fuelEach);
  p.money = stuck.fuelEach * 3 + 10;
  const rich = jobsAt(c, p);
  assert.equal(rich.refuelUnits, 3);
  assert.equal(rich.refuelCost, rich.fuelEach * 3);
});

test("travel, dispatch and refuel each leave a result notice on the board, cleared by a failed action", () => {
  const s = session();
  s.startSolo();
  s.soloBuild(1);
  const p = s.state.campaign, x = s.state.solo, pilot = { send() {} };
  s.handlePilot(pilot, { t: "pilotTravel", to: "tollgate" });
  assert.match(s.soloView().notice, /^Travelled to .*: \d+ days, 1 fuel\. 9 left\.$/);
  p.resources.fuel = 0;
  p.money = 0;
  s.handlePilot(pilot, { t: "pilotDispatch" });
  assert.match(s.soloView().notice, /^Dispatch advanced 1 unit of fuel: [\d,]+cr added to the note\. The note is [\d,]+cr\. Fuel 1\.$/);
  p.money = 100000;
  const quoted = s.soloJobs();
  s.handlePilot(pilot, { t: "pilotRefuel" });
  assert.equal(quoted.refuelUnits, 9);
  assert.equal(s.soloView().notice, `Refuelled 9 units for ${quoted.refuelCost.toLocaleString("en-US")}cr. Rig account ${(100000 - quoted.refuelCost).toLocaleString("en-US")}cr. Fuel 10.`);
  s.handlePilot(pilot, { t: "pilotRefuel" });
  assert.equal(x.notice, "");
  assert.match(x.error, /tank is full/);
});

test("no-Warden downtime: a Critical Failure asks for a Panic Check, Stress over 20 cuts the Save, Nightmares is [-]", () => {
  const a = pc({ stress: 20, cond: { tags: ["CONDITION: Nightmares"] }, saves: { sanity: 40, fear: 40, body: 60 } });
  // Body Save 66 (critical failure); Rest Save with [-]: 31 (success) and 66 (critical failure), the worse kept
  const [r] = restAndRecover([a], rig([66, 31, 66]));
  assert.equal(r.rest.why[0], "Nightmares [-]");
  assert.equal(r.rest.roll, 66);
  assert.equal(r.rest.outcome, "critical failure");
  assert.equal(a.stress, 20);
  assert.equal(r.panics.length, 2);
  assert.equal(r.reduced.length, 2);
  assert.equal(a.saves.body, 59);
  assert.equal(a.saves.sanity, 39);
  assert.match(downtimeLines([r])[0], /Stress over 20 by 1: body Save 60 to 59.*Panic Check for the critical failures/);
});

test("no-Warden downtime without a Critical Failure or Stress over 20 asks for nothing", () => {
  const a = pc();
  const [r] = restAndRecover([a], rig([30, 24]));
  assert.deepEqual(r.panics, []);
  assert.deepEqual(r.reduced, []);
  assert.doesNotMatch(downtimeLines([r])[0], /Panic|over 20/);
});

test("ending a story rolls the Panic Check for a crewmate who critically failed a downtime Save", () => {
  const s = session();
  s.startSolo();
  s.soloBuild(1);
  const p = s.state.campaign;
  p.current = "cold_chain";
  Object.assign(s.state.solo, { phase: "ended", recap: null, delivery: null, earned: [] });
  s.state.config.crew = structuredClone(p.crew);
  const m = mock.method(crypto, "randomInt", (lo, hi) => (hi === 100 ? 66 : 20));
  try { s.soloFinish(); } finally { m.mock.restore(); }
  const panics = s.state.log.filter((e) => e.kind === "roll" && /downtime, critical failure on the/.test(e.text));
  assert.ok(panics.length >= 1);
  assert.match(panics[0].text, /PANIC/i);
});
