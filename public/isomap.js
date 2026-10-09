import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { frustum, labelScale } from "./isofit.js";

const DECK_H = 12;
const GAP = 1.5;
const CORR = 3;
const DOCK_GAP = 2.5;
const NO_PLAN = [8, 6];
const WALL_H = 1.5;
const FURN = { T: [0.8, 0.7], B: [0.45, 0.85], K: [0.6, 0.8], S: [0.4, 0.5], L: [1.25, 0.8], C: [0.75, 0.75], M: [1.05, 0.85], R: [1.4, 0.8], P: [0.3, 0.95], X: [0.35, 0.9], V: [0.06, 0.75] };
const TONES = { warn: "#ffb22e", bad: "#ff4a3d", info: "#8a969e" };
const isDoor = (x) => /door|hatch|airlock|access|gate|lock/i.test(x.leaf.path[0]) || /^door|hatch/i.test(x.label);
const isCam = (x) => /camera|cctv|feed/i.test(x.leaf.path.join("."));
const LIGHTS = /light|power/i, LIFT = /lift|elevator/i;

function tag(html, cls, at, { right = false, left = false, units = 0 } = {}) {
  const d = document.createElement("div");
  d.className = `iso-l ${cls}`;
  if (units) d.style.setProperty("--u", units);
  d.innerHTML = html;
  const o = new CSS2DObject(d);
  o.position.copy(at);
  if (right) o.center.set(1, 0.5);
  if (left) o.center.set(0, 0.5);
  return o;
}

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
  boxGeo.translate(0, 0.5, 0);
  const batches = new Map();
  const flicker = [];
  const box = (deck, x, y, z, w, h, d, color) => (batches.get(deck) || batches.set(deck, []).get(deck)).push({ x, y, z, w, h, d, color });
  const markers = [];
  const deckLooks = new Map(P.decks.map((d) => [d.deck.id, m.deckLook(d.deck)]));

  for (const D of P.decks) {
    const look = deckLooks.get(D.deck.id), id = D.deck.id;
    const red = new THREE.Color(TONES.bad);
    box(id, -2, D.y - 0.15, -CORR / 2, D.len + 2, 0.15, CORR, look.quarantine ? red.clone().multiplyScalar(0.55) : cDim.clone().multiplyScalar(0.55));
    const tags = (m.byDeck.get(id) || []).filter((x) => !LIGHTS.test(x.leaf.path.join(".")) && !LIFT.test(x.leaf.path[0])).map((x) => SM.chip(x.leaf, x.label, editable)).join("");
    const state = look.quarantine ? '<span class="iso-q">QUARANTINE</span>' : "";
    const [name, ...what] = D.deck.label.toUpperCase().split(/\s*[·:|]\s*|\s+-\s+/);
    group.add(tag(`<div class="iso-dname">${esc(name)}${state ? ` ${state}` : ""}</div>${what.length ? `<div class="iso-dsub">${esc(what.join(" · "))}</div>` : ""}${tags ? `<div class="mchips">${tags}</div>` : ""}`, "iso-deck", new THREE.Vector3(-7.5, D.y + 0.5, 0), { right: true }));
    if (D.served) {
      const leaf = (m.byDeck.get(id) || []).find((x) => LIFT.test(x.leaf.path[0]))?.leaf;
      const ls = leaf ? SM.liftState(leaf.value) : "";
      box(id, -6, D.y - 0.15, -1.6, 3.2, 0.5, 3.2, ls ? new THREE.Color(ls === "perm" ? TONES.warn : TONES.bad) : cDim);
      box(id, -2.8, D.y - 0.15, -0.6, 0.8, 0.15, 1.2, cDim.clone().multiplyScalar(0.55));
    }
    if (look.flicker) flicker.push(id);
  }
  const stops = P.decks.filter((d) => d.served).map((d) => d.y);
  if (stops.length) {
    const whole = [...(m.systems.get("lift") || []), ...(m.systems.get("elevator") || [])];
    const ws = whole.map((l) => SM.liftState(l.value)).find(Boolean) || "";
    const top = Math.max(...stops), bottom = Math.min(...stops);
    box("_lift", -5.2, bottom - 0.3, -0.8, 1.6, top - bottom + WALL_H + 0.6, 1.6, ws ? new THREE.Color(ws === "perm" ? TONES.warn : TONES.bad) : cDim);
    group.add(tag("LIFT", "iso-small", new THREE.Vector3(-4.4, top + WALL_H + 1.4, 0)));
  }

  const placed = {};
  for (const r of P.rooms) {
    placed[r.id] = r;
    const deck = r.deck.id, look = deckLooks.get(deck) || {};
    const items = m.byRoom.get(r.id) || [];
    const door = items.find(isDoor)?.leaf, cam = items.find(isCam)?.leaf;
    const values = items.filter((x) => !SM.isRoster(x.leaf));
    const rest = [...values.filter((x) => x.leaf === cam), ...values.filter((x) => x.leaf !== door && x.leaf !== cam)];
    const alarm = values.some((x) => SM.tone(x.leaf.path, x.leaf.value) === "bad");
    const who = SM.names(items.find((x) => x.leaf.path[0] === "occupants")?.leaf.value);
    const what = SM.names(items.find((x) => x.leaf.path[0] === "contents")?.leaf.value);
    const pcs = data.people?.[r.id] || [];
    const wall = alarm ? cFg.clone().lerp(new THREE.Color(TONES.bad), 0.6) : cFg.clone();
    const floor = pcs.length ? cFg.clone().multiplyScalar(0.55) : cDim.clone().multiplyScalar(0.7);
    if (look.quarantine) floor.lerp(new THREE.Color(TONES.bad), 0.3);
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
      const dz = r.north ? r.z + r.h - 0.3 : r.z;
      box(deck, r.x + r.w / 2 - 0.7, r.y, dz - 0.05, 1.4, Math.max(doorH, 0.1), 0.4, doorColor);
    }
    if (cam) {
      const back = r.north ? r.z + 0.2 : r.z + r.h - 0.8;
      box(deck, r.x + r.w - 1.2, r.y + WALL_H, back, 0.7, 0.45, 0.6, toneColor(SM.tone(cam.path, cam.value)));
    }
    if (r.dock) {
      const p = r.dock, z0 = r.north ? r.z + r.h : p.z + p.h, z1 = r.north ? p.z : r.z;
      box(deck, r.x + r.w / 2 - 0.6, r.y, Math.min(z0, z1), 1.2, 0.9, Math.abs(z1 - z0), cDim);
    } else {
      const z0 = r.north ? r.z + r.h : -CORR / 2, z1 = r.north ? -CORR / 2 : r.z;
      if (z1 > z0) box(deck, r.x + r.w / 2 - 0.5, r.y - 0.12, z0, 1, 0.12, z1 - z0, cDim.clone().multiplyScalar(0.55));
    }
    const roster = [...pcs.map((n) => `${n} (player)`), ...who, ...(what.length ? ["-", ...what] : [])].join("\n");
    const more = rest.slice(2).map((x) => `${x.label} ${x.leaf.value}`).join("\n");
    const head = editable ? ` data-room="${esc(r.id)}" data-label="${esc(r.label)}" data-deck="${esc(r.dock ? `docked at ${r.dock.label}` : r.deck.label)}"` : "";
    group.add(tag(`<div class="iso-name"${head} title="${esc(`${r.label}${editable ? " (click for the room view)" : ""}${roster ? `\n${roster}` : ""}`)}">${esc(r.label.toUpperCase())}</div>
      ${rest.length ? `<div class="mchips">${rest.slice(0, 2).map((x) => SM.chip(x.leaf, x.label, editable)).join("")}${rest.length > 2 ? `<span class="iso-more" title="${esc(more)}">+${rest.length - 2}</span>` : ""}</div>` : ""}`,
    `iso-room${pcs.length ? " here" : ""}${alarm ? " alarm" : ""}`, new THREE.Vector3(r.x + r.w / 2, r.y + WALL_H + 1.2, r.z + r.h / 2), { units: r.w }));
    if (/airlock/.test(r.id)) group.add(tag("&#9656; SPACE", "iso-small iso-space", new THREE.Vector3(r.x + r.w / 2, r.y + 0.4, r.north ? r.z - 1.2 : r.z + r.h + 1.2)));
    if (pcs.length) {
      const mk = new THREE.Mesh(new THREE.OctahedronGeometry(0.6), new THREE.MeshLambertMaterial({ color: new THREE.Color("#ffffff").lerp(cFg, 0.3) }));
      mk.position.set(r.x + r.w / 2, r.y + WALL_H + 3.4, r.z + r.h / 2);
      mk.userData.y = mk.position.y;
      markers.push(mk);
      group.add(mk);
      group.add(tag(esc(pcs.join(" ")), "iso-who", new THREE.Vector3(r.x + r.w / 2, r.y + WALL_H + 4.6, r.z + r.h / 2)));
    }
  }

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
    o.element?.remove();
    o.geometry?.dispose();
    for (const mt of [].concat(o.material || [])) { mt.map?.dispose(); mt.dispose(); }
  });
}

