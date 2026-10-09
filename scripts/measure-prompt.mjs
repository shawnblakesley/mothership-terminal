// Prints the size in characters of one normal reply's prompt for the fixed test states, and of each block in it.
import { kestrelState, haulersState, promptSize } from "./steering-fixtures.mjs";
import { buildRequest } from "../agent.js";

const blocks = (text) => text.split("\n\n").reduce((acc, part) => {
  const head = part.split("\n")[0].slice(0, 48);
  if (/^[A-Z][A-Z '&,:()0-9-]{5,}/.test(head) && !/^-/.test(head)) acc.push([head, part.length]);
  else if (acc.length) acc.at(-1)[1] += part.length + 2;
  return acc;
}, []);

for (const [name, st] of [["KESTREL-9", kestrelState()], ["Rim Haulers story 1", haulersState(0)]]) {
  console.log(name, JSON.stringify(promptSize(st)));
  if (process.argv.includes("--blocks")) {
    const r = buildRequest(st, "");
    for (const [k, v] of [...blocks(r.system), ...blocks(r.context)]) console.log(`  ${String(v).padStart(6)}  ${k}`);
  }
}
