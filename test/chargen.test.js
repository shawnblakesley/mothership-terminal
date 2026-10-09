import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { CAMPAIGNS } from "../campaign.js";
import { CLASSES, STATS, SAVES, MAX_CREW, DEFAULT_CREW, sanitizeCrew, crewBrief } from "../crew.js";
import {
  newDraft, rollFor, rollDice, setChoices, buildSheet, viewOf, applyClass, statsFrom, savesFrom, healthFrom, creditsFrom,
  skillErrors, skillOptions, validateCharacter, parseTables, loadTables, handleChargen, decideCharacter, checkDice,
} from "../chargen.js";

const seeded = (seed) => {
  let a = seed;
  const next = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return (lo, hi) => lo + Math.floor(next() * (hi - lo));
};

// Rolls and fills in a whole character with the given rng, the way a player would.
function makeOne(rng, className, extra = {}) {
  const draft = newDraft();
  setChoices(draft, { className });
  for (const w of ["stats", "saves", "health", "credits", "loadout", "trinket", "patch"]) rollFor(draft, w, { rng });
  const need = className === "Android" || className === "Scientist";
  setChoices(draft, { choice: need ? STATS[rng(0, 4)] : "" });
  for (let i = 0; i < 12; i++) {
    const open = skillOptions(className, draft.skills).filter((s) => s.state === "open");
    if (!open.length) break;
    setChoices(draft, { skills: [...draft.skills, open[rng(0, open.length)].name] });
  }
  setChoices(draft, { name: "Test Pilot", ...extra });
  return draft;
}

test("stats and saves stay in each class's range over many rolls", () => {
  const rng = seeded(7);
  for (const className of CLASSES) {
    for (let i = 0; i < 300; i++) {
      const draft = makeOne(rng, className);
      const { sheet, errors } = buildSheet(draft);
      assert.deepEqual(errors, [], `${className} #${i}`);
      const base = statsFrom(draft.dice.stats), sv = savesFrom(draft.dice.saves);
      for (const s of STATS) assert.ok(base[s] >= 27 && base[s] <= 45);
      for (const s of SAVES) assert.ok(sv[s] >= 12 && sv[s] <= 30);
      const mod = { Marine: { combat: 10 }, Android: { intellect: 20 }, Scientist: { intellect: 10 }, Teamster: Object.fromEntries(STATS.map((s) => [s, 5])) }[className];
      const shift = className === "Android" ? -10 : className === "Scientist" ? 5 : 0;
      for (const s of STATS) assert.equal(sheet.stats[s], base[s] + (mod[s] || 0) + (draft.choice === s ? shift : 0), `${className} ${s}`);
      const smod = { Marine: { body: 10, fear: 20 }, Android: { fear: 60 }, Scientist: { sanity: 30 }, Teamster: { sanity: 10, fear: 10, body: 10 } }[className];
      for (const s of SAVES) assert.equal(sheet.saves[s], sv[s] + (smod[s] || 0));
    }
  }
});

test("the Android's -10 and the Scientist's +5 land on the chosen Stat", () => {
  const stats = { strength: 30, speed: 30, intellect: 30, combat: 30 }, saves = { sanity: 20, fear: 20, body: 20 };
  for (const s of STATS) {
    assert.equal(applyClass(stats, saves, "Android", s).stats[s], 30 - 10 + (s === "intellect" ? 20 : 0));
    assert.equal(applyClass(stats, saves, "Scientist", s).stats[s], 30 + 5 + (s === "intellect" ? 10 : 0));
    for (const other of STATS.filter((o) => o !== s && o !== "intellect")) assert.equal(applyClass(stats, saves, "Android", s).stats[other], 30);
  }
  const draft = makeOne(seeded(1), "Android");
  setChoices(draft, { choice: "" });
  assert.match(buildSheet(draft).errors.join(" "), /Choose the Stat/);
});

test("Max Wounds, Health, Credits and starting Stress", () => {
  const rng = seeded(3);
  for (const [className, wounds] of [["Marine", 3], ["Android", 3], ["Scientist", 2], ["Teamster", 2]]) {
    const { sheet } = buildSheet(makeOne(rng, className));
    assert.equal(sheet.wounds.max, wounds);
    assert.equal(sheet.wounds.current, 0);
    assert.deepEqual([sheet.stress, sheet.minStress, sheet.startStress], [2, 2, 2]);
    assert.equal(sheet.health.current, sheet.health.max);
  }
  for (let i = 0; i < 500; i++) {
    const h = healthFrom(rollDice("health", rng)), c = creditsFrom(rollDice("credits", rng));
    assert.ok(h >= 11 && h <= 20);
    assert.ok(c >= 20 && c <= 200 && c % 10 === 0);
  }
  assert.equal(healthFrom([10]), 20);
  assert.equal(creditsFrom([10, 10]), 200);
});

