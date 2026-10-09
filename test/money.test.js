import { test } from "node:test";
import assert from "node:assert/strict";
import { RIM_HAULERS as c } from "../campaigns/rim-haulers.js";
import { newProgress, sanitizeProgress, finishInto, settleStory, payUpfront, resupply } from "../campaign.js";
import { startingCredits, duesOf, feeFor, finalFee, upfrontOf, debtDue, transfer, spend, DEBT_START, DEBT_PAYMENT } from "../money.js";
import { sanitizeCrew } from "../crew.js";

const story = (id) => c.stories.find((s) => s.id === id);
const config = () => ({ cast: [], voices: [], crew: [] });
// Plays a story out: it is current, then finished and settled.
const run = (p, id, o) => {
  p.current = id;
  payUpfront(p, c, story(id));
  finishInto(p, c, config(), "ok");
  return settleStory(p, c, story(id), o);
};

test("starting credits are 2d10x10 with each d10 reading 1-10: 20 to 200", () => {
  assert.equal(startingCredits(() => 1).total, 20);
  assert.equal(startingCredits(() => 10).total, 200);
  let lo = 999, hi = 0;
  for (let i = 0; i < 400; i++) {
    const t = startingCredits().total;
    lo = Math.min(lo, t);
    hi = Math.max(hi, t);
    assert.ok(t >= 20 && t <= 200 && t % 10 === 0);
  }
  assert.ok(lo < 60 && hi > 160);
  const p = newProgress(c, () => 4);
  assert.deepEqual(p.crew.map((x) => x.credits), p.crew.map(() => 80));
  assert.equal(p.ledger.length, p.crew.length, "the rolls are in the ledger");
  assert.match(p.ledger[0].what, /\(4\+4\)x10/);
  assert.equal(p.money, 0);
  assert.equal(p.debt, DEBT_START);
  assert.equal(DEBT_START, 180000);
});

test("dues are 4% of the pay, rounded to the credit", () => {
  assert.equal(duesOf(10000), 400);
  assert.equal(duesOf(8000), 320);
  assert.equal(duesOf(12345), 494, "493.8");
  assert.equal(duesOf(12), 0, "0.48");
  assert.equal(duesOf(13), 1, "0.52");
});

test("a delivery in full pays the fee to the rig account less the dues; the ledger shows each", () => {
  const p = newProgress(c);
  const r = run(p, "cinders_reach", { delivery: "full" });
  assert.equal(story("cinders_reach").pay, 10000);
  assert.equal(p.money, 9600);
  assert.deepEqual(r.entries.map((e) => [e.acct, e.amount]), [["rig", 10000], ["rig", -400]], "the fee and the dues are separate ledger lines");
  assert.match(r.lines[0], /10,000cr fee.*4% union dues 400cr.*9,600cr to the rig account/);
});

test("a partial delivery pays half; not delivered pays nothing", () => {
  const p = newProgress(c);
  run(p, "cinders_reach", { delivery: "partly" });
  assert.equal(p.money, 5000 - 200);
  const q = newProgress(c);
  const r = run(q, "cinders_reach", { delivery: "none" });
  assert.equal(q.money, 0);
  assert.equal(r.entries.length, 0);
});

test("skip dues keeps the 4% and costs the Union standing -1", () => {
  const p = newProgress(c);
  const r = run(p, "cinders_reach", { delivery: "full", skipDues: true });
  assert.equal(p.money, 10000);
  assert.equal(p.factions.union, -1);
  assert.equal(r.changes[0].faction, "union");
  assert.match(r.lines[0], /skipped/);
});

test("late delivery voids the fee on Cold Chain only", () => {
  assert.equal(story("cold_chain").late, true);
  assert.equal(feeFor(story("cold_chain"), "full", true), 0);
  assert.equal(feeFor(story("cold_chain"), "full", false), 10000);
  assert.equal(feeFor(story("cinders_reach"), "full", true), 10000, "other jobs ignore late");
  const p = newProgress(c);
  const r = run(p, "cold_chain", { delivery: "full", late: true });
  assert.equal(p.money, 0);
  assert.match(r.lines[0], /voids the fee/);
});

test("Lantern pays triple, half up front at Play (dues taken), the rest at the finish; no double payment on a rebuild", () => {
  const s = story("lantern");
  assert.equal(s.pay, 3 * 16000);
  assert.equal(upfrontOf(s), 24000);
  const p = newProgress(c);
  p.current = "lantern";
  payUpfront(p, c, s);
  assert.equal(p.money, 24000 - 960);
  payUpfront(p, c, s);
  assert.equal(p.money, 24000 - 960, "a rebuild pays nothing more");
  finishInto(p, c, config(), "ok");
  settleStory(p, c, s, { delivery: "full" });
  assert.equal(p.money, 2 * (24000 - 960), "the second half, with its dues");
  assert.equal(finalFee(s, "none", false, 24000), 0, "no clawback of what was paid");
  assert.equal(finalFee(s, "partly", false, 24000), 0);
});

