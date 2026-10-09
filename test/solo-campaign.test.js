import { test } from "node:test";
import assert from "node:assert/strict";
import { Session } from "../session.js";
import { campaignById, newProgress, jobsAt } from "../campaign.js";
import { restAndRecover, downtimeLines } from "../downtime-lite.js";
import { sanitizeCrew } from "../crew.js";

const BANNED = ["acts", "adversary", "secrets", "affinity", "cast", "description", "persona", "factions", "faction", "crew", "notes", "outcome", "event", "horror", "tier"];
const ALLOWED = ["port", "rig", "fuel", "jobs", "id", "title", "hook", "job", "where", "lane", "days"];
const keys = (v, out = new Set()) => {
  if (Array.isArray(v)) v.forEach((x) => keys(x, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { out.add(k); keys(x, out); }
  return out;
};
const c = campaignById("rim-haulers");

function session() {
  Session.prototype.usesNeural = () => false;
  const s = new Session({ code: "TEST", tokenHash: "x", game: {} }, { onChange() {}, onEnd() {} });
  s.touch = () => {};
  s.syncDm = () => {};
  s.toPlayers = () => {};
  s.send = () => {};
  s.initPlayers = () => {};
  s.soloPitches = async () => {};
  return s;
}

test("the pilot's job list from Port Gallow: the four jobs, no spoiler fields", () => {
  const p = newProgress(c);
  const board = jobsAt(c, p);
  assert.equal(board.port, "PORT GALLOW");
  assert.deepEqual(board.jobs.map((j) => j.title).sort(), ["COLD CHAIN", "FIRST SHIFT", "LIVESTOCK", "QUARANTINE"]);
  const found = keys(board);
  for (const k of BANNED) assert.ok(!found.has(k), `job list has key ${k}`);
  assert.deepEqual([...found].filter((k) => !ALLOWED.includes(k)), []);
  const text = JSON.stringify(board);
  for (const s of c.stories) {
    for (const b of [...s.secrets, ...Object.values(s.acts), s.adversary.persona, s.event, s.horror]) assert.ok(!text.includes(b), `leaks: ${b.slice(0, 50)}`);
  }
  for (const m of c.cast) assert.ok(!text.includes(m.notes), `cast notes leak: ${m.name}`);
  assert.equal(board.jobs.find((j) => j.title === "LIVESTOCK").days, 3);
});

test("the pilot's session shows the campaign pitch, then only the job list", () => {
  const s = session();
  s.startSolo();
  const x = s.state.solo;
  assert.deepEqual(x.pitches.map((p) => p.title).slice(0, 2), ["KESTREL-9", "RIM HAULERS (campaign)"]);
  assert.equal(s.soloView().jobs, undefined);
  s.soloBuild(1);
  assert.ok(s.state.campaign);
  const view = s.soloView();
  assert.deepEqual(view.jobs.jobs.map((j) => j.title).sort(), ["COLD CHAIN", "FIRST SHIFT", "LIVESTOCK", "QUARANTINE"]);
  assert.ok(!JSON.stringify(view.jobs).includes("affinity"));
  s.state.campaign.at = "tollgate";
  assert.deepEqual(s.soloView().jobs.jobs.map((j) => j.title).sort(), ["DEADHEAD", "TOLLGATE"]);
  s.state.campaign.done.push({ id: "tollgate", outcome: "", at: 1 });
  assert.deepEqual(s.soloView().jobs.jobs.map((j) => j.title), ["DEADHEAD"]);
});

test("ending a campaign story records the verdict, only the earned faction stakes, and rests the crew", () => {
  const s = session();
  s.startSolo();
  s.soloBuild(1);
  const p = s.state.campaign, story = c.stories.find((t) => t.id === "first_shift");
  p.current = story.id;
  Object.assign(s.state.solo, { phase: "ended", recap: { verdict: "They made it out." }, earned: [0, 9] });
  s.state.config.crew = sanitizeCrew(structuredClone(p.crew));
  s.state.config.crew[0].health.current = 1;
  s.state.config.cast = [];
  const before = p.factions.union;
  s.soloFinish();
  assert.equal(p.current, "");
  assert.equal(p.done.at(-1).outcome, "They made it out.");
  assert.equal(p.factions.union, before + 1);
  assert.equal(p.factions.gallow_mercer, 0);
  assert.equal(s.state.solo.after.rest.length, p.crew.length);
  assert.ok(s.state.log.some((e) => /Downtime between stories/.test(e.text)));
  assert.ok(s.soloView().jobs.jobs.some((j) => j.title === "QUARANTINE"));
  assert.ok(!s.soloView().jobs.jobs.some((j) => j.title === "FIRST SHIFT"));
});

const rig = (ds) => () => ds.shift();
const pc = (over = {}) => sanitizeCrew([{ name: "Ada", saves: { sanity: 40, fear: 25, body: 50 }, health: { current: 3, max: 12 }, wounds: { current: 1, max: 2 }, stress: 6, minStress: 2, ...over }])[0];

test("short-term recovery: a Body Save success restores Health to Maximum and leaves Wounds", () => {
  const a = pc();
  const [r] = restAndRecover([a], rig([30, 21]));
  assert.equal(a.health.current, 12);
  assert.equal(a.wounds.current, 1);
  assert.equal(r.recovery.ok, true);
  const b = pc();
  restAndRecover([b], rig([70, 21]));
  assert.equal(b.health.current, 3);
});

test("Rest Save: the worst Save, Stress down by the ones digit, +1 on failure, never below Minimum Stress", () => {
  const a = pc();
  const [r] = restAndRecover([a], rig([30, 24]));
  assert.equal(r.rest.save, "fear");
  assert.equal(r.rest.target, 25);
  assert.equal(a.stress, 2);
  assert.equal(r.rest.from, 6);
  const b = pc({ stress: 5 });
  restAndRecover([b], rig([30, 78]));
  assert.equal(b.stress, 6);
  const f = pc({ stress: 5, minStress: 4 });
  restAndRecover([f], rig([30, 19]));
  assert.equal(f.stress, 4);
});

test("downtime skips the dead and gives no Rest Save in cryosleep", () => {
  const dead = pc({ cond: { dead: "killed" } }), cold = pc({ name: "Bo", cond: { cryo: true } });
  const out = restAndRecover([dead, cold], rig([30, 5]));
  assert.equal(out.length, 1);
  assert.equal(out[0].rest, undefined);
  assert.equal(cold.stress, 6);
  assert.match(downtimeLines(out)[0], /cryosleep/);
});