test("skill prerequisites", () => {
  assert.ok(skillErrors("Scientist", ["Surgery", "Zoology", "Chemistry"]).length, "Surgery without Pathology or Field Medicine");
  assert.ok(skillErrors("Scientist", ["Surgery", "Pathology", "Chemistry", "Art"]).length, "Pathology without Zoology or Botany");
  assert.deepEqual(skillErrors("Scientist", ["Zoology", "Pathology", "Surgery", "Chemistry"]), []);
  assert.deepEqual(skillErrors("Scientist", ["Botany", "Field Medicine", "Surgery", "Art"]), []);
  assert.deepEqual(skillErrors("Teamster", ["Industrial Equipment", "Zero-G", "Jury-Rigging", "Piloting"]), []);
  assert.ok(skillErrors("Teamster", ["Industrial Equipment", "Zero-G", "Jury-Rigging", "Hacking"]).length, "Hacking needs Computers");
  assert.ok(skillErrors("Marine", ["Military Training", "Athletics", "Firearms", "Hand-to-Hand Combat"]).length, "a Marine with two Experts");
  assert.deepEqual(skillErrors("Marine", ["Military Training", "Athletics", "Firearms"]), []);
  assert.deepEqual(skillErrors("Marine", ["Military Training", "Athletics", "Rimwise", "Art"]), []);
  assert.ok(skillErrors("Marine", ["Military Training", "Athletics", "Rimwise", "Art", "Theology"]).length, "too many");
  assert.ok(skillErrors("Android", ["Linguistics", "Computers", "Mathematics"]).length, "Android must take a bonus");
  assert.ok(skillErrors("Marine", ["Athletics", "Firearms"]).length, "class skills must be present");
  assert.ok(skillErrors("Scientist", ["Zoology", "Pathology", "Chemistry", "Art"]).length, "Scientist needs a Master Skill");
});

test("the picker only opens skills whose prerequisite is taken", () => {
  const open = (picked) => skillOptions("Scientist", picked).filter((s) => s.state === "open").map((s) => s.name);
  assert.ok(!open([]).includes("Pathology") && !open([]).includes("Surgery") && open([]).includes("Zoology"));
  assert.ok(open(["Zoology"]).includes("Pathology"));
  assert.ok(open(["Zoology", "Pathology"]).includes("Surgery"));
  const draft = newDraft();
  setChoices(draft, { className: "Scientist", skills: ["Surgery", "Pathology", "Zoology", "Chemistry"] });
  assert.deepEqual(draft.skills, ["Zoology", "Chemistry", "Pathology", "Surgery"]);
  setChoices(draft, { skills: ["Zoology", "Surgery", "Chemistry"] });
  assert.deepEqual(draft.skills, ["Zoology", "Chemistry"], "Surgery dropped without its chain");
  assert.equal(skillOptions("Marine", []).find((s) => s.name === "Athletics").state, "class");
});

test("the Scientist example builds a valid sheet", () => {
  const draft = makeOne(seeded(5), "Scientist");
  setChoices(draft, { skills: ["Zoology", "Pathology", "Surgery", "Chemistry"], choice: "speed" });
  const { sheet, errors } = buildSheet(draft);
  assert.deepEqual(errors, []);
  assert.deepEqual(sheet.skills.map((s) => [s.name, s.bonus]), [["Zoology", 10], ["Chemistry", 10], ["Pathology", 15], ["Surgery", 20]]);
  assert.ok(sanitizeCrew([sheet]).length === 1);
  assert.match(sheet.notes, /Credits: \d+cr/);
});

test("validateCharacter rejects what the rules do not allow", () => {
  const { sheet } = buildSheet(makeOne(seeded(9), "Marine"));
  assert.deepEqual(validateCharacter(sheet), []);
  const bad = (edit) => { const c = structuredClone(sheet); edit(c); return validateCharacter(c); };
  assert.ok(bad((c) => (c.stats.strength = 99)).length);
  assert.ok(bad((c) => (c.stats.strength = 26)).length);
  assert.ok(bad((c) => (c.saves.fear = 30)).length, "a Marine's Fear is at least 32");
  assert.ok(bad((c) => (c.wounds.max = 2)).length);
  assert.ok(bad((c) => (c.health.max = 21)).length);
  assert.ok(bad((c) => (c.health.current = 1)).length);
  assert.ok(bad((c) => (c.stress = 3)).length);
  assert.ok(bad((c) => (c.skills = c.skills.slice(1))).length);
  assert.ok(bad((c) => (c.credits = 205)).length);
  assert.ok(bad((c) => (c.name = "")).length);
  assert.ok(validateCharacter({ ...sheet, className: "Wizard" }).length);
});

