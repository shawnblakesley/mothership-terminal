// The station in 3D, seen from above at an angle (isometric), in the screen's
// colour: the decks stacked down the lift, each deck's rooms either side of its
// corridor, a docked ship outside the room it's docked at. A room with a floor
// plan (rooms.js) is built from it: walls, windows, doors and furniture; one
// without is an outline. Where the players are is marked over the room.
// Drag to turn it, scroll to zoom, right-drag to move it.
// Used by the Warden console (the map's 3D view) and the players' screens (when
// the Warden shows them the map). The layout comes from stationmap.js.
//   const view = IsoMap.mount(el, { layout, rooms, people }, { fg, dim, labelPx })
//   view.update(data); view.dispose()
//   people: { roomId: ["ROOK", ...] }
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";

const DECK_H = 16;       // from one deck down to the next (room to see each deck clear of the next)
const GAP = 1.5;         // between rooms along a corridor
const CORR = 3;          // the corridor's width
const DOCK_GAP = 2.5;    // a docked ship, out from the room it's docked at
const NO_PLAN = [8, 6];  // a room without a floor plan (tiles)
const WALL_H = 1.5;
// Furniture: [height, footprint], one tile each.
const FURN = { T: [0.8, 0.7], B: [0.45, 0.85], K: [0.6, 0.8], S: [0.4, 0.5], L: [1.25, 0.8], C: [0.75, 0.75], M: [1.05, 0.85], R: [1.4, 0.8], P: [0.3, 0.95], X: [0.35, 0.9], V: [0.06, 0.75] };

// Words over the map, the same size on screen however far it's zoomed (HTML, drawn by CSS2DRenderer).
//   look: "room" | "here" (a room the players are in) | "deck" | "who" (the players' names)
function label(text, look, { fg, dim, px = 15 }) {
  const d = document.createElement("div");
  d.textContent = text;
  const base = `font: ${px}px/1 VT323, Consolas, monospace;`
    + " letter-spacing: 0.06em; white-space: nowrap; pointer-events: none; padding: 1px 4px;";
  d.style.cssText = base + {
    room: `color: ${fg}; text-shadow: 0 0 4px #000, 0 0 2px #000;`,
    here: `color: #fff; text-shadow: 0 0 6px ${fg}, 0 0 2px #000;`,
    deck: `color: ${dim}; font-size: ${px + 2}px; text-shadow: 0 0 3px #000;`,
    who: `color: #050805; background: ${fg}; font-size: ${px + 1}px; box-shadow: 0 0 8px ${fg};`,
  }[look];
  return new CSS2DObject(d);
}

// Where every deck, room, corridor and the lift go (world units; one tile = 1).
function plan(data) {
  const SM = window.StationMap;
  const decks = SM.parseLayout(data.layout).filter((d) => d.rooms.length);
  const docked = SM.parseDocked(data.layout);
  const served = SM.parseLift(data.layout) ?? new Set(decks.map((d) => d.id).filter((id) => /^deck_\d+$/.test(id)));
  const size = (id) => {
    const rows = data.rooms?.[id]?.rows;
    return rows?.length ? [rows[0].length, rows.length] : NO_PLAN;
  };
  const rooms = [], corridors = [], deckTags = [], stops = [];
  decks.forEach((d, di) => {
    const y = -di * DECK_H;
    let xn = 0, xs = 0;
    // Alternate sides of the corridor: north (z < 0), south (z > 0).
    d.rooms.forEach((r, i) => {
      const [w, h] = size(r.id), north = i % 2 === 0;
      const x = north ? xn : xs;
      const z = north ? -CORR / 2 - h : CORR / 2;
      rooms.push({ ...r, x, z, w, h, y, north });
      if (north) xn += w + GAP; else xs += w + GAP;
    });
    const len = Math.max(xn, xs) - GAP;
    corridors.push({ x: -2, z: -CORR / 2, w: len + 2, h: CORR, y });
    deckTags.push({ text: (d.label.match(/deck\s*\d+/i)?.[0] || d.label).toUpperCase(), x: -3, y, z: 0 });
    if (served.has(d.id)) stops.push(y);
  });
  for (const r of docked) {
    const p = rooms.find((x) => x.id === r.parent);
    if (!p) continue;
    const [w, h] = size(r.id);
    const x = p.x + (p.w - w) / 2;
    const z = p.north ? p.z - DOCK_GAP - h : p.z + p.h + DOCK_GAP;
    rooms.push({ ...r, x, z, w, h, y: p.y, north: p.north, dock: p });
  }
  return { rooms, corridors, deckTags, lift: stops.length ? { top: stops[0], bottom: stops.at(-1) } : null };
}

