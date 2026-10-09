// PSG 14-15 as printed. wound: Wounds Table column; woundAdv: "+" / "-" printed next to it; alt: a second column the weapon can use; shots: per magazine.
const w = (name, damage, wound, extra = {}) => ({ name, damage, wound, woundAdv: "", alt: "", shots: 0, aa: false, special: "", ...extra });

export const WEAPONS = [
  w("Boarding Axe", "2d10", "gore", { woundAdv: "+" }),
  w("Combat Shotgun", "4d10", "gunshot", { shots: 4, longDamage: "1d10", special: "1d10 Damage at Long Range or further." }),
  w("Crowbar", "1d5", "blunt", { woundAdv: "+" }),
  w("Flamethrower", "2d10", "fire", { woundAdv: "+", shots: 4, special: "Body Save [-] or set on fire (2d10 Damage per round)." }),
  w("Flare Gun", "1d5", "fire", { woundAdv: "-", shots: 2 }),
  w("Foam Gun", "1", "blunt", { shots: 3, special: "Body Save or stuck." }),
  w("Frag Grenade", "3d10", "fire", { shots: 1, special: "Hits everything Adjacent to the target." }),
  w("General-Purpose Machine Gun", "4d10", "gunshot", { woundAdv: "+", shots: 5 }),
  w("Hand Welder", "1d10", "bleeding"),
  w("Laser Cutter", "1d100", "bleeding", { woundAdv: "+", alt: "gore", shots: 6, special: "Bleeding [+] or Gore [+]. 1 round to recharge." }),
  w("Nail Gun", "1d5", "bleeding", { shots: 32 }),
  w("Pulse Rifle", "3d10", "gunshot", { shots: 5 }),
  w("Revolver", "1d10+1", "gunshot", { shots: 6 }),
  w("Rigging Gun", "1d10", "bleeding", { woundAdv: "+", shots: 1, special: "Another 2d10 Damage when the bolt is removed." }),
  w("Scalpel", "1d5", "bleeding", { woundAdv: "+" }),
  w("Smart Rifle", "4d10", "gunshot", { woundAdv: "+", shots: 3, aa: true, closeCheck: "-", special: "Anti-Armor. [-] at Close range." }),
  w("SMG", "2d10", "gunshot", { shots: 5 }),
  w("Stun Baton", "1d5", "blunt", { special: "Body Save or stunned for 1 round." }),
  w("Tranq Pistol", "1d5", "blunt", { shots: 6, special: "Body Save or unconscious for 1d10 rounds." }),
  w("Vibechete", "3d10", "bleeding", { alt: "gore", aa: true, special: "Anti-Armor. Bleeding + Gore." }),
];

export const UNARMED = w("Unarmed", "Strength/10", "blunt");

export const ARMORS = [
  { name: "Standard Crew Attire", ap: 1, dr: 0, note: "" },
  { name: "Vaccsuit", ap: 3, dr: 0, note: "12 hours of oxygen. Speed [-]. Radiation shielding. If punctured: decompression within 1d5 rounds." },
  { name: "Hazard Suit", ap: 5, dr: 0, note: "1 hour of oxygen. Extreme heat and cold protection. Radiation shielding." },
  { name: "Standard Battle Dress", ap: 7, dr: 0, note: "" },
  { name: "Advanced Battle Dress", ap: 10, dr: 3, note: "1 hour of oxygen. Speed [-]. Strength [+]. Radiation shielding." },
];

const flat = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const has = (item, name) => ` ${flat(item)} `.includes(` ${flat(name)} `);

export const weaponByName = (name) => WEAPONS.find((x) => flat(x.name) === flat(name)) || (flat(name) === "unarmed" ? UNARMED : null);

// The weapons named in a character's items, in item order ("Combat shotgun (registered to MARY)" is a Combat Shotgun); Unarmed is always last.
export function weaponsOf(items) {
  const out = [];
  for (const item of items || []) {
    if (/^ammo\b/i.test(String(item).trim())) continue;
    const hit = WEAPONS.filter((x) => has(item, x.name)).sort((a, b) => b.name.length - a.name.length)[0];
    if (hit && !out.includes(hit)) out.push(hit);
  }
  return [...out, UNARMED];
}

// PSG 30-31 range bands. "Long Range or further" is Long and Extreme.
export const RANGES = ["adjacent", "close", "long", "extreme"];
export const RANGE_LABELS = { adjacent: "Adjacent", close: "Close", long: "Long", extreme: "Extreme" };
export const rangeOf = (v) => (RANGES.includes(String(v ?? "").toLowerCase()) ? String(v).toLowerCase() : "");
export const weaponDamage = (weapon, strength, range = "") => (weapon === UNARMED ? String(Math.floor(Math.max(0, Number(strength) || 0) / 10)) : weapon.longDamage && (range === "long" || range === "extreme") ? weapon.longDamage : weapon.damage);
// A weapon's range effect on the Combat check: Smart Rifle [-] at Close.
export const checkAdvantage = (weapon, range = "") => (weapon?.closeCheck && range === "close" ? weapon.closeCheck : "");

// Armor by item name: the best (highest AP) armor in the list, else Standard Crew Attire.
export function armorFrom(items) {
  const found = ARMORS.filter((a) => (items || []).some((i) => has(i, a.name)));
  const best = found.sort((a, b) => b.ap - a.ap)[0] || ARMORS[0];
  return { name: best.name, ap: best.ap, dr: best.dr, destroyed: false };
}
