import crypto from "crypto";

export const randInt = (min, max) => crypto.randomInt(min, max + 1);

const DICE = /^\s*(\d{0,2})d(\d{1,3})\s*(?:([+-])\s*(\d{1,3}))?\s*$/i;
const FLAT = /^\s*\d{1,3}\s*$/;
export const validDice = (expr) => DICE.test(String(expr ?? "")) || FLAT.test(String(expr ?? ""));

// "2d10", "d100", "1d10+1" or a flat "3" -> { rolls, total }. A d100 reads 00-99, other dice 1..n.
export function rollDice(expr, rng = randInt) {
  if (FLAT.test(String(expr ?? ""))) return { rolls: [], total: Number(expr) };
  const m = DICE.exec(String(expr ?? ""));
  if (!m) return null;
  const n = Number(m[1] || 1), sides = Number(m[2]);
  const rolls = Array.from({ length: n }, () => (sides === 100 ? rng(0, 99) : rng(1, sides)));
  const mod = m[3] ? (m[3] === "-" ? -1 : 1) * Number(m[4]) : 0;
  return { rolls, total: rolls.reduce((a, b) => a + b, 0) + mod };
}

// adv "+" rolls twice and keeps the higher total, "-" the lower, "" rolls once.
export function rollWithAdv(expr, adv = "", rng = randInt) {
  const a = rollDice(expr, rng);
  if (!a || !adv) return a && { ...a, all: [a.total] };
  const b = rollDice(expr, rng);
  const keep = adv === "+" ? (b.total > a.total ? b : a) : b.total < a.total ? b : a;
  return { ...keep, all: [a.total, b.total] };
}

// A d10 read off a table: 0-9. adv "+" keeps the higher, "-" the lower.
export function rollTable(adv = "", rng = randInt) {
  const all = Array.from({ length: adv ? 2 : 1 }, () => rng(0, 9));
  return { value: adv === "+" ? Math.max(...all) : adv === "-" ? Math.min(...all) : all[0], all };
}

export function cancelAdv(...advs) {
  const up = advs.includes("+"), down = advs.includes("-");
  return up && down ? "" : up ? "+" : down ? "-" : "";
}
