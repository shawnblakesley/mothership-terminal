import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { RIM_HAULERS as c } from "../campaigns/rim-haulers.js";
import { newProgress, sanitizeProgress, finishInto, carryInto } from "../campaign.js";
import { DEFAULT_CREW, sanitizeCrew, endSession, settleEndings, memorialOf, longestSurvivor, applyDeathSave } from "../crew.js";
import { finalVoice, speakingVoice } from "../cast.js";
import { resolve, sanitizeRequest, rollTarget } from "../rolls.js";

const crew = () => sanitizeCrew(structuredClone(DEFAULT_CREW));
const config = (list) => ({ cast: [], voices: [], crew: list });

test("a new character starts at High Score 0, and the value is sanitized", () => {
  assert.ok(crew().every((p) => p.highScore === 0));
  const [a, b, d] = sanitizeCrew([{ ...DEFAULT_CREW[0], highScore: "7.6" }, { ...DEFAULT_CREW[1], highScore: -4 }, { ...DEFAULT_CREW[2], highScore: 1e9 }]);
  assert.equal(a.highScore, 8);
  assert.equal(b.highScore, 0);
  assert.equal(d.highScore, 9999);
});

test("End session adds 1 to living characters only", () => {
  const list = crew();
  list[1].cond.dead = "Head explodes";
  list[2].retired = true;
  const up = endSession(list);
  assert.deepEqual(up.map((p) => p.id), [list[0].id, list[3].id]);
  assert.deepEqual(list.map((p) => p.highScore), [1, 0, 0, 1]);
  endSession(list);
  assert.deepEqual(list.map((p) => p.highScore), [2, 0, 0, 2]);
});

test("High Score is carried across stories with the rest of the sheet", () => {
  const p = newProgress(c);
  const story = c.stories.find((s) => s.at);
  p.current = story.id;
  const live = sanitizeCrew(structuredClone(p.crew));
  endSession(live);
  endSession(live);
  finishInto(p, c, config(live), "done");
  assert.ok(p.crew.every((x) => x.highScore === 2));
  const next = config([]);
  carryInto(next, c, story, sanitizeProgress(JSON.parse(JSON.stringify(p))));
  assert.ok(next.crew.every((x) => x.highScore === 2));
});

test("the campaign keeps its own session total", () => {
  const p = newProgress(c);
  assert.equal(p.sessions, 0);
  p.sessions = 3;
  assert.equal(sanitizeProgress(p).sessions, 3);
  assert.equal(sanitizeProgress({ ...p, sessions: -5 }).sessions, 0);
});

test("the dead and the retired go to the memorial with their reason and story", () => {
  const list = crew();
  list[0].highScore = 4;
  list[0].cond.dead = "Head explodes";
  list[0].epitaph = "Never once on time.";
  list[1].retired = true;
  const fresh = settleEndings(list, "FIRST SHIFT");
  assert.deepEqual(fresh.map((p) => p.id), [list[0].id, list[1].id]);
  assert.deepEqual(settleEndings(list, "SECOND"), [], "only noticed once");
  const wall = memorialOf(list);
  assert.equal(wall.length, 2);
  assert.deepEqual([wall[0].name, wall[0].how, wall[0].story, wall[0].highScore, wall[0].epitaph, wall[0].retired], [list[0].name, "Head explodes", "FIRST SHIFT", 4, "Never once on time.", false]);
  assert.deepEqual([wall[1].how, wall[1].retired], ["Retired from play", true]);
  assert.equal(longestSurvivor(list).id, list[0].id, "the dead can hold the record");
  assert.equal(longestSurvivor(crew()), null, "nobody has survived a session yet");
});

test("a death from the Death Save lands on the memorial, and a character put back in play leaves it", () => {
  const list = crew();
  applyDeathSave(list[2], 7);
  assert.ok(list[2].cond.dead);
  settleEndings(list, "story");
  list[2].finalWords = "Tell Rook I was right.";
  assert.equal(memorialOf(list)[0].finalWords, "Tell Rook I was right.");
  list[2].cond.dead = "";
  settleEndings(list, "story");
  assert.equal(memorialOf(list).length, 0);
  assert.equal(list[2].endedIn, "");
  assert.equal(list[2].finalWords, "");
});

test("the final transmission has a voice of its own, by pronouns, and is spoken like any cast line", () => {
  const list = crew();
  const she = { name: "A", pronouns: "she/her" }, he = { name: "B", pronouns: "he/him" };
  assert.equal(finalVoice(she)[1], "f");
  assert.equal(finalVoice(he)[1], "m");
  const speaker = finalVoice(list[0], [{ voice: "af_bella" }]);
  assert.deepEqual(speakingVoice({ cast: [], voices: [] }, { voiceSpeaker: speaker, character: list[0].name }), { engine: "neural", speaker, pace: 1 });
});

test("High Score changes no roll", () => {
  const pc = crew()[0];
  const list = crew(), req = sanitizeRequest({ pc: pc.id, check: "strength" }, list);
  const a = resolve(req, rollTarget(req, pc).stat, [37]);
  pc.highScore = 40;
  const b = resolve(req, rollTarget(req, pc).stat, [37]);
  assert.deepEqual(a, b);
  for (const file of ["rolls.js", "combat.js", "dice.js", "hazards.js", "wounds.js", "weapons.js", "agent.js"]) {
    assert.ok(!/highScore|High Score/.test(fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8")), `${file} must not read High Score`);
  }
});
