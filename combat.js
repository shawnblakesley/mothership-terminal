import { randInt, rollDice, validDice, rollTable } from "./dice.js";
import { WOUND_TYPES } from "./wounds.js";
import { clampInt } from "./clean.js";

// PSG 28.3. DR first; then damage under the armor's AP is ignored, damage at or over AP destroys the armor and the rest (damage - AP) goes through. Anti-Armor ignores and destroys armor.
export function mitigate(amount, { ap = 0, dr = 0, aa = false } = {}) {
  const raw = Math.max(0, Math.floor(Number(amount) || 0));
  const afterDr = Math.max(0, raw - Math.max(0, dr));
  const out = { raw, dr: raw - afterDr, afterDr, through: afterDr, armorDestroyed: false, armorIgnored: false };
  if (afterDr <= 0 || ap <= 0) return out;
  if (aa) return { ...out, armorDestroyed: true };
  if (afterDr < ap) return { ...out, through: 0, armorIgnored: true };
  return { ...out, through: afterDr - ap, armorDestroyed: true };
}

// d100 under the Combat score; 90-99 always fails; doubles are criticals (00 always a Critical Success, 99 a Critical Failure).
export function combatCheck(combat, adv = "", rng = randInt) {
  const judge = (d) => ({ d, success: d < combat && d < 90, critical: d % 11 === 0 });
  const a = judge(rng(0, 99));
  if (!adv) return { ...a, all: [a.d] };
  const b = judge(rng(0, 99));
  const rank = (j) => (j.success ? (j.critical ? 3 : 2) : j.critical ? 0 : 1);
  const better = rank(b) > rank(a) || (rank(b) === rank(a) && b.d < a.d);
  const pick = adv === "+" ? (better ? b : a) : better ? a : b;
  return { ...pick, all: [a.d, b.d] };
}

// PSG 29.2. The Warden's secret d10 (0-9).
export function deathSaveOutcome(roll, rng = randInt) {
  if (roll === 0) return { kind: "unconscious", minutes: rollDice("2d10", rng).total, maxHealthLoss: rollDice("1d5", rng).total };
  if (roll <= 2) return { kind: "dying", rounds: rollDice("1d5", rng).total };
  if (roll <= 4) return { kind: "comatose" };
  return { kind: "dead" };
}
export const rollDeathSave = (rng = randInt) => rollTable("", rng).value;
export const deathSaveText = (o) => ({
  unconscious: `Unconscious. Wakes in ${o.minutes} minutes. Maximum Health -${o.maxHealthLoss}.`,
  dying: `Unconscious and dying. Dead in ${o.rounds} rounds without intervention.`,
  comatose: "Comatose.",
  dead: "Dead.",
})[o.kind];

// A creature or person's damage to an adversary. stats: { ap, dr, armorDestroyed, wounds (remaining), woundsMax, health, healthPerWound, dead }.
export function damageAdversary(stats, amount, { aa = false, direct = false } = {}) {
  if (stats.dead) return { dealt: 0, raw: amount, armorDestroyed: false, woundsLost: 0, dead: true, already: true };
  const m = direct ? { raw: amount, dr: 0, through: Math.max(0, amount), armorDestroyed: false, armorIgnored: false } : mitigate(amount, { ap: stats.armorDestroyed ? 0 : stats.ap, dr: stats.dr, aa });
  if (m.armorDestroyed) stats.armorDestroyed = true;
  stats.health -= m.through;
  let woundsLost = 0;
  while (stats.health <= 0 && stats.wounds > 0) {
    stats.wounds--;
    woundsLost++;
    const carry = -stats.health;
    stats.health = stats.wounds ? Math.max(0, stats.healthPerWound - carry) : 0;
  }
  if (stats.wounds <= 0) stats.dead = true;
  return { ...m, dealt: m.through, woundsLost, dead: !!stats.dead };
}

const text = (v, n) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);

// Optional combat numbers on an adversary (PSG 40-41): Combat, Instinct, AP/DR, Wounds with a Health value each, and attacks.
export function sanitizeStats(raw) {
  if (!raw || typeof raw !== "object") return null;
  const woundsMax = clampInt(raw.woundsMax, 1, 20, 1);
  const healthPerWound = clampInt(raw.healthPerWound, 1, 999, 10);
  const wounds = clampInt(raw.wounds, 0, woundsMax, woundsMax);
  const out = {
    combat: clampInt(raw.combat, 1, 300, 30),
    instinct: clampInt(raw.instinct, 1, 300, 30),
    ap: clampInt(raw.ap, 0, 99, 0),
    dr: clampInt(raw.dr, 0, 99, 0),
    woundsMax,
    healthPerWound,
    wounds,
    health: clampInt(raw.health, 0, healthPerWound, healthPerWound),
    attacks: (Array.isArray(raw.attacks) ? raw.attacks : []).filter((a) => a && text(a.name, 40) && validDice(a.damage)).slice(0, 8).map((a) => ({
      name: text(a.name, 40),
      damage: text(a.damage, 12),
      woundType: WOUND_TYPES.includes(a.woundType) ? a.woundType : "blunt",
      woundAdv: a.woundAdv === "+" || a.woundAdv === "-" ? a.woundAdv : "",
      special: text(a.special, 200),
    })),
    special: text(raw.special, 600),
  };
  if (raw.armorDestroyed === true) out.armorDestroyed = true;
  if (raw.dead === true || wounds === 0) { out.dead = true; out.wounds = 0; out.health = 0; }
  if (Number(raw.count) > 1) out.count = clampInt(raw.count, 2, 99, 2);
  if (text(raw.note, 300)) out.note = text(raw.note, 300);
  return out;
}

export const statsLine = (s) => `Combat ${s.combat}, Instinct ${s.instinct}, ${s.ap ? `AP ${s.ap}${s.armorDestroyed ? " (destroyed)" : ""}` : "no armor"}${s.dr ? `, DR ${s.dr}` : ""}, Wounds ${s.wounds}/${s.woundsMax} (${s.healthPerWound} Health each), Health ${s.health}/${s.healthPerWound}${s.dead ? ", DEAD OR DESTROYED" : ""}${s.count ? `, ${s.count} of them` : ""}`;
