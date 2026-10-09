import { judge, rollD100 } from "./rolls.js";
import { isGone } from "./crew.js";
import { applyRecovery, applyRest, worstSave } from "./downtime.js";

// Automatic downtime between stories (PSG 20.2): short-term recovery (Body Save; success = Health to Maximum, Wounds stay)
// and a Rest Save (worst Save; success = Stress down by the ones digit of the roll, failure = +1 Stress).
// No cryosleep Rest Save (stress isn't usually relieved there). One implementation: the rules are in downtime.js, this only rolls them for everyone at once.
const word = (j) => (j.success ? (j.critical ? "critical success" : "success") : j.critical ? "critical failure" : "failure");
const two = (d) => String(d).padStart(2, "0");

export function restAndRecover(crew, rng = rollD100) {
  const out = [];
  for (const pc of crew) {
    if (isGone(pc)) continue;
    const r = { id: pc.id, name: pc.name };
    if (pc.health.current < pc.health.max) {
      const j = judge(rng(), pc.saves.body), from = pc.health.current;
      applyRecovery(pc, { ...j, used: j.d });
      r.recovery = { roll: j.d, target: pc.saves.body, outcome: word(j), ok: j.success, from, to: pc.health.current };
    }
    if (pc.cond?.cryo) r.cryo = true;
    else {
      const save = worstSave(pc), j = judge(rng(), pc.saves[save]), from = pc.stress;
      applyRest(pc, { ...j, used: j.d });
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
