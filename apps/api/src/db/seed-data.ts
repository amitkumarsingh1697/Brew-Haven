import { eq } from "drizzle-orm";
import { hashPin } from "../auth.js";
import type { Db } from "./client.js";
import { categories, menuItems, modifierGroups, modifierOptions, outlets, staffUsers, stations, tenants } from "./schema.js";

/**
 * Development and testing menu (D-07, Point 3): modelled on what India's popular café chains sell
 * and charge in 2026, without copying any one brand's menu. 400 Coffee adds GST on the bill (SO-6),
 * so these prices are before GST. Replace with the café's real menu when the owner sends it
 * (Admin > Menu, or edit this list and reseed a fresh database).
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
      ["Cortado", 170, "Espresso cut with an equal splash of warm milk.", true, "bar", "coffee"],
      ["Spanish Latte", 230, "Latte sweetened with condensed milk. Rich and smooth.", true, "bar", "coffee", ["new"]],
      ["Caramel Macchiato", 240, "Vanilla milk marked with espresso and a caramel drizzle.", true, "bar", "coffee"],
    ],
  },
  {
    category: "Cold Coffee",
    items: [
      ["Iced Latte", 210, "Espresso poured over cold milk and ice.", true, "bar", "cold"],
      ["Cold Brew", 230, "Steeped for 16 hours. Low in acid, naturally sweet.", true, "bar", "cold", ["new"]],
      ["Classic Frappé", 240, "Blended coffee, milk and ice, topped with foam.", true, "bar", "cold", ["bestseller"]],
      ["Hazelnut Cold Coffee", 250, "Thick, creamy cold coffee with roasted hazelnut.", true, "bar", "cold"],
      ["Mocha Frappé", 260, "Blended coffee and dark chocolate, finished with cream.", true, "bar", "cold"],
      ["Vietnamese Iced Coffee", 240, "Strong drip coffee over condensed milk and ice.", true, "bar", "cold"],
      ["Espresso Tonic", 230, "A double shot over tonic water and orange peel.", true, "bar", "none", ["new"]],
    ],
  },
  {
    category: "Manual Brews",
    items: [
      ["Pour Over (V60)", 220, "Single-estate Chikmagalur beans, brewed by hand to order.", true, "bar", "none"],
      ["French Press", 200, "Full-bodied and rich. Serves one large cup.", true, "bar", "none"],
      ["AeroPress", 210, "Clean, bright and quick, with a sweet finish.", true, "bar", "none"],
    ],
  },
  {
    category: "Tea & More",
    items: [
      ["Masala Chai", 90, "Assam tea brewed with ginger, cardamom and spices.", true, "bar", "chai", ["bestseller"]],
      ["Lemon Ginger Honey Tea", 110, "A bright, soothing caffeine-light brew.", true, "bar", "chai"],
      ["Hot Chocolate", 200, "Rich cocoa and steamed milk.", true, "bar", "none"],
      ["Adrak Chai", 90, "Strong milk tea with fresh ginger.", true, "bar", "chai"],
      ["Kashmiri Kahwa", 140, "Green tea with saffron, cardamom and almonds.", true, "bar", "none"],
      ["Iced Peach Tea", 160, "Black tea shaken with peach and lemon.", true, "bar", "none"],
    ],
  },
  {
    category: "Shakes & Coolers",
    items: [
      ["Belgian Chocolate Shake", 260, "Thick shake with Belgian dark chocolate.", true, "bar", "none", ["bestseller"]],
      ["Strawberry Shake", 240, "Made with real strawberries and ice cream.", true, "bar", "none"],
      ["Fresh Lime Soda", 110, "Sweet, salted or mixed. Ask the barista.", true, "bar", "none"],
      ["Watermelon Mint Cooler", 150, "Fresh watermelon, mint and a squeeze of lime.", true, "bar", "none"],
    ],
  },
  {
    category: "All-Day Breakfast",
    items: [
      ["Masala Omelette & Toast", 220, "Three-egg omelette with onion, tomato and green chilli.", false, "kitchen", "none"],
      ["Avocado Toast", 320, "Smashed avocado, cherry tomatoes and chilli flakes on sourdough.", true, "kitchen", "none", ["new"]],
      ["Poha", 140, "Flattened rice with peanuts, curry leaves and lemon.", true, "kitchen", "none"],
      ["Pancake Stack", 260, "Three fluffy pancakes with maple syrup and butter.", true, "kitchen", "none"],
    ],
  },
  {
    category: "Bakes",
    items: [
      ["Butter Croissant", 140, "Flaky, golden and baked fresh every morning.", true, "kitchen", "none"],
      ["Double Chocolate Muffin", 130, "Moist cocoa muffin with chocolate chunks.", true, "kitchen", "none"],
      ["Banana Walnut Bread", 150, "A thick slice, lightly toasted.", true, "kitchen", "none"],
      ["Almond Croissant", 190, "Twice-baked croissant with almond cream.", true, "kitchen", "none"],
      ["Cinnamon Roll", 170, "Soft, swirled and glazed.", true, "kitchen", "none"],
      ["Chocolate Brownie", 150, "Fudgy, dense and served warm.", true, "kitchen", "none"],
      ["Blueberry Cheesecake", 280, "Baked New York style with blueberry compote.", true, "kitchen", "none"],
      ["Tiramisu", 300, "Espresso-soaked sponge with mascarpone cream.", true, "kitchen", "none"],
    ],
  },
  {
    category: "Quick Bites",
    items: [
      ["Paneer Tikka Sandwich", 220, "Smoky paneer, mint mayo and onions on toasted bread.", true, "kitchen", "none", ["bestseller"]],
      ["Chicken Pesto Sandwich", 260, "Grilled chicken, basil pesto and tomato.", false, "kitchen", "none"],
      ["Veg Puff", 60, "Flaky pastry with spiced potato and peas.", true, "kitchen", "none"],
      ["Egg Puff", 70, "Flaky pastry with a spiced egg masala.", false, "kitchen", "none"],
      ["Bombay Masala Toast", 180, "Spiced potato, chutney and cheese, grilled crisp.", true, "kitchen", "none"],
      ["Paneer Kathi Roll", 240, "Paneer tikka, onions and mint chutney in a flaky paratha.", true, "kitchen", "none"],
      ["Chicken Tikka Wrap", 280, "Chargrilled chicken tikka with slaw in a soft wrap.", false, "kitchen", "none"],
      ["Peri Peri Fries", 160, "Crisp fries tossed in peri peri spice.", true, "kitchen", "none"],
      ["Cheese Garlic Bread", 170, "Toasted baguette with garlic butter and mozzarella.", true, "kitchen", "none"],
    ],
  },
  {
    category: "Pasta & Bowls",
    items: [
      ["Penne Arrabbiata", 320, "Penne in a spicy tomato and garlic sauce.", true, "kitchen", "none"],
      ["Chicken Alfredo Pasta", 380, "Creamy parmesan sauce with grilled chicken.", false, "kitchen", "none"],
      ["Rajma Chawal Bowl", 260, "Slow-cooked kidney beans with steamed rice.", true, "kitchen", "none"],
      ["Butter Chicken Rice Bowl", 340, "Butter chicken over jeera rice.", false, "kitchen", "none", ["bestseller"]],
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
        // SO-6, confirmed by Amit on 13 Nov 2026: GST is added on the complete bill when the order is placed.
        pricesIncludeTax: false,
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
