// The station in 3D, seen from above at an angle (isometric): everything the 2D
// view (stationmap.js draw) shows, in the screen's colour. The decks stacked down
// the lift, each deck's rooms either side of its corridor, a docked ship outside the
// room it's docked at, vents and shafts between rooms. A room with a floor plan
// (rooms.js) is built from it: walls, windows, doors and furniture; one without is an
// outline. Over each room: its name, its values (camera first), who's there. Doors,
// cameras and the lift take their value's colour (doors also lie open or stand shut),
// dark decks are dark and flickering ones flicker, quarantined ones red: so the lights,
// the lift and the doors aren't labelled. The station's own systems are listed above the view and
// anything not on the map yet below it, as in the 2D view.
// Drag to turn it, scroll to zoom, right-drag to move it. It starts looking from the
// south, a little east, so the corridors run across the view.
// Used by the Warden console (the map's 3D view: values click to change, room names
// open the room view) and the players' screens (when the Warden shows them the map).
//   const view = IsoMap.mount(el, { station, layout, rooms, people, editable }, { fg, dim, labelPx })
//   view.update(data); view.dispose()
//   people: { roomId: ["ROOK", ...] } (the players' characters, from their terminals)
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";

const DECK_H = 12;       // from one deck down to the next (room to see each deck clear of the next)
const GAP = 1.5;         // between rooms along a corridor
const CORR = 3;          // the corridor's width
const DOCK_GAP = 2.5;    // a docked ship, out from the room it's docked at
const NO_PLAN = [8, 6];  // a room without a floor plan (tiles)
const WALL_H = 1.5;
// Furniture: [height, footprint], one tile each.
const FURN = { T: [0.8, 0.7], B: [0.45, 0.85], K: [0.6, 0.8], S: [0.4, 0.5], L: [1.25, 0.8], C: [0.75, 0.75], M: [1.05, 0.85], R: [1.4, 0.8], P: [0.3, 0.95], X: [0.35, 0.9], V: [0.06, 0.75] };
const TONES = { warn: "#ffb22e", bad: "#ff4a3d", info: "#8a969e" }; // (ok: the screen's colour)
// Which of a room's values is its door, and its camera (as the 2D view decides).
const isDoor = (x) => /door|hatch|airlock|access|gate|lock/i.test(x.leaf.path[0]) || /^door|hatch/i.test(x.label);
const isCam = (x) => /camera|cctv|feed/i.test(x.leaf.path.join("."));
const LIGHTS = /light|power/i, LIFT = /lift|elevator/i; // (a deck's lights and its lift stop, as the 2D view finds them)

// Words over the map, the same size on screen however far it's zoomed (HTML, drawn by CSS2DRenderer).
// right: anchored by its right edge (it reads leftwards from the point), not its middle.
function tag(html, cls, at, { right = false, left = false } = {}) {
  const d = document.createElement("div");
  d.className = `iso-l ${cls}`;
  d.innerHTML = html;
  const o = new CSS2DObject(d);
  o.position.copy(at);
  if (right) o.center.set(1, 0.5);
  if (left) o.center.set(0, 0.5);
  return o;
}

// Where every deck, room, corridor and the lift go (world units; one tile = 1).
function plan(m, data) {
  const decks = m.decks.filter((d) => d.rooms.length);
  const served = m.lift ?? new Set(decks.map((d) => d.id).filter((id) => /^deck_\d+$/.test(id)));
  const size = (id) => {
    const rows = data.rooms?.[id]?.rows;
    return rows?.length ? [rows[0].length, rows.length] : NO_PLAN;
  };
  const rooms = [], deckOut = [];
  decks.forEach((d, di) => {
    const y = -di * DECK_H;
    let xn = 0, xs = 0;
    // Alternate sides of the corridor: north (z < 0), south (z > 0).
    d.rooms.forEach((r, i) => {
      const [w, h] = size(r.id), north = i % 2 === 0;
      const x = north ? xn : xs;
      rooms.push({ ...r, x, z: north ? -CORR / 2 - h : CORR / 2, w, h, y, north, deck: d });
      if (north) xn += w + GAP; else xs += w + GAP;
    });
    deckOut.push({ deck: d, y, len: Math.max(xn, xs) - GAP, served: served.has(d.id) });
  });
  for (const r of m.docked) {
    const p = rooms.find((x) => x.id === r.parent);
    if (!p) continue;
    const [w, h] = size(r.id);
    rooms.push({ ...r, x: p.x + (p.w - w) / 2, z: p.north ? p.z - DOCK_GAP - h : p.z + p.h + DOCK_GAP, w, h, y: p.y, north: p.north, dock: p, deck: p.deck });
  }
  return { rooms, decks: deckOut };
}

