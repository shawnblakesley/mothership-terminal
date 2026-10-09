import { test } from "node:test";
import assert from "node:assert/strict";
import { ITEMS, PORT_MULT, DEFAULT_SHOP, openShop, priceIn, listing, shopView, buy, sell, refund, findItem, nameKey, sellAt } from "../shop.js";
import { CAMPAIGNS } from "../campaign.js";
import { sanitizeCrew, startingCredits } from "../crew.js";

const base = (id) => ITEMS.find((i) => i.id === id).price;
const everything = { id: "x", name: "Everywhere", portClass: "B", stock: ITEMS.map((i) => i.id), deals: {} };
const pc = (credits, items = []) => ({ name: "Test", credits, items: [...items] });

test("list prices are the PSG equipment list", () => {
  const psg = { ammo: 50, first_aid: 75, stimpak: 1000, medscanner: 8000, oxygen_tank: 50, rebreather: 500, rad_pills: 200, geiger: 20, flashlight: 30, chemlight: 5, mre: 7 * 10, water_filter: 50, patch_kit: 200, detonator: 500, mag_boots: 350, tool_set: 100, comms_short: 100, comms_long: 1000, beacon: 2000, crowbar: 25 };
  for (const [id, price] of Object.entries(psg)) assert.equal(base(id), price, id);
});

test("house-rule resources: fuel 500, ration crate 70, spare parts 200, flagged as house rules", () => {
  assert.deepEqual(["fuel", "ration_crate", "spare_parts"].map(base), [500, 70, 200]);
  assert.ok(ITEMS.filter((i) => i.cat === "resources").every((i) => i.house));
  assert.ok(ITEMS.filter((i) => i.cat !== "resources" && !i.used).every((i) => !i.house));
});

test("each port class multiplier", () => {
  assert.deepEqual(PORT_MULT, { X: 2, C: 1.25, B: 1, A: 1 });
  for (const [cls, m] of Object.entries(PORT_MULT)) {
    const shop = openShop({ ...everything, portClass: cls });
    assert.equal(shop.mult, m);
    assert.equal(priceIn(shop, "first_aid"), Math.round(75 * m));
    assert.equal(priceIn(shop, "stimpak"), 1000 * m);
  }
});

test("Rim Haulers ports carry the classes and stocks from the brief", () => {
  const c = CAMPAIGNS.find((x) => x.id === "rim-haulers" || x.locations.some((l) => l.id === "lantern"));
  const cls = Object.fromEntries(c.locations.map((l) => [l.id, l.portClass]));
  assert.deepEqual(cls, { port_gallow: "A", tollgate: "C", halfway_house: "C", cinder: "B", st_brigid: "C", boneyard: "C", lantern: "X", terminus: "C" });
  const ids = new Set(ITEMS.map((i) => i.id));
  for (const l of c.locations) {
    assert.ok(l.stock.length, l.id);
    for (const id of l.stock) assert.ok(ids.has(id), `${l.id}: unknown item ${id}`);
    for (const id of Object.keys(l.deals || {})) assert.ok(l.stock.includes(id));
  }
  const tollgate = openShop(c.locations.find((l) => l.id === "tollgate"));
  assert.ok(tollgate.stock.length <= 3);
  const halfway = openShop(c.locations.find((l) => l.id === "halfway_house"));
  assert.equal(priceIn(halfway, "mre"), 70);
  assert.equal(priceIn(halfway, "first_aid"), Math.round(75 * 1.25));
});

test("outside a campaign the shop is a default C-class stock", () => {
  const shop = openShop(null);
  assert.equal(shop.portClass, "C");
  assert.equal(priceIn(shop, "ammo"), Math.round(50 * 1.25));
  assert.deepEqual(shop.stock, DEFAULT_SHOP.stock);
});

