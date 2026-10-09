import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { CLASSES, STATS, SAVES, MAX_CREW, playable, goneWord, newCond, maxWoundsFor, traumaResponse, sanitizeCrew, skillOf } from "./crew.js";
import { slug } from "./clean.js";
import { PORTRAIT_FILE } from "./cast.js";

// Mothership 1e character creation, PSG v1.2 pages 4-5 (see _out/tickets/RULES.md, "Classes"). Each d10 in a sum reads 1-10.
const STAT_BASE = 25, SAVE_BASE = 10, HEALTH_BASE = 10, START_STRESS = 2;
export const STAT_RANGE = [2 + STAT_BASE, 20 + STAT_BASE];
export const SAVE_RANGE = [2 + SAVE_BASE, 20 + SAVE_BASE];
export const HEALTH_RANGE = [1 + HEALTH_BASE, 10 + HEALTH_BASE];
export const CREDITS_RANGE = [20, 200];
export const PAGES = { loadout: 7, trinket: 8, patch: 9 };

const all = (keys, n) => Object.fromEntries(keys.map((k) => [k, n]));
export const CLASS_INFO = {
  Marine: { stats: { combat: 10 }, saves: { body: 10, fear: 20 }, wounds: 1, text: "+10 Combat, +10 Body Save, +20 Fear Save, +1 Max Wounds.", skills: "Military Training, Athletics, plus 1 Expert or 2 Trained." },
  Android: { stats: { intellect: 20 }, saves: { fear: 60 }, wounds: 1, minus: 10, text: "+20 Intellect, -10 to one Stat of your choice, +60 Fear Save, +1 Max Wounds.", skills: "Linguistics, Computers, Mathematics, plus 1 Expert or 2 Trained." },
  Scientist: { stats: { intellect: 10 }, saves: { sanity: 30 }, wounds: 0, plus: 5, text: "+10 Intellect, +5 to one Stat of your choice, +30 Sanity Save.", skills: "1 Master Skill with an Expert and a Trained prerequisite, plus 1 Trained." },
  Teamster: { stats: all(STATS, 5), saves: all(SAVES, 10), wounds: 0, text: "+5 to all Stats, +10 to all Saves.", skills: "Industrial Equipment, Zero-G, plus 1 Trained and 1 Expert." },
};
for (const k of CLASSES) CLASS_INFO[k].trauma = traumaResponse({ className: k });

const TRAINED = ["Linguistics", "Zoology", "Botany", "Geology", "Industrial Equipment", "Jury-Rigging", "Chemistry", "Computers", "Zero-G", "Mathematics", "Art", "Archaeology", "Theology", "Military Training", "Rimwise", "Athletics"];
const EXPERT = {
  Psychology: ["Linguistics", "Zoology", "Botany"], Pathology: ["Zoology", "Botany"], "Field Medicine": ["Zoology", "Botany"], Ecology: ["Botany", "Geology"],
  "Asteroid Mining": ["Geology", "Industrial Equipment"], "Mechanical Repair": ["Industrial Equipment", "Jury-Rigging"], Explosives: ["Jury-Rigging", "Chemistry", "Military Training"],
  Pharmacology: ["Chemistry"], Hacking: ["Computers"], Piloting: ["Zero-G"], Physics: ["Mathematics"], Mysticism: ["Art", "Archaeology", "Theology"],
  "Wilderness Survival": ["Botany", "Military Training"], Firearms: ["Military Training", "Rimwise"], "Hand-to-Hand Combat": ["Military Training", "Rimwise", "Athletics"],
};
const MASTER = {
  Sophontology: ["Psychology"], Exobiology: ["Pathology"], Surgery: ["Pathology", "Field Medicine"], Planetology: ["Ecology", "Asteroid Mining"],
  Robotics: ["Mechanical Repair"], Engineering: ["Mechanical Repair"], Cybernetics: ["Mechanical Repair"], "Artificial Intelligence": ["Hacking"],
  Hyperspace: ["Piloting", "Physics", "Mysticism"], Xenoesotericism: ["Mysticism"], Command: ["Piloting", "Firearms"],
};
export const TIERS = ["trained", "expert", "master"];
export const TIER_BONUS = { trained: 10, expert: 15, master: 20 };
export const SKILL_TREE = [
  ...TRAINED.map((name) => ({ name, tier: "trained", needs: [] })),
  ...Object.entries(EXPERT).map(([name, needs]) => ({ name, tier: "expert", needs })),
  ...Object.entries(MASTER).map(([name, needs]) => ({ name, tier: "master", needs })),
];
const TREE = new Map(SKILL_TREE.map((s) => [s.name, s]));