function build(data, colors) {
  const SM = window.StationMap, esc = SM.esc;
  const editable = !!data.editable;
  const m = SM.model(data.station || {}, data.layout);
  const P = plan(m, data);
  const group = new THREE.Group();
  const cFg = new THREE.Color(colors.fg), cDim = new THREE.Color(colors.dim);
  const toneColor = (t) => (t === "ok" ? cFg.clone() : new THREE.Color(TONES[t] || TONES.info));
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  boxGeo.translate(0, 0.5, 0); // (sits on the floor)
  // Each deck is drawn as one batch of boxes (so a dark or flickering deck can be dimmed as one).
  const batches = new Map(); // deck id -> [{ x, y, z, w, h, d, color }]
  const flicker = [];
  const box = (deck, x, y, z, w, h, d, color) => (batches.get(deck) || batches.set(deck, []).get(deck)).push({ x, y, z, w, h, d, color });
  const markers = [];
  const deckLooks = new Map(P.decks.map((d) => [d.deck.id, m.deckLook(d.deck)]));

  // ---- decks: the corridor, the deck's name, its own values (lights...), the lift stop
  for (const D of P.decks) {
    const look = deckLooks.get(D.deck.id), id = D.deck.id;
    const red = new THREE.Color(TONES.bad);
    box(id, -2, D.y - 0.15, -CORR / 2, D.len + 2, 0.15, CORR, look.quarantine ? red.clone().multiplyScalar(0.55) : cDim.clone().multiplyScalar(0.55));
    // (Its lights and its lift stop show in the drawing: dimmed or flickering, the stop's colour. Only its other values are labelled.)
    const tags = (m.byDeck.get(id) || []).filter((x) => !LIGHTS.test(x.leaf.path.join(".")) && !LIFT.test(x.leaf.path[0])).map((x) => SM.chip(x.leaf, x.label, editable)).join("");
    const state = look.quarantine ? '<span class="iso-q">QUARANTINE</span>' : "";
    // (its name on two lines, "DECK 2" over "HABITATION / MED BAY": narrower beside the lift)
    const [name, ...what] = D.deck.label.toUpperCase().split(/\s*[·:|]\s*|\s+-\s+/);
    group.add(tag(`<div class="iso-dname">${esc(name)}${state ? ` ${state}` : ""}</div>${what.length ? `<div class="iso-dsub">${esc(what.join(" · "))}</div>` : ""}${tags ? `<div class="mchips">${tags}</div>` : ""}`, "iso-deck", new THREE.Vector3(-7.5, D.y + 0.5, 0), { right: true }));
    // Where the lift meets this deck: its own value's colour (restricted, fault).
    if (D.served) {
      const leaf = (m.byDeck.get(id) || []).find((x) => LIFT.test(x.leaf.path[0]))?.leaf;
      const ls = leaf ? SM.liftState(leaf.value) : "";
      box(id, -6, D.y - 0.15, -1.6, 3.2, 0.5, 3.2, ls ? new THREE.Color(ls === "perm" ? TONES.warn : TONES.bad) : cDim);
      box(id, -2.8, D.y - 0.15, -0.6, 0.8, 0.15, 1.2, cDim.clone().multiplyScalar(0.55)); // (to the corridor)
    }
    if (look.flicker) flicker.push(id);
  }
  // The lift shaft, from the top deck it reaches to the bottom: coloured when the whole lift is out.
  const stops = P.decks.filter((d) => d.served).map((d) => d.y);
  if (stops.length) {
    const whole = [...(m.systems.get("lift") || []), ...(m.systems.get("elevator") || [])];
    const ws = whole.map((l) => SM.liftState(l.value)).find(Boolean) || "";
    const top = Math.max(...stops), bottom = Math.min(...stops);
    box("_lift", -5.2, bottom - 0.3, -0.8, 1.6, top - bottom + WALL_H + 0.6, 1.6, ws ? new THREE.Color(ws === "perm" ? TONES.warn : TONES.bad) : cDim);
    group.add(tag("LIFT", "iso-small", new THREE.Vector3(-4.4, top + WALL_H + 1.4, 0)));
  }

  // ---- rooms
  const placed = {};
  for (const r of P.rooms) {
    placed[r.id] = r;
    const deck = r.deck.id, look = deckLooks.get(deck) || {};
    const items = m.byRoom.get(r.id) || [];
    const door = items.find(isDoor)?.leaf, cam = items.find(isCam)?.leaf;
    const values = items.filter((x) => !SM.isRoster(x.leaf));
    // (The door shows in the drawing: its colour, open or shut. The rest are labelled, camera first.)
    const rest = [...values.filter((x) => x.leaf === cam), ...values.filter((x) => x.leaf !== door && x.leaf !== cam)];
    const alarm = values.some((x) => SM.tone(x.leaf.path, x.leaf.value) === "bad");
    const who = SM.names(items.find((x) => x.leaf.path[0] === "occupants")?.leaf.value);
    const what = SM.names(items.find((x) => x.leaf.path[0] === "contents")?.leaf.value);
    const pcs = data.people?.[r.id] || [];
    const wall = alarm ? cFg.clone().lerp(new THREE.Color(TONES.bad), 0.6) : cFg.clone();
    const floor = pcs.length ? cFg.clone().multiplyScalar(0.55) : cDim.clone().multiplyScalar(0.7);
    if (look.quarantine) floor.lerp(new THREE.Color(TONES.bad), 0.3);
    // The door's colour and how far it's shut: open lies flat, closed stands, locked (or worse) stands tall.
    const dt = door ? SM.tone(door.path, door.value) : "";
    const open = door && /OPEN/i.test(String(door.value));
    const doorColor = door ? toneColor(dt).lerp(new THREE.Color("#ffffff"), dt === "ok" ? 0.35 : 0) : new THREE.Color("#ffffff").lerp(cFg, 0.4);
    const doorH = open ? 0.08 : dt === "bad" ? WALL_H * 0.9 : 0.55;
    const rows = data.rooms?.[r.id]?.rows;
    if (rows?.length) {
      rows.forEach((row, j) => [...row].forEach((ch, i) => {
        const x = r.x + i, z = r.z + j;
        if (ch === " ") return;
        if (ch === "#") return box(deck, x, r.y, z, 1, WALL_H, 1, wall);
        if (ch === "W") { box(deck, x, r.y, z, 1, 0.55, 1, wall); box(deck, x, r.y + 0.55, z, 1, WALL_H - 0.55, 1, wall.clone().multiplyScalar(0.3)); return; }
        box(deck, x, r.y - 0.12, z, 1, 0.12, 1, floor);
        if (ch === "D" || ch === "H") return box(deck, x + 0.08, r.y, z + 0.08, 0.84, ch === "H" && !open ? doorH + 0.15 : doorH, 0.84, doorColor);
        const f = FURN[ch];
        if (f) { const mg = (1 - f[1]) / 2; box(deck, x + mg, r.y, z + mg, f[1], f[0], f[1], cFg.clone().multiplyScalar(ch === "R" ? 1.2 : 0.8)); }
      }));
    } else {
      box(deck, r.x, r.y - 0.12, r.z, r.w, 0.12, r.h, floor);
      for (const [x, z, w, d] of [[r.x, r.z, r.w, 0.3], [r.x, r.z + r.h - 0.3, r.w, 0.3], [r.x, r.z, 0.3, r.h], [r.x + r.w - 0.3, r.z, 0.3, r.h]]) box(deck, x, r.y, z, w, 0.6, d, wall);
      // (its door, in the wall it opens through: towards the corridor, or the room it's docked at)
      const dz = r.north ? r.z + r.h - 0.3 : r.z;
      box(deck, r.x + r.w / 2 - 0.7, r.y, dz - 0.05, 1.4, Math.max(doorH, 0.1), 0.4, doorColor);
    }
    // Its camera, up on the back wall: the camera value's colour.
    if (cam) {
      const back = r.north ? r.z + 0.2 : r.z + r.h - 0.8;
      box(deck, r.x + r.w - 1.2, r.y + WALL_H, back, 0.7, 0.45, 0.6, toneColor(SM.tone(cam.path, cam.value)));
    }
    // The way in: a docking collar to the parent room, or a doorway onto the corridor.
    if (r.dock) {
      const p = r.dock, z0 = r.north ? r.z + r.h : p.z + p.h, z1 = r.north ? p.z : r.z;
      box(deck, r.x + r.w / 2 - 0.6, r.y, Math.min(z0, z1), 1.2, 0.9, Math.abs(z1 - z0), cDim);
    } else {
      const z0 = r.north ? r.z + r.h : -CORR / 2, z1 = r.north ? -CORR / 2 : r.z;
      if (z1 > z0) box(deck, r.x + r.w / 2 - 0.5, r.y - 0.12, z0, 1, 0.12, z1 - z0, cDim.clone().multiplyScalar(0.55));
    }
    // Over the room: its name (the Warden: click for the room view), values (camera first,
    // two of them, then how many more), and who and what is there (counted; listed on hover).
    const roster = [...pcs.map((n) => `${n} (player)`), ...who, ...(what.length ? ["-", ...what] : [])].join("\n");
    const more = rest.slice(2).map((x) => `${x.label} ${x.leaf.value}`).join("\n");
    const counts = [pcs.length && `<span class="pc">${pcs.length}&#9670;</span>`, who.length && `${who.length}&#9679;`, what.length && `${what.length}&#9642;`].filter(Boolean).join(" ");
    const head = editable ? ` data-room="${esc(r.id)}" data-label="${esc(r.label)}" data-deck="${esc(r.dock ? `docked at ${r.dock.label}` : r.deck.label)}"` : "";
    group.add(tag(`<div class="iso-name"${head} title="${esc(`${r.label}${editable ? " (click for the room view)" : ""}${roster ? `\n${roster}` : ""}`)}">${esc(r.label.toUpperCase())}</div>
      ${rest.length ? `<div class="mchips">${rest.slice(0, 2).map((x) => SM.chip(x.leaf, x.label, editable)).join("")}${rest.length > 2 ? `<span class="iso-more" title="${esc(more)}">+${rest.length - 2}</span>` : ""}</div>` : ""}
      ${counts ? `<div class="iso-people" title="${esc(roster)}">${counts}</div>` : ""}`,
    `iso-room${pcs.length ? " here" : ""}${alarm ? " alarm" : ""}`, new THREE.Vector3(r.x + r.w / 2, r.y + WALL_H + 1.2, r.z + r.h / 2)));
    if (/airlock/.test(r.id)) group.add(tag("&#9656; SPACE", "iso-small iso-space", new THREE.Vector3(r.x + r.w / 2, r.y + 0.4, r.north ? r.z - 1.2 : r.z + r.h + 1.2)));
    // The players' characters there: a marker and their names.
    if (pcs.length) {
      const mk = new THREE.Mesh(new THREE.OctahedronGeometry(0.6), new THREE.MeshLambertMaterial({ color: new THREE.Color("#ffffff").lerp(cFg, 0.3) }));
      mk.position.set(r.x + r.w / 2, r.y + WALL_H + 3.4, r.z + r.h / 2);
      mk.userData.y = mk.position.y;
      markers.push(mk);
      group.add(mk);
      group.add(tag(esc(pcs.join(" ")), "iso-who", new THREE.Vector3(r.x + r.w / 2, r.y + WALL_H + 4.6, r.z + r.h / 2)));
    }
  }

  // ---- vents, ducts, maintenance shafts: dashed arcs between the rooms they join
  for (const l of m.links) {
    const a = placed[l.a], b = placed[l.b];
    if (!a || !b) continue;
    const pa = new THREE.Vector3(a.x + a.w / 2, a.y + 0.4, a.z + a.h / 2), pb = new THREE.Vector3(b.x + b.w / 2, b.y + 0.4, b.z + b.h / 2);
    const mid = pa.clone().add(pb).multiplyScalar(0.5).add(new THREE.Vector3(Math.max(a.x + a.w, b.x + b.w) - (pa.x + pb.x) / 2 + 6, 2, 0));
    const curve = new THREE.QuadraticBezierCurve3(pa, mid, pb);
    const vent = /vent|duct|air/i.test(l.label);
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(48)), new THREE.LineDashedMaterial({ color: vent ? new THREE.Color(TONES.warn).lerp(cDim, 0.4) : new THREE.Color(TONES.info), dashSize: vent ? 0.9 : 0.3, gapSize: 0.5 }));
    line.computeLineDistances();
    group.add(line);
    if (l.label) group.add(tag(esc(l.label.toUpperCase()), "iso-small iso-link", curve.getPoint(0.5).add(new THREE.Vector3(0.6, 0, 0)), { left: true }));
  }

  // ---- the boxes: one batch per deck, dimmed when the deck's dark
  const mats = new Map();
  for (const [id, list] of batches) {
    const look = deckLooks.get(id) || {};
    const mat = new THREE.MeshLambertMaterial({ color: new THREE.Color(1, 1, 1).multiplyScalar(look.dark ? 0.35 : 1) });
    mats.set(id, mat);
    const mesh = new THREE.InstancedMesh(boxGeo, mat, list.length);
    const m4 = new THREE.Matrix4();
    list.forEach((b, i) => {
      m4.makeScale(b.w, b.h, b.d).setPosition(b.x + b.w / 2, b.y, b.z + b.d / 2);
      mesh.setMatrixAt(i, m4);
      mesh.setColorAt(i, b.color);
    });
    group.add(mesh);
  }
  return { group, markers, flicker: flicker.map((id) => mats.get(id)).filter(Boolean), m };
}