function build(data, colors) {
  const { fg, dim } = colors;
  const group = new THREE.Group();
  const P = plan(data);
  const cFg = new THREE.Color(fg), cDim = new THREE.Color(dim);
  const mat = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  boxGeo.translate(0, 0.5, 0); // (sits on the floor)
  // Many boxes in one draw: each with its own place, size and colour.
  const boxes = [];
  const box = (x, y, z, w, h, d, color) => boxes.push({ x, y, z, w, h, d, color });
  const markers = [];

  for (const c of P.corridors) box(c.x, c.y - 0.15, c.z, c.w, 0.15, c.h, cDim.clone().multiplyScalar(0.55));
  for (const r of P.rooms) {
    const here = data.people?.[r.id] || [];
    const rows = data.rooms?.[r.id]?.rows;
    const floor = here.length ? cFg.clone().multiplyScalar(0.55) : cDim.clone().multiplyScalar(0.7);
    if (rows?.length) {
      rows.forEach((row, j) => [...row].forEach((ch, i) => {
        const x = r.x + i, z = r.z + j;
        if (ch === " ") return;
        if (ch === "#") return box(x, r.y, z, 1, WALL_H, 1, cFg);
        if (ch === "W") { box(x, r.y, z, 1, 0.55, 1, cFg); box(x, r.y + 0.55, z, 1, WALL_H - 0.55, 1, cFg.clone().multiplyScalar(0.3)); return; }
        box(x, r.y - 0.12, z, 1, 0.12, 1, floor);
        if (ch === "D" || ch === "H") return box(x + 0.1, r.y, z + 0.1, 0.8, ch === "H" ? 0.35 : 0.2, 0.8, new THREE.Color("#ffffff").lerp(cFg, 0.4));
        const f = FURN[ch];
        if (f) { const m = (1 - f[1]) / 2; box(x + m, r.y, z + m, f[1], f[0], f[1], cFg.clone().multiplyScalar(ch === "R" ? 1.2 : 0.8)); }
      }));
    } else {
      box(r.x, r.y - 0.12, r.z, r.w, 0.12, r.h, floor);
      for (const [x, z, w, d] of [[r.x, r.z, r.w, 0.3], [r.x, r.z + r.h - 0.3, r.w, 0.3], [r.x, r.z, 0.3, r.h], [r.x + r.w - 0.3, r.z, 0.3, r.h]]) box(x, r.y, z, w, 0.6, d, cFg);
    }
    // The way in: a docking collar to the parent room, or a doorway onto the corridor.
    if (r.dock) {
      const p = r.dock, z0 = r.north ? r.z + r.h : p.z + p.h, z1 = r.north ? p.z : r.z;
      box(r.x + r.w / 2 - 0.6, r.y, Math.min(z0, z1), 1.2, 0.9, Math.abs(z1 - z0), cDim);
    } else {
      const z0 = r.north ? r.z + r.h : -CORR / 2, z1 = r.north ? -CORR / 2 : r.z;
      if (z1 > z0) box(r.x + r.w / 2 - 0.5, r.y - 0.12, z0, 1, 0.12, z1 - z0, cDim.clone().multiplyScalar(0.55));
    }
    const name = label(r.label.toUpperCase(), here.length ? "here" : "room", colors);
    name.position.set(r.x + r.w / 2, r.y + WALL_H + 1.1, r.z + r.h / 2);
    group.add(name);
    if (here.length) {
      const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.6), mat(new THREE.Color("#ffffff").lerp(cFg, 0.3)));
      m.position.set(r.x + r.w / 2, r.y + WALL_H + 2.6, r.z + r.h / 2);
      m.userData.y = m.position.y;
      markers.push(m);
      group.add(m);
      const who = label(here.join(" "), "who", colors);
      who.position.set(r.x + r.w / 2, r.y + WALL_H + 3.7, r.z + r.h / 2);
      group.add(who);
    }
  }
  for (const t of P.deckTags) {
    const s = label(t.text, "deck", colors);
    s.position.set(t.x - 2.5, t.y + 0.6, t.z);
    group.add(s);
  }
  if (P.lift) box(-5.5, P.lift.bottom - 0.3, -1, 2, P.lift.top - P.lift.bottom + WALL_H + 0.3, 2, cDim);

  const mesh = new THREE.InstancedMesh(boxGeo, mat(0xffffff), boxes.length);
  const m4 = new THREE.Matrix4();
  boxes.forEach((b, i) => {
    m4.makeScale(b.w, b.h, b.d).setPosition(b.x + b.w / 2, b.y, b.z + b.d / 2);
    mesh.setMatrixAt(i, m4);
    mesh.setColorAt(i, b.color);
  });
  group.add(mesh);
  return { group, markers };
}