test("every story has a fee in its tier's house-rule band; the finale pays off the debt instead", () => {
  const band = { 1: [6000, 12000], 2: [12000, 25000], 3: [25000, 60000] };
  for (const s of c.stories) {
    assert.equal(typeof s.pay, "number", s.id);
    if (s.payoff) { assert.equal(s.id, "end_of_the_line"); continue; }
    const mult = s.id === "lantern" ? 3 : 1, [lo, hi] = band[s.tier];
    if (s.pay === 0) continue;
    assert.ok(s.pay >= lo * mult && s.pay <= hi * mult, `${s.id} ${s.pay}`);
  }
  assert.equal(c.stories.filter((s) => s.payoff).length, 1);
  const p = newProgress(c);
  p.debt = 100000;
  const r = run(p, "end_of_the_line", { delivery: "full" });
  assert.equal(p.debt, 0);
  assert.equal(p.money, 0, "it pays off the note rather than paying a fee");
  assert.match(r.lines[0], /paid off/);
  const q = newProgress(c);
  q.debt = 100000;
  run(q, "end_of_the_line", { delivery: "partly" });
  assert.equal(q.debt, 50000);
});

test("the debt: 6 kcr due every 2 finished stories, paid from the rig account", () => {
  assert.deepEqual([1, 2, 3, 4, 6].map((n) => debtDue(n, 1000)), [false, true, false, true, true]);
  assert.equal(debtDue(2, 0), false, "nothing due once paid off");
  const p = newProgress(c);
  p.money = 50000;
  run(p, "deadhead", {});
  assert.equal(p.debt, DEBT_START, "not yet");
  const r = run(p, "last_call", {});
  assert.equal(p.debt, DEBT_START - DEBT_PAYMENT);
  assert.equal(p.money, 50000 - 6000);
  assert.equal(p.missed, 0);
  assert.ok(r.lines.some((l) => /6,000cr paid/.test(l)));
});

test("a missed payment costs Gallow-Mercer standing -1 and sends the repossession letter", () => {
  const p = newProgress(c);
  run(p, "deadhead", {});
  const r = run(p, "last_call", {});
  assert.equal(p.debt, DEBT_START);
  assert.equal(p.missed, 1);
  assert.equal(p.factions.gallow_mercer, -1);
  assert.match(r.handout.text, /repossess/);
  assert.match(r.handout.text, /ROSCOE/);
  assert.match(r.handout.text, /remote code/);
  run(p, "deadhead", {});
  const r2 = run(p, "last_call", {});
  assert.equal(p.missed, 2);
  assert.equal(p.factions.gallow_mercer, -2);
  assert.match(r2.handout.text, /second missed/);
});

test("transfers and spending: whole price or nothing, ledger kept, no negative accounts", () => {
  const p = newProgress(c, () => 5);
  const [a, b] = p.crew;
  assert.equal(a.credits, 100);
  assert.equal(transfer(p, { from: a.id, to: "rig", amount: 150 }).ok, false);
  const r = transfer(p, { from: a.id, to: "rig", amount: 60, what: "kit" });
  assert.equal(r.ok, true);
  assert.deepEqual([a.credits, p.money], [40, 60]);
  assert.equal(transfer(p, { from: "", to: b.id, amount: 25, what: "shore leave" }).ok, true);
  assert.equal(b.credits, 125);
  assert.equal(transfer(p, { from: "rig", to: "debt", amount: 60 }).ok, true);
  assert.equal(p.debt, DEBT_START - 60);
  assert.equal(transfer(p, { from: "rig", to: "debt", amount: 1 }).ok, false, "the rig account is empty");
  assert.equal(transfer(p, { from: a.id, to: a.id, amount: 1 }).ok, false);
  assert.equal(spend(p, b.id, 500, "x").ok, false);
  assert.equal(b.credits, 125);
  assert.equal(spend(p, b.id, 25, "ammo, 50cr a magazine").ok, true);
  assert.equal(b.credits, 100);
  assert.ok(p.ledger.every((e) => e.bal >= 0));
});

test("Resupply is charged to the rig account or the chosen character, and refused when it cannot be paid", () => {
  const p = newProgress(c, () => 5);
  p.at = "tollgate";
  const who = p.crew[0];
  const buy = (pay) => resupply(p, c, { to: who.id, ammoFor: "Revolver", pay, lines: { ammo: 2 } });
  const price = buy("rig");
  assert.equal(price.ok, false, "the rig account is empty");
  assert.equal(who.items.filter((i) => /ammo/i.test(i)).length, p.crew[0].items.filter((i) => /ammo/i.test(i)).length);
  p.money = 1000;
  const r = buy("rig");
  assert.equal(r.ok, true, r.error);
  assert.equal(p.money, 1000 - r.total);
  assert.equal(r.entries[0].acct, "rig");
  assert.equal(buy(who.id).ok, false, "100cr is not enough");
  who.credits = 500;
  const r2 = buy(who.id);
  assert.equal(r2.ok, true, r2.error);
  assert.equal(who.credits, 500 - r2.total);
});