function dispose(obj) {
  obj.traverse((o) => {
    o.element?.remove(); // (a label)
    o.geometry?.dispose();
    for (const mt of [].concat(o.material || [])) { mt.map?.dispose(); mt.dispose(); }
  });
}

export function mount(el, data, opts = {}) {
  const css = getComputedStyle(el);
  const colors = { fg: opts.fg || css.getPropertyValue("--fg").trim() || "#3bff7a", dim: opts.dim || css.getPropertyValue("--dim").trim() || "#1d8a43" };
  // The station's systems above the view, anything not on the map yet below it (as in the 2D view).
  const wrap = document.createElement("div");
  wrap.className = "iso-wrap";
  wrap.innerHTML = '<div class="iso-sys"></div><div class="iso-view"></div><div class="iso-else"></div>';
  el.append(wrap);
  const [sysEl, view, elseEl] = wrap.children;
  view.style.setProperty("--iso-fg", colors.fg);
  view.style.setProperty("--iso-dim", colors.dim);
  view.style.setProperty("--iso-px", `${opts.labelPx || 15}px`);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  view.append(renderer.domElement);
  renderer.domElement.style.cssText = "display: block; width: 100%; height: 100%; touch-action: none;";
  const words = new CSS2DRenderer(); // (the labels, over the drawing)
  words.domElement.style.cssText = "position: absolute; inset: 0; pointer-events: none; overflow: hidden;";
  view.append(words.domElement);
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 0.4));
  const sun = new THREE.DirectionalLight(0xffffff, 0.9);
  sun.position.set(-0.6, 1, 0.35);
  scene.add(sun);
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, -500, 500);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.minPolarAngle = controls.maxPolarAngle = Math.atan(Math.SQRT2); // (the isometric tilt, turning only around)
  controls.minZoom = 0.4;
  controls.maxZoom = 8;
  let built = null, shapeKey = "", fit = { w: 20, h: 20 };

  // Frame everything: looking down at the isometric angle, from the south and a little east
  // (so the corridors run across the view and the decks stack down it), with the whole
  // station in view (measured as the camera sees it).
  const TILT = Math.atan(1 / Math.SQRT2), TURN = (25 * Math.PI) / 180;
  function frame() {
    const bb = new THREE.Box3().setFromObject(built.group);
    bb.min.x -= 12; // (the decks' names, reading leftwards from the lift)
    const c = bb.getCenter(new THREE.Vector3());
    controls.target.copy(c);
    camera.position.copy(c).add(new THREE.Vector3(Math.sin(TURN) * Math.cos(TILT), Math.sin(TILT), Math.cos(TURN) * Math.cos(TILT)).multiplyScalar(200));
    camera.lookAt(c);
    camera.updateMatrixWorld();
    let w = 0, h = 0;
    for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) {
      const p = new THREE.Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse);
      w = Math.max(w, Math.abs(p.x)); h = Math.max(h, Math.abs(p.y));
    }
    fit = { w: w * 2.1, h: h * 2.15 };
    camera.zoom = 1;
    resize();
  }
  function resize() {
    const w = view.clientWidth || 1, h = view.clientHeight || 1, a = w / h;
    renderer.setSize(w, h, false);
    words.setSize(w, h);
    const ch = Math.max(fit.h, fit.w / a); // (as tall as needed to fit both ways)
    camera.left = -ch * a / 2; camera.right = ch * a / 2; camera.top = ch / 2; camera.bottom = -ch / 2;
    camera.updateProjectionMatrix();
  }
  function update(next) {
    data = next;
    if (built) { scene.remove(built.group); dispose(built.group); }
    built = build(data, colors);
    scene.add(built.group);
    sysEl.innerHTML = window.StationMap.systemsHtml(built.m, !!data.editable);
    elseEl.innerHTML = window.StationMap.elsewhereHtml(built.m, !!data.editable);
    // (Re-framed only when the station's shape changes, not when a value changes or someone moves.)
    const key = JSON.stringify([data.layout, data.rooms]);
    if (key !== shapeKey) { shapeKey = key; requestAnimationFrame(frame); }
  }
  update(data);
  const ro = new ResizeObserver(resize);
  ro.observe(view);
  let raf = 0;
  const loop = (t) => {
    raf = requestAnimationFrame(loop);
    for (const mk of built.markers) { mk.rotation.y = t / 700; mk.position.y = mk.userData.y + Math.sin(t / 300) * 0.15; }
    // A flickering deck's lights: mostly on, now and then off for a moment.
    const ph = (t / 2600) % 1, off = (ph > 0.07 && ph < 0.09) || (ph > 0.54 && ph < 0.56);
    for (const mt of built.flicker) mt.color.setScalar(off ? 0.3 : 1);
    controls.update();
    renderer.render(scene, camera);
    words.render(scene, camera);
  };
  raf = requestAnimationFrame(loop);
  return {
    update,
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      if (built) dispose(built.group);
      renderer.dispose();
      wrap.remove();
    },
  };
}

window.IsoMap = { mount };