function dispose(obj) {
  obj.traverse((o) => {
    o.element?.remove(); // (a label)
    o.geometry?.dispose();
    for (const m of [].concat(o.material || [])) { m.map?.dispose(); m.dispose(); }
  });
}

export function mount(el, data, opts = {}) {
  const css = getComputedStyle(el);
  const colors = { fg: opts.fg || css.getPropertyValue("--fg").trim() || "#3bff7a", dim: opts.dim || css.getPropertyValue("--dim").trim() || "#1d8a43", px: opts.labelPx || 15 };
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  el.append(renderer.domElement);
  renderer.domElement.style.cssText = "display: block; width: 100%; height: 100%; touch-action: none;";
  const words = new CSS2DRenderer(); // (the labels, over the drawing)
  words.domElement.style.cssText = "position: absolute; inset: 0; pointer-events: none; overflow: hidden;";
  if (getComputedStyle(el).position === "static") el.style.position = "relative";
  el.append(words.domElement);
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
  controls.maxZoom = 6;
  let built = null, shapeKey = "", fit = { w: 20, h: 20 };

  // Frame everything: looking down at the isometric angle, from the south-east,
  // with the whole station in view (measured as the camera sees it).
  function frame() {
    const bb = new THREE.Box3().setFromObject(built.group), c = bb.getCenter(new THREE.Vector3());
    controls.target.copy(c);
    camera.position.copy(c).add(new THREE.Vector3(1, Math.SQRT2, 1).normalize().multiplyScalar(200));
    camera.lookAt(c);
    camera.updateMatrixWorld();
    let w = 0, h = 0;
    for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) {
      const p = new THREE.Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse);
      w = Math.max(w, Math.abs(p.x)); h = Math.max(h, Math.abs(p.y));
    }
    fit = { w: w * 2.1, h: h * 2.1 };
    camera.zoom = 1;
    resize();
  }
  function resize() {
    const w = el.clientWidth || 1, h = el.clientHeight || 1, a = w / h;
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
    // (Re-framed only when the station's shape changes, not when someone moves.)
    const key = JSON.stringify([data.layout, data.rooms]);
    if (key !== shapeKey) { shapeKey = key; frame(); }
  }
  update(data);
  const ro = new ResizeObserver(resize);
  ro.observe(el);
  let raf = 0;
  const loop = (t) => {
    raf = requestAnimationFrame(loop);
    for (const m of built.markers) { m.rotation.y = t / 700; m.position.y = m.userData.y + Math.sin(t / 300) * 0.15; }
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
      renderer.domElement.remove();
      words.domElement.remove();
    },
  };
}

window.IsoMap = { mount };
