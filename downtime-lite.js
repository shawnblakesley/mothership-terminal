import { judge, rollD100 } from "./rolls.js";
import { SAVES, isGone, setVital, gainStress } from "./crew.js";

// Automatic downtime between stories (PSG 20.2): short-term recovery (Body Save; success = Health to Maximum, Wounds stay)
// and a Rest Save (worst Save; success = Stress down by the ones digit of the roll, failure = +1 Stress).
// No cryosleep Rest Save (stress isn't usually relieved there). Ticket 06's downtime can replace this.
const word = (j) => (j.success ? (j.critical ? "critical success" : "success") : j.critical ? "critical failure" : "failure");
const two = (d) => String(d).padStart(2, "0");

export function restAndRecover(crew, rng = rollD100) {
  const out = [];
  for (const pc of crew) {
    if (isGone(pc)) continue;
    const r = { id: pc.id, name: pc.name };
    if (pc.health.current < pc.health.max) {
      const j = judge(rng(), pc.saves.body);
      const from = pc.health.current;
      if (j.success) setVital(pc, "health", pc.health.max);
      r.recovery = { roll: j.d, target: pc.saves.body, outcome: word(j), ok: j.success, from, to: pc.health.current };
    }
    if (pc.cond?.cryo) r.cryo = true;
    else {
      const save = SAVES.reduce((a, b) => (pc.saves[b] < pc.saves[a] ? b : a));
      const j = judge(rng(), pc.saves[save]);
      const from = pc.stress;
      if (j.success) setVital(pc, "stress", pc.stress - (j.d % 10));
      else gainStress(pc, 1);
      r.rest = { save, roll: j.d, target: pc.saves[save], outcome: word(j), ok: j.success, from, to: pc.stress };
    }
    out.push(r);
  }
  return out;
}

export function downtimeLines(results) {
  return results.map(({ name, recovery: a, rest: b, cryo }) => {
    const parts = [
      a && `Body Save ${two(a.roll)} vs ${a.target}, ${a.outcome}: ${a.ok ? `Health ${a.from} to ${a.to}` : "no recovery"}`,
      b && `Rest Save (${b.save}, the worst) ${two(b.roll)} vs ${b.target}, ${b.outcome}: Stress ${b.from} to ${b.to}`,
      cryo && "in cryosleep: no Rest Save",
    ].filter(Boolean);
    return `${name}: ${parts.join("; ") || "rested"}.`;
  });
}