export const CLASS_SKILLS = {
  Marine: ["Military Training", "Athletics"],
  Android: ["Linguistics", "Computers", "Mathematics"],
  Scientist: [],
  Teamster: ["Industrial Equipment", "Zero-G"],
};
// The bonus skills a class chooses: any one of these combinations.
const BONUS = {
  Marine: [{ trained: 2 }, { expert: 1 }],
  Android: [{ trained: 2 }, { expert: 1 }],
  Scientist: [{ master: 1, expert: 1, trained: 2 }],
  Teamster: [{ trained: 1, expert: 1 }],
};

const count = (names) => {
  const n = { trained: 0, expert: 0, master: 0 };
  for (const x of names) n[TREE.get(x)?.tier]++;
  return n;
};
const fits = (className, names) => BONUS[className].some((combo) => TIERS.every((t) => count(names)[t] <= (combo[t] || 0)));
const hasNeeds = (skill, have) => !skill.needs.length || skill.needs.some((p) => have.includes(p));

// Whether `name` can be taken on top of `picked` right now, and still lead to a complete set of skills.
function canTake(className, picked, name) {
  const r = step(className, picked, name);
  return r.ok && !completable(className, [...picked, name]) ? { ok: false, why: "it would leave no way to finish your skills" } : r;
}
const completable = (className, picked) => !skillErrors(className, [...CLASS_SKILLS[className], ...picked]).length
  || SKILL_TREE.some((s) => step(className, picked, s.name).ok && completable(className, [...picked, s.name]));
function step(className, picked, name) {
  const s = TREE.get(name), fixed = CLASS_SKILLS[className];
  if (!s || fixed.includes(name) || picked.includes(name)) return { ok: false, why: "already taken" };
  if (!hasNeeds(s, [...fixed, ...picked])) return { ok: false, why: `needs ${s.needs.join(" or ")}` };
  if (!fits(className, [...picked, name])) return { ok: false, why: `no ${s.tier} pick left` };
  return { ok: true, why: "" };
}

export function pruneSkills(className, list) {
  const picked = [];
  for (const t of TIERS) for (const name of list) if (TREE.get(name)?.tier === t && canTake(className, picked, name).ok) picked.push(name);
  return picked;
}

export function skillOptions(className, picked) {
  return SKILL_TREE.map((s) => ({
    name: s.name, tier: s.tier, bonus: TIER_BONUS[s.tier], needs: s.needs,
    state: CLASS_SKILLS[className].includes(s.name) ? "class" : picked.includes(s.name) ? "taken" : canTake(className, picked, s.name).ok ? "open" : "locked",
    why: canTake(className, picked, s.name).why,
  }));
}

export function skillErrors(className, skills) {
  const names = skills.map((s) => (typeof s === "string" ? s : s.name));
  const errors = [], fixed = CLASS_SKILLS[className];
  if (names.length !== new Set(names).size) errors.push("A skill is listed twice.");
  for (const n of names) if (!TREE.has(n)) errors.push(`${n} is not a Mothership skill.`);
  if (errors.length) return errors;
  for (const n of fixed) if (!names.includes(n)) errors.push(`${className}s start with ${n}.`);
  const bonus = names.filter((n) => !fixed.includes(n));
  if (!BONUS[className].some((combo) => TIERS.every((t) => count(bonus)[t] === (combo[t] || 0)))) errors.push(`${className} skills: ${CLASS_INFO[className].skills}`);
  for (const n of names) if (!hasNeeds(TREE.get(n), names)) errors.push(`${n} needs ${TREE.get(n).needs.join(" or ")}.`);
  for (const s of skills) if (typeof s !== "string" && s.bonus !== TIER_BONUS[TREE.get(s.name).tier]) errors.push(`${s.name} is +${TIER_BONUS[TREE.get(s.name).tier]}, not +${s.bonus}.`);
  return errors;
}

