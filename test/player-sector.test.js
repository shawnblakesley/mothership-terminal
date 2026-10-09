import { test } from "node:test";
import assert from "node:assert/strict";
import { CAMPAIGNS, newProgress, sectorPayload } from "../campaign.js";

const BANNED = ["acts", "adversary", "secrets", "affinity", "cast", "description", "persona", "factions", "faction", "crew", "notes", "outcome"];
const ALLOWED = ["t", "title", "ports", "lanes", "rig", "played", "offered", "id", "name", "kind", "x", "y", "theme", "a", "b", "days", "dark", "at", "hook", "job"];
const keys = (v, out = new Set()) => {
  if (Array.isArray(v)) v.forEach((x) => keys(x, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { out.add(k); keys(x, out); }
  return out;
};

for (const c of CAMPAIGNS) {
  test(`${c.title}: the players' sector payload holds only whitelisted fields and no secrets`, () => {
    const p = newProgress(c);
    p.offered = c.stories.map((s) => s.id);
    p.done = [{ id: c.stories[0].id, outcome: "SECRET OUTCOME NOTES", at: 1 }];
    const payload = sectorPayload(c, p);
    const text = JSON.stringify(payload);
    const found = keys(payload);
    for (const k of BANNED) assert.ok(!found.has(k), `payload has key ${k}`);
    assert.deepEqual([...found].filter((k) => !ALLOWED.includes(k)), []);
    assert.equal(payload.ports.length, c.locations.length);
    assert.equal(payload.offered.length, c.stories.length);
    assert.ok(!text.includes("SECRET OUTCOME"));
    for (const o of payload.offered) assert.deepEqual(Object.keys(o).sort(), ["hook", "id", "job", "title", "x", "y"]);
    for (const s of c.stories) {
      for (const b of [...s.secrets, ...Object.values(s.acts), s.adversary.persona, s.event, s.horror]) assert.ok(!text.includes(b), `leaks: ${b.slice(0, 50)}`);
      const visible = [s.title, s.hook, s.job].join(" ");
      assert.ok(!text.includes(s.adversary.name) || visible.includes(s.adversary.name), `adversary name ${s.adversary.name} leaks`);
    }
    for (const m of c.cast) assert.ok(!text.includes(m.notes), `cast notes leak: ${m.name}`);
    for (const f of c.factions) assert.ok(!text.includes(f.about), "faction text leaks");
  });
}
