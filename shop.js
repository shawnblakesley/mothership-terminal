import { changeItem } from "./crew.js";

// List prices are the PSG equipment list (RULES.md). Port classes, stocks, selling and the rig resources are campaign house rules.
export const CATEGORIES = [
  ["weapons", "Weapons"], ["armor", "Armor"], ["medical", "Medical"], ["survival", "Survival"], ["tools", "Tools"], ["ammo", "Ammo"], ["resources", "Rig resources"],
];
export const ITEMS = [
  { id: "crowbar", name: "Crowbar", price: 25, cat: "weapons", desc: "1d5 Blunt Force [+]. Also opens things." },
  { id: "boarding_axe", name: "Boarding Axe", price: 150, cat: "weapons", desc: "2d10 Gore [+]. Heavy and sharp." },
  { id: "shotgun", name: "Combat Shotgun", price: 1400, cat: "weapons", desc: "4d10 Gunshot, 4 shots. Only 1d10 at Long Range or further." },
  { id: "flamethrower", name: "Flamethrower", price: 4000, cat: "weapons", desc: "2d10 Fire [+], 4 shots. Body Save [-] or set on fire." },
  { id: "flare_gun", name: "Flare Gun", price: 25, cat: "weapons", desc: "1d5 Fire [-], 2 shots." },
  { id: "foam_gun", name: "Foam Gun", price: 500, cat: "weapons", desc: "1 Blunt Force, 3 shots. Body Save or stuck." },
  { id: "frag_grenade", name: "Frag Grenade", price: 400, cat: "weapons", desc: "3d10 Fire/Explosives, one use. Hits all Adjacent to the target." },
  { id: "gpmg", name: "General-Purpose Machine Gun", price: 4500, cat: "weapons", desc: "4d10 Gunshot [+], 5 shots." },
  { id: "hand_welder", name: "Hand Welder", price: 250, cat: "weapons", desc: "1d10 Bleeding." },
  { id: "laser_cutter", name: "Laser Cutter", price: 1200, cat: "weapons", desc: "1d100 Bleeding or Gore [+], 6 shots. Recharges for a round." },
  { id: "nail_gun", name: "Nail Gun", price: 150, cat: "weapons", desc: "1d5 Bleeding, 32 shots." },
  { id: "pulse_rifle", name: "Pulse Rifle", price: 2400, cat: "weapons", desc: "3d10 Gunshot, 5 shots." },
  { id: "revolver", name: "Revolver", price: 750, cat: "weapons", desc: "1d10+1 Gunshot, 6 shots." },
  { id: "rigging_gun", name: "Rigging Gun", price: 350, cat: "weapons", desc: "1d10 Bleeding [+], 1 shot. 2d10 more when removed." },
  { id: "scalpel", name: "Scalpel", price: 50, cat: "weapons", desc: "1d5 Bleeding [+]." },
  { id: "smart_rifle", name: "Smart Rifle", price: 5000, cat: "weapons", desc: "4d10 Gunshot [+], Anti-Armor, 3 shots. [-] at Close." },
  { id: "smg", name: "SMG", price: 1000, cat: "weapons", desc: "2d10 Gunshot, 5 shots." },
  { id: "stun_baton", name: "Stun Baton", price: 150, cat: "weapons", desc: "1d5 Blunt Force. Body Save or stunned 1 round." },
  { id: "tranq_pistol", name: "Tranq Pistol", price: 250, cat: "weapons", desc: "1d5 Blunt Force, 6 shots. Body Save or unconscious 1d10 rounds." },
  { id: "vibechete", name: "Vibechete", price: 1000, cat: "weapons", desc: "3d10 Anti-Armor, Bleeding and Gore." },
  { id: "crew_attire", name: "Standard Crew Attire", price: 100, cat: "armor", desc: "AP 1." },
  { id: "vaccsuit", name: "Vaccsuit", price: 10000, cat: "armor", desc: "AP 3, 12 hrs O2, Speed [-], radiation shielding. Decompresses within 1d5 rounds if punctured." },
  { id: "hazard_suit", name: "Hazard Suit", price: 4000, cat: "armor", desc: "AP 5, 1 hr O2, extreme heat and cold protection, radiation shielding." },
  { id: "battle_dress", name: "Standard Battle Dress", price: 2000, cat: "armor", desc: "AP 7." },
  { id: "adv_battle_dress", name: "Advanced Battle Dress", price: 12000, cat: "armor", desc: "AP 10, DR 3, 1 hr O2, Speed [-], Strength [+], radiation shielding." },
  { id: "ammo", name: "Ammo (magazine)", price: 50, cat: "ammo", desc: "One magazine for any firearm." },
  { id: "first_aid", name: "First Aid Kit", price: 75, cat: "medical", desc: "Stops Bleeding." },
  { id: "stimpak", name: "Stimpak", price: 1000, cat: "medical", desc: "Stress -1, +1d10 Health, [+] for 1d10 minutes. Cures cryosickness." },
  { id: "medscanner", name: "Medscanner", price: 8000, cat: "medical", desc: "Reads a patient's vitals and injuries." },
  { id: "rad_pills", name: "Radiation Pills (x5)", price: 200, cat: "medical", desc: "Take 1d5 Damage, Radiation Level -1 for 2d10 minutes." },
  { id: "oxygen_tank", name: "Oxygen Tank", price: 50, cat: "survival", desc: "On a vaccsuit: up to 12 hours, 4 under strain." },
  { id: "rebreather", name: "Rebreather", price: 500, cat: "survival", desc: "Breathe a toxic atmosphere." },
  { id: "geiger", name: "Geiger Counter", price: 20, cat: "survival", desc: "Reads radiation." },
  { id: "flashlight", name: "Flashlight", price: 30, cat: "survival", desc: "A light that lasts." },
  { id: "chemlight", name: "Chemlight (x5)", price: 5, cat: "survival", desc: "Glowsticks." },
  { id: "mre", name: "MRE (x7)", price: 70, cat: "survival", desc: "A week of meals." },
  { id: "water_filter", name: "Water Filtration Device", price: 50, cat: "survival", desc: "Clean water from bad water." },
  { id: "patch_kit", name: "Patch Kit (x3)", price: 200, cat: "survival", desc: "Restores a punctured vaccsuit's space readiness; a patched vaccsuit is AP 1." },
  { id: "detonator", name: "Detonator", price: 500, cat: "tools", desc: "Sets charges off." },
  { id: "mag_boots", name: "Mag-boots", price: 350, cat: "tools", desc: "Stick to a hull." },
  { id: "tool_set", name: "Electronic Tool Set", price: 100, cat: "tools", desc: "For electronics repair." },
  { id: "comms_short", name: "Short-range Comms", price: 100, cat: "tools", desc: "Radios for the crew." },
  { id: "comms_long", name: "Long-range Comms", price: 1000, cat: "tools", desc: "Reaches a ship in orbit." },
  { id: "beacon", name: "Emergency Beacon", price: 2000, cat: "tools", desc: "Calls for rescue." },
  { id: "fuel", name: "Fuel unit", price: 500, cat: "resources", house: true, desc: "One unit of fuel for the rig." },
  { id: "ration_crate", name: "Ration crate (7 MREs)", price: 70, cat: "resources", house: true, desc: "Rations for the rig's larder." },
  { id: "spare_parts", name: "Spare parts (cargo-grade)", price: 200, cat: "resources", house: true, desc: "Parts for the rig." },
];
export const USED_ARMOR = ITEMS.filter((i) => i.cat === "armor").map((i) => ({ ...i, id: `used_${i.id}`, name: `Used ${i.name}`, price: i.price / 2, house: true, used: true, desc: `Used, half list price (house rule). ${i.desc}` }));
ITEMS.push(...USED_ARMOR);
export const PORT_MULT = { X: 2, C: 1.25, B: 1, A: 1 };
export const DEFAULT_SHOP = { id: "", name: "Trading post", portClass: "C", stock: ["crowbar", "ammo", "first_aid", "stimpak", "oxygen_tank", "rebreather", "flashlight", "chemlight", "mre", "water_filter", "tool_set", "comms_short", "fuel", "ration_crate"], deals: {} };