// ---- Dice ----

export const ROLLS = {
  stats: { n: 8, lo: 1, hi: 10, text: "Stats: 2d10+25 each for Strength, Speed, Intellect, Combat (eight d10, two per Stat)" },
  saves: { n: 6, lo: 1, hi: 10, text: "Saves: 2d10+10 each for Sanity, Fear, Body (six d10, two per Save)" },
  health: { n: 1, lo: 1, hi: 10, text: "Maximum Health: 1d10+10" },
  credits: { n: 2, lo: 1, hi: 10, text: "Credits: 2d10x10" },
  loadout: { n: 1, lo: 0, hi: 9, text: "Loadout: d10 by class" },
  trinket: { n: 1, lo: 0, hi: 99, text: "Trinket: d100" },
  patch: { n: 1, lo: 0, hi: 99, text: "Patch: d100" },
};
const pairs = (dice, keys, base) => Object.fromEntries(keys.map((k, i) => [k, dice[2 * i] + dice[2 * i + 1] + base]));
export const statsFrom = (dice) => pairs(dice, STATS, STAT_BASE);
export const savesFrom = (dice) => pairs(dice, SAVES, SAVE_BASE);
export const healthFrom = (dice) => dice[0] + HEALTH_BASE;
export const creditsFrom = (dice) => (dice[0] + dice[1]) * 10;

export const rollDice = (what, rng = crypto.randomInt) => Array.from({ length: ROLLS[what].n }, () => rng(ROLLS[what].lo, ROLLS[what].hi + 1));
export function checkDice(what, dice) {
  const r = ROLLS[what];
  if (!r || !Array.isArray(dice) || dice.length !== r.n || dice.some((d) => !Number.isInteger(d) || d < r.lo || d > r.hi)) {
    return `Enter ${r.n} number${r.n > 1 ? "s" : ""}, each ${r.lo}-${r.hi}${r.hi === 10 && r.lo === 1 ? " (a 0 on a d10 counts as 10)" : ""}.`;
  }
  return "";
}

// ---- Classes ----

export function applyClass(stats, saves, className, choice) {
  const k = CLASS_INFO[className];
  const out = { stats: { ...stats }, saves: { ...saves } };
  for (const [s, v] of Object.entries(k.stats)) out.stats[s] += v;
  for (const [s, v] of Object.entries(k.saves)) out.saves[s] += v;
  if (STATS.includes(choice)) {
    if (k.minus) out.stats[choice] -= k.minus;
    if (k.plus) out.stats[choice] += k.plus;
  }
  return out;
}
export const needsChoice = (className) => !!(CLASS_INFO[className]?.minus || CLASS_INFO[className]?.plus);

// ---- Validation ----

