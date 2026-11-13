import { eq } from "drizzle-orm";
import { hashPin } from "../auth.js";
import type { Db } from "./client.js";
import { categories, menuItems, modifierGroups, modifierOptions, outlets, staffUsers, stations, tenants } from "./schema.js";

/**
 * Demo data (D-07): an illustrative café menu, not copied from any one café.
 * Prices are tax-inclusive rupees. Replace with the owner's menu when it arrives.
 */
type Mods = "coffee" | "cold" | "chai" | "none";
const MENU: Array<{ category: string; items: Array<[name: string, rupees: number, desc: string, veg: boolean, station: "bar" | "kitchen", mods: Mods, tags?: string[]]> }> = [
  {
    category: "Hot Coffee",
    items: [
      ["Espresso", 120, "A short, intense double shot with a hazelnut crema.", true, "bar", "coffee"],
      ["Americano", 150, "Espresso stretched with hot water. Clean and bold.", true, "bar", "coffee"],
      ["Cappuccino", 180, "Equal parts espresso, steamed milk and velvety foam.", true, "bar", "coffee", ["bestseller"]],
      ["Café Latte", 190, "Smooth espresso with plenty of silky steamed milk.", true, "bar", "coffee", ["bestseller"]],
      ["Flat White", 200, "A ristretto-forward coffee with thin, glossy microfoam.", true, "bar", "coffee"],
      ["Café Mocha", 220, "Espresso, dark chocolate and steamed milk.", true, "bar", "coffee"],
    ],
  },
  {
    category: "Cold Coffee",
    items: [
      ["Iced Latte", 210, "Espresso poured over cold milk and ice.", true, "bar", "cold"],
      ["Cold Brew", 230, "Steeped for 16 hours. Low in acid, naturally sweet.", true, "bar", "cold", ["new"]],
      ["Classic Frappé", 240, "Blended coffee, milk and ice, topped with foam.", true, "bar", "cold", ["bestseller"]],
      ["Hazelnut Cold Coffee", 250, "Thick, creamy cold coffee with roasted hazelnut.", true, "bar", "cold"],
    ],
  },
  {
    category: "Tea & More",
    items: [
      ["Masala Chai", 90, "Assam tea brewed with ginger, cardamom and spices.", true, "bar", "chai", ["bestseller"]],
      ["Lemon Ginger Honey Tea", 110, "A bright, soothing caffeine-light brew.", true, "bar", "chai"],
      ["Hot Chocolate", 200, "Rich cocoa and steamed milk.", true, "bar", "none"],
    ],
  },
  {
    category: "Bakes",
    items: [
      ["Butter Croissant", 140, "Flaky, golden and baked fresh every morning.", true, "kitchen", "none"],
      ["Double Chocolate Muffin", 130, "Moist cocoa muffin with chocolate chunks.", true, "kitchen", "none"],
      ["Banana Walnut Bread", 150, "A thick slice, lightly toasted.", true, "kitchen", "none"],
    ],
  },
  {
    category: "Quick Bites",
    items: [
      ["Paneer Tikka Sandwich", 220, "Smoky paneer, mint mayo and onions on toasted bread.", true, "kitchen", "none", ["bestseller"]],
      ["Chicken Pesto Sandwich", 260, "Grilled chicken, basil pesto and tomato.", false, "kitchen", "none"],
      ["Veg Puff", 60, "Flaky pastry with spiced potato and peas.", true, "kitchen", "none"],
      ["Egg Puff", 70, "Flaky pastry with a spiced egg masala.", false, "kitchen", "none"],
    ],
  },
];

export const DEMO_TENANT_SLUG = "400-coffee";
export const DEMO_PINS = { admin: "1111", cashierA: "2222", kitchenA: "3333", cashierB: "4444", kitchenB: "5555" } as const;

