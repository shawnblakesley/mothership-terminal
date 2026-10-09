import { test } from "node:test";
import assert from "node:assert/strict";
import { CAMPAIGNS, mapFor } from "../campaign.js";
import { sanitizeCrew } from "../crew.js";

// Mothership 1e character creation (PSG v1.2, pages 4-5): base ranges, class modifiers and skills.
const STAT = [27, 45], SAVE = [12, 30];
const CLASS = {
  Teamster: { stats: { strength: 5, speed: 5, intellect: 5, combat: 5 }, saves: { sanity: 10, fear: 10, body: 10 }, wounds: 2, skills: ["Industrial Equipment", "Zero-G"] },
  Marine: { stats: { combat: 10 }, saves: { body: 10, fear: 20 }, wounds: 3, skills: ["Military Training", "Athletics"] },
  Android: { stats: { intellect: 20 }, minus: 10, saves: { fear: 60 }, wounds: 3, skills: ["Linguistics", "Computers", "Mathematics"] },
  Scientist: { stats: { intellect: 10 }, plus: 5, saves: { sanity: 30 }, wounds: 2, skills: [] },
};
const PREREQ = {
  Psychology: ["Linguistics", "Zoology", "Botany"], Pathology: ["Zoology", "Botany"], "Field Medicine": ["Zoology", "Botany"], Ecology: ["Botany", "Geology"],
  "Asteroid Mining": ["Geology", "Industrial Equipment"], "Mechanical Repair": ["Industrial Equipment", "Jury-Rigging"], Explosives: ["Jury-Rigging", "Chemistry", "Military Training"],
  Pharmacology: ["Chemistry"], Hacking: ["Computers"], Piloting: ["Zero-G"], Physics: ["Mathematics"], Mysticism: ["Art", "Archaeology", "Theology"],
  "Wilderness Survival": ["Botany", "Military Training"], Firearms: ["Military Training", "Rimwise"], "Hand-to-Hand Combat": ["Military Training", "Rimwise", "Athletics"],
  Sophontology: ["Psychology"], Exobiology: ["Pathology"], Surgery: ["Pathology", "Field Medicine"], Planetology: ["Ecology", "Asteroid Mining"],
  Robotics: ["Mechanical Repair"], Engineering: ["Mechanical Repair"], Cybernetics: ["Mechanical Repair"], "Artificial Intelligence": ["Hacking"],
  Hyperspace: ["Piloting", "Physics", "Mysticism"], Xenoesotericism: ["Mysticism"], Command: ["Piloting", "Firearms"],
};

for (const c of CAMPAIGNS) {
  test(`${c.title}: crew follow 1e character creation`, () => {
    for (const pc of sanitizeCrew(structuredClone(c.crew))) {
      const k = CLASS[pc.className];
      assert.ok(k, `${pc.name}: class`);
      let spare = (k.minus ? 1 : 0) + (k.plus ? 1 : 0);
      for (const [s, v] of Object.entries(pc.stats)) {
        const m = k.stats[s] || 0;
        if (v >= STAT[0] + m && v <= STAT[1] + m) continue;
        const alt = k.minus ? -k.minus : k.plus;
        assert.ok(spare && v >= STAT[0] + m + alt && v <= STAT[1] + m + alt, `${pc.name}: ${s} ${v} out of range`);
        spare--;
      }
      for (const [s, v] of Object.entries(pc.saves)) assert.ok(v >= SAVE[0] + (k.saves[s] || 0) && v <= SAVE[1] + (k.saves[s] || 0), `${pc.name}: ${s} save ${v} out of range`);
      assert.ok(pc.health.max >= 11 && pc.health.max <= 20, `${pc.name}: health`);
      assert.equal(pc.wounds.max, k.wounds, `${pc.name}: max wounds`);
      const names = pc.skills.map((s) => s.name);
      for (const s of k.skills) assert.ok(names.includes(s), `${pc.name}: missing class skill ${s}`);
      for (const s of names) if (PREREQ[s]) assert.ok(PREREQ[s].some((p) => names.includes(p)), `${pc.name}: ${s} without a prerequisite`);
    }
  });

  test(`${c.title}: every story is placed and complete`, () => {
    const locs = new Set(c.locations.map((l) => l.id));
    const lanes = new Set(c.lanes.flatMap((l) => [`${l.a}|${l.b}`, `${l.b}|${l.a}`]));
    for (const s of c.stories) {
      assert.ok(s.at ? locs.has(s.at) : lanes.has(`${s.from}|${s.to}`), `${s.id}: place`);
      for (const k of ["transgression", "omens", "manifestation", "banishment", "slumber"]) assert.ok(s.acts[k], `${s.id}: ${k}`);
      for (const id of s.cast) assert.ok(c.cast.some((m) => m.id === id), `${s.id}: cast ${id}`);
      for (const f of s.factions) assert.ok(c.factions.some((x) => x.id === f), `${s.id}: faction ${f}`);
      assert.ok(mapFor(c, s).includes("Deck 1"), `${s.id}: map`);
    }
    assert.equal(new Set(c.stories.map((s) => s.adversary.name)).size, c.stories.length, "every adversary differs");
  });
}