const inRange = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
export function validateCharacter(pc, { pregenerated = false } = {}) {
  const errors = [];
  const k = CLASS_INFO[pc?.className];
  if (!k) return ["Choose a class."];
  if (!String(pc.name || "").trim()) errors.push("Give the character a name.");
  const shift = k.minus ? -k.minus : k.plus || 0;
  let spare = shift ? 1 : 0;
  for (const s of STATS) {
    const v = pc.stats?.[s], m = k.stats[s] || 0;
    if (inRange(v, STAT_RANGE[0] + m, STAT_RANGE[1] + m)) continue;
    if (spare && inRange(v, STAT_RANGE[0] + m + shift, STAT_RANGE[1] + m + shift)) spare--;
    else errors.push(`${s} ${v} is outside what a ${pc.className} can roll.`);
  }
  for (const s of SAVES) {
    const m = k.saves[s] || 0;
    if (!inRange(pc.saves?.[s], SAVE_RANGE[0] + m, SAVE_RANGE[1] + m)) errors.push(`${s} Save ${pc.saves?.[s]} is outside what a ${pc.className} can roll.`);
  }
  if (!inRange(pc.health?.max, ...HEALTH_RANGE)) errors.push(`Maximum Health ${pc.health?.max} must be ${HEALTH_RANGE.join("-")}.`);
  if (pc.wounds?.max !== maxWoundsFor(pc.className)) errors.push(`${pc.className} Max Wounds must be ${maxWoundsFor(pc.className)}.`);
  errors.push(...skillErrors(pc.className, pc.skills || []));
  if (pc.credits > 0 && !(inRange(pc.credits, ...CREDITS_RANGE) && pc.credits % 10 === 0)) errors.push(`Credits must be 2d10x10 (${CREDITS_RANGE.join("-")}).`);
  if (!pregenerated) {
    if (pc.health?.current !== pc.health?.max) errors.push("A new character starts at Maximum Health.");
    if (pc.wounds?.current !== 0) errors.push("A new character starts with 0 Wounds.");
    for (const f of ["stress", "minStress", "startStress"]) if (pc[f] !== START_STRESS) errors.push(`${f} starts at ${START_STRESS}.`);
  }
  return errors;
}

// ---- The roll tables (optional, supplied by the host: the book's contents are not shipped) ----

const here = path.dirname(fileURLToPath(import.meta.url));
export const tablesFile = () => path.join(process.env.DATA_DIR || path.join(here, "data"), "tables", "psg-tables.json");

export function parseTables(raw) {
  const rows = (v, n) => Array.isArray(v) && v.length === n && v.every((x) => typeof x === "string");
  if (!raw || typeof raw !== "object") return { error: "it is not a JSON object" };
  for (const c of CLASSES) if (!rows(raw.loadouts?.[c], 10)) return { error: `loadouts.${c} must be a list of 10 text rows` };
  if (!rows(raw.trinkets, 100)) return { error: "trinkets must be a list of 100 text rows" };
  if (!rows(raw.patches, 100)) return { error: "patches must be a list of 100 text rows" };
  return { tables: { loadouts: Object.fromEntries(CLASSES.map((c) => [c, raw.loadouts[c]])), trinkets: raw.trinkets, patches: raw.patches } };
}

let cached = { file: "", mtime: -1, tables: null };
export function loadTables(file = tablesFile()) {
  let mtime;
  try { mtime = fs.statSync(file).mtimeMs; } catch { cached = { file, mtime: -1, tables: null }; return null; }
  if (cached.file === file && cached.mtime === mtime) return cached.tables;
  let tables = null;
  try {
    const r = parseTables(JSON.parse(fs.readFileSync(file, "utf8")));
    if (r.error) console.warn(`[chargen] ignoring ${file}: ${r.error}`);
    else tables = r.tables;
  } catch (err) {
    console.warn(`[chargen] ignoring ${file}: ${err.message}`);
  }
  cached = { file, mtime, tables };
  return tables;
}

export function lookup(tables, what, className, n) {
  if (!tables) return "";
  return (what === "loadout" ? tables.loadouts[className]?.[n] : what === "trinket" ? tables.trinkets[n] : tables.patches[n]) || "";
}

// ---- A character being made ----

const str = (v, n) => String(v ?? "").slice(0, n).trim();
export const newDraft = (replaces = "") => ({ replaces, dice: {}, history: [], className: "", choice: "", skills: [], loadout: "", trinket: "", patch: "", name: "", pronouns: "", portrait: "" });

