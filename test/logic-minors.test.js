import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { campaignById, newProgress, buildRequest, finishInto } from "../campaign.js";
import { coldOpenRequest, snapshotStory } from "../coldopen.js";
import { DEFAULT_CREW, sanitizeCrew, fateNote } from "../crew.js";
import "../public/shortname.js";

const c = campaignById("rim-haulers");
const story = (id) => c.stories.find((s) => s.id === id);

function fallen() {
  const p = newProgress(c);
  p.crew[1].cond.dead = "Death Save";
  p.crew[1].endedIn = "FIRST SHIFT";
  p.crew[2].retired = true;
  p.crew[2].replacedBy = p.crew[3].id;
  return p;
}

test("the story builder is told who is dead or retired, and who replaced them", () => {
  const p = fallen();
  const ctx = buildRequest(c, story("quarantine"), p).context;
  assert.match(ctx, new RegExp(`${p.crew[1].name} \\([^)]*\\) \\[DECEASED: Death Save, in FIRST SHIFT\\]`));
  assert.match(ctx, new RegExp(`${p.crew[2].name} \\([^)]*\\) \\[RETIRED; replaced by ${p.crew[3].name}\\]`));
  assert.doesNotMatch(ctx.split("\n").find((l) => l.includes(p.crew[0].name)), new RegExp(`${p.crew[0].name} \\([^)]*\\) \\[`));
});

test("the cold open sees the dead and retired too", () => {
  const p = fallen();
  p.current = "first_shift";
  finishInto(p, c, { crew: [], cast: [] }, "Done.", [], null, snapshotStory({ config: { voices: [], cast: [] }, log: [] }));
  const r = coldOpenRequest(c, p.done[0], story("quarantine"), p);
  assert.match(r.context, /THE CREW \(anyone marked DECEASED or RETIRED is gone[^)]*\): .*\[DECEASED: Death Save, in FIRST SHIFT\]/);
  assert.match(r.context, /\[RETIRED; replaced by /);
});

test("fateNote is empty for the living", () => {
  const crew = sanitizeCrew(structuredClone(DEFAULT_CREW));
  assert.equal(fateNote(crew[0], crew), "");
  crew[0].cond.dead = "Warden";
  assert.equal(fateNote(crew[0], crew), "DECEASED: marked deceased");
});

test("a title is never the short name", () => {
  const s = globalThis.crewShort;
  assert.equal(s("Dr. Ines Marrow"), "INES");
  assert.equal(s("Capt. Rook"), "ROOK");
  assert.equal(s("Sgt Ana Wu"), "ANA");
  assert.equal(s("Wanda Okafor"), "WANDA");
  assert.equal(s('Kofi "Shotgun" Mensah'), "SHOTGUN");
  assert.equal(s("Dr."), "DR.", "nothing else to use");
});

test("two crew with the same short name show their full names", () => {
  const all = ["Dr. Ines Marrow", "Ines Okoro", "Rook"];
  assert.equal(globalThis.crewShort(all[0], all), "DR. INES MARROW");
  assert.equal(globalThis.crewShort(all[1], all), "INES OKORO");
  assert.equal(globalThis.crewShort(all[2], all), "ROOK");
});

test("the short name is used by the player page, the Warden's console and the ship panel, and /msg can find the crewmate", async () => {
  for (const f of ["player", "dm", "shipui"]) assert.match(fs.readFileSync(new URL(`../public/${f}.js`, import.meta.url), "utf8"), /crewShort\(/);
  for (const f of ["player", "dm"]) assert.match(fs.readFileSync(new URL(`../public/${f}.html`, import.meta.url), "utf8"), /shortname\.js/);
  const { crewNamed } = await import("../crewmsg.js");
  const crew = [{ name: "Dr. Ines Marrow" }, { name: "Wanda Okafor" }];
  assert.equal(crewNamed(crew, "INES"), crew[0]);
  assert.equal(crewNamed(crew, "MARROW"), crew[0]);
});

test("High Score stays Warden-only: finishing a no-Warden story does not count a session, and the docs and UI say so", () => {
  const src = fs.readFileSync(new URL("../session.js", import.meta.url), "utf8");
  const body = src.slice(src.indexOf("  soloFinish() {"), src.indexOf("  soloPanic("));
  assert.doesNotMatch(body, /endNight|endSession|highScore|sessions/);
  const readme = fs.readFileSync(new URL("../README.md", import.meta.url), "utf8");
  assert.match(readme, /Warden game nights only/);
  assert.match(readme, /High Score is not counted in a no-Warden campaign/);
  assert.match(fs.readFileSync(new URL("../public/player.js", import.meta.url), "utf8"), /COUNTED ON WARDEN GAME NIGHTS ONLY/);
});