test("crew credits are a field; the old note 'Credits: Ncr.' moves into it and out of the notes", () => {
  const [pc] = sanitizeCrew([{ name: "Old Hand", notes: "Credits: 130cr. High Score: 2.", className: "Marine" }]);
  assert.equal(pc.credits, 130);
  assert.equal(pc.notes, "High Score: 2.");
  assert.equal(sanitizeCrew([{ name: "Rich", credits: 90, notes: "Credits: 10cr." }])[0].credits, 90, "the field wins");
  assert.equal(sanitizeCrew([{ name: "Broke", credits: -5 }])[0].credits, 0);
  assert.equal(sanitizeCrew([{ name: "Plain" }])[0].credits, 0);
});

test("money survives a save: sanitizeProgress keeps the accounts, debt, ledger and what was paid up front", () => {
  const p = newProgress(c, () => 3);
  p.money = 4321;
  p.debt = 99000;
  p.missed = 2;
  p.finished = 5;
  p.current = "lantern";
  payUpfront(p, c, story("lantern"));
  const q = sanitizeProgress(JSON.parse(JSON.stringify(p)));
  assert.deepEqual([q.money, q.debt, q.missed, q.finished], [p.money, 99000, 2, 5]);
  assert.deepEqual(q.upfront, p.upfront);
  assert.equal(q.ledger.length, p.ledger.length);
  assert.deepEqual(q.crew.map((x) => x.credits), p.crew.map((x) => x.credits));
  const old = sanitizeProgress({ id: c.id, crew: [{ name: "Old", notes: "Credits: 70cr." }] });
  assert.equal(old.debt, DEBT_START, "a campaign saved before money has the note");
  assert.equal(old.crew[0].credits, 70);
});

test("the Warden's console: starting rolls are logged, Finish pays with dues, a missed payment hands out the letter, money moves", async () => {
  const { Session } = await import("../session.js");
  Session.prototype.usesNeural = () => false;
  const s = new Session({ code: "TEST", tokenHash: "x", game: {} }, { onChange() {}, onEnd() {} });
  Object.assign(s, { touch() {}, syncDm() {}, toPlayers() {}, send() {}, initPlayers() {}, sectorSync() {} });
  s.handleDm({ t: "campaignStart", id: c.id });
  const p = s.state.campaign;
  assert.ok(p.crew.every((x) => x.credits >= 20 && x.credits <= 200));
  assert.equal(s.state.log.filter((e) => /starting credits, 2d10x10/.test(e.text)).length, p.crew.length);
  assert.ok(s.state.log.some((e) => /180,000cr note.*house rule/.test(e.text)));
  p.current = "cinders_reach";
  s.handleDm({ t: "campaignFinish", outcome: "ok", delivery: "full" });
  assert.equal(p.money, 9600);
  assert.ok(s.state.log.some((e) => /4% union dues 400cr/.test(e.text)));
  p.current = "deadhead";
  s.handleDm({ t: "campaignFinish", outcome: "ok", delivery: "full" });
  assert.equal(p.debt, DEBT_START - DEBT_PAYMENT, "2 finished: the rig paid 6 kcr");
  assert.equal(p.money, 3600);
  s.handleDm({ t: "campaignMoney", from: "rig", to: p.crew[0].id, amount: 3000, what: "shore leave" });
  assert.deepEqual([p.money, p.crew[0].credits >= 3000], [600, true]);
  p.current = "deadhead";
  s.handleDm({ t: "campaignFinish", outcome: "ok", delivery: "full" });
  p.current = "deadhead";
  s.handleDm({ t: "campaignFinish", outcome: "ok", delivery: "full" });
  assert.equal(p.missed, 1, "600cr could not cover the next 6 kcr");
  assert.equal(s.state.handouts.at(-1).title, "GALLOW-MERCER FINANCE: NOTICE OF MISSED PAYMENT");
  assert.equal(p.factions.gallow_mercer, -1);
  s.handleDm({ t: "campaignMoney", from: "rig", to: "debt", amount: 600, what: "part of the note" });
  assert.equal(p.debt, DEBT_START - DEBT_PAYMENT - 600);
  s.handleDm({ t: "campaignMoney", from: "rig", to: "", amount: 5, what: "x" });
  assert.equal(p.money, 0, "a refused move changes nothing");
});
