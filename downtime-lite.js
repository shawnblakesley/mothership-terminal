import { judge, rollD100, resolve } from "./rolls.js";
import { isGone } from "./crew.js";
import { applyRecovery, applyRest, worstSave, restAdvantage } from "./downtime.js";

// Automatic downtime between stories (PSG 20.2): short-term recovery (Body Save; success = Health to Maximum, Wounds stay)
// and a Rest Save (worst Save; success = Stress down by the ones digit of the roll, failure = +1 Stress; the Nightmares Condition is [-]).
// A Critical Failure also needs a Panic Check (PSG 14) and Stress over 20 reduces the Save just rolled (PSG 20.1, the app's reading of "the most relevant"); both are reported for the caller to carry out.
// No cryosleep Rest Save (stress isn't usually relieved there). One implementation: the rules are in downtime.js, this only rolls them for everyone at once.
const word = (j) => (j.success ? (j.critical ? "critical success" : "success") : j.critical ? "critical failure" : "failure");
const two = (d) => String(d).padStart(2, "0");

// One Save with the Rest Save's advantage: two d100 for [+]/[-], the better or worse kept (rolls.js resolve).
const rollSave = (pc, save, advantage, rng) => {
  const r = resolve({ check: save, advantage, bonus: 0 }, pc.saves[save], advantage === "none" ? [rng()] : [rng(), rng()]);
  return { ...r, d: r.used, rank: judge(r.used, r.target).rank };
};
const drop = (pc, save, over) => {
  if (!over) return null;
  const from = pc.saves[save];
  pc.saves[save] = Math.max(1, from - over);
  return { save, over, from, to: pc.saves[save] };
};

export function restAndRecover(crew, rng = rollD100) {
  const out = [];
  for (const pc of crew) {
    if (isGone(pc)) continue;
    const r = { id: pc.id, name: pc.name, panics: [], reduced: [] };
    if (pc.health.current < pc.health.max) {
      const j = judge(rng(), pc.saves.body), from = pc.health.current;
      const a = applyRecovery(pc, { ...j, used: j.d });
      r.recovery = { roll: j.d, target: pc.saves.body, outcome: word(j), ok: j.success, from, to: pc.health.current };
      const cut = drop(pc, "body", a.over);
      if (cut) r.reduced.push(cut);
      if (j.rank === 0) r.panics.push("critical failure on the Body Save");
    }
    if (pc.cond?.cryo) r.cryo = true;
    else {
      const save = worstSave(pc), adv = restAdvantage(pc), j = rollSave(pc, save, adv.advantage, rng), from = pc.stress;
      const a = applyRest(pc, { ...j, used: j.d });
      r.rest = { save, roll: j.d, target: pc.saves[save], outcome: word(j), ok: j.success, from, to: pc.stress, why: adv.why };
      const cut = drop(pc, save, a.over);
      if (cut) r.reduced.push(cut);
      if (j.rank === 0) r.panics.push("critical failure on the Rest Save");
    }
    out.push(r);
  }
  return out;
}

export function downtimeLines(results) {
  return results.map(({ name, recovery: a, rest: b, cryo, reduced = [], panics = [] }) => {
    const parts = [
      a && `Body Save ${two(a.roll)} vs ${a.target}, ${a.outcome}: ${a.ok ? `Health ${a.from} to ${a.to}` : "no recovery"}`,
      b && `Rest Save (${b.save}, the worst${b.why?.length ? `; ${b.why.join(", ")}` : ""}) ${two(b.roll)} vs ${b.target}, ${b.outcome}: Stress ${b.from} to ${b.to}`,
      cryo && "in cryosleep: no Rest Save",
      ...reduced.map((x) => `Stress over 20 by ${x.over}: ${x.save} Save ${x.from} to ${x.to}`),
      panics.length && `Panic Check for the ${panics.length > 1 ? "critical failures" : panics[0]}`,
    ].filter(Boolean);
    return `${name}: ${parts.join("; ") || "rested"}.`;
  });
}
