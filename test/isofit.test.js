import test from "node:test";
import assert from "node:assert/strict";
import { frustum, labelScale } from "../public/isofit.js";

test("frustum fits the taller or wider extent and keeps the aspect", () => {
  const tall = frustum({ w: 44, h: 66 }, 3);
  assert.equal(tall.h, 66);
  assert.equal(tall.w, 198);
  const wide = frustum({ w: 90, h: 20 }, 2);
  assert.equal(wide.w, 90);
  assert.equal(wide.h, 45);
});

test("labels shrink and drop detail when the station is far away", () => {
  const far = labelScale(3, 15);
  assert.equal(far.far, true);
  assert.equal(far.px, 8.5);
  const near = labelScale(14, 15);
  assert.equal(near.far, false);
  assert.equal(near.px, 15);
  assert.ok(labelScale(8, 18).px > labelScale(5, 18).px);
});
