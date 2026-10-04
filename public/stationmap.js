// The Warden's station map: the station state drawn as decks and rooms, with
// every value on it. Layout is the Warden's text (one line per deck):
//   Deck 2 · Habitation / Med Bay: med_bay=Med Bay, galley
// A room id matches station state keys anywhere in a path (doors.med_bay,
// cameras.med_bay...); a deck id (deck_2, from "Deck 2") matches deck-wide keys
// (lights.deck_2). Values that belong to no room or deck are shown as systems,
// so nothing in the state is left off. Exposes window.StationMap.
(() => {
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const slug = (s) => String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const human = (id) => String(id).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const singular = (w) => (w === "lights" ? w : /ies$/.test(w) ? w.replace(/ies$/, "y") : /(ss|us)$/.test(w) ? w : w.replace(/s$/, ""));

  // "Deck 1 · Command: command_deck=Command, airlock_a" -> { id: "deck_1", label, rooms: [{ id, label }] }
  function parseLayout(text) {
    return String(text || "").split("\n").map((line) => line.trim()).filter((l) => l && !l.startsWith("#")).map((line) => {
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
    if (/LOCK|SEAL|OFFLINE|^OFF$|JAM|FAIL|BREACH|DOWN|ARMED|CRITICAL|DANGER|ALERT|VENT|DEAD|DENIED|EMERGENCY|DESTROY|CONTAMIN|INFECT|^ACTIVE$|DECK\s*\d/.test(v)) return "bad";
    if (/FLICKER|DEGRAD|STANDBY|LOW|PARTIAL|UNKNOWN|ELEVATED|WARN|CLOSED|DAMAGED|INTERMITTENT/.test(v)) return "warn";
    return "info";
  }

  // A clickable value: "DOOR LOCKED".
  function chip(leaf, label, editable) {
    const t = tone(leaf.path, leaf.value);
    const pct = typeof leaf.value === "number" && /pct|percent/.test(leaf.path.join(".").toLowerCase());
    return `<button class="mchip ${t}" data-path="${esc(JSON.stringify(leaf.path))}" ${editable ? "" : "disabled"} title="${esc(leaf.path.join("."))}">
      <span class="mk">${esc(label)}</span><span class="mv">${esc(leaf.value)}${pct ? "%" : ""}</span>
      ${pct ? `<i class="bar" style="--p:${Math.max(0, Math.min(100, leaf.value))}%"></i>` : ""}</button>`;
  }

  function render(el, station, layoutText, { editable = true } = {}) {
    const decks = parseLayout(layoutText);
    const all = leaves(station);
    const roomIds = new Map(decks.flatMap((d) => d.rooms.map((r) => [r.id, r])));
    const deckIds = new Map(decks.map((d) => [d.id, d]));
    const byRoom = new Map(), byDeck = new Map(), loose = [];
    for (const leaf of all) {
      const segs = leaf.path.map(slug);
      const room = segs.find((s) => roomIds.has(s));
      const deck = !room && segs.find((s) => deckIds.has(s));
      if (room) (byRoom.get(room) || byRoom.set(room, []).get(room)).push({ leaf, label: labelFor(leaf.path, room) });
      else if (deck) (byDeck.get(deck) || byDeck.set(deck, []).get(deck)).push({ leaf, label: labelFor(leaf.path, deck) });
      else loose.push(leaf);
    }
    // Location-like values not on the map yet (a new door the agent added): an
    // "Elsewhere" deck, one room each. Everything else is a station system.
    const placedCats = new Set([...byRoom.values(), ...byDeck.values()].flat().map((x) => x.leaf.path[0]));
    const elsewhere = new Map(), systems = new Map();
    for (const leaf of loose) {
      if (leaf.path.length >= 2 && placedCats.has(leaf.path[0])) {
        const id = leaf.path[1];
        (elsewhere.get(id) || elsewhere.set(id, []).get(id)).push({ leaf, label: labelFor(leaf.path, id) });
      } else {
        const group = leaf.path.length > 1 ? leaf.path[0] : "";
        (systems.get(group) || systems.set(group, []).get(group)).push(leaf);
      }
    }
    const quarantined = String(station?.quarantine ?? "").toUpperCase();
    const deckState = (d) => {
      const lights = (byDeck.get(d.id) || []).find((x) => /light|power/i.test(x.leaf.path.join(".")));
      const v = String(lights?.leaf.value ?? "").toUpperCase();
      const n = d.id.match(/deck_(\d+)/)?.[1];
      return [
        v === "OFF" || v === "DARK" ? "dark" : "",
        /FLICKER/.test(v) ? "flicker" : "",
        n && new RegExp(`DECK\\s*${n}\\b`).test(quarantined) ? "quarantine" : "",
      ].join(" ");
    };
    const roomTile = (id, label, items) => `<div class="mroom ${items.some((x) => tone(x.leaf.path, x.leaf.value) === "bad") ? "alarm" : ""}">
        <div class="mrname">${esc(label)}</div>
        <div class="mchips">${items.map((x) => chip(x.leaf, x.label, editable)).join("") || `<span class="mnone">no data</span>`}</div>
      </div>`;
    const deckBand = (d, rooms) => `<section class="mdeck ${deckState(d)}">
        <header><span class="mdname">${esc(d.label)}</span><span class="mchips">${(byDeck.get(d.id) || []).map((x) => chip(x.leaf, x.label, editable)).join("")}</span></header>
        <div class="mrooms">${rooms}</div>
      </section>`;

    const sys = [...systems.entries()].map(([group, items]) => `<div class="msys">
        <div class="msname">${esc(group ? human(group) : "Station")}</div>
        <div class="mchips">${items.map((leaf) => chip(leaf, labelFor(leaf.path.slice(group ? 1 : 0)), editable)).join("")}</div>
      </div>`).join("");
    el.innerHTML = `
      <div class="msystems">${sys}</div>
      <div class="mdecks">
        ${decks.map((d) => deckBand(d, d.rooms.map((r) => roomTile(r.id, r.label, byRoom.get(r.id) || [])).join(""))).join("")}
        ${elsewhere.size ? deckBand({ id: "_elsewhere", label: "Not on the map yet" }, [...elsewhere.entries()].map(([id, items]) => roomTile(id, human(id), items)).join("")) : ""}
      </div>`;
  }

  // "doors.med_bay" in room med_bay -> "DOOR"; "life_support.oxygen_pct" -> "OXYGEN PCT"
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

  window.StationMap = { render, parseLayout, choicesFor };
})();
