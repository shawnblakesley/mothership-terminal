import { test } from "node:test";
import assert from "node:assert/strict";
import { Session } from "../session.js";
import { DEFAULT_CREW, sanitizeCrew, applyDamage, playable, endSession } from "../crew.js";
import { campaignById, newProgress } from "../campaign.js";
import { decideCharacter } from "../chargen.js";
import { sanitizeRequest } from "../rolls.js";

function session(crew = DEFAULT_CREW) {
  Session.prototype.usesNeural = () => false;
  const s = new Session({ code: "TEST", tokenHash: "x", game: {} }, { onChange() {}, onEnd() {} });
  Object.assign(s, { touch() {}, syncDm() {}, send() {}, toPlayers() {}, toPlayersIf() {}, initPlayers() {} });
  s.state.config.crew = sanitizeCrew(structuredClone(crew));
  return s;
}
const campaignOf = (s, current = "story") => { const p = newProgress(campaignById("rim-haulers")); Object.assign(p, { current, crew: sanitizeCrew(structuredClone(s.state.config.crew)) }); s.state.campaign = p; return p; };
const ws = (s, character) => { const sent = []; const w = { role: "player", readyState: 1, character, sent, send: (m) => sent.push(JSON.parse(m)), lastInput: 0 }; s.sockets.add(w); return w; };
const kill = (pc, how = "Death Save") => { pc.cond.dead = how; };
const pip = () => ({ ...sanitizeCrew([{ ...DEFAULT_CREW[0], name: "Pip Okoro" }])[0], id: "pip-okoro" });

test("ticket 51 A: Restart story keeps a dead carried character dead", () => {
  const s = session();
  const okafor = s.state.config.crew[1];
  kill(okafor);
  campaignOf(s);
  s.storyBegins();
  s.restartStory();
  assert.equal(s.crewById(okafor.id).cond.dead, "Death Save");
  s.restartStory();
  assert.equal(s.crewById(okafor.id).cond.dead, "Death Save", "also with no snapshot");
  s.endNight();
  assert.equal(s.crewById(okafor.id).highScore, 0);
});

test("ticket 51 B: Restart story keeps items, ammo, Stress and conditions as carried", () => {
  const s = session();
  const pc = s.state.config.crew[0];
  pc.items.push("First aid kit");
  pc.ammo = { "Combat shotgun": 1 };
  pc.stress = 5;
  pc.cond.tags = ["cryosleep"];
  pc.cond.cryo = true;
  campaignOf(s);
  s.restartStory();
  const a = s.crewById(pc.id);
  assert.ok(a.items.includes("First aid kit"));
  assert.deepEqual(a.ammo, { "Combat shotgun": 1 });
  assert.equal(a.stress, 5);
  assert.deepEqual(a.cond.tags, ["cryosleep"]);
  assert.equal(a.cond.cryo, true);
  s.storyBegins();
  s.restartStory();
  assert.ok(s.crewById(pc.id).items.includes("First aid kit"), "with a snapshot too");
});

test("Restart story still rewinds a story's own damage and deaths", () => {
  const s = session();
  campaignOf(s);
  s.storyBegins();
  const pc = s.state.config.crew[0];
  pc.health.current = 1;
  kill(pc, "Wounds Table");
  s.restartStory();
  const a = s.crewById(pc.id);
  assert.equal(a.cond.dead, "");
  assert.equal(a.health.current, a.health.max);
});

test("ticket 51 C: Restart keeps a replacement and the character it replaced; no 5 playable", () => {
  const s = session();
  const okafor = s.state.config.crew[1];
  kill(okafor);
  const p = campaignOf(s);
  s.storyBegins();
  const marrow = s.state.config.crew.at(-1);
  kill(marrow, "Death Save");
  s.state.newChars = [{ id: "n1", sheet: pip(), replaces: marrow.id, history: [], ts: 0 }];
  assert.equal(decideCharacter(s, true, "n1"), "");
  s.restartStory();
  const ids = s.state.config.crew.map((c) => c.id);
  assert.ok(ids.includes("pip-okoro") && ids.includes(marrow.id) && ids.includes(okafor.id));
  assert.equal(s.crewById(marrow.id).cond.dead, "Death Save");
  assert.equal(s.crewById(marrow.id).replacedBy, "pip-okoro");
  assert.ok(s.state.config.crew.filter(playable).length <= 4);
  assert.ok(p.crew.some((c) => c.id === "pip-okoro"));
  s.endNight();
  assert.equal(s.crewById("pip-okoro").highScore, 1);
});

