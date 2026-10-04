// Room floor plans: a small grid of tile codes, one string per row, drawn as a
// blueprint. Used by the Warden console (view and edit) and the players'
// screens (when the Warden shows them a room: the layout only, never what's in it).
// Exposes window.RoomPlan.
(() => {
  // code -> [name, how it's drawn]. Keep in step with rooms.js (TILES).
  const TILES = {
    " ": ["outside"],
    "#": ["wall"],
    ".": ["floor"],
    D: ["door"],
    H: ["hatch / airlock door"],
    W: ["window"],
    T: ["terminal / console"],
    B: ["bed / bunk"],
    K: ["table / desk"],
    S: ["seat"],
    L: ["locker / shelves"],
    C: ["crate / cargo"],
    V: ["vent / grate"],
    M: ["machinery"],
    R: ["reactor / core"],
    P: ["pipes / conduit"],
    X: ["debris / blockage"],
  };
  const CODES = Object.keys(TILES);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  // Rows padded to one width; unknown codes become floor.
  function normalize(rows) {
    const list = (Array.isArray(rows) ? rows : []).map((r) => String(r ?? ""));
    const w = Math.max(0, ...list.map((r) => r.length));
    return list.map((r) => [...r.padEnd(w, " ")].map((c) => (TILES[c] ? c : ".")).join(""));
  }

  // One tile at (x, y), size s. Shapes only, coloured by CSS (currentColor).
  function tile(c, x, y, s, n) {
    const m = s * 0.18, i = s - m * 2, cx = x + s / 2, cy = y + s / 2;
    const wallish = (k) => k === "#" || k === "W";
    switch (c) {
      case "#": return `<rect class="rp-wall" x="${x}" y="${y}" width="${s}" height="${s}"/>`;
      case "W": { // a wall with a pane through it, along the run of the wall
        const h = wallish(n.l) || wallish(n.r);
        return `<rect class="rp-wall" x="${x}" y="${y}" width="${s}" height="${s}"/>` + (h
          ? `<rect class="rp-glass" x="${x}" y="${cy - s * 0.12}" width="${s}" height="${s * 0.24}"/>`
          : `<rect class="rp-glass" x="${cx - s * 0.12}" y="${y}" width="${s * 0.24}" height="${s}"/>`);
      }
      case "D": case "H": { // a gap in the wall with the door leaf across it
        const h = wallish(n.l) || wallish(n.r) || n.l === "D" || n.r === "D" || n.l === "H" || n.r === "H";
        const t = c === "H" ? s * 0.34 : s * 0.2;
        return `<rect class="rp-floor" x="${x}" y="${y}" width="${s}" height="${s}"/>` + (h
          ? `<rect class="rp-door${c === "H" ? " hatch" : ""}" x="${x}" y="${cy - t / 2}" width="${s}" height="${t}"/>`
          : `<rect class="rp-door${c === "H" ? " hatch" : ""}" x="${cx - t / 2}" y="${y}" width="${t}" height="${s}"/>`);
      }
      case " ": return "";
    }
    const floor = `<rect class="rp-floor" x="${x}" y="${y}" width="${s}" height="${s}"/>`;
    switch (c) {
      case ".": return floor;
      case "T": return floor + `<rect class="rp-thing" x="${x + m}" y="${y + m * 1.4}" width="${i}" height="${i * 0.62}" rx="1.5"/><rect class="rp-screen" x="${x + m * 1.8}" y="${y + m * 2}" width="${i - m * 1.6}" height="${i * 0.3}"/><rect class="rp-thing" x="${cx - i * 0.12}" y="${y + m * 1.4 + i * 0.62}" width="${i * 0.24}" height="${i * 0.26}"/>`;
      case "B": return floor + `<rect class="rp-thing" x="${x + m * 0.6}" y="${y + m}" width="${s - m * 1.2}" height="${i}" rx="2"/><rect class="rp-soft" x="${x + m * 1.2}" y="${y + m * 1.5}" width="${i * 0.38}" height="${i - m}" rx="1.5"/>`;
      case "K": return floor + `<rect class="rp-thing" x="${x + m * 0.6}" y="${y + m * 1.2}" width="${s - m * 1.2}" height="${i * 0.8}" rx="1.5"/>`;
      case "S": return floor + `<rect class="rp-thing" x="${x + s * 0.28}" y="${y + s * 0.28}" width="${s * 0.44}" height="${s * 0.44}" rx="${s * 0.12}"/>`;
      case "L": return floor + `<rect class="rp-thing" x="${x + m * 0.6}" y="${y + m * 0.6}" width="${s - m * 1.2}" height="${s - m * 1.2}"/><line class="rp-line" x1="${cx}" y1="${y + m * 0.6}" x2="${cx}" y2="${y + s - m * 0.6}"/>`;
      case "C": return floor + `<rect class="rp-thing" x="${x + m}" y="${y + m}" width="${i}" height="${i}"/><path class="rp-line" d="M${x + m} ${y + m}L${x + m + i} ${y + m + i}M${x + m + i} ${y + m}L${x + m} ${y + m + i}"/>`;
      case "V": return floor + `<rect class="rp-thing hollow" x="${x + m}" y="${y + m}" width="${i}" height="${i}"/>` + [1, 2, 3].map((k) => `<line class="rp-line" x1="${x + m}" y1="${y + m + (i * k) / 4}" x2="${x + m + i}" y2="${y + m + (i * k) / 4}"/>`).join("");
      case "M": return floor + `<rect class="rp-thing" x="${x + m}" y="${y + m}" width="${i}" height="${i}" rx="2"/><circle class="rp-soft" cx="${cx}" cy="${cy}" r="${i * 0.26}"/>`;
      case "R": { // one core for a whole block of R tiles, drawn from its top-left tile
        if (!n.core) return floor;
        const [bw, bh] = n.core, ccx = x + (bw * s) / 2, ccy = y + (bh * s) / 2, r = (Math.min(bw, bh) * s) / 2 - 2;
        return floor + `<circle class="rp-core" cx="${ccx}" cy="${ccy}" r="${r}"/><circle class="rp-soft" cx="${ccx}" cy="${ccy}" r="${r * 0.42}"/><circle class="rp-line" cx="${ccx}" cy="${ccy}" r="${r * 0.72}"/>`;
      }
      case "P": return floor + `<line class="rp-pipe" x1="${x}" y1="${cy - s * 0.15}" x2="${x + s}" y2="${cy - s * 0.15}"/><line class="rp-pipe" x1="${x}" y1="${cy + s * 0.15}" x2="${x + s}" y2="${cy + s * 0.15}"/>`;
      case "X": return floor + `<path class="rp-debris" d="M${x + m} ${y + s - m}L${x + s * 0.4} ${y + m * 1.5}L${x + s * 0.6} ${y + s * 0.55}L${x + s - m} ${y + m}"/>`;
    }
    return floor;
  }

  // The blueprint as an SVG string. opts: { cell (px per tile), title, cls }.
  function svg(rows, { cell = 22, title = "", cls = "" } = {}) {
    const g = normalize(rows);
    const h = g.length, w = g[0]?.length || 0;
    if (!w || !h) return `<svg class="roomplan ${cls}" viewBox="0 0 10 10"></svg>`;
    const at = (x, y) => g[y]?.[x] ?? " ";
    const parts = [], cores = [], hits = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const n = { l: at(x - 1, y), r: at(x + 1, y), u: at(x, y - 1), d: at(x, y + 1) };
        if (g[y][x] === "R" && n.l !== "R" && n.u !== "R") { // the top-left of a reactor block: one core for all of it
          let bw = 1, bh = 1;
          while (at(x + bw, y) === "R") bw++;
          while (at(x, y + bh) === "R") bh++;
          cores.push(tile("R", x * cell, y * cell, cell, { ...n, core: [bw, bh] }));
        }
        parts.push(tile(g[y][x], x * cell, y * cell, cell, n));
        hits.push(`<rect class="rp-hit" data-x="${x}" data-y="${y}" x="${x * cell}" y="${y * cell}" width="${cell}" height="${cell}"/>`);
      }
    }
    // Tiles, then reactor cores over them, then the click targets (for editing) on top.
    return `<svg class="roomplan ${cls}" viewBox="-2 -2 ${w * cell + 4} ${h * cell + 4}" role="img" aria-label="${esc(title || "Room layout")}">${title ? `<title>${esc(title)}</title>` : ""}${parts.join("")}${cores.join("")}${hits.join("")}</svg>`;
  }

  // The tiles a plan uses, for a legend: [[code, name]].
  const legend = (rows) => {
    const used = new Set(normalize(rows).join(""));
    return CODES.filter((c) => c !== " " && c !== "." && used.has(c)).map((c) => [c, TILES[c][0]]);
  };

  window.RoomPlan = { TILES, CODES, normalize, svg, legend };
})();
