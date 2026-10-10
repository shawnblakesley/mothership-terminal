import { test } from "node:test";
import assert from "node:assert/strict";
import { Session } from "../session.js";
import { RIM_HAULERS as c } from "../campaigns/rim-haulers.js";
import { newProgress, composeDraft } from "../campaign.js";
import { normalizeDraft } from "../builder.js";
import { DEFAULT_CREW, sanitizeCrew } from "../crew.js";
import { validateCharacter } from "../chargen.js";
import { sanitizeStats } from "../combat.js";
import { WEAPONS } from "../weapons.js";
import { planRoll, treat, shoreCost } from "../downtime.js";

function game(placement) {
  Session.prototype.usesNeural = () => false;
  const s = new Session({ code: "TESTPOLISH2" }, { onChange() {}, onEnd() {} });
  s.touch = () => {};
  s.syncDm = () => {};
  for (const [character, terminal] of Object.entries(placement)) s.sockets.add({ role: "player", character, terminal, readyState: 1, send() {} });
  return s;
}
const texts = (s) => s.state.log.map((e) => e.text);
const dummy = (s) => s.state.config.voices.push({ id: "dummy", name: "Dummy", adversary: { revealed: true, stats: sanitizeStats({ combat: 99, instinct: 30, woundsMax: 20, healthPerWound: 999, attacks: [] }) } });

// ---- Ticket 65
test("each printed weapon rider shows under the hit in the log (and so reaches the agent)", () => {
  const riders = { Flamethrower: /BODY SAVE \[-\] OR SET ON FIRE \(2D10 DAMAGE PER ROUND\)/, "Foam Gun": /BODY SAVE OR STUCK/, "Frag Grenade": /HITS EVERYTHING ADJACENT TO THE TARGET/, "Laser Cutter": /1 ROUND TO RECHARGE/, "Rigging Gun": /ANOTHER 2D10 DAMAGE WHEN THE BOLT IS REMOVED/, "Stun Baton": /BODY SAVE OR STUNNED FOR 1 ROUND/, "Tranq Pistol": /BODY SAVE OR UNCONSCIOUS FOR 1D10 ROUNDS/ };
  const s = game({ rusk: "airlock" });
  const rusk = s.crewById("rusk");
  dummy(s);
  for (const [name, re] of Object.entries(riders)) {
    rusk.items = [name, `Ammo (${name})`];
    rusk.ammo = {};
    s.crewAttack({ pc: rusk, weapon: name, target: "Dummy" });
    assert.match(texts(s).findLast((t) => /HITS DUMMY/.test(t)), re, name);
  }
});

test("weapons without a rider print none, and only the seven riders in the book are listed", () => {
  assert.deepEqual(WEAPONS.filter((w) => w.effect).map((w) => w.name).sort(), ["Flamethrower", "Foam Gun", "Frag Grenade", "Laser Cutter", "Rigging Gun", "Stun Baton", "Tranq Pistol"]);
  const s = game({ rusk: "airlock" });
  const rusk = s.crewById("rusk");
  rusk.items = ["Revolver", "Ammo (revolver)"];
  rusk.ammo = {};
  dummy(s);
  s.crewAttack({ pc: rusk, weapon: "Revolver", target: "Dummy" });
  assert.doesNotMatch(texts(s).findLast((t) => /HITS DUMMY/.test(t)), /\(PSG\)/);
});

// ---- Ticket 60
test("every default KESTREL-9 character is a legal 1e pregenerated character", () => {
  for (const pc of DEFAULT_CREW) assert.deepEqual(validateCharacter(pc, { pregenerated: true }), [], pc.name);
  assert.equal(DEFAULT_CREW.find((x) => x.className === "Marine").wounds.max, 3);
  assert.equal(DEFAULT_CREW.find((x) => x.className === "Android").saves.fear, 72);
  assert.equal(sanitizeCrew(structuredClone(DEFAULT_CREW)).every((x) => x.wounds.max === (x.className === "Marine" || x.className === "Android" ? 3 : 2)), true);
});

// ---- Ticket 63
test("class X shore leave: a d100 of 00 costs 0cr and is labelled, 01 costs 10,000cr, 99 costs 990,000cr", () => {
  assert.equal(shoreCost("X", () => 0).total, 0);
  assert.equal(shoreCost("X", () => 1).total, 10000);
  assert.equal(shoreCost("X", () => 99).total, 990000);
  const p = newProgress(c, () => 5);
  p.done = [{ id: "x", outcome: "", at: 1 }];
  const lantern = c.locations.find((l) => l.portClass === "X");
  p.at = lantern.id;
  const a = sanitizeCrew(structuredClone(p.crew))[0];
  p.crew[0].credits = 123;
  const plan = planRoll(p, c, a, "shore", { safe: true }, (lo, hi) => (hi === 99 ? 0 : 4));
  assert.equal(plan.ok, true);
  assert.equal(p.crew[0].credits, 123);
  assert.match(plan.lines[0], /pays 0cr.*00 reads as zero/);
});

// ---- Ticket 66
test("Psychosurgery refuses Minimum Stress when it is already 2 or lower (Nanogel), and still restores a raised one", () => {
  const p = newProgress(c, () => 5);
  p.done = [{ id: "x", outcome: "", at: 1 }];
  p.at = "halfway_house";
  p.crew[0].credits = 500000;
  const a = sanitizeCrew(structuredClone(p.crew))[0];
  for (const min of [2, 1, 0]) {
    a.minStress = min;
    const r = treat(p, a, "psychosurgery", { choice: "minstress" });
    assert.match(r.error, /not above 2/, `Minimum Stress ${min}`);
    assert.equal(a.minStress, min);
  }
  assert.equal(p.crew[0].credits, 500000, "nothing charged");
  a.minStress = 3;
  assert.equal(treat(p, a, "psychosurgery", { choice: "minstress" }).ok, true);
  assert.equal(a.minStress, 2);
  assert.equal(p.crew[0].credits, 472000);
});

// ---- Ticket 67
test("the Teamster's [+] is once per game night: it survives a new story and Restart story, and End game night gives it back", () => {
  const draft = () => normalizeDraft(composeDraft(c, c.stories[0], { cast: {} }, {}));
  const s = game({ rusk: "airlock" });
  const rusk = s.crewById("rusk");
  s.storyBegins();
  s.handleDm({ t: "rollRequest", roll: { pc: "rusk", check: "panic", plus: true } });
  s.rollFor(rusk, [15, 3]);
  assert.equal(s.state.panicPlus.rusk, true);
  s.restartStory();
  assert.equal(s.state.panicPlus.rusk, undefined, "used after the story began, so Restart story rewinds it");
  s.storyBegins();
  s.state.roll = null;
  s.handleDm({ t: "rollRequest", roll: { pc: "rusk", check: "panic", plus: true } });
  s.rollFor(rusk, [15, 3]);
  s.state.panicPlus.rusk = true;
  s.applyStory(draft());
  assert.equal(s.state.panicPlus.rusk, true, "a new story does not give it back");
  s.state.config.crew = sanitizeCrew(structuredClone(DEFAULT_CREW));
  assert.equal(s.plusAvailable(s.crewById("rusk")), false);
  s.endNight();
  assert.deepEqual(s.state.panicPlus, {});
  assert.equal(s.plusAvailable(s.crewById("rusk")), true);
});

test("Restart story keeps a use made in an earlier story of the same night", () => {
  const s = game({ rusk: "airlock" });
  s.state.panicPlus.rusk = true;
  s.storyBegins();
  s.restartStory();
  assert.equal(s.state.panicPlus.rusk, true);
});