const label = { strength: "Strength", speed: "Speed", intellect: "Intellect", combat: "Combat", sanity: "Sanity", fear: "Fear", body: "Body" };
function describe(what, dice) {
  if (what === "stats") return `Stats (2d10+25 each): ${STATS.map((k, i) => `${label[k]} ${dice[2 * i]}+${dice[2 * i + 1]}+25=${statsFrom(dice)[k]}`).join(", ")}`;
  if (what === "saves") return `Saves (2d10+10 each): ${SAVES.map((k, i) => `${label[k]} ${dice[2 * i]}+${dice[2 * i + 1]}+10=${savesFrom(dice)[k]}`).join(", ")}`;
  if (what === "health") return `Maximum Health (1d10+10): ${dice[0]}+10=${healthFrom(dice)}`;
  if (what === "credits") return `Credits (2d10x10): (${dice[0]}+${dice[1]})x10=${creditsFrom(dice)}`;
  return `${what[0].toUpperCase()}${what.slice(1)} (${what === "loadout" ? "d10" : "d100"}): ${String(dice[0]).padStart(2, "0")}`;
}

export function rollFor(draft, what, { typed = null, rerolls = false, rng = crypto.randomInt, tables = null } = {}) {
  if (!ROLLS[what]) return { error: "Unknown roll." };
  if (what === "loadout" && !draft.className) return { error: "Choose a class first: the loadout table is by class." };
  if (draft.dice[what] && !rerolls) return { error: "Already rolled. The Warden has not allowed rerolls." };
  const dice = typed ? typed : rollDice(what, rng);
  if (typed) {
    const bad = checkDice(what, typed);
    if (bad) return { error: bad };
  }
  draft.dice[what] = dice;
  if (what === "loadout" || what === "trinket" || what === "patch") draft[what] = str(lookup(tables, what, draft.className, dice[0]), what === "loadout" ? 400 : what === "trinket" ? 160 : 80);
  const line = `${describe(what, dice)}${typed ? " (physical dice, typed in)" : ""}`;
  draft.history.push(line);
  return { line };
}

export function setChoices(draft, raw, tables = null) {
  if ("className" in raw && CLASSES.includes(raw.className) && raw.className !== draft.className) {
    draft.className = raw.className;
    draft.choice = "";
    draft.skills = [];
    if (draft.dice.loadout) draft.loadout = str(lookup(tables, "loadout", draft.className, draft.dice.loadout[0]), 400);
  }
  if ("choice" in raw) draft.choice = needsChoice(draft.className) && STATS.includes(raw.choice) ? raw.choice : "";
  if (!needsChoice(draft.className)) draft.choice = "";
  if (Array.isArray(raw.skills) && draft.className) draft.skills = pruneSkills(draft.className, raw.skills.filter((x) => typeof x === "string"));
  for (const [k, n] of [["loadout", 400], ["trinket", 160], ["patch", 80], ["name", 60], ["pronouns", 20]]) if (k in raw) draft[k] = str(raw[k], n);
  if ("portrait" in raw) draft.portrait = PORTRAIT_FILE.test(raw.portrait || "") ? raw.portrait : "";
}

export function buildSheet(draft) {
  const errors = [];
  for (const w of ["stats", "saves", "health", "credits"]) if (!draft.dice[w]) errors.push(`Roll ${w}.`);
  if (!draft.className) errors.push("Choose a class.");
  else if (needsChoice(draft.className) && !draft.choice) errors.push(`Choose the Stat for the ${draft.className}'s ${CLASS_INFO[draft.className].minus ? "-10" : "+5"}.`);
  if (!draft.name) errors.push("Give the character a name.");
  if (errors.length) return { errors };
  const { stats, saves } = applyClass(statsFrom(draft.dice.stats), savesFrom(draft.dice.saves), draft.className, draft.choice);
  const max = healthFrom(draft.dice.health), credits = creditsFrom(draft.dice.credits);
  const sheet = {
    name: draft.name, pronouns: draft.pronouns, className: draft.className, role: draft.className, crime: "", backstory: "",
    stats, saves, health: { current: max, max }, wounds: { current: 0, max: maxWoundsFor(draft.className) },
    stress: START_STRESS, minStress: START_STRESS, startStress: START_STRESS,
    skills: [...CLASS_SKILLS[draft.className], ...draft.skills].map((n) => ({ name: n, bonus: TIER_BONUS[TREE.get(n).tier] })),
    loadout: draft.loadout, trinket: draft.trinket, patch: draft.patch, credits,
    notes: "High Score: 0.", portrait: draft.portrait,
  };
  errors.push(...validateCharacter(sheet));
  if (errors.length) return { errors };
  return { sheet: { ...sanitizeCrew([sheet])[0], credits, highScore: 0 }, errors };
}

