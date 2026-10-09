import { changeItem } from "./crew.js";

// List prices are the PSG equipment list (RULES.md). Port classes, stocks, selling and the rig resources are campaign house rules.
export const CATEGORIES = [
  ["weapons", "Weapons"], ["armor", "Armor"], ["medical", "Medical"], ["survival", "Survival"], ["tools", "Tools"], ["ammo", "Ammo"], ["resources", "Rig resources"],
];
export const ITEMS = [
  { id: "crowbar", name: "Crowbar", price: 25, cat: "weapons", desc: "1d5 Blunt Force [+]. Also opens things." },
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
