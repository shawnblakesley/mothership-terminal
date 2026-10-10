// A finished roll card folds to one line once a later log line (a reply, a Speak, a player's move) follows it; "Show" opens it again.
const QUIET = new Set(["note", "roll"]);

export function rollFolded(roll, log, openedAt) {
  if (!roll || roll.status === "waiting") return false;
  if (openedAt && openedAt === roll.createdAt) return false;
  const done = roll.finishedAt || roll.createdAt || 0;
  return log.some((e) => e.ts > done && !QUIET.has(e.kind) && !e.cut);
}

export function rollBrief(roll) {
  return roll.pcs.map((p) => {
    const res = roll.results[p.id]?.result;
    if (!res) return `${p.name}: didn't roll`;
    return `${p.name}: ${res.panic ? (res.success ? "kept their cool" : `panic ${res.used}`) : res.outcome}`;
  }).join(" · ");
}