test("an Android's Stat choice may take only one out-of-range Stat", () => {
  const { sheet } = buildSheet(makeOne(seeded(11), "Android"));
  const c = structuredClone(sheet);
  c.stats = { strength: 20, speed: 20, intellect: 60, combat: 40 };
  assert.equal(validateCharacter(c).filter((e) => /outside/.test(e)).length, 1);
  c.stats.strength = 30;
  assert.equal(validateCharacter(c).filter((e) => /outside/.test(e)).length, 0);
});

test("the Rim Haulers crew pass as pregenerated characters", () => {
  for (const c of CAMPAIGNS) {
    for (const pc of sanitizeCrew(structuredClone(c.crew))) {
      assert.deepEqual(validateCharacter(pc, { pregenerated: true }), [], pc.name);
    }
  }
  assert.ok(CAMPAIGNS.some((c) => c.title.toUpperCase().includes("RIM HAULERS") || c.id === "rim-haulers"));
});

test("dice: typed dice are range-checked, rerolls need the Warden's say-so", () => {
  const d = newDraft();
  assert.ok(rollFor(d, "stats", { typed: [1, 2, 3] }).error);
  assert.ok(rollFor(d, "stats", { typed: [0, 1, 1, 1, 1, 1, 1, 1] }).error, "a d10 in a sum reads 1-10");
  assert.ok(rollFor(d, "stats", { typed: [11, 1, 1, 1, 1, 1, 1, 1] }).error);
  assert.ok(!rollFor(d, "stats", { typed: [10, 10, 1, 1, 1, 1, 5, 5] }).error);
  assert.deepEqual(statsFrom(d.dice.stats), { strength: 45, speed: 27, intellect: 27, combat: 35 });
  assert.match(d.history[0], /physical dice/);
  assert.match(rollFor(d, "stats").error, /rerolls/);
  assert.ok(!rollFor(d, "stats", { rerolls: true }).error);
  assert.match(rollFor(newDraft(), "loadout").error, /class/);
  assert.equal(checkDice("trinket", [0]), "");
  assert.equal(checkDice("trinket", [99]), "");
  assert.ok(checkDice("trinket", [100]));
  assert.ok(checkDice("loadout", [10]));
});

const rows = (n, p) => Array.from({ length: n }, (_, i) => `${p} ${i}`);
const fake = () => ({ loadouts: Object.fromEntries(CLASSES.map((c) => [c, rows(10, `${c} kit`)])), trinkets: rows(100, "trinket"), patches: rows(100, "patch") });

test("optional roll tables: validated on load and used to prefill", () => {
  assert.ok(parseTables(null).error);
  assert.ok(parseTables({ ...fake(), trinkets: rows(99, "t") }).error);
  assert.ok(parseTables({ ...fake(), loadouts: { Marine: rows(10, "m") } }).error);
  assert.ok(!parseTables(fake()).error);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tables-"));
  const file = path.join(dir, "psg-tables.json");
  assert.equal(loadTables(file), null, "no file, no tables");
  fs.writeFileSync(file, JSON.stringify(fake()));
  const tables = loadTables(file);
  assert.ok(tables);

  const d = newDraft();
  setChoices(d, { className: "Marine" }, tables);
  rollFor(d, "loadout", { typed: [3], tables });
  rollFor(d, "trinket", { typed: [42], tables });
  rollFor(d, "patch", { typed: [0], tables });
  assert.deepEqual([d.loadout, d.trinket, d.patch], ["Marine kit 3", "trinket 42", "patch 0"]);
  setChoices(d, { loadout: "My own kit" });
  assert.equal(d.loadout, "My own kit", "the field stays editable");
  assert.equal(viewOf(d, { tables }).tables, true);
  setChoices(d, { className: "Teamster" }, tables);
  assert.equal(d.loadout, "Teamster kit 3", "a new class looks the same roll up in its own table");

  const bare = newDraft();
  setChoices(bare, { className: "Marine" });
  rollFor(bare, "trinket", { typed: [5] });
  assert.equal(bare.trinket, "");
  assert.equal(viewOf(bare).pages.trinket, 8);

  const warn = console.warn;
  const seen = [];
  console.warn = (m) => seen.push(m);
  try {
    fs.writeFileSync(file, '{"loadouts": 1}');
    assert.equal(loadTables(file), null);
    fs.writeFileSync(file, "not json");
    assert.equal(loadTables(file), null);
  } finally {
    console.warn = warn;
  }
  assert.equal(seen.length, 2);
  assert.match(seen[0], /ignoring/);
  fs.rmSync(dir, { recursive: true });
});

// ---- The Warden's approval ----

