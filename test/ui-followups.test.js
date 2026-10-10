import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import vm from "vm";
import { Session } from "../session.js";
import { keeperOf, newDraft, rollFor, handleChargen } from "../chargen.js";
import { campaignById, jobsAt, newProgress } from "../campaign.js";

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

const client = (solo) => {
  const ctx = { window: {}, document: { getElementById: () => ({ addEventListener() {} }), addEventListener() {} } };
  vm.runInNewContext(fs.readFileSync(new URL("../public/chargen.js", import.meta.url), "utf8"), ctx);
  ctx.window.Chargen.init({ solo: () => solo });
  return ctx.window.Chargen;
};

test("character creation names the pilot in a no-Warden game and the Warden otherwise (server text)", () => {
  assert.equal(keeperOf(true), "pilot");
  assert.equal(keeperOf(false), "Warden");
  const d = newDraft("");
  rollFor(d, "health", {});
  assert.match(rollFor(d, "health", { solo: true }).error, /the pilot has not allowed rerolls/);
  assert.match(rollFor(d, "health", {}).error, /the Warden has not allowed rerolls/);
  for (const solo of [true, false]) {
    const s = session();
    if (solo) s.startSolo();
    s.state.config.playerCreate = false;
    const sent = [];
    handleChargen(s, { send: (m) => sent.push(JSON.parse(m)) }, { t: "cgStart" });
    assert.match(sent[0].error, solo ? /The pilot has not allowed new characters/ : /The Warden has not allowed new characters/);
  }
});

test("character creation screen says THE PILOT in a no-Warden game and THE WARDEN otherwise (client text)", () => {
  assert.equal(client(true).keeper(), "PILOT");
  assert.equal(client(false).keeper(), "WARDEN");
  const src = fs.readFileSync(new URL("../public/chargen.js", import.meta.url), "utf8");
  assert.ok(!/THE WARDEN/.test(src), "no hard-coded THE WARDEN left in the character-creation screen");
  assert.match(src, /THE \$\{keeper\(\)\} APPROVES YOUR CHARACTER/);
});

test("the pilot's board carries each living crew member's credits", () => {
  const p = newProgress(c);
  p.crew[0].credits = 340;
  p.crew[1].cond = { ...p.crew[1].cond, dead: "Hull breach" };
  p.crew[2].retired = true;
  const b = jobsAt(c, p);
  assert.deepEqual(b.crew, p.crew.filter((x) => !x.cond?.dead && !x.retired).map((x) => ({ name: x.name, credits: x.credits || 0 })));
  assert.equal(b.crew[0].credits, 340);
  assert.ok(!b.crew.some((x) => x.name === p.crew[1].name || x.name === p.crew[2].name));
  assert.deepEqual(Object.keys(b.crew[0]).sort(), ["credits", "name"]);
  p.money = 0;
  assert.equal(jobsAt(c, p).money, 0);
});

test("the board shows the empty-account line and the crew credits line", () => {
  const src = fs.readFileSync(new URL("../public/player.js", import.meta.url), "utf8");
  assert.match(src, /RIG ACCOUNT EMPTY&#58; REFUELLING NEEDS CREDITS\. IF THE RIG CAN'T MOVE, CALL DISPATCH\./);
  assert.match(src, /jobs\.money > 0/);
  assert.match(src, /CREW CREDITS&#58; /);
  assert.match(src, /crewShort\(x\.name/);
});