test("an item a port does not stock has no price and can't be bought or sold there", () => {
  const shop = openShop({ id: "t", name: "Tiny", portClass: "B", stock: ["mre"] });
  assert.equal(priceIn(shop, "stimpak"), null);
  assert.match(buy(pc(99999), shop, "stimpak").error, /WON'T TRADE/);
  assert.match(sell(pc(0, ["Stimpak"]), shop, "Stimpak").error, /WON'T TRADE/);
  assert.equal(shopView(shop).items.length, 1);
  assert.ok(shopView(shop).others.some((o) => o.name === "Stimpak"));
});

test("selling pays half the port's listed price", () => {
  const shop = openShop({ ...everything, portClass: "X" });
  const c = pc(0, ["Stimpak"]);
  const r = sell(c, shop, "stimpak");
  assert.equal(r.ok, true);
  assert.equal(c.credits, 1000);
  assert.deepEqual(c.items, []);
  assert.equal(sellAt(75), 37);
  assert.equal(listing(openShop({ ...everything, portClass: "B" })).find((i) => i.id === "first_aid").sell, 37);
});

test("only catalogue items sell, and only ones the character carries", () => {
  const shop = openShop(everything);
  const c = pc(10, ["Heavy crowbar", "Plasma cutter", "First aid kit"]);
  assert.match(sell(c, shop, "Plasma cutter").error, /CATALOGUE/);
  assert.match(sell(c, shop, "Stimpak").error, /DON'T HAVE/);
  assert.equal(sell(c, shop, "First Aid Kit").ok, true);
  assert.deepEqual(c.items, ["Heavy crowbar", "Plasma cutter"]);
  assert.equal(c.credits, 10 + 37);
});

test("buying takes credits and adds the item; credits can't go negative", () => {
  const shop = openShop(everything);
  const c = pc(100);
  assert.equal(buy(c, shop, "first_aid").ok, true);
  assert.equal(c.credits, 25);
  assert.deepEqual(c.items, ["First Aid Kit"]);
  const poor = buy(c, shop, "first_aid");
  assert.match(poor.error, /AFFORD/);
  assert.equal(c.credits, 25);
  assert.equal(c.items.length, 1);
  for (const id of ["stimpak", "beacon", "medscanner"]) assert.ok(buy(c, shop, id).error);
  assert.ok(c.credits >= 0);
});

test("buying stops when the character can carry no more", () => {
  const shop = openShop(everything);
  const c = pc(100000, Array.from({ length: 24 }, (_, i) => `Thing ${i}`));
  assert.match(buy(c, shop, "ammo").error, /CARRY/);
  assert.equal(c.credits, 100000);
});

test("item name matching ignores case, spacing and quantity suffixes", () => {
  assert.equal(findItem("first aid kit").id, "first_aid");
  assert.equal(findItem("  STIMPAK ").id, "stimpak");
  assert.equal(findItem("Radiation Pills").id, "rad_pills");
  assert.equal(findItem("mre").id, "mre");
  assert.equal(findItem("Ammo").id, "ammo");
  assert.equal(findItem("Plasma cutter"), null);
  assert.equal(nameKey("Mag-boots"), nameKey("mag boots"));
});

test("a refund undoes a purchase or a sale", () => {
  const shop = openShop(everything);
  const c = pc(100);
  const bought = buy(c, shop, "first_aid");
  assert.equal(refund(c, { kind: "buy", item: bought.item, cr: bought.cr }).ok, true);
  assert.equal(c.credits, 100);
  assert.deepEqual(c.items, []);
  const d = pc(0, ["Stimpak"]);
  const sold = sell(d, shop, "Stimpak");
  assert.ok(refund(d, { kind: "sell", item: sold.item, cr: sold.cr }).ok);
  assert.deepEqual([d.credits, d.items], [0, ["Stimpak"]]);
  const broke = pc(10);
  assert.ok(refund(broke, { kind: "sell", item: "Stimpak", cr: 500 }).error);
  assert.equal(broke.credits, 10);
});

test("starting credits are 2d10 x 10, rolled once when missing, and sanitized", () => {
  assert.equal(startingCredits(() => 0), 20);
  assert.equal(startingCredits(() => 0.999), 200);
  for (let i = 0; i < 200; i++) {
    const n = startingCredits();
    assert.ok(n >= 20 && n <= 200 && n % 10 === 0);
  }
  const [a] = sanitizeCrew([{ name: "Ann" }]);
  assert.ok(a.credits >= 20 && a.credits <= 200);
  const [b] = sanitizeCrew([{ name: "Bob", credits: 450 }]);
  assert.equal(b.credits, 450);
  assert.equal(sanitizeCrew([b])[0].credits, 450);
  assert.equal(sanitizeCrew([{ name: "Neg", credits: -5 }])[0].credits, 0);
  assert.equal(sanitizeCrew([{ name: "Zero", credits: 0 }])[0].credits, 0);
});

test("weapon and armor list prices are the PSG's", () => {
  const psg = { boarding_axe: 150, shotgun: 1400, crowbar: 25, flamethrower: 4000, flare_gun: 25, foam_gun: 500, frag_grenade: 400, gpmg: 4500, hand_welder: 250, laser_cutter: 1200, nail_gun: 150, pulse_rifle: 2400, revolver: 750, rigging_gun: 350, scalpel: 50, smart_rifle: 5000, smg: 1000, stun_baton: 150, tranq_pistol: 250, vibechete: 1000, crew_attire: 100, vaccsuit: 10000, hazard_suit: 4000, battle_dress: 2000, adv_battle_dress: 12000 };
  for (const [id, price] of Object.entries(psg)) assert.equal(base(id), price, id);
  assert.equal(ITEMS.filter((i) => i.cat === "weapons").length, 20);
  assert.equal(priceIn(openShop({ ...everything, portClass: "A" }), "revolver"), 750);
  assert.equal(priceIn(openShop({ ...everything, portClass: "C" }), "vaccsuit"), 12500);
});

test("used armor costs half list price, is labelled used and house rule, and only the Boneyard stocks it", () => {
  const used = ITEMS.filter((i) => i.used);
  assert.equal(used.length, 5);
  assert.equal(base("used_vaccsuit"), 5000);
  assert.equal(base("used_adv_battle_dress"), 6000);
  for (const u of used) assert.ok(u.house && u.name.startsWith("Used ") && u.cat === "armor");
  const c = CAMPAIGNS.find((x) => x.locations.some((l) => l.id === "boneyard"));
  const yard = openShop(c.locations.find((l) => l.id === "boneyard"));
  assert.equal(priceIn(yard, "used_vaccsuit"), Math.round(5000 * 1.25));
  assert.equal(priceIn(yard, "vaccsuit"), null);
  for (const l of c.locations.filter((x) => x.id !== "boneyard")) assert.ok(!l.stock.some((id) => id.startsWith("used_")), l.id);
  assert.equal(findItem("Used Vaccsuit").id, "used_vaccsuit");
  assert.equal(findItem("Vaccsuit").id, "vaccsuit");
});

test("Lantern sells most weapons, and only Lantern sells the Smart Rifle", () => {
  const c = CAMPAIGNS.find((x) => x.locations.some((l) => l.id === "lantern"));
  const weapons = ITEMS.filter((i) => i.cat === "weapons").map((i) => i.id);
  const lantern = c.locations.find((l) => l.id === "lantern");
  assert.ok(lantern.stock.filter((id) => weapons.includes(id)).length > weapons.length / 2);
  assert.deepEqual(c.locations.filter((l) => l.stock.includes("smart_rifle")).map((l) => l.id), ["lantern"]);
  assert.equal(priceIn(openShop(lantern), "revolver"), 1500);
});