function fakeSession(crew, extra = {}) {
  const sent = [];
  const sess = {
    state: { config: { crew: sanitizeCrew(structuredClone(crew)), playerCreate: true, createRerolls: false }, newChars: [], log: [], ...extra },
    sockets: new Set(), logs: [],
    addLog(kind, text) { this.logs.push([kind, text]); },
    touch() {}, syncDm() {}, crewChanged() { this.changed = (this.changed || 0) + 1; },
    crewById(id) { return this.state.config.crew.find((c) => c.id === id); },
  };
  const ws = { role: "player", readyState: 1, character: null, send: (m) => sent.push(JSON.parse(m)) };
  return { sess, ws, sent };
}
const run = (sess, ws, msg) => handleChargen(sess, ws, msg);

function submitOne(sess, ws, replaces = "") {
  run(sess, ws, { t: "cgStart", replaces });
  const draft = ws.cg;
  assert.ok(draft, "started");
  const made = makeOne(seeded(21), "Teamster", { replaces });
  Object.assign(draft, made, { replaces, history: made.history });
  run(sess, ws, { t: "cgSet", set: {} });
  run(sess, ws, { t: "cgSubmit" });
}

test("a new character waits for the Warden, then joins the crew", () => {
  const { sess, ws, sent } = fakeSession(DEFAULT_CREW.slice(0, 2), { campaign: { crew: sanitizeCrew(structuredClone(DEFAULT_CREW.slice(0, 2))) } });
  submitOne(sess, ws);
  assert.equal(sess.state.newChars.length, 1);
  assert.equal(sess.state.config.crew.length, 2, "not yet");
  assert.ok(sess.state.newChars[0].history.length >= 7, "every roll is kept for the Warden");
  assert.ok(sent.at(-1).submitted);
  const id = sess.state.newChars[0].id;
  assert.equal(decideCharacter(sess, true, id), "");
  assert.equal(sess.state.config.crew.length, 3);
  assert.equal(sess.state.campaign.crew.length, 3, "carries to the next story");
  assert.equal(ws.character, sess.state.config.crew[2].id);
  assert.equal(sent.at(-1).t, "cgAccepted");
  assert.equal(sess.state.newChars.length, 0);
  assert.ok(sess.logs.some(([k, t]) => k === "warden" && /Warden's to stage/.test(t)));
  assert.ok(decideCharacter(sess, true, id));
});

test("a rejected character comes back to the player with the note", () => {
  const { sess, ws, sent } = fakeSession(DEFAULT_CREW.slice(0, 1));
  submitOne(sess, ws);
  decideCharacter(sess, false, sess.state.newChars[0].id, "Pick another name");
  assert.equal(sess.state.config.crew.length, 1);
  assert.equal(sent.at(-1).rejected, "Pick another name");
  assert.ok(ws.cg, "the draft is theirs to fix");
});

test("creation needs the switch and a free slot; a dead character's player can always replace", () => {
  const { sess, ws, sent } = fakeSession(DEFAULT_CREW);
  run(sess, ws, { t: "cgStart" });
  assert.match(sent.at(-1).error, /full/);
  sess.state.config.crew[1].status = "deceased";
  sess.state.config.playerCreate = false;
  run(sess, ws, { t: "cgStart" });
  assert.match(sent.at(-1).error, /not allowed/);
  run(sess, ws, { t: "cgStart", replaces: sess.state.config.crew[0].id });
  assert.match(sent.at(-1).error, /no replacement/, "a living character is not replaced");
  const dead = sess.state.config.crew[1].id;
  submitOne(sess, ws, dead);
  assert.equal(sess.state.newChars.length, 1);
  assert.equal(decideCharacter(sess, true, sess.state.newChars[0].id), "");
  const crew = sess.state.config.crew;
  assert.equal(crew.length, MAX_CREW + 1);
  assert.equal(crew[1].id, ws.character, "the new character takes the slot");
  assert.equal(crew[2].id, dead);
  assert.equal(crew[2].status, "deceased");
  assert.equal(crew[2].replacedBy, crew[1].id);
  assert.equal(crew.filter((c) => !c.status).length, MAX_CREW);
  run(sess, ws, { t: "cgStart", replaces: dead });
  assert.match(sent.at(-1).error, /no replacement/, "only once");
});

test("name and pronouns are separate and never guessed", () => {
  const made = (name, pronouns) => {
    const d = makeOne(seeded(31), "Marine");
    setChoices(d, { name, pronouns });
    return buildSheet(d).sheet;
  };
  const a = made("Ines Okoro", "she/her");
  assert.equal(a.name, "Ines Okoro");
  assert.equal(a.pronouns, "she/her");
  const b = made("Ines Okoro", "");
  assert.equal(b.name, "Ines Okoro");
  assert.equal(b.pronouns, "");
  assert.match(crewBrief([b]), /none given: use they\/them/);
  assert.equal(sanitizeCrew([b])[0].pronouns, "");
});
