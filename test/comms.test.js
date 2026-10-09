import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanComms, openComms, commsView } from "../comms.js";
import { newAdversary } from "../voices.js";

const adv = () => { const v = newAdversary(); v.name = "THE COLD"; v.adversary = { revealed: true, picture: "cold.png", credit: "" }; return v; };
const config = () => ({ cast: [{ id: "salk", name: "Dr. Imre Salk", portrait: "kit/salk.png", notes: "SECRET NOTE", attitude: 2 }, { id: "bare", name: "Bare", portrait: "" }], voices: [adv()] });

test("a channel with a cast member shows their portrait and matches their lines", () => {
  const c = config();
  const k = openComms(c, { who: "salk", ship: "RCEA CUTTER", transponder: "CLASS 3" });
  assert.equal(k.cast, "Dr. Imre Salk");
  const v = commsView(k, c);
  assert.deepEqual(v.pic, { portrait: "kit/salk.png" });
  assert.equal(v.match.character, "Dr. Imre Salk");
  assert.ok(!JSON.stringify(v).includes("SECRET"));
});

test("no picture means no picture, and a hidden adversary is ???", () => {
  const c = config();
  assert.equal(commsView(openComms(c, { who: "Bare" }), c).pic, null);
  assert.equal(commsView(openComms(c, { who: "Nobody Known" }), c).pic, null);
  const a = openComms(c, { who: "the cold" });
  assert.ok(a.adv);
  assert.equal(commsView(a, c, (p) => `pics/${p}`).pic.src, "pics/cold.png");
  c.voices[0].adversary.revealed = false;
  const hidden = commsView(a, c);
  assert.equal(hidden.who, "???");
  assert.equal(hidden.pic, null);
});

test("saved channels are cleaned", () => {
  assert.equal(cleanComms({ who: "  " }), null);
  assert.equal(cleanComms("x"), null);
  assert.equal(cleanComms({ who: "A".repeat(200), ship: "S" }).who.length, 60);
});
