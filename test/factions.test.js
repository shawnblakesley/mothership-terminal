import { test } from "node:test";
import assert from "node:assert/strict";
import { RIM_HAULERS as c } from "../campaigns/rim-haulers.js";
import { newProgress, sanitizeProgress, shiftStanding, finishInto, carryInto, priceMultiplier, priceAt, socialAdvantage, standingLabel, factionBrief, toggleFavour } from "../campaign.js";

const story = (id) => c.stories.find((s) => s.id === id);
const config = (names) => ({ cast: names.map((name) => ({ name, notes: "", attitude: 0, why: "", portrait: "" })), voices: [], crew: [] });

test("standing is clamped to -3..+3, on shifts and when loaded", () => {
  const p = newProgress(c);
  assert.equal(p.factions.union, 0);
  shiftStanding(p, c, "union", 9);
  assert.equal(p.factions.union, 3);
  assert.equal(shiftStanding(p, c, "union", 1), null);
  shiftStanding(p, c, "union", -9);
  assert.equal(p.factions.union, -3);
  p.factions = { union: 99, rcea: -99, lantern: "x", nope: 2 };
  const q = sanitizeProgress(p);
  assert.deepEqual([q.factions.union, q.factions.rcea, q.factions.lantern, q.factions.nope], [3, -3, 0, undefined]);
  assert.equal(standingLabel(-3), "Enemy");
  assert.equal(standingLabel(2), "Trusted");
});

test("finishing a story applies only the ticked entries", () => {
  const p = newProgress(c);
  p.current = "first_shift";
  const s = story("first_shift");
  assert.ok(s.affinity.length >= 2);
  const { changes } = finishInto(p, c, config([]), "done", [0]);
  assert.equal(changes.length, 1);
  assert.equal(p.factions[s.affinity[0].faction], s.affinity[0].change);
  const total = Object.values(p.factions).reduce((a, b) => a + Math.abs(b), 0);
  assert.equal(total, Math.abs(s.affinity[0].change), "nothing else moved");
  const q = newProgress(c);
  q.current = "first_shift";
  assert.equal(finishInto(q, c, config([]), "done", []).changes.length, 0);
  assert.ok(Object.values(q.factions).every((n) => n === 0), "unticked by default");
});

test("recurring characters start one step friendlier at +2, cooler at -2, and the nudge does not compound", () => {
  const halfway = story(c.stories.find((x) => x.cast.includes("maggie") && x.at).id);
  const attitude = (n) => {
    const p = newProgress(c);
    p.factions.union = n;
    p.cast.maggie = { attitude: 1, why: "", portrait: "", history: "" };
    const cfg = config(["Maggie Szabo"]);
    carryInto(cfg, c, halfway, p);
    return { a: cfg.cast[0].attitude, p, cfg };
  };
  assert.equal(attitude(0).a, 1);
  assert.equal(attitude(1).a, 1);
  assert.equal(attitude(2).a, 2);
  assert.equal(attitude(-2).a, 0);
  assert.equal(attitude(2).p.nudges.maggie, 1);
  const top = newProgress(c);
  top.factions.union = 2;
  top.cast.maggie = { attitude: 3, why: "", portrait: "", history: "" };
  const cfg = config(["Maggie Szabo"]);
  carryInto(cfg, c, halfway, top);
  assert.equal(cfg.cast[0].attitude, 3, "clamped");
  top.current = halfway.id;
  finishInto(top, c, cfg, "ok");
  assert.equal(top.cast.maggie.attitude, 2, "the nudge is taken back off when the story ends");
});

test("price multipliers by standing", () => {
  const m = [-3, -2, -1, 0, 1, 2, 3].map(priceMultiplier);
  assert.deepEqual(m, [null, 1.25, 1.1, 1, 1, 0.9, 0.8]);
  const p = newProgress(c);
  p.factions.union = 3;
  assert.equal(priceAt(c, p, "halfway_house", 100), 80);
  p.factions.union = -3;
  assert.equal(priceAt(c, p, "halfway_house", 100), null);
  assert.equal(priceAt(c, p, "tollgate", 100), 100);
});

test("social rolls: [+] at +2 or more, [-] at -2 or less", () => {
  assert.deepEqual([-3, -2, -1, 0, 1, 2, 3].map(socialAdvantage), ["disadvantage", "disadvantage", "none", "none", "none", "advantage", "advantage"]);
});

test("the agent is told the standings in force, favours and the finale's help", () => {
  const p = newProgress(c);
  const s = story("first_shift");
  p.factions.union = 2;
  p.factions.gallow_mercer = -2;
  const brief = factionBrief(c, s, p);
  assert.match(brief, /house rule/);
  assert.match(brief, /Teamsters Local 1312: Trusted \(\+2\)\. \[\+\]/);
  assert.match(brief, /Gallow-Mercer Logistics: Hostile \(-2\)\. \[-\].*hit team/);
  assert.match(brief, /prices at PORT GALLOW are \+25%/);
  assert.ok(toggleFavour(p, c, "union"));
  assert.match(factionBrief(c, s, p), /favour is already used|favour this story is already used/);
  p.factions.gallow_mercer = -3;
  assert.match(factionBrief(c, s, p), /won't trade/);
  const finale = story("end_of_the_line");
  p.factions.rcea = 3;
  assert.match(factionBrief(c, finale, p), /THE FINALE.*Rim Customs & Excise Authority.*send help in the final hour/);
  assert.doesNotMatch(factionBrief(c, s, p), /THE FINALE/);
});
