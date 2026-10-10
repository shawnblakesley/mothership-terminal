import test from "node:test";
import assert from "node:assert/strict";
import { sectorScrollLeft } from "../public/phonefit.js";

test("a map that fits does not scroll", () => assert.equal(sectorScrollLeft({ x: 800 }, [], 700, 760), 0));
test("the scroll centres the rig and the jobs", () => {
  const left = sectorScrollLeft({ x: 820 }, [{ x: 780 }], 900, 353);
  assert.equal(left, Math.round((800 / 1100) * 900 - 353 / 2));
});
test("the scroll is clamped to both ends", () => {
  assert.equal(sectorScrollLeft({ x: 20 }, [], 900, 353), 0);
  assert.equal(sectorScrollLeft({ x: 1090 }, [], 900, 353), 900 - 353);
});
