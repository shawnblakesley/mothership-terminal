import { test } from "node:test";
import assert from "node:assert/strict";
import { PANIC_TABLE, panicEntry } from "../cast.js";
import { panicSequence, panicMessage, nearMessage } from "../panicscreen.js";

test("every Panic Table result 1-20 maps to a single treatment, except Compounding Problems", () => {
  for (let n = 1; n <= 20; n++) {
    if (n === 18) continue;
    assert.deepEqual(panicSequence(n, PANIC_TABLE[n].name), [n]);
  }
  assert.deepEqual(panicSequence(0), []);
  assert.deepEqual(panicSequence(21), []);
  assert.deepEqual(panicSequence("x"), []);
});

test("Compounding Problems plays the two results it rolled, in order, never 18 again", () => {
  for (let i = 0; i < 200; i++) {
    const e = panicEntry(18);
    const seq = panicSequence(18, e.name);
    assert.equal(seq.length, 2);
    assert.ok(seq.every((d) => d >= 1 && d <= 20 && d !== 18));
    assert.match(e.name, new RegExp(`${seq[0]}: .* \\+ ${seq[1]}: `));
  }
  assert.deepEqual(panicSequence(18, "Compounding problems"), [18]);
});

test("the panic screen payload carries numbers and a picture address, never names, and Jumpy alone flashes neighbours", () => {
  const msg = panicMessage({ used: 14, name: "Prophetic vision", android: false, picture: "api/sessions/ABC/portraits/0123456789ab.png" });
  assert.deepEqual(Object.keys(msg).sort(), ["role", "seq", "t", "vision"]);
  assert.equal(msg.role, "self");
  assert.ok(!JSON.stringify(msg).toLowerCase().includes("prophetic"));
  assert.deepEqual(Object.keys(panicMessage({ used: 14, name: "x" })).sort(), ["role", "seq", "t"]);
  assert.equal(panicMessage({ used: 19, name: "x", android: true }).android, true);
  assert.equal(panicMessage({ used: 99 }), null);
  assert.equal(nearMessage([3]).role, "near");
  assert.equal(nearMessage([2]), null);
  assert.equal(nearMessage([7, 3]).seq.length, 1);
});

test("the Panic Table itself is untouched by panic screens", () => {
  assert.equal(PANIC_TABLE.length, 21);
  assert.equal(PANIC_TABLE[14].minStress, 2);
  assert.equal(PANIC_TABLE[20].name, "Retire");
});