test("ticket 52: accepting a replacement keeps the dead character on the crew record", () => {
  const s = session();
  const marrow = s.state.config.crew.at(-1);
  kill(marrow);
  marrow.highScore = 2;
  marrow.epitaph = "Last off the ship.";
  campaignOf(s);
  s.state.newChars = [{ id: "n1", sheet: pip(), replaces: marrow.id, history: [], ts: 0 }];
  assert.equal(decideCharacter(s, true, "n1"), "");
  for (const list of [s.state.config.crew, s.state.campaign.crew]) {
    const m = list.find((c) => c.id === marrow.id);
    assert.ok(m, "dead character still listed");
    assert.equal(m.highScore, 2);
    assert.equal(m.replacedBy, "pip-okoro");
    assert.ok(list.some((c) => c.id === "pip-okoro"));
  }
});

test("sanitizeCrew caps living characters at 4 but keeps the dead", () => {
  const many = sanitizeCrew(Array.from({ length: 7 }, (_, i) => ({ ...DEFAULT_CREW[0], id: `a${i}`, name: `Alpha ${i}`, cond: i % 2 ? { dead: "x" } : undefined })));
  assert.equal(many.filter(playable).length, 4);
  assert.equal(many.filter((c) => !playable(c)).length, 3);
});

test("ticket 26 A: attacks on a dead target spend no shot", () => {
  const s = session();
  const pc = s.state.config.crew[0];
  s.state.config.voices = [{ id: "x", name: "Creature", adversary: { stats: { dead: true, wounds: 0, attacks: [], combat: 40 } } }];
  const log = [];
  s.addLog = (k, t) => log.push(t);
  const before = JSON.stringify(pc.ammo);
  s.crewAttack({ pc, weapon: "", target: "Creature" });
  assert.ok(log.some((t) => /already dead/.test(t)));
  assert.equal(JSON.stringify(pc.ammo), before);
});

test("ticket 26 B: a mid-story death is mirrored into the campaign crew copy", () => {
  const s = session();
  const p = campaignOf(s);
  const mensah = s.state.config.crew[2];
  kill(mensah, "lethal radiation dose");
  s.crewChanged();
  const q = p.crew.find((c) => c.id === mensah.id);
  assert.equal(q.cond.dead, "lethal radiation dose");
  assert.ok(q.endedIn);
  s.endNight();
  assert.equal(q.highScore, 0, "no High Score for the dead (ticket 58)");
  assert.equal(p.crew.find((c) => c.id === s.state.config.crew[0].id).highScore, 1);
});

test("ticket 56: a dead character's player cannot act", () => {
  const s = session();
  const okafor = s.state.config.crew[1];
  const w = ws(s, okafor.id);
  s.state.config.playerRolls = true;
  s.state.config.playerVitals = true;
  kill(okafor);
  s.requestReply = () => assert.fail("no agent reply");
  s.handlePlayer(w, { t: "input", text: "I get up and shoot." });
  s.handlePlayer(w, { t: "selfRoll", check: "strength" });
  s.handlePlayer(w, { t: "vitals", field: "stress", value: 0 });
  assert.equal(s.state.log.filter((e) => e.kind === "player").length, 0);
  assert.equal(w.sent.filter((m) => m.t === "rollError").length, 3);
  s.handlePlayer(w, { t: "finalWords", text: "Tell them I tried." });
  assert.equal(okafor.finalWords, "Tell them I tried.");
});

test("ticket 56: a Warden roll for a dead character says why", () => {
  const crew = sanitizeCrew(structuredClone(DEFAULT_CREW));
  kill(crew[1]);
  assert.throws(() => sanitizeRequest({ pc: crew[1].id, check: "strength" }, crew), /dead and cannot roll/);
});

test("ticket 56: a hit at Maximum Wounds and 0 Health calls a Death Save", () => {
  const pc = sanitizeCrew(structuredClone(DEFAULT_CREW))[0];
  pc.wounds.current = pc.wounds.max;
  pc.health.current = 0;
  assert.equal(applyDamage(pc, 5, { direct: true }).deathSave, true);
  const s = session();
  const t = s.state.config.crew[0];
  t.wounds.current = t.wounds.max;
  t.health.current = 0;
  s.hurtCrew(t, 5, { direct: true }, "HIT");
  const roll = s.state.deathSaves[t.id];
  assert.notEqual(roll, undefined);
  s.hurtCrew(t, 5, { direct: true }, "HIT");
  assert.equal(s.state.deathSaves[t.id], roll, "a pending Death Save is not re-rolled");
});

test("ticket 58: End session never gives the dead or retired a High Score", () => {
  const list = sanitizeCrew(structuredClone(DEFAULT_CREW));
  kill(list[1]);
  list[2].retired = true;
  endSession(list);
  assert.equal(list[1].highScore, 0);
  assert.equal(list[2].highScore, 0);
  assert.equal(list[0].highScore, 1);
});