export function viewOf(draft, { tables = null, rerolls = false } = {}) {
  const d = draft.dice, rolls = {};
  for (const w of Object.keys(ROLLS)) if (d[w]) rolls[w] = { dice: d[w] };
  if (d.stats) rolls.stats.values = statsFrom(d.stats);
  if (d.saves) rolls.saves.values = savesFrom(d.saves);
  if (d.health) rolls.health.value = healthFrom(d.health);
  if (d.credits) rolls.credits.value = creditsFrom(d.credits);
  const fin = draft.className && d.stats && d.saves && (!needsChoice(draft.className) || draft.choice) ? applyClass(statsFrom(d.stats), savesFrom(d.saves), draft.className, draft.choice) : null;
  const built = buildSheet(draft);
  return {
    replaces: draft.replaces, rolls, rerolls, tables: !!tables, pages: PAGES, classes: CLASS_INFO, wounds: draft.className ? maxWoundsFor(draft.className) : null,
    className: draft.className, choice: draft.choice, final: fin,
    skills: draft.className ? { fixed: CLASS_SKILLS[draft.className], picked: draft.skills, options: skillOptions(draft.className, draft.skills), bonus: BONUS[draft.className], done: !skillErrors(draft.className, [...CLASS_SKILLS[draft.className], ...draft.skills]).length } : null,
    loadout: draft.loadout, trinket: draft.trinket, patch: draft.patch, name: draft.name, pronouns: draft.pronouns, portrait: draft.portrait,
    history: draft.history, problems: built.errors, sheet: built.sheet || null,
  };
}

// ---- The session glue ----

const active = (list) => list.filter(playable).length;
const owners = new WeakMap();
const ownersOf = (sess) => owners.get(sess) || owners.set(sess, new Map()).get(sess);
const pilots = (sess) => { for (const c of sess.sockets) if (c.pilot && c.readyState === 1) sess.sendPilot(c); };
const ctx = (sess) => ({ tables: loadTables(), rerolls: !!sess.state.config.createRerolls });

export function handleChargen(sess, ws, msg) {
  const s = sess.state, cfg = s.config;
  const reply = (extra = {}) => ws.send(JSON.stringify({ t: "cg", view: ws.cg ? viewOf(ws.cg, ctx(sess)) : null, ...extra }));
  const fail = (error) => reply({ error });
  if (msg.t === "cgCancel") { ws.cg = null; return reply(); }
  if (msg.t === "cgStart") {
    const replaces = str(msg.replaces, 30), old = replaces && sess.crewById(replaces);
    if (replaces) {
      if (!old || playable(old) || old.replacedBy || s.newChars.some((n) => n.replaces === replaces)) return fail("That character has no replacement to make.");
    } else if (!cfg.playerCreate) return fail("The Warden has not allowed new characters.");
    else if (active(cfg.crew) + s.newChars.filter((n) => !n.replaces).length >= MAX_CREW) return fail("The crew is full.");
    ws.cg = newDraft(replaces);
    return reply();
  }
  if (!ws.cg) return fail("Start a new character first.");
  const draft = ws.cg;
  switch (msg.t) {
    case "cgRoll": {
      const r = rollFor(draft, String(msg.what), { typed: Array.isArray(msg.dice) ? msg.dice.map(Number) : null, rerolls: cfg.createRerolls, tables: loadTables() });
      if (r.error) return fail(r.error);
      sess.addLog("note", `New character (${draft.name || "unnamed"}) rolled: ${r.line}`);
      return reply({ rolled: String(msg.what) });
    }
    case "cgSet":
      setChoices(draft, msg.set || {}, loadTables());
      return reply();
    case "cgSubmit": {
      const r = buildSheet(draft);
      if (!r.sheet) return fail(r.errors.join(" "));
      const id = `${slug(r.sheet.name) || "pc"}-${crypto.randomBytes(2).toString("hex")}`;
      s.newChars.push({ id, sheet: r.sheet, history: draft.history, replaces: draft.replaces, ts: Date.now() });
      ownersOf(sess).set(id, { ws, draft });
      ws.cg = null;
      sess.addLog("note", `New character submitted for your approval: ${r.sheet.name} (${r.sheet.className}).`);
      sess.touch();
      sess.syncDm();
      pilots(sess);
      return reply({ submitted: id });
    }
  }
}

