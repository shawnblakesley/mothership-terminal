import crypto from "crypto";
import { findSkill } from "./crew.js";
import { clampInt } from "./clean.js";

export const CHECKS = {
  strength: { label: "Strength", kind: "Stat" },
  speed: { label: "Speed", kind: "Stat" },
  intellect: { label: "Intellect", kind: "Stat" },
  combat: { label: "Combat", kind: "Stat" },
  sanity: { label: "Sanity", kind: "Save" },
  fear: { label: "Fear", kind: "Save" },
  body: { label: "Body", kind: "Save" },
};

export const PANIC = "panic";
const PANIC_CHECK = { label: "Panic", kind: "Panic" };
export const checkInfo = (check) => (check === PANIC ? PANIC_CHECK : CHECKS[check]);

export const SKILL_LEVELS = { none: 0, trained: 10, expert: 15, master: 20 };
export const ADVANTAGE = ["none", "advantage", "disadvantage"];

const LEVEL_OF = Object.fromEntries(Object.entries(SKILL_LEVELS).map(([k, v]) => [v, k]));
export function sanitizeRequest(raw, crew = []) {
  const check = CHECKS[raw?.check] || raw?.check === PANIC ? raw.check : "intellect";
  const panic = check === PANIC;
  const skill = panic ? "" : String(raw?.skill || "").trim().slice(0, 40);
  const who = raw?.pc === "all" ? crew : crew.filter((c) => c.id === raw?.pc);
  if (!who.length) throw new Error("Choose who rolls.");
  const bonus = raw?.pc === "all" ? 0 : findSkill(who[0], skill)?.bonus ?? 0;
  return {
    id: crypto.randomBytes(6).toString("hex"),
    check,
    skill,
    skillLevel: LEVEL_OF[bonus] || "none",
    bonus,
    advantage: ADVANTAGE.includes(raw?.advantage) ? raw.advantage : "none",
    reason: String(raw?.reason || "").trim().slice(0, 140),
    all: raw?.pc === "all",
    pcs: who.map((c) => ({ id: c.id, name: c.name })),
    results: {},
    status: "waiting",
    createdAt: Date.now(),
  };
}

export function rollTarget(req, pc) {
  if (req.check === PANIC) return { stat: pc.stress, bonus: 0 };
  return { stat: pc.stats[req.check] ?? pc.saves[req.check], bonus: findSkill(pc, req.skill)?.bonus ?? 0 };
}

function judge(d, target) {
  const success = d < target;
  const critical = d % 11 === 0;
  return { d, success, critical, rank: success ? (critical ? 3 : 2) : critical ? 0 : 1 };
}

export const rollD100 = () => crypto.randomInt(0, 100);
export const rollD20 = () => crypto.randomInt(1, 21);
export const diceFor = (req) => Array.from({ length: req.advantage === "none" ? 1 : 2 }, req.check === PANIC ? rollD20 : rollD100);

export function resolve(request, statValue, dice, bonus = request.bonus) {
  if (request.check === PANIC) return resolvePanic(request, statValue, dice);
  const stat = clampInt(statValue, 1, 99, null);
  if (stat === null) throw new Error("Enter the Stat or Save value.");
  const need = request.advantage === "none" ? 1 : 2;
  if (dice.length !== need || dice.some((d) => !Number.isInteger(d) || d < 0 || d > 99)) {
    throw new Error(need === 1 ? "Enter one d100 roll (00-99)." : "Enter two d100 rolls (00-99).");
  }
  const target = stat + bonus;
  const judged = dice.map((d) => judge(d, target));
  let pick = judged[0];
  for (const j of judged.slice(1)) {
    const better = j.rank > pick.rank || (j.rank === pick.rank && j.d < pick.d);
    if (request.advantage === "advantage" ? better : !better) pick = j;
  }
  const outcome = pick.success ? (pick.critical ? "critical success" : "success") : pick.critical ? "critical failure" : "failure";
  return { stat, bonus, target, dice, used: pick.d, success: pick.success, critical: pick.critical, outcome, stress: pick.success ? 0 : 1 };
}

function resolvePanic(request, stressValue, dice) {
  const stress = clampInt(stressValue, 0, 20, 0);
  const need = request.advantage === "none" ? 1 : 2;
  if (dice.length !== need || dice.some((d) => !Number.isInteger(d) || d < 1 || d > 20)) {
    throw new Error(need === 1 ? "Enter one d20 roll (1-20)." : "Enter two d20 rolls (1-20).");
  }
  const used = request.advantage === "advantage" ? Math.max(...dice) : request.advantage === "disadvantage" ? Math.min(...dice) : dice[0];
  const success = used > stress;
  return { panic: true, stat: stress, bonus: 0, target: stress, dice, used, success, critical: false, outcome: success ? "kept their cool" : "panic", stress: 0 };
}

const pad = (d) => String(d).padStart(2, "0");

export function checkLabel(req) {
  const c = checkInfo(req.check);
  const adv = req.advantage === "advantage" ? " [+]" : req.advantage === "disadvantage" ? " [-]" : "";
  return `${c.label.toUpperCase()} ${c.kind === "Save" ? "SAVE" : "CHECK"}${adv}`;
}

export function skillLabel(req) {
  return req.skill ? `${req.skill.toUpperCase()}${req.bonus ? ` +${req.bonus}` : ""}` : "";
}

export function resultText(req, res) {
  const skill = res.bonus ? `${(req.skill || "SKILL").toUpperCase()} +${res.bonus}` : "";
  const head = [checkLabel(req), skill, req.reason && req.reason.toUpperCase()].filter(Boolean).join(" · ");
  const p = res.panic ? String : pad;
  const rolled = res.dice.length > 1 ? `${res.dice.map(p).join(" / ")} → ${p(res.used)}` : p(res.used);
  if (res.panic) {
    return `${head}\nSTRESS ${res.stat} · ROLLED ${rolled} (D20)\n${res.success ? "KEPT THEIR COOL" : `PANIC · PANIC TABLE RESULT ${res.used}`}`;
  }
  const tail = res.success ? "" : " · +1 STRESS";
  return `${head}\nTARGET ${res.target}${res.bonus ? ` (${res.stat}+${res.bonus})` : ""} · ROLLED ${rolled}\n${res.outcome.toUpperCase()}${tail}`;
}
