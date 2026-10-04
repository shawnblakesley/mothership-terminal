// Mothership (1e) stat checks and saves.
//
// - Roll d100 (0-99; "00" is 0). Succeed if the roll is LESS THAN the target.
// - Target = the Stat or Save, + a Skill bonus when one applies
//   (Trained +10, Expert +15, Master +20).
// - Doubles (00, 11, 22 ... 99) are criticals: a critical success if it
//   succeeds, a critical failure if it fails.
// - Advantage [+] / Disadvantage [-]: roll twice, keep the better / worse.
// - Failing a check or save gives the character 1 Stress.
import crypto from "crypto";

export const CHECKS = {
  strength: { label: "Strength", kind: "Stat" },
  speed: { label: "Speed", kind: "Stat" },
  intellect: { label: "Intellect", kind: "Stat" },
  combat: { label: "Combat", kind: "Stat" },
  sanity: { label: "Sanity", kind: "Save" },
  fear: { label: "Fear", kind: "Save" },
  body: { label: "Body", kind: "Save" },
};

export const SKILL_LEVELS = { none: 0, trained: 10, expert: 15, master: 20 };
export const ADVANTAGE = ["none", "advantage", "disadvantage"];

const clampInt = (v, min, max) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null;
};

// What the Warden asks for. `stat` is the character's Stat/Save value if the
// Warden knows it; otherwise the players enter it when they roll.
export function sanitizeRequest(raw) {
  const check = CHECKS[raw?.check] ? raw.check : "intellect";
  const skillLevel = SKILL_LEVELS[raw?.skillLevel] !== undefined ? raw.skillLevel : "none";
  return {
    id: crypto.randomBytes(6).toString("hex"),
    check,
    skill: skillLevel === "none" ? "" : String(raw?.skill || "").trim().slice(0, 40),
    skillLevel,
    bonus: SKILL_LEVELS[skillLevel],
    advantage: ADVANTAGE.includes(raw?.advantage) ? raw.advantage : "none",
    stat: raw?.stat === "" || raw?.stat == null ? null : clampInt(raw.stat, 1, 99),
    reason: String(raw?.reason || "").trim().slice(0, 140),
    status: "waiting",
    createdAt: Date.now(),
  };
}

// One die: rank orders outcomes for advantage/disadvantage.
function judge(d, target) {
  const success = d < target;
  const critical = d % 11 === 0; // 00, 11, ... 99
  return { d, success, critical, rank: success ? (critical ? 3 : 2) : critical ? 0 : 1 };
}

export const rollD100 = () => crypto.randomInt(0, 100);

// dice: one value, or two for [+]/[-]. Returns the full result.
export function resolve(request, statValue, dice) {
  const stat = clampInt(statValue, 1, 99);
  if (stat === null) throw new Error("Enter the Stat or Save value.");
  const need = request.advantage === "none" ? 1 : 2;
  if (dice.length !== need || dice.some((d) => !Number.isInteger(d) || d < 0 || d > 99)) {
    throw new Error(need === 1 ? "Enter one d100 roll (00-99)." : "Enter two d100 rolls (00-99).");
  }
  const target = stat + request.bonus;
  const judged = dice.map((d) => judge(d, target));
  let pick = judged[0];
  for (const j of judged.slice(1)) {
    const better = j.rank > pick.rank || (j.rank === pick.rank && j.d < pick.d);
    if (request.advantage === "advantage" ? better : !better) pick = j;
  }
  const outcome = pick.success ? (pick.critical ? "critical success" : "success") : pick.critical ? "critical failure" : "failure";
  return { stat, target, dice, used: pick.d, success: pick.success, critical: pick.critical, outcome, stress: pick.success ? 0 : 1 };
}

const pad = (d) => String(d).padStart(2, "0");

// Short labels, e.g. "INTELLECT CHECK [+]" / "FEAR SAVE".
export function checkLabel(req) {
  const c = CHECKS[req.check];
  const adv = req.advantage === "advantage" ? " [+]" : req.advantage === "disadvantage" ? " [-]" : "";
  return `${c.label.toUpperCase()} ${c.kind === "Stat" ? "CHECK" : "SAVE"}${adv}`;
}

export function skillLabel(req) {
  return req.bonus ? `${(req.skill || "SKILL").toUpperCase()} +${req.bonus}` : "";
}

// The line that goes in the log (players see it; the agent reads it).
export function resultText(req, res) {
  const head = [checkLabel(req), skillLabel(req), req.reason && req.reason.toUpperCase()].filter(Boolean).join(" · ");
  const rolled = res.dice.length > 1 ? `${res.dice.map(pad).join(" / ")} → ${pad(res.used)}` : pad(res.used);
  const tail = res.success ? "" : " · +1 STRESS";
  return `${head}\nTARGET ${res.target}${req.bonus ? ` (${res.stat}+${req.bonus})` : ""} · ROLLED ${rolled}\n${res.outcome.toUpperCase()}${tail}`;
}
