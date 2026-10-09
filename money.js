import { clampInt } from "./clean.js";
import { randInt } from "./dice.js";

// Credits in text: cr, kcr, mcr (RULES.md).
export const exact = (n) => `${Math.round(Number(n) || 0).toLocaleString("en-US")}cr`;

// PSG: starting credits are 2d10x10, each d10 reading 1-10 when dice are multiplied (RULES.md).
export const startingCredits = (rng = randInt) => {
  const dice = [rng(1, 10), rng(1, 10)];
  return { dice, total: (dice[0] + dice[1]) * 10 };
};

// Campaign house rules: Mothership 1e has no pay, debt or union dues.
export const DUES_PCT = 4;
export const DEBT_START = 180000;
export const DEBT_PAYMENT = 6000;
export const DEBT_EVERY = 2;
export const DELIVERY = { full: 1, partly: 0.5, none: 0 };
export const DELIVERY_NAMES = { full: "Delivered in full", partly: "Delivered in part (half the fee)", none: "Not delivered" };
export const duesOf = (gross) => Math.round(Math.max(0, Number(gross) || 0) * DUES_PCT / 100);

// What a story pays in all: the fee x delivery; nothing if the Warden ticks late on a job whose fee late delivery voids.
export function feeFor(story, delivery = "full", late = false) {
  if (story.late && late) return 0;
  return Math.round((Number(story.pay) || 0) * (DELIVERY[delivery] ?? 1));
}
// Paid when the story begins (a share of the fee, from `upfront`), and what is left to pay at its end. No clawback of what was paid.
export const upfrontOf = (story) => Math.round((Number(story.pay) || 0) * (Number(story.upfront) || 0));
export const finalFee = (story, delivery, late, paid = 0) => Math.max(0, feeFor(story, delivery, late) - Math.max(0, paid));
export const debtDue = (finished, owed) => owed > 0 && finished > 0 && finished % DEBT_EVERY === 0;

const MAX = 999999999;
export function sanitizeMoney(p, c, crew) {
  const ids = new Set(crew.map((x) => x.id));
  const acct = (a) => (a === "rig" || a === "debt" || ids.has(a) ? a : "");
  return {
    money: clampInt(p?.money, 0, MAX, 0),
    debt: clampInt(p?.debt, 0, MAX, DEBT_START),
    missed: clampInt(p?.missed, 0, 99, 0),
    finished: clampInt(p?.finished, 0, 999, 0),
    upfront: Object.fromEntries(Object.entries(p?.upfront && typeof p.upfront === "object" ? p.upfront : {}).filter(([id]) => c.stories.some((s) => s.id === id)).map(([id, n]) => [id, clampInt(n, 0, MAX, 0)])),
    ledger: (Array.isArray(p?.ledger) ? p.ledger : []).map((e) => ({ at: Number(e?.at) || 0, acct: acct(e?.acct), amount: clampInt(e?.amount, -MAX, MAX, 0), what: String(e?.what || "").slice(0, 160), bal: clampInt(e?.bal, 0, MAX, 0) })).filter((e) => e.acct && e.amount).slice(-80),
  };
}

export const balanceOf = (p, acct) => (acct === "rig" ? p.money : acct === "debt" ? p.debt : p.crew.find((x) => x.id === acct)?.credits ?? 0);
export const acctName = (p, acct) => (acct === "rig" ? "the rig account" : acct === "debt" ? "the Gallow-Mercer note" : p.crew.find((x) => x.id === acct)?.name || "?");

function setBalance(p, acct, v) {
  if (acct === "rig") p.money = v;
  else if (acct === "debt") p.debt = v;
  else {
    const pc = p.crew.find((x) => x.id === acct);
    if (pc) pc.credits = v;
  }
}

// Books one change to an account and its ledger line.
export function book(p, acct, amount, what, at = Date.now()) {
  const bal = Math.max(0, balanceOf(p, acct) + amount);
  setBalance(p, acct, bal);
  const e = { at, acct, amount, what: String(what).slice(0, 160), bal };
  p.ledger = [...(p.ledger || []), e].slice(-80);
  return e;
}
export const ledgerLine = (p, e) => `Ledger: ${acctName(p, e.acct)} ${e.amount > 0 ? "+" : "-"}${exact(Math.abs(e.amount))} (${e.what}), now ${exact(e.bal)}.`;

// Moves credits. from/to: "rig", a character id, or "" for outside the crew (income or an expense); to may also be "debt" (a payment on the note).
export function transfer(p, { from = "", to = "", amount = 0, what = "" } = {}) {
  const n = clampInt(amount, 0, MAX, 0);
  const known = (a) => !a || a === "rig" || p.crew.some((x) => x.id === a);
  if (!n) return { ok: false, error: "Enter an amount of credits." };
  if (!known(from) || !(known(to) || to === "debt") || (from && from === to) || (!from && !to)) return { ok: false, error: "Pick two different accounts." };
  if (to === "debt" && n > p.debt) return { ok: false, error: `The note is only ${exact(p.debt)}.` };
  if (from && balanceOf(p, from) < n) return { ok: false, error: `${acctName(p, from)} has ${exact(balanceOf(p, from))}, not ${exact(n)}.` };
  const why = String(what || "").trim().slice(0, 100) || "the Warden's call";
  const entries = [];
  if (from) entries.push(book(p, from, -n, to ? `to ${to === "debt" ? "Gallow-Mercer Finance" : acctName(p, to)}: ${why}` : why));
  if (to === "debt") entries.push(book(p, "debt", -n, `payment: ${why}`));
  else if (to) entries.push(book(p, to, n, from ? `from ${acctName(p, from)}: ${why}` : why));
  return { ok: true, entries };
}

// Charges an account for goods: the whole price or nothing.
export function spend(p, acct, amount, what) {
  const n = Math.max(0, Math.round(Number(amount) || 0));
  if (!n) return { ok: true, entries: [] };
  const a = acct === "rig" || p.crew.some((x) => x.id === acct) ? acct : "rig";
  if (balanceOf(p, a) < n) return { ok: false, error: `${acctName(p, a)} has ${exact(balanceOf(p, a))}; that costs ${exact(n)}.` };
  return { ok: true, entries: [book(p, a, -n, what)] };
}

// The letter the finance company sends after a missed payment (house rule).
export function debtLetter(p, c, due) {
  const android = p.crew.find((x) => x.className === "Android");
  const nth = ["", "", "second", "third"][p.missed] || `${p.missed}th`;
  return {
    title: "GALLOW-MERCER FINANCE: NOTICE OF MISSED PAYMENT",
    text: `ACCOUNT: ${c.ship.name}, Kessler-Pike K-12, registered owner W. OKAFOR.\n\nOur records show the scheduled payment of ${exact(due)} on your vessel note was not received.${p.missed > 1 ? ` This is your ${nth} missed payment.` : ""} The outstanding balance is ${exact(p.debt)}.\n\nPlease remit within your next two jobs. Under the terms of your loan, a continued default entitles Gallow-Mercer Finance to repossess the vessel and to recall all leased equipment${android ? `, including the cargo-handling unit ${android.name}, by remote code` : ""}.\n\nThis is a courtesy notice. Gallow-Mercer Finance is here to help you keep moving.`,
  };
}