const byId = new Map(ITEMS.map((i) => [i.id, i]));
export const catalogItem = (id) => byId.get(id) || null;
export const nameKey = (s) => String(s || "").toLowerCase().replace(/\([^)]*\)/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
const byName = new Map(ITEMS.map((i) => [nameKey(i.name), i]));
export const findItem = (name) => byName.get(nameKey(name)) || null;

export const classMult = (cls) => PORT_MULT[cls] ?? PORT_MULT.C;
export const sellAt = (price) => Math.floor(price / 2);

// A shop as the room holds it: plain data. `loc` is a campaign location ({id, name, portClass, stock, deals}), or nothing for the default C-class stock.
export function openShop(loc) {
  const l = loc?.stock ? loc : DEFAULT_SHOP;
  const cls = PORT_MULT[l.portClass] ? l.portClass : "C";
  return { id: loc?.id || "", name: String(loc?.name || l.name), portClass: cls, mult: classMult(cls), stock: l.stock.filter((id) => byId.has(id)), deals: { ...(l.deals || {}) } };
}

export function priceIn(shop, id) {
  const item = byId.get(id);
  if (!item || !shop?.stock.includes(id)) return null;
  return Math.round(item.price * (shop.deals?.[id] ?? shop.mult));
}

export const listing = (shop) => shop.stock.map((id) => ({ ...byId.get(id), price: priceIn(shop, id), sell: sellAt(priceIn(shop, id)) }));