export function mount(el, data, opts = {}) {
  const css = getComputedStyle(el);
  const colors = { fg: opts.fg || css.getPropertyValue("--fg").trim() || "#3bff7a", dim: opts.dim || css.getPropertyValue("--dim").trim() || "#1d8a43" };
  const wrap = document.createElement("div");
  wrap.className = "iso-wrap";
  wrap.innerHTML = '<div class="iso-sys"></div><div class="iso-view"></div><div class="iso-else"></div>';
  el.append(wrap);
  const [sysEl, view, elseEl] = wrap.children;
  view.style.setProperty("--iso-fg", colors.fg);
  view.style.setProperty("--iso-dim", colors.dim);
  const basePx = opts.labelPx || 15;
  view.style.setProperty("--iso-px", `${basePx}px`);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  view.append(renderer.domElement);
  renderer.domElement.style.cssText = "display: block; width: 100%; height: 100%; touch-action: none;";
  const words = new CSS2DRenderer();
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
  controls.minPolarAngle = controls.maxPolarAngle = Math.atan(Math.SQRT2);
  controls.minZoom = 0.4;
  controls.maxZoom = 8;
  controls.addEventListener("change", scale);
  let built = null, shapeKey = "", fit = { w: 20, h: 20 };

  const TILT = Math.atan(1 / Math.SQRT2), TURN = (25 * Math.PI) / 180;
  function frame() {
    const bb = new THREE.Box3().setFromObject(built.group);
    bb.min.x -= 12;
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
    const f = frustum(fit, a);
    camera.left = -f.w / 2; camera.right = f.w / 2; camera.top = f.h / 2; camera.bottom = -f.h / 2;
    camera.updateProjectionMatrix();
    scale();
  }
  let lastPpu = 0;
  function scale() {
    const ppu = (view.clientHeight || 1) / (camera.top - camera.bottom) * camera.zoom;
    if (Math.abs(ppu - lastPpu) < 0.05) return;
    lastPpu = ppu;
    const { px, far } = labelScale(ppu, basePx);
    view.style.setProperty("--iso-px", `${px}px`);
    view.style.setProperty("--ppu", ppu.toFixed(2));
    view.classList.toggle("far", far);
  }
  function update(next) {
    data = next;
    if (built) { scene.remove(built.group); dispose(built.group); }
    built = build(data, colors);
    scene.add(built.group);
    sysEl.innerHTML = window.StationMap.systemsHtml(built.m, !!data.editable);
    elseEl.innerHTML = window.StationMap.elsewhereHtml(built.m, !!data.editable);
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
