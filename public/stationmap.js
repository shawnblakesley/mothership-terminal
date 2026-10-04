// The Warden's station map: the station state drawn two ways, with every value
// on it.
//   render(): a status board, decks and rooms as tiles of values.
//   draw():   a schematic drawing: decks stacked on a lift shaft, each with a
//             corridor its rooms open off, doors on the doorways, cameras,
//             lights, and extra connections (vents, maintenance shafts...).
// Layout is the Warden's text, one line per deck, plus optional links:
//   Deck 2 · Habitation / Med Bay: med_bay=Med Bay, galley
//   Link: med_bay - cargo_bay_deck3 (air vents)
// A room id matches station state keys anywhere in a path (doors.med_bay,
// cameras.med_bay...); a deck id (deck_2, from "Deck 2") matches deck-wide keys
// (lights.deck_2). Values that belong to no room or deck are shown as systems,
// so nothing in the state is left off. Exposes window.StationMap.
(() => {
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const slug = (s) => String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const human = (id) => String(id).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const singular = (w) => (w === "lights" ? w : /ies$/.test(w) ? w.replace(/ies$/, "y") : /(ss|us)$/.test(w) ? w : w.replace(/s$/, ""));
  const LINK = /^link\s*:\s*(.+?)\s*(?:-+|<->|–|—|to)\s*(.+?)(?:\s*\((.+)\))?$/i;

  // Deck lines -> [{ id: "deck_1", label, rooms: [{ id, label }] }]
  function parseLayout(text) {
    return lines(text).filter((l) => !/^link\s*:/i.test(l)).map((line) => {
      const at = line.indexOf(":");
      const head = (at < 0 ? line : line.slice(0, at)).trim();
      const rooms = at < 0 ? [] : line.slice(at + 1).split(",").map((r) => r.trim()).filter(Boolean).map((r) => {
        const [id, label] = r.split("=").map((x) => x.trim());
        return { id: slug(id), label: label || human(id) };
      });
      const n = head.match(/deck\s*(\d+)/i);
      return { id: n ? `deck_${n[1]}` : slug(head), label: head, rooms };
    });
  }
  // "Link: a - b (label)" lines -> [{ a, b, label }]
  function parseLinks(text) {
    return lines(text).map((l) => l.match(LINK)).filter(Boolean).map((m) => ({ a: slug(m[1]), b: slug(m[2]), label: (m[3] || "").trim() }));
  }
  const lines = (text) => String(text || "").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));

  // Every scalar in the state, with its path.
  function leaves(obj, path = [], out = []) {
    for (const [k, v] of Object.entries(obj || {})) {
      if (v && typeof v === "object" && !Array.isArray(v)) leaves(v, [...path, k], out);
      else out.push({ path: [...path, k], value: Array.isArray(v) ? v.join(", ") : v });
    }
    return out;
  }

  // How a value reads at a glance.
  function tone(path, value) {
    const v = String(value).toUpperCase();
    const key = path.join(".").toLowerCase();
    if (typeof value === "number" && /pct|percent|level|integrity|charge/.test(key)) return value < 25 ? "bad" : value < 60 ? "warn" : "ok";
    if (/^(INACTIVE|DISARMED|NOMINAL|NORMAL|OK|ONLINE|ON|OPEN|GREEN|CLEAR|STABLE|SAFE|ALIVE|SECURE)$/.test(v)) return "ok";
    if (/\bLOCK|SEAL|OFFLINE|^OFF$|JAM|FAIL|BREACH|DOWN|ARMED|CRITICAL|DANGER|ALERT|VENT|DEAD|DENIED|EMERGENCY|DESTROY|CONTAMIN|INFECT|^ACTIVE$|DECK\s*\d/.test(v)) return "bad";
    if (/FLICKER|DEGRAD|STANDBY|LOW|PARTIAL|UNKNOWN|ELEVATED|WARN|CLOSED|DAMAGED|INTERMITTENT/.test(v)) return "warn";
    return "info";
  }

  // Sort the state onto the layout: rooms, decks, "not on the map yet", systems.
  function build(station, layoutText) {
    const decks = parseLayout(layoutText);
    const roomIds = new Set(decks.flatMap((d) => d.rooms.map((r) => r.id)));
    const deckIds = new Set(decks.map((d) => d.id));
    const byRoom = new Map(), byDeck = new Map(), loose = [];
    const add = (map, key, item) => (map.get(key) || map.set(key, []).get(key)).push(item);
    for (const leaf of leaves(station)) {
      const segs = leaf.path.map(slug);
      const room = segs.find((s) => roomIds.has(s));
      const deck = !room && segs.find((s) => deckIds.has(s));
      if (room) add(byRoom, room, { leaf, label: labelFor(leaf.path, room) });
      else if (deck) add(byDeck, deck, { leaf, label: labelFor(leaf.path, deck) });
      else loose.push(leaf);
    }
    // Location-like values not on the layout (a new door the agent added) vs station systems.
    const placedCats = new Set([...byRoom.values(), ...byDeck.values()].flat().map((x) => x.leaf.path[0]));
    const elsewhere = new Map(), systems = new Map();
    for (const leaf of loose) {
      if (leaf.path.length >= 2 && placedCats.has(leaf.path[0])) add(elsewhere, leaf.path[1], { leaf, label: labelFor(leaf.path, leaf.path[1]) });
      else add(systems, leaf.path.length > 1 ? leaf.path[0] : "", leaf);
    }
    const quarantined = String(station?.quarantine ?? "").toUpperCase();
    const deckLook = (d) => {
      const lights = (byDeck.get(d.id) || []).find((x) => /light|power/i.test(x.leaf.path.join(".")));
      const v = String(lights?.leaf.value ?? "").toUpperCase();
      const n = d.id.match(/deck_(\d+)/)?.[1];
      return {
        dark: v === "OFF" || v === "DARK",
        flicker: /FLICKER/.test(v),
        quarantine: !!n && (new RegExp(`DECK\\s*${n}\\b`).test(quarantined) || /STATION|ALL/.test(quarantined)),
      };
    };
    return { decks, links: parseLinks(layoutText), byRoom, byDeck, elsewhere, systems, deckLook };
  }

  // A clickable value: "DOOR LOCKED".
  function chip(leaf, label, editable) {
    const t = tone(leaf.path, leaf.value);
    const pct = typeof leaf.value === "number" && /pct|percent/.test(leaf.path.join(".").toLowerCase());
    return `<button class="mchip ${t}" data-path="${esc(JSON.stringify(leaf.path))}" ${editable ? "" : "disabled"} title="${esc(leaf.path.join("."))}">
      <span class="mk">${esc(label)}</span><span class="mv">${esc(leaf.value)}${pct ? "%" : ""}</span>
      ${pct ? `<i class="bar" style="--p:${Math.max(0, Math.min(100, leaf.value))}%"></i>` : ""}</button>`;
  }

  const systemsHtml = (m, editable) => `<div class="msystems">${[...m.systems.entries()].map(([group, items]) => `<div class="msys">
      <div class="msname">${esc(group ? human(group) : "Station")}</div>
      <div class="mchips">${items.map((leaf) => chip(leaf, labelFor(leaf.path.slice(group ? 1 : 0)), editable)).join("")}</div>
    </div>`).join("")}</div>`;

  // ---------------------------------------------------------------- status board
  function render(el, station, layoutText, { editable = true } = {}) {
    const m = build(station, layoutText);
    const roomTile = (label, items) => `<div class="mroom ${items.some((x) => tone(x.leaf.path, x.leaf.value) === "bad") ? "alarm" : ""}">
        <div class="mrname">${esc(label)}</div>
        <div class="mchips">${items.map((x) => chip(x.leaf, x.label, editable)).join("") || `<span class="mnone">no data</span>`}</div>
      </div>`;
    const deckBand = (d, rooms) => {
      const look = d.id === "_elsewhere" ? {} : m.deckLook(d);
      return `<section class="mdeck ${look.dark ? "dark" : ""} ${look.flicker ? "flicker" : ""} ${look.quarantine ? "quarantine" : ""}">
        <header><span class="mdname">${esc(d.label)}</span><span class="mchips">${(m.byDeck.get(d.id) || []).map((x) => chip(x.leaf, x.label, editable)).join("")}</span></header>
        <div class="mrooms">${rooms}</div>
      </section>`;
    };
    el.innerHTML = `${systemsHtml(m, editable)}
      <div class="mdecks">
        ${m.decks.map((d) => deckBand(d, d.rooms.map((r) => roomTile(r.label, m.byRoom.get(r.id) || [])).join(""))).join("")}
        ${m.elsewhere.size ? deckBand({ id: "_elsewhere", label: "Not on the map yet" }, [...m.elsewhere.entries()].map(([id, items]) => roomTile(human(id), items)).join("")) : ""}
      </div>`;
  }

  // ---------------------------------------------------------------- schematic
  // Decks stacked top to bottom on a lift shaft at the left. Each deck has a
  // corridor; its rooms sit in rows above and below it, joined by doorways.
  function draw(el, station, layoutText, { editable = true } = {}) {
    const m = build(station, layoutText);
    const W = Math.max(560, Math.round(el.clientWidth || 900)); // ~1 unit per CSS pixel, so text stays readable
    const SHAFT = 34, X0 = SHAFT + 46, RIGHT = 28;
    const ROOM_H = 62, GAP = 40, LABEL = 32;
    const perRow = Math.max(1, Math.floor((W - X0 - RIGHT) / 170));
    const rooms = {}; // id -> { x, y, w, h, cx, cy }
    let y = 12;
    const out = { bands: [], links: [], fg: [] };
    const path = (leaf) => (editable && leaf ? `data-path="${esc(JSON.stringify(leaf.path))}"` : "");
    const title = (s) => `<title>${esc(s)}</title>`;
    const corridors = [];

    m.decks.forEach((d, di) => {
      const look = m.deckLook(d);
      const above = d.rooms.slice(0, perRow), below = d.rooms.slice(perRow, perRow * 2), extra = d.rooms.slice(perRow * 2);
      const top = y;
      const cy = top + LABEL + ROOM_H + GAP; // corridor centre line
      const bottom = cy + (below.length ? GAP + ROOM_H : 0) + 18;
      corridors.push(cy);
      const cls = `sv-deck${look.dark ? " dark" : ""}${look.flicker ? " flicker" : ""}${look.quarantine ? " quarantine" : ""}`;
      const lights = (m.byDeck.get(d.id) || []).map((x) => x.leaf);
      out.bands.push(`<g class="${cls}">
        <rect class="sv-band" x="${SHAFT + 18}" y="${top}" width="${W - SHAFT - 18 - 8}" height="${bottom - top}" rx="10"/>
        ${look.quarantine ? `<rect x="${SHAFT + 18}" y="${top}" width="${W - SHAFT - 18 - 8}" height="${bottom - top}" rx="10" fill="url(#sv-hatch)"/>` : ""}
        <text class="sv-deckname" x="${X0}" y="${top + 20}">${esc(d.label.toUpperCase())}</text>
        ${lights.map((leaf, i) => `<g class="sv-click ${tone(leaf.path, leaf.value)}" ${path(leaf)}><text class="sv-tag" x="${W - RIGHT - i * 150}" y="${top + 20}" text-anchor="end">${esc(labelFor(leaf.path, d.id))} ${esc(leaf.value)}</text>${title(leaf.path.join("."))}</g>`).join("")}
        <line class="sv-corridor" x1="${SHAFT}" y1="${cy}" x2="${W - RIGHT}" y2="${cy}"/>
        <rect class="sv-stop" x="${SHAFT - 9}" y="${cy - 9}" width="18" height="18" rx="3"/>
      </g>`);
      // Rooms spread along the corridor (links get the right-hand margin).
      const place = (row, ry, side) => {
        const span = W - X0 - RIGHT - (m.links.length ? 70 : 0);
        const slot = span / Math.max(row.length, 2);
        row.forEach((r, i) => {
          const w = Math.min(240, slot - 26), x = X0 + i * slot + (slot - w) / 2;
          rooms[r.id] = { x, y: ry, w, h: ROOM_H, cx: x + w / 2, cy: ry + ROOM_H / 2, side, corridor: cy, label: r.label };
        });
      };
      place(above, top + LABEL, "above");
      place(below, cy + GAP, "below");
      extra.forEach((r) => (rooms[r.id] = null)); // too many for one deck: still listed on the status board
      y = bottom + 14;
    });

    // Lift shaft through every deck.
    const shaft = corridors.length
      ? `<rect class="sv-shaft" x="${SHAFT - 13}" y="${corridors[0] - 26}" width="26" height="${corridors.at(-1) - corridors[0] + 52}" rx="6"/>
         <text class="sv-tag sv-lift" x="${SHAFT}" y="${corridors[0] - 32}" text-anchor="middle">LIFT</text>`
      : "";

    // Rooms, their doorways and what's in them.
    for (const [id, r] of Object.entries(rooms)) {
      if (!r) continue;
      const items = m.byRoom.get(id) || [];
      const isDoor = (x) => /door|hatch|airlock|access|gate|lock/i.test(x.leaf.path[0]) || /^door|hatch/i.test(x.label);
      const door = items.find(isDoor)?.leaf;
      const cam = items.find((x) => /camera|cctv|feed/i.test(x.leaf.path.join(".")))?.leaf;
      // Shown in the room: door and camera first, then anything else.
      const rest = [...items.filter((x) => x.leaf === door || x.leaf === cam), ...items.filter((x) => x.leaf !== door && x.leaf !== cam)];
      const bad = items.some((x) => tone(x.leaf.path, x.leaf.value) === "bad");
      // Doorway: a short passage from the room to the corridor, with the door across it.
      const y1 = r.side === "above" ? r.y + r.h : r.corridor, y2 = r.side === "above" ? r.corridor : r.y;
      const dy = r.side === "above" ? y1 + 9 : y2 - 9, dt = door ? tone(door.path, door.value) : "none";
      const open = door && /OPEN/i.test(String(door.value));
      out.fg.push(`<line class="sv-doorway" x1="${r.cx}" y1="${y1}" x2="${r.cx}" y2="${y2}"/>`);
      out.fg.push(`<g class="sv-room${bad ? " alarm" : ""}${/airlock/.test(id) ? " airlock" : ""}">
        <rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="6" ${path(items[0]?.leaf)}/>${title(`${r.label}${items.length ? "\n" + items.map((x) => `${x.leaf.path.join(".")}: ${x.leaf.value}`).join("\n") : ""}`)}
        <text class="sv-roomname" x="${r.x + 10}" y="${r.y + 19}">${esc(r.label.toUpperCase())}</text>
        ${rest.slice(0, 2).map((x, i) => `<g class="sv-click ${tone(x.leaf.path, x.leaf.value)}" ${path(x.leaf)}><text class="sv-val" x="${r.x + 10}" y="${r.y + 37 + i * 14}">${esc(x.label)} ${esc(x.leaf.value)}</text>${title(x.leaf.path.join("."))}</g>`).join("")}
        ${rest.length > 2 ? `<text class="sv-val sv-more" x="${r.x + r.w - 8}" y="${r.y + r.h - 7}" text-anchor="end">+${rest.length - 2}</text>` : ""}
        ${cam ? `<g class="sv-click sv-cam ${tone(cam.path, cam.value)}" ${path(cam)} transform="translate(${r.x + r.w - 26} ${r.y + 8})"><rect width="13" height="9" rx="2"/><path d="M13 2.5 L18 0 L18 9 L13 6.5 Z"/>${title(`${cam.path.join(".")}: ${cam.value}`)}</g>` : ""}
        ${/airlock/.test(id) ? `<text class="sv-tag sv-space" x="${r.x + r.w + 6}" y="${r.cy + 4}">▸ SPACE</text>` : ""}
      </g>`);
      if (door) {
        out.fg.push(`<g class="sv-click sv-door ${dt}${open ? " open" : ""}" ${path(door)} transform="translate(${r.cx} ${dy})">
          ${open ? `<rect x="-13" y="-3" width="7" height="6" rx="1"/><rect x="6" y="-3" width="7" height="6" rx="1"/>` : `<rect x="-13" y="-4" width="26" height="8" rx="2"/>`}
          <rect class="sv-hit" x="-16" y="-9" width="32" height="18"/>${title(`${door.path.join(".")}: ${door.value}`)}</g>`);
      }
    }

    // Extra connections between rooms: vents, ducts, maintenance shafts.
    for (const l of m.links) {
      const a = rooms[l.a], b = rooms[l.b];
      if (!a || !b) continue;
      const bend = Math.max(40, Math.abs(a.cy - b.cy) * 0.35);
      const [p, q] = a.cx <= b.cx ? [a, b] : [b, a];
      const sx = p.x + p.w, ex = q.x + q.w;
      const d = `M ${sx} ${p.cy} C ${Math.max(sx, ex) + bend} ${p.cy}, ${Math.max(sx, ex) + bend} ${q.cy}, ${ex} ${q.cy}`;
      out.links.push(`<g class="sv-link${/vent|duct|air/i.test(l.label) ? " vent" : ""}"><path d="${d}"/>${l.label ? `<text class="sv-tag" x="${Math.min(W - 10, Math.max(sx, ex) + bend * 0.75 + 4)}" y="${(p.cy + q.cy) / 2}">${esc(l.label.toUpperCase())}</text>` : ""}${title(`${a.label} ↔ ${b.label}${l.label ? ` (${l.label})` : ""}`)}</g>`);
    }

    const elsewhere = m.elsewhere.size
      ? `<div class="mdecks"><section class="mdeck"><header><span class="mdname">Not on the map yet</span></header><div class="mrooms">${[...m.elsewhere.entries()].map(([id, items]) =>
          `<div class="mroom"><div class="mrname">${esc(human(id))}</div><div class="mchips">${items.map((x) => chip(x.leaf, x.label, editable)).join("")}</div></div>`).join("")}</div></section></div>`
      : "";
    el.innerHTML = `${systemsHtml(m, editable)}
      <svg class="sv" viewBox="0 0 ${W} ${y}" width="100%" role="img" aria-label="Station schematic">
        <defs><pattern id="sv-hatch" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="12" class="sv-hatchline"/></pattern></defs>
        ${out.bands.join("")}${shaft}${out.links.join("")}${out.fg.join("")}
      </svg>${elsewhere}`;
  }

  // "doors.med_bay" in room med_bay -> "DOOR"; "life_support.oxygen_pct" -> "OXYGEN"
  function labelFor(path, skip) {
    const parts = path.filter((p) => slug(p) !== skip);
    return (parts.length ? parts : path).map((p, i, a) => (i === 0 && a.length === 1 && skip ? singular(p) : p)).join(" ").replace(/_/g, " ").replace(/\bpct\b/i, "").trim().toUpperCase();
  }

  // Likely values for a key, offered as one-click choices when editing.
  function choicesFor(path) {
    const k = path.join(".").toLowerCase();
    if (/door|hatch|airlock|access$/.test(k) && !/access_level/.test(k)) return ["OPEN", "CLOSED", "LOCKED", "SEALED"];
    if (/light/.test(k)) return ["ON", "OFF", "FLICKERING"];
    if (/camera|sensor|comms|reactor|terminal/.test(k)) return ["ONLINE", "OFFLINE"];
    if (/quarantine/.test(k)) return ["INACTIVE", "DECK 1", "DECK 2", "DECK 3", "DECK 4", "STATION-WIDE"];
    if (/self_destruct/.test(k)) return ["DISARMED", "ARMED"];
    if (/access_level/.test(k)) return ["GUEST", "CREW", "SECURITY", "ADMIN"];
    return [];
  }

  window.StationMap = { render, draw, parseLayout, parseLinks, choicesFor };
})();