export function shopView(shop) {
  return {
    name: shop.name,
    portClass: shop.portClass,
    mult: shop.mult,
    categories: CATEGORIES,
    items: listing(shop).map(({ id, name, cat, desc, price, sell, house }) => ({ id, name, cat, desc, price, sell, key: nameKey(name), ...(house ? { house: true } : {}) })),
    others: ITEMS.filter((i) => !shop.stock.includes(i.id)).map(({ name, cat, desc }) => ({ name, cat, desc, key: nameKey(name) })),
  };
}

export function buy(pc, shop, id) {
  const price = priceIn(shop, id), item = byId.get(id);
  if (price === null) return { error: "THIS PORT WON'T TRADE THAT." };
  if (pc.credits < price) return { error: `YOU CAN'T AFFORD IT. ${price}CR, YOU HAVE ${pc.credits}CR.` };
  if (!changeItem(pc, "add", item.name)) return { error: "YOU CAN'T CARRY ANY MORE." };
  pc.credits -= price;
  return { ok: true, item: item.name, cr: price };
}

// Sells the character's own item that matches the catalogue, at half this port's price.
export function sell(pc, shop, name) {
  const item = findItem(name);
  if (!item) return { error: "THE CATALOGUE DOESN'T LIST THAT." };
  const price = priceIn(shop, item.id);
  if (price === null) return { error: "THIS PORT WON'T TRADE THAT." };
  const owned = pc.items.find((x) => nameKey(x) === nameKey(item.name));
  if (!owned) return { error: "YOU DON'T HAVE ONE." };
  changeItem(pc, "remove", owned);
  const cr = sellAt(price);
  pc.credits += cr;
  return { ok: true, item: owned, cr };
}

// Reverses a logged trade: a purchase gives the money back and takes the item if they still have it; a sale takes the money back and returns the item.
export function refund(pc, trade) {
  if (trade.kind === "buy") {
    const owned = pc.items.find((x) => nameKey(x) === nameKey(trade.item));
    if (owned) changeItem(pc, "remove", owned);
    pc.credits += trade.cr;
    return { ok: true };
  }
  if (pc.credits < trade.cr) return { error: `${pc.name} no longer has ${trade.cr}cr to give back.` };
  if (!changeItem(pc, "add", trade.item)) return { error: `${pc.name} can't carry any more.` };
  pc.credits -= trade.cr;
  return { ok: true };
}