export async function seedDemo(db: Db) {
  const existing = await db.select().from(tenants).where(eq(tenants.slug, DEMO_TENANT_SLUG));
  if (existing.length > 0) return { created: false, tenantId: existing[0]!.id };

  return db.transaction(async (tx) => {
    const [tenant] = await tx
      .insert(tenants)
      .values({
        slug: DEMO_TENANT_SLUG,
        name: "400 Coffee Cafe",
        taxRateBps: 500,
        demoData: true,
        // The pilot client has three cafés, so it isn't held to Starter limits.
        plan: "multi",
        branding: {
          displayName: "400 Coffee Cafe",
          tagline: "Sanctuary for coffee lovers",
          greeting: "Welcome in! What can I brew for you today?",
          managerName: "Aarav",
          primaryColor: "#57331F",
          accentColor: "#6F8F5A",
          baristaVideo: { idle: "/baristas/400-coffee/idle.mp4", wave: "/baristas/400-coffee/wave.mp4" },
        },
      })
      .returning();
    const t = tenant!.id;
    const [a, b] = await tx
      .insert(outlets)
      .values([
        { tenantId: t, slug: "tower-a", name: "Tower A", pickupPrefix: "A" },
        { tenantId: t, slug: "tower-b", name: "Tower B", pickupPrefix: "B" },
      ])
      .returning();
    for (const o of [a!, b!]) {
      await tx.insert(stations).values([
        { tenantId: t, outletId: o.id, key: "bar", name: "Coffee bar" },
        { tenantId: t, outletId: o.id, key: "kitchen", name: "Kitchen" },
      ]);
    }

    let catSort = 0;
    for (const c of MENU) {
      const [cat] = await tx.insert(categories).values({ tenantId: t, name: c.category, sort: catSort++ }).returning();
      let itemSort = 0;
      for (const [name, rupees, description, isVeg, stationKey, mods, tags] of c.items) {
        const [item] = await tx
          .insert(menuItems)
          .values({ tenantId: t, categoryId: cat!.id, name, description, pricePaise: rupees * 100, isVeg, stationKey, sort: itemSort++, tags: tags ?? [] })
          .returning();
        const groups: Array<[string, number, number, Array<[string, number]>]> = [];
        if (mods === "coffee" || mods === "cold") {
          groups.push(["Size", 1, 1, [["Regular", 0], ["Large", 40]]]);
          groups.push(["Milk", 1, 1, [["Regular milk", 0], ["Oat milk", 50], ["Almond milk", 50]]]);
          groups.push(["Extras", 0, 3, [["Extra shot", 40], ["Hazelnut syrup", 30], ["Sugar-free", 0]]]);
        }
        if (mods === "chai") groups.push(["Sugar", 1, 1, [["Regular sugar", 0], ["Less sugar", 0], ["No sugar", 0]]]);
        let gSort = 0;
        for (const [gName, min, max, opts] of groups) {
          const [g] = await tx.insert(modifierGroups).values({ tenantId: t, itemId: item!.id, name: gName, minSelect: min, maxSelect: max, sort: gSort++ }).returning();
          await tx.insert(modifierOptions).values(opts.map(([oName, r], i) => ({ tenantId: t, groupId: g!.id, name: oName, pricePaise: r * 100, sort: i })));
        }
      }
    }

    await tx.insert(staffUsers).values([
      { tenantId: t, name: "Owner (Admin)", role: "ADMIN", pinHash: await hashPin(DEMO_PINS.admin), outletIds: [a!.id, b!.id] },
      { tenantId: t, name: "Cashier · Tower A", role: "CASHIER", pinHash: await hashPin(DEMO_PINS.cashierA), outletIds: [a!.id] },
      { tenantId: t, name: "Kitchen · Tower A", role: "KITCHEN", pinHash: await hashPin(DEMO_PINS.kitchenA), outletIds: [a!.id] },
      { tenantId: t, name: "Cashier · Tower B", role: "CASHIER", pinHash: await hashPin(DEMO_PINS.cashierB), outletIds: [b!.id] },
      { tenantId: t, name: "Kitchen · Tower B", role: "KITCHEN", pinHash: await hashPin(DEMO_PINS.kitchenB), outletIds: [b!.id] },
    ]);
    return { created: true, tenantId: t };
  });
}
