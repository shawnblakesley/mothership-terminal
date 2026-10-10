import test from "node:test";
import assert from "node:assert/strict";
import { rollFolded, rollBrief } from "../public/rollcard.js";
import { tipText } from "../public/touchtips.js";

const roll = (extra = {}) => ({ status: "done", createdAt: 100, finishedAt: 200, check: "intellect", pcs: [{ id: "a", name: "Wanda" }], results: { a: { result: { success: false, outcome: "failure" } } }, ...extra });

test("a roll still waiting is never folded", () => assert.equal(rollFolded(roll({ status: "waiting" }), [{ ts: 300, kind: "terminal" }]), false));
test("a finished roll stays open until a later reply, Speak or player line", () => {
  assert.equal(rollFolded(roll(), []), false);
  assert.equal(rollFolded(roll(), [{ ts: 150, kind: "terminal" }]), false);
  assert.equal(rollFolded(roll(), [{ ts: 210, kind: "roll" }, { ts: 220, kind: "note" }]), false);
  for (const kind of ["terminal", "warden", "player"]) assert.equal(rollFolded(roll(), [{ ts: 300, kind }]), true);
});
test("a cut line does not fold it, and Show keeps this roll open", () => {
  assert.equal(rollFolded(roll(), [{ ts: 300, kind: "terminal", cut: true }]), false);
  assert.equal(rollFolded(roll(), [{ ts: 300, kind: "terminal" }], 100), false);
  assert.equal(rollFolded(roll({ createdAt: 500, finishedAt: 600 }), [{ ts: 700, kind: "terminal" }], 100), true);
});
test("the brief names each character's outcome", () => {
  assert.equal(rollBrief(roll({ pcs: [{ id: "a", name: "Wanda" }, { id: "b", name: "Ines" }], results: { a: { result: { outcome: "failure" } }, b: { result: { panic: true, success: false, used: 7 } } } })), "Wanda: failure · Ines: panic 7");
  assert.equal(rollBrief(roll({ results: {} })), "Wanda: didn't roll");
});

const el = (attrs = {}, kids = [], parent = null) => {
  const e = { getAttribute: (k) => attrs[k] ?? null, children: kids, parentElement: parent };
  for (const k of kids) k.parentElement = e;
  return e;
};
test("tip text comes from the nearest title attribute", () => {
  const outer = el({ title: "Outer tip" });
  const inner = el({}, [], outer);
  assert.equal(tipText(inner), "Outer tip");
  assert.equal(tipText(el()), "");
});
test("tip text reads an SVG title child and skips blank titles", () => {
  const svgTitle = { localName: "title", textContent: "Medbay\nWanda", children: [], getAttribute: () => null };
  assert.equal(tipText(el({}, [svgTitle])), "Medbay\nWanda");
  assert.equal(tipText(el({ title: "  " })), "");
});