export function resend(sess, ws) {
  ws.send(JSON.stringify({ t: "cg", view: ws.cg ? viewOf(ws.cg, ctx(sess)) : null }));
}

// The Crew tab's "Standing": playing, deceased (combat's pc.cond.dead) or retired (Panic Table 20).
export function setCrewState(sess, id, state) {
  const pc = sess.crewById(id);
  if (!pc) return;
  pc.cond ||= newCond();
  pc.cond.dead = state === "deceased" ? pc.cond.dead || "Warden" : "";
  pc.retired = state === "retired";
  sess.addLog("note", `${pc.name} is ${goneWord(pc) || "playing again"}.`);
  sess.touch();
  sess.crewChanged();
}

// A Warden (or, in a game with no Warden, the pilot) accepts or rejects a submitted character. Returns an error text, or "".
export function decideCharacter(sess, accept, id, note = "") {
  const s = sess.state, i = s.newChars.findIndex((n) => n.id === id);
  if (i < 0) return "That character is no longer waiting.";
  const [pending] = s.newChars.splice(i, 1);
  const owner = ownersOf(sess).get(id);
  ownersOf(sess).delete(id);
  const done = () => { sess.touch(); sess.syncDm(); pilots(sess); };
  if (!accept) {
    const why = str(note, 300);
    if (owner?.ws.readyState === 1) {
      owner.ws.cg = owner.draft;
      owner.ws.send(JSON.stringify({ t: "cg", view: viewOf(owner.draft, ctx(sess)), rejected: why || "The Warden turned the character down." }));
    }
    sess.addLog("note", `New character rejected: ${pending.sheet.name}${why ? ` (${why})` : ""}.`);
    done();
    return "";
  }
  const crew = s.config.crew, old = pending.replaces && crew.find((c) => c.id === pending.replaces);
  if (!old && active(crew) >= MAX_CREW) {
    s.newChars.splice(i, 0, pending);
    ownersOf(sess).set(id, owner);
    return "The crew is full.";
  }
  const sheet = structuredClone(pending.sheet);
  let n = slug(sheet.name) || "pc";
  while (crew.some((c) => c.id === n)) n += "x";
  sheet.id = n;
  const join = (list) => {
    const at = pending.replaces ? list.findIndex((c) => c.id === pending.replaces) : -1;
    const next = list.map((c) => (c.id === pending.replaces ? { ...c, replacedBy: n } : c));
    next.splice(at >= 0 ? at : next.length, 0, sheet);
    return sanitizeCrew(next);
  };
  s.config.crew = join(crew);
  if (s.campaign) s.campaign.crew = join(s.campaign.crew || []);
  if (owner?.ws.readyState === 1) {
    owner.ws.character = n;
  }
  sess.addLog("note", `New character accepted: ${sheet.name} (${sheet.className})${old ? `, replacing ${old.name}` : ""}.`);
  sess.addLog("warden", `A new crewmember, ${sheet.name} (${sheet.className}), has joined the crew${old ? ` in place of ${old.name}` : ""}. Their arrival is the Warden's to stage: do not narrate how or when they appear, and do not describe their arrival yourself.`);
  sess.crewChanged();
  if (owner?.ws.readyState === 1) owner.ws.send(JSON.stringify({ t: "cgAccepted", id: n }));
  done();
  return "";
}
