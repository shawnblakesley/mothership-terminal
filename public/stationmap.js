(() => {
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const slug = (s) => String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const human = (id) => String(id).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const singular = (w) => (w === "lights" ? w : /ies$/.test(w) ? w.replace(/ies$/, "y") : /(ss|us)$/.test(w) ? w : w.replace(/s$/, ""));
  const LINK = /^link\s*:\s*(.+?)\s*(?:-+|<->|–|—|to)\s*(.+?)(?:\s*\((.+)\))?$/i;

  const SPECIAL = /^(link|lift|docked)\s*:/i;
  function parseLayout(text) {
    return lines(text).filter((l) => !SPECIAL.test(l)).map((line) => {
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
  function parseLinks(text) {
    return lines(text).map((l) => l.match(LINK)).filter(Boolean).map((m) => ({ a: slug(m[1]), b: slug(m[2]), label: (m[3] || "").trim() }));
  }
  function parseDocked(text) {
    return lines(text).map((l) => l.match(/^docked\s*:\s*([^=@]+?)\s*(?:=\s*([^@]+?))?\s*@\s*(.+)$/i)).filter(Boolean)
      .map((m) => ({ id: slug(m[1]), label: (m[2] || human(m[1])).trim(), parent: slug(m[3]) }));
  }
  function parseLift(text) {
    const line = lines(text).find((l) => /^lift\s*:/i.test(l));
    if (!line) return null;
    return new Set(line.replace(/^lift\s*:/i, "").split(",").map((d) => d.trim()).filter(Boolean)
      .map((d) => (d.match(/deck\s*(\d+)/i) ? `deck_${d.match(/deck\s*(\d+)/i)[1]}` : slug(d))));
  }
  const lines = (text) => String(text || "").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));

  function leaves(obj, path = [], out = []) {
    for (const [k, v] of Object.entries(obj || {})) {
      if (v && typeof v === "object" && !Array.isArray(v)) leaves(v, [...path, k], out);
      else out.push({ path: [...path, k], value: Array.isArray(v) ? v.join(", ") : v });
    }
    return out;
  }

  function tone(path, value) {
    const v = String(value).toUpperCase();
    const key = path.join(".").toLowerCase();
    if (typeof value === "number" && /pct|percent|level|integrity|charge/.test(key)) return value < 25 ? "bad" : value < 60 ? "warn" : "ok";
    if (/^(INACTIVE|DISARMED|NOMINAL|NORMAL|OK|ONLINE|ON|OPEN|GREEN|CLEAR|STABLE|SAFE|ALIVE|SECURE)$/.test(v)) return "ok";
    if (/\bLOCK|SEAL|OFFLINE|^OFF$|JAM|FAIL|BREACH|DOWN|ARMED|CRITICAL|DANGER|ALERT|VENT|DEAD|DENIED|EMERGENCY|DESTROY|CONTAMIN|INFECT|FAULT|MALFUNC|ERROR|^ACTIVE$|DECK\s*\d/.test(v)) return "bad";
    if (/FLICKER|DEGRAD|STANDBY|LOW|PARTIAL|UNKNOWN|ELEVATED|WARN|CLOSED|DAMAGED|INTERMITTENT|RESTRICT|WITHHELD/.test(v)) return "warn";
    return "info";
  }

  function build(station, layoutText) {
    const decks = parseLayout(layoutText);
    const docked = parseDocked(layoutText);
    const roomIds = new Set([...decks.flatMap((d) => d.rooms.map((r) => r.id)), ...docked.map((r) => r.id)]);
    const deckIds = new Set(decks.map((d) => d.id));
    const byRoom = new Map(), byDeck = new Map(), loose = [];
    const add = (map, key, item) => (map.get(key) || map.set(key, []).get(key)).push(item);
    for (const leaf of leaves(station).filter((l) => l.path[0] !== "hazards")) {
      const segs = leaf.path.map(slug);
      const room = segs.find((s) => roomIds.has(s));
      const deck = !room && segs.find((s) => deckIds.has(s));
      if (room) add(byRoom, room, { leaf, label: labelFor(leaf.path, room) });
      else if (deck) add(byDeck, deck, { leaf, label: labelFor(leaf.path, deck) });
      else loose.push(leaf);
    }
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
    return { decks, docked, lift: parseLift(layoutText), links: parseLinks(layoutText), byRoom, byDeck, elsewhere, systems, deckLook };
  }

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

  const liftState = (v) => {
    const s = String(v ?? "").toUpperCase();
    if (/FAULT|OFFLINE|DAMAG|ERROR|MALFUNC|BROKEN|JAM|STUCK|FAIL|DOWN|DISABLED|NO POWER/.test(s)) return "fault";
    if (/RESTRICT|LOCK|DENIED|CLEARANCE|AUTH|SECUR|SEALED/.test(s)) return "perm";
    return "";
  };
  const isRoster = (leaf) => leaf.path[0] === "occupants" || leaf.path[0] === "contents";
  const names = (v) => String(v ?? "").split(",").map((x) => x.trim()).filter(Boolean);

  function draw(el, station, layoutText, { editable = true, people = {} } = {}) {
    const m = build(station, layoutText);
    const W = Math.max(560, Math.round(el.clientWidth || 900));
    const SHAFT = 34, X0 = SHAFT + 46, RIGHT = 28;
    const ROOM_H = 62, GAP = 40, LABEL = 32, DOCK_GAP = 24, DOCK = ROOM_H + DOCK_GAP;
    const perRow = Math.max(1, Math.floor((W - X0 - RIGHT) / 170));
    const rooms = {};
    let y = 12;
    const out = { bands: [], links: [], fg: [], lift: [] };
    const path = (leaf) => (editable && leaf ? `data-path="${esc(JSON.stringify(leaf.path))}"` : "");
    const title = (s) => `<title>${esc(s)}</title>`;
    const served = m.lift ?? new Set(m.decks.map((d) => d.id).filter((id) => /^deck_\d+$/.test(id)));
    const stops = [];
    const dockedOn = (ids) => m.docked.filter((r) => ids.includes(r.parent));

    m.decks.forEach((d) => {
      const look = m.deckLook(d);
      const above = d.rooms.slice(0, perRow), below = d.rooms.slice(perRow, perRow * 2), extra = d.rooms.slice(perRow * 2);
      const dockAbove = dockedOn(above.map((r) => r.id)), dockBelow = dockedOn(below.map((r) => r.id));
      const top = y + (dockAbove.length ? DOCK : 0);
      const cy = top + LABEL + ROOM_H + GAP;
      const bottom = cy + (below.length ? GAP + ROOM_H : 0) + 18;
      const reached = served.has(d.id);
      const liftLeaf = (m.byDeck.get(d.id) || []).find((x) => /lift|elevator/i.test(x.leaf.path[0]))?.leaf;
      const ls = liftLeaf ? liftState(liftLeaf.value) : "";
      if (reached) stops.push(cy);
      const cls = `sv-deck${look.dark ? " dark" : ""}${look.flicker ? " flicker" : ""}${look.quarantine ? " quarantine" : ""}`;
      const tags = (m.byDeck.get(d.id) || []).map((x) => x.leaf);
      const bandX = SHAFT + 18;
      out.bands.push(`<g class="${cls}">
        <rect class="sv-band" x="${bandX}" y="${top}" width="${W - bandX - 8}" height="${bottom - top}" rx="10"/>
        ${look.quarantine ? `<rect x="${bandX}" y="${top}" width="${W - bandX - 8}" height="${bottom - top}" rx="10" fill="url(#sv-hatch)"/>` : ""}
        <text class="sv-deckname" x="${X0}" y="${top + 20}">${esc(d.label.toUpperCase())}</text>
        ${tags.map((leaf, i) => `<g class="sv-click ${tone(leaf.path, leaf.value)}" ${path(leaf)}><text class="sv-tag" x="${W - RIGHT - i * 150}" y="${top + 20}" text-anchor="end">${esc(labelFor(leaf.path, d.id))} ${esc(leaf.value)}</text>${title(leaf.path.join("."))}</g>`).join("")}
        <line class="sv-corridor" x1="${reached ? SHAFT : bandX + 10}" y1="${cy}" x2="${W - RIGHT}" y2="${cy}"/>
      </g>`);
      if (reached) {
        const stripes = ls ? `fill="url(#sv-stripes-${ls === "perm" ? "warn" : "bad"})"` : "";
        out.lift.push(`<g class="sv-liftstop ${ls}" ${path(liftLeaf)}>
          ${ls ? `<rect class="sv-gate" x="${SHAFT + 10}" y="${cy - 8}" width="${X0 - SHAFT - 16}" height="16" rx="2" ${stripes}/>` : ""}
          <rect class="sv-stop" x="${SHAFT - 9}" y="${cy - 9}" width="18" height="18" rx="3" ${stripes}/>
          ${title(liftLeaf ? `${liftLeaf.path.join(".")}: ${liftLeaf.value}` : `Lift: ${d.label}`)}</g>`);
      }
      const place = (row, ry, side) => {
        const span = W - X0 - RIGHT - (m.links.length ? 70 : 0);
        const slot = span / Math.max(row.length, 2);
        row.forEach((r, i) => {
          const w = Math.min(240, slot - 26), x = X0 + i * slot + (slot - w) / 2;
          rooms[r.id] = { x, y: ry, w, h: ROOM_H, cx: x + w / 2, cy: ry + ROOM_H / 2, side, corridor: cy, label: r.label, deck: d.label };
        });
      };
      place(above, top + LABEL, "above");
      place(below, cy + GAP, "below");
      extra.forEach((r) => (rooms[r.id] = null));
      for (const r of [...dockAbove, ...dockBelow]) {
        const p = rooms[r.parent];
        const ry = p.side === "above" ? top - DOCK_GAP - ROOM_H : bottom + DOCK_GAP;
        rooms[r.id] = { x: p.x, y: ry, w: p.w, h: ROOM_H, cx: p.cx, cy: ry + ROOM_H / 2, side: "docked", parent: p, label: r.label, deck: `docked at ${p.label}` };
      }
      y = bottom + 14 + (dockBelow.length ? DOCK : 0);
    });

    const whole = [...(m.systems.get("lift") || []), ...(m.systems.get("elevator") || [])];
    const wholeState = whole.map((l) => liftState(l.value)).find(Boolean) || "";
    const shaft = stops.length
      ? `<g class="sv-click" ${path(whole[0])}><rect class="sv-shaft" x="${SHAFT - 13}" y="${stops[0] - 26}" width="26" height="${stops.at(-1) - stops[0] + 52}" rx="6"/>
         ${wholeState ? `<rect x="${SHAFT - 13}" y="${stops[0] - 26}" width="26" height="${stops.at(-1) - stops[0] + 52}" rx="6" fill="url(#sv-stripes-${wholeState === "perm" ? "warn" : "bad"})"/>` : ""}
         ${whole.length ? title(whole.map((l) => `${l.path.join(".")}: ${l.value}`).join("\n")) : ""}</g>
         <text class="sv-tag sv-lift" x="${SHAFT}" y="${stops[0] - 32}" text-anchor="middle">LIFT</text>`
      : "";

    for (const [id, r] of Object.entries(rooms)) {
      if (!r) continue;
      const items = m.byRoom.get(id) || [];
      const isDoor = (x) => /door|hatch|airlock|access|gate|lock/i.test(x.leaf.path[0]) || /^door|hatch/i.test(x.label);
      const door = items.find(isDoor)?.leaf;
      const cam = items.find((x) => /camera|cctv|feed/i.test(x.leaf.path.join(".")))?.leaf;
      const values = items.filter((x) => !isRoster(x.leaf));
      const rest = [...values.filter((x) => x.leaf === door || x.leaf === cam), ...values.filter((x) => x.leaf !== door && x.leaf !== cam)];
      const bad = values.some((x) => tone(x.leaf.path, x.leaf.value) === "bad");
      const who = names(items.find((x) => x.leaf.path[0] === "occupants")?.leaf.value);
      const pcs = people[id] || [];
      const what = names(items.find((x) => x.leaf.path[0] === "contents")?.leaf.value);
      const dt = door ? tone(door.path, door.value) : "none";
      const open = door && /OPEN/i.test(String(door.value));
      let dx = r.cx, dy;
      if (r.side === "docked") {
        const p = r.parent, up = r.y < p.y;
        const y1 = up ? r.y + r.h : p.y + p.h, y2 = up ? p.y : r.y;
        out.fg.push(`<g class="sv-collar"><line x1="${r.cx - 9}" y1="${y1}" x2="${r.cx - 9}" y2="${y2}"/><line x1="${r.cx + 9}" y1="${y1}" x2="${r.cx + 9}" y2="${y2}"/></g>`);
        dy = (y1 + y2) / 2;
      } else {
        const y1 = r.side === "above" ? r.y + r.h : r.corridor, y2 = r.side === "above" ? r.corridor : r.y;
        dy = r.side === "above" ? y1 + 9 : y2 - 9;
        out.fg.push(`<line class="sv-doorway" x1="${r.cx}" y1="${y1}" x2="${r.cx}" y2="${y2}"/>`);
      }
      const count = who.length + pcs.length;
      const roster = [...pcs.map((n) => `${n} (player)`), ...who, ...(what.length ? ["—", ...what] : [])].join("\n");
      const hz = station?.hazards?.[id];
      const hzText = hz ? `${String(hz.type).toUpperCase()}${hz.level ? ` ${hz.level}` : ""}` : "";
      out.fg.push(`<g class="sv-room${bad ? " alarm" : ""}${hz ? " hazard" : ""}${/airlock/.test(id) ? " airlock" : ""}${r.side === "docked" ? " docked" : ""}">
        <rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="6" ${editable ? `data-room="${esc(id)}" data-label="${esc(r.label)}" data-deck="${esc(r.deck)}"` : ""}/>${title(`${r.label}${editable ? " (click for the room view)" : ""}${roster ? `\n${roster}` : ""}`)}
        <text class="sv-roomname" x="${r.x + 10}" y="${r.y + 19}">${esc(r.label.toUpperCase())}</text>
        ${rest.slice(0, hz ? 1 : 2).map((x, i) => `<g class="sv-click ${tone(x.leaf.path, x.leaf.value)}" ${path(x.leaf)}><text class="sv-val" x="${r.x + 10}" y="${r.y + 37 + i * 14}">${esc(x.label)} ${esc(x.leaf.value)}</text>${title(x.leaf.path.join("."))}</g>`).join("")}
        ${hz ? `<text class="sv-hazard" x="${r.x + 10}" y="${r.y + 51}">${esc(hzText)}${rest.length > 1 ? ` +${rest.length - 1}` : ""}</text>` : rest.length > 2 ? `<text class="sv-val sv-more" x="${r.x + 10}" y="${r.y + r.h - 7}">+${rest.length - 2}</text>` : ""}
        ${count || what.length ? `<text class="sv-val sv-people" x="${r.x + r.w - 8}" y="${r.y + r.h - 7}" text-anchor="end">${pcs.length ? `<tspan class="sv-pc">${pcs.length}◆</tspan> ` : ""}${who.length ? `${who.length}●` : ""}${what.length ? ` ${what.length}▪` : ""}</text>` : ""}
        ${cam ? `<g class="sv-click sv-cam ${tone(cam.path, cam.value)}" ${path(cam)} transform="translate(${r.x + r.w - 26} ${r.y + 8})"><rect width="13" height="9" rx="2"/><path d="M13 2.5 L18 0 L18 9 L13 6.5 Z"/>${title(`${cam.path.join(".")}: ${cam.value}`)}</g>` : ""}
        ${/airlock/.test(id) ? `<text class="sv-tag sv-space" x="${r.x + r.w + 6}" y="${r.cy + 4}">▸ SPACE</text>` : ""}
      </g>`);
      if (door) {
        out.fg.push(`<g class="sv-click sv-door ${dt}${open ? " open" : ""}" ${path(door)} transform="translate(${dx} ${dy})">
          ${open ? `<rect x="-13" y="-3" width="7" height="6" rx="1"/><rect x="6" y="-3" width="7" height="6" rx="1"/>` : `<rect x="-13" y="-4" width="26" height="8" rx="2"/>`}
          <rect class="sv-hit" x="-16" y="-9" width="32" height="18"/>${title(`${door.path.join(".")}: ${door.value}`)}</g>`);
      }
    }

    for (const l of m.links) {
      const a = rooms[l.a], b = rooms[l.b];
      if (!a || !b) continue;
      const bend = Math.max(40, Math.abs(a.cy - b.cy) * 0.35);
      const [p, q] = a.cx <= b.cx ? [a, b] : [b, a];
      const sx = p.x + p.w, ex = q.x + q.w;
      const d = `M ${sx} ${p.cy} C ${Math.max(sx, ex) + bend} ${p.cy}, ${Math.max(sx, ex) + bend} ${q.cy}, ${ex} ${q.cy}`;
      out.links.push(`<g class="sv-link${/vent|duct|air/i.test(l.label) ? " vent" : ""}"><path d="${d}"/>${l.label ? `<text class="sv-tag" x="${Math.min(W - 10, Math.max(sx, ex) + bend * 0.75 + 4)}" y="${(p.cy + q.cy) / 2}">${esc(l.label.toUpperCase())}</text>` : ""}${title(`${a.label} ↔ ${b.label}${l.label ? ` (${l.label})` : ""}`)}</g>`);
    }

    const elsewhere = elsewhereHtml(m, editable);
    const stripes = (id, cls) => `<pattern id="${id}" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="10" height="10" class="sv-stripe-bg"/><rect width="5" height="10" class="${cls}"/></pattern>`;
    el.innerHTML = `${systemsHtml(m, editable)}
      <svg class="sv" viewBox="0 0 ${W} ${y}" width="100%" role="img" aria-label="Station schematic">
        <defs><pattern id="sv-hatch" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="12" class="sv-hatchline"/></pattern>
          ${stripes("sv-stripes-warn", "sv-stripe-warn")}${stripes("sv-stripes-bad", "sv-stripe-bad")}</defs>
        ${out.bands.join("")}${shaft}${out.lift.join("")}${out.links.join("")}${out.fg.join("")}
      </svg>${elsewhere}`;
  }

  const elsewhereHtml = (m, editable) => (m.elsewhere.size
    ? `<div class="mdecks"><section class="mdeck"><header><span class="mdname">Not on the map yet</span></header><div class="mrooms">${[...m.elsewhere.entries()].map(([id, items]) =>
        `<div class="mroom"><div class="mrname">${esc(human(id))}</div><div class="mchips">${items.map((x) => chip(x.leaf, x.label, editable)).join("")}</div></div>`).join("")}</div></section></div>`
    : "");

  function labelFor(path, skip) {
    const parts = path.filter((p) => slug(p) !== skip);
    return (parts.length ? parts : path).map((p, i, a) => (i === 0 && a.length === 1 && skip ? singular(p) : p)).join(" ").replace(/_/g, " ").replace(/\bpct\b/i, "").trim().toUpperCase();
  }

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

  function mini(el, layoutText, people = {}) {
    const decks = parseLayout(layoutText).filter((d) => d.rooms.length);
    const docked = parseDocked(layoutText);
    const RW = 168, RH = 42, GAP = 12, ROW = RH + 8, LIFT = 10, X0 = 96;
    const fit = (s, n) => (s.length > n ? s.slice(0, n) : s);
    const deckName = (label) => (label.match(/deck\s*\d+/i)?.[0] || label).toUpperCase();
    const placed = {}, corridors = [], stops = [];
    let y = 2, w = X0;
    for (const d of decks) {
      const dock = docked.filter((r) => d.rooms.some((x) => x.id === r.parent));
      if (dock.length) y += ROW;
      const cy = y + RH / 2, end = X0 + d.rooms.length * (RW + GAP) - GAP;
      stops.push(cy);
      corridors.push(`<text class="mm-deck" x="${LIFT + 12}" y="${cy + 5}">${esc(fit(deckName(d.label), 7))}</text><line class="mm-corr" x1="${LIFT}" y1="${cy}" x2="${LIFT + 8}" y2="${cy}"/><line class="mm-corr" x1="${X0 - 8}" y1="${cy}" x2="${end}" y2="${cy}"/>`);
      d.rooms.forEach((r, i) => (placed[r.id] = { x: X0 + i * (RW + GAP), y, label: r.label }));
      for (const r of dock) {
        const p = placed[r.parent];
        placed[r.id] = { x: p.x, y: y - ROW, label: r.label };
        corridors.push(`<line class="mm-corr" x1="${p.x + RW / 2}" y1="${y - ROW + RH}" x2="${p.x + RW / 2}" y2="${y}"/>`);
      }
      w = Math.max(w, end);
      y += ROW;
    }
    const lift = stops.length > 1 ? `<line class="mm-lift" x1="${LIFT}" y1="${stops[0]}" x2="${LIFT}" y2="${stops.at(-1)}"/>` : "";
    const rooms = Object.entries(placed).map(([id, r]) => {
      const pcs = people[id] || [];
      return `<g class="mm-room${pcs.length ? " here" : ""}"><rect x="${r.x}" y="${r.y}" width="${RW}" height="${RH}" rx="4"/>
        <text class="mm-name" x="${r.x + 8}" y="${r.y + (pcs.length ? 18 : 27)}">${esc(fit(r.label.toUpperCase(), 17))}</text>
        ${pcs.length ? `<text class="mm-pcs" x="${r.x + 8}" y="${r.y + 37}">${esc(fit(pcs.join(" "), 17))}</text>` : ""}</g>`;
    }).join("");
    el.innerHTML = decks.length ? `<svg class="mm" viewBox="0 0 ${w + 4} ${y - 6}" role="img" aria-label="Where the crew are">${lift}${corridors.join("")}${rooms}</svg>` : "";
  }

  window.StationMap = { draw, mini, parseLayout, parseLinks, parseDocked, parseLift, choicesFor,
    model: build, tone, liftState, labelFor, isRoster, names, chip, systemsHtml, elsewhereHtml, esc };
})();
