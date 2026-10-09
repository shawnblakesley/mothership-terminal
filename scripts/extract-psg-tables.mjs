// Reads your own copy of the Mothership Player's Survival Guide (1e PDF) and writes the loadout, trinket and patch
// tables for the character creation screen to DATA_DIR/tables/psg-tables.json (data/ is not in git).
// Usage: npm i --no-save pdfjs-dist && node scripts/extract-psg-tables.mjs path/to/Players-Survival-Guide.pdf
import fs from "fs";
import path from "path";

const CLASSES = ["Teamster", "Scientist", "Android", "Marine"];
const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/extract-psg-tables.mjs <Player's Survival Guide PDF> [output.json]");
  process.exit(1);
}
const out = process.argv[3] || path.join(process.env.DATA_DIR || "data", "tables", "psg-tables.json");

let pdfjs;
try {
  pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
} catch {
  console.error("Needs pdfjs-dist: run `npm i --no-save pdfjs-dist` first.");
  process.exit(1);
}

const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), verbosity: 0 }).promise;
const pages = [];
for (let n = 1; n <= doc.numPages; n++) {
  const items = (await (await doc.getPage(n)).getTextContent()).items
    .filter((i) => i.str)
    .map((i) => ({ s: i.str.replace(/\s+/g, " ").trim(), raw: i.str.replace(/\s+/g, " "), x: i.transform[4], y: i.transform[5], w: i.width }));
  pages.push(items);
}
const pageWith = (re) => pages.find((items) => items.some((i) => re.test(i.s))) || [];

const MARK = /^(\d{2})(?:\s+(.*))?$/;
const clusters = (xs) => {
  const out = [];
  for (const x of [...xs].sort((a, b) => a - b)) if (!out.length || x - out.at(-1) > 40) out.push(x);
  return out;
};
const columnOf = (cols, x) => cols.filter((c) => c <= x + 6).at(-1) ?? cols[0];

// Words within a few points of each other vertically are one line, read left to right.
const lines = (items) => {
  const out = [];
  for (const i of [...items].sort((a, b) => b.y - a.y)) {
    const line = out.at(-1);
    if (line && line[0].y - i.y < 4) line.push(i);
    else out.push([i]);
  }
  return out.flatMap((l) => l.sort((a, b) => a.x - b.x));
};
// pdf.js splits some words at kerning, so pieces join as they are; a new line, or a visible gap, is a space.
const join = (items) => items.reduce((text, i, n) => {
  const prev = items[n - 1];
  const gap = prev && (prev.y - i.y >= 4 || i.x - (prev.x + prev.w) > 1);
  return text + (gap && !/ $/.test(text) && !/^ /.test(i.raw) ? " " : "") + i.raw;
}, "").replace(/\s+/g, " ");
// Entries are "NN text..." runs: split the items into columns by where the numbers start, then read each column top to bottom.
function entries(items, filter = () => true) {
  const marks = items.filter((i) => MARK.test(i.s) && filter(i));
  const cols = clusters(marks.map((m) => m.x));
  const rows = new Map();
  for (const col of cols) {
    // A number sits vertically centred on its entry, so each piece of text belongs to the nearest number in its column.
    const mine = items.filter((i) => filter(i) && columnOf(cols, i.x) === col);
    const nums = mine.filter((i) => MARK.test(i.s) && Math.abs(i.x - col) < 6);
    const group = new Map(nums.map((n) => [n, []]));
    for (const i of mine) {
      if (nums.includes(i)) continue;
      const near = nums.reduce((a, b) => (Math.abs(b.y - i.y) < Math.abs(a.y - i.y) ? b : a));
      if (Math.abs(near.y - i.y) < 30) group.get(near).push(i);
    }
    for (const [n, list] of group) {
      const m = MARK.exec(n.s);
      rows.set(Number(m[1]), lines([...(m[2] ? [{ ...n, raw: m[2] }] : []), ...list]));
    }
  }
  return new Map([...rows].map(([k, v]) => [k, join(v).replace(/\s+,/g, ",").replace(/,(?=\S)/g, ", ").trim()]));
}

function table(map, size, what) {
  const list = Array.from({ length: size }, (_, n) => map.get(n) || "");
  const missing = list.map((v, n) => (v ? null : n)).filter((n) => n !== null);
  if (missing.length) throw new Error(`${what}: no entry for ${missing.map((n) => String(n).padStart(2, "0")).join(", ")}`);
  return list;
}

const loadPage = pageWith(/^TEAMSTER LOADOUTS/);
// Four tables in a grid: each is anchored on its "D10" column header and named by the title just above it.
const anchors = loadPage.filter((i) => i.s === "D10").map((d) => ({ ...d, name: loadPage.filter((t) => /LOADOUTS/.test(t.s) && t.y > d.y && t.y - d.y < 40 && Math.abs(t.x - d.x) < 160)[0]?.s.split(" ")[0] }));
const anchorCols = clusters(anchors.map((d) => d.x));
const anchorFor = (i) => {
  const col = columnOf(anchorCols, i.x);
  return anchors.filter((d) => columnOf(anchorCols, d.x) === col && d.y > i.y).sort((a, b) => a.y - b.y)[0];
};
const loadouts = {};
for (const c of CLASSES) {
  const anchor = anchors.find((d) => d.name === c.toUpperCase());
  if (!anchor) throw new Error(`no ${c} loadout table found`);
  loadouts[c] = table(entries(loadPage, (i) => anchorFor(i) === anchor && !/^(D10|LOADOUT)$/.test(i.s)), 10, `${c} loadouts`);
}
const trinkets = table(entries(pageWith(/^D100 TRINKETS$/).filter((i) => !/^D100 TRINKETS$/.test(i.s))), 100, "trinkets");
const patches = table(entries(pageWith(/^D100 PATCHES$/).filter((i) => !/^D100 PATCHES$/.test(i.s))), 100, "patches");

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ source: path.basename(file), loadouts, trinkets, patches }, null, 2));
console.log(`Wrote ${out}: loadouts ${CLASSES.map((c) => `${c} ${loadouts[c].length}`).join(", ")}; trinkets ${trinkets.length}; patches ${patches.length}.`);
