import { weaponByName, WEAPONS } from "./weapons.js";
import { keyOf, clampInt } from "./clean.js";

// PSG gear prices (RULES.md, Gear prices): ammo is per magazine, MREs come as a pack of 7.
export const PRICES = { ammo: 50, aid: 75, stimpak: 1000, mre: 70, tank: 50 };
export const MRE_PACK = 7;

// Campaign house rules (Mothership 1e has no price scale for ports, and its fuel figure is for whole-system travel).
export const TANK = 10;
export const DAYS_PER_FUEL = 3;
export const PORT_MULT = { X: 2, C: 1.25, B: 1, A: 1 };
export const STORES = ["parts", "explosives", "flares", "rations"];
export const STORE_NAMES = { parts: "Parts", explosives: "Explosives", flares: "Flares", rations: "Rations (MREs)" };
export const fuelCost = (days) => Math.max(1, Math.ceil((Number(days) || 0) / DAYS_PER_FUEL));
export const portMult = (cls) => PORT_MULT[cls] ?? 1;

export function sanitizeResources(raw, base = { fuel: TANK, stores: {} }) {
  const r = raw && typeof raw === "object" ? raw : {};
  return {
    fuel: clampInt(r.fuel, 0, TANK, clampInt(base.fuel, 0, TANK, TANK)),
    stores: Object.fromEntries(STORES.map((k) => [k, clampInt(r.stores?.[k], 0, 99, clampInt(base.stores?.[k], 0, 99, 0))])),
  };
}

// The rig's resources as they sit in a story's station state (rig.*), and back.
export function rigStation(r, lifeSupport = "ONLINE") {
  return { fuel_units: r.fuel, fuel_capacity: TANK, ...r.stores, life_support: lifeSupport };
}
export function resourcesFrom(station, base) {
  const rig = station?.rig;
  if (!rig || typeof rig !== "object") return base;
  return sanitizeResources({ fuel: rig.fuel_units, stores: rig }, base);
}

// ---- Ammunition (PSG: shots per magazine; a magazine costs 50cr). Rounds in the loaded magazine are pc.ammo[weapon key]; spare magazines are items "Ammo (combat shotgun) x2".
const AMMO = /^ammo\s*\((.+?)\)\s*(?:x\s*(\d+))?\s*$/i;
export const isAmmoItem = (item) => /^ammo\b/i.test(String(item || "").trim());
export function ammoOf(item) {
  const m = AMMO.exec(String(item || "").trim());
  const w = m && weaponByName(m[1]);
  return w ? { weapon: w, n: Math.max(1, Number(m[2]) || 1) } : null;
}
export const ammoItem = (w, n) => `Ammo (${w.name.toLowerCase()})${n > 1 ? ` x${n}` : ""}`;
export const wkey = (w) => keyOf(w.name);
export const firearms = WEAPONS.filter((w) => w.shots > 0);

// Merges duplicate magazine stacks and drops empty ones.
export function mergeAmmo(items) {
  const counts = new Map();
  const out = [];
  for (const item of items) {
    const a = ammoOf(item);
    if (!a) { out.push(item); continue; }
    const k = wkey(a.weapon);
    if (counts.has(k)) { counts.get(k).n += a.n; continue; }
    const slot = { w: a.weapon, n: a.n };
    counts.set(k, slot);
    out.push(slot);
  }
  return out.map((x) => (typeof x === "string" ? x : ammoItem(x.w, Math.min(99, x.n))));
}

export const magazines = (pc, w) => (pc.items || []).reduce((n, i) => n + (ammoOf(i)?.weapon === w ? ammoOf(i).n : 0), 0);
export const loaded = (pc, w) => clampInt(pc.ammo?.[wkey(w)], 0, w.shots, w.shots);

export function addMagazines(pc, w, n = 1, max = 24) {
  const at = pc.items.findIndex((i) => ammoOf(i)?.weapon === w);
  if (at >= 0) pc.items[at] = ammoItem(w, Math.min(99, ammoOf(pc.items[at]).n + n));
  else if (pc.items.length < max) pc.items.push(ammoItem(w, n));
  else return false;
  return true;
}
function takeMagazine(pc, w) {
  const at = pc.items.findIndex((i) => ammoOf(i)?.weapon === w);
  if (at < 0) return false;
  const left = ammoOf(pc.items[at]).n - 1;
  if (left > 0) pc.items[at] = ammoItem(w, left);
  else pc.items.splice(at, 1);
  return true;
}

// One attack with a firearm spends one shot. false: the magazine is empty (reload is an action).
export function spendShot(pc, w) {
  if (!w.shots) return true;
  const n = loaded(pc, w);
  if (n <= 0) return false;
  pc.ammo = { ...pc.ammo, [wkey(w)]: n - 1 };
  return true;
}
// Swaps in a fresh magazine from the spares. Returns { ok, why, left }.
export function reload(pc, w) {
  if (!w.shots) return { ok: false, why: `${w.name} doesn't use magazines.` };
  if (loaded(pc, w) >= w.shots) return { ok: false, why: `${w.name} is already full (${w.shots}/${w.shots}).` };
  if (!takeMagazine(pc, w)) return { ok: false, why: `no spare magazine for the ${w.name} (Ammo is 50cr a magazine).` };
  pc.ammo = { ...pc.ammo, [wkey(w)]: w.shots };
  return { ok: true, left: w.shots, spare: magazines(pc, w) };
}
export const sanitizeAmmo = (raw) => Object.fromEntries(Object.entries(raw && typeof raw === "object" ? raw : {})
  .map(([k, v]) => [k, WEAPONS.find((w) => wkey(w) === k)]).filter(([, w]) => w?.shots).map(([k, w]) => [k, clampInt(raw[k], 0, w.shots, w.shots)]));

// Firearms a character carries, with rounds loaded and spare magazines (for the agent and the Warden).
export const ammoLine = (pc, weapons) => weapons.filter((w) => w.shots).map((w) => `${w.name} ${loaded(pc, w)}/${w.shots} loaded, ${magazines(pc, w)} spare magazine${magazines(pc, w) === 1 ? "" : "s"}`).join("; ");

// What the agent is told about the rig's resources. `station` is the live station state.
export function rigBrief(station) {
  const rig = station?.rig;
  if (!rig) return "";
  const fuel = Number(rig.fuel_units) || 0;
  return [
    `THE RIG'S RESOURCES (campaign house rules, not Mothership 1e; the app saves them between stories; change them with station_changes on rig.*):`,
    `- Fuel: ${fuel} of ${rig.fuel_capacity ?? TANK} units (a lane costs 1 unit per started ${DAYS_PER_FUEL} days).${fuel <= 0 ? " The rig has NO FUEL: it is stranded where it is, a story hook (a distress call, a tow, a favour, a siphon)." : ""}`,
    `- Stores: ${STORES.map((k) => `${STORE_NAMES[k].toLowerCase()} ${Number(rig[k]) || 0}`).join(", ")}.`,
    `- Life support: ${String(rig.life_support ?? "ONLINE").toUpperCase()}. Normally online and not tracked; set rig.life_support to OFFLINE and the app runs the oxygen supply rules (PSG 33.1) for everyone aboard.`,
  ].join("\n");
}
