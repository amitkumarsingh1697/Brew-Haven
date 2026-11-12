import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AdminSetup, MenuResponse, OrderView, OutletWithStations, StaffSession } from "@brew-haven/contracts";
import { setup, teardown, type TestEnv } from "./helpers.js";
import { eq } from "drizzle-orm";
import { tenants } from "../src/db/schema.js";

let env: TestEnv;
beforeAll(async () => {
  env = await setup();
});
afterAll(async () => teardown(env));

const as = (s: StaffSession) => ({ authorization: `Bearer ${s.token}` });
const call = async (method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, who: StaffSession, payload?: object) =>
  await env.app.inject({ method, url, headers: as(who), ...(payload ? { payload } : {}) });

describe("owner self-service (D-17)", () => {
  it("only the admin can change the setup", async () => {
    expect((await call("GET", "/v1/admin/setup", env.cashierA)).statusCode).toBe(403);
    expect((await call("POST", "/v1/admin/outlets", env.kitchenA, { name: "Tower C", pickupPrefix: "C" })).statusCode).toBe(403);
    expect((await call("POST", "/v1/admin/categories", env.cashierA, { name: "Sneaky" })).statusCode).toBe(403);
    const setup = (await call("GET", "/v1/admin/setup", env.admin)).json() as AdminSetup;
    expect(setup.outlets.map((o) => o.name)).toEqual(["Tower A", "Tower B"]);
    expect(setup.outlets[0]!.stations.map((s) => s.key).sort()).toEqual(["bar", "kitchen"]);
  });

  it("adds a new café that takes orders straight away, with its own kitchens, numbers and staff", async () => {
    // 1. New café; kitchens default to a copy of an existing café's.
    const r = await call("POST", "/v1/admin/outlets", env.admin, { name: "Tower C", pickupPrefix: "c", address: "Tower C lobby" });
    expect(r.statusCode).toBe(201);
    const c = r.json() as OutletWithStations;
    expect(c.slug).toBe("tower-c");
    expect(c.pickupPrefix).toBe("C");
    expect(c.stations.map((s) => s.key).sort()).toEqual(["bar", "kitchen"]);

    // Duplicate link or pickup letter is refused.
    expect((await call("POST", "/v1/admin/outlets", env.admin, { name: "Tower C", pickupPrefix: "D" })).statusCode).toBe(409);
    expect((await call("POST", "/v1/admin/outlets", env.admin, { name: "Tower D", pickupPrefix: "A" })).statusCode).toBe(409);

    // 2. Add a third kitchen there.
    const withGrill = (await call("POST", `/v1/admin/outlets/${c.id}/stations`, env.admin, { name: "Grill" })).json() as OutletWithStations;
    expect(withGrill.stations.map((s) => s.name)).toContain("Grill");

    // 3. The customer menu for the new café works, and the café appears in the outlet switcher.
    const menu = (await env.app.inject({ method: "GET", url: "/v1/cafes/400-coffee/tower-c/menu" })).json() as MenuResponse;
    expect(menu.outlet.name).toBe("Tower C");
    expect(menu.outlets.map((o) => o.slug)).toContain("tower-c");

    // 4. A customer orders and pays there; the pickup number uses the new letter.
    const order = await env.placeOrder([env.line("Cappuccino")], { outlet: "tower-c" });
    const view = await env.track(order.trackingToken);
    expect(view.pickupCode).toBe("C-001");

    // 5. The admin (signed in before the café existed) can run it without signing in again.
    const queue = await call("GET", `/v1/staff/orders?outletId=${c.id}`, env.admin);
    expect(queue.statusCode).toBe(200);
    expect((queue.json() as OrderView[]).map((o) => o.id)).toContain(order.orderId);
    expect(((await call("GET", "/v1/staff/outlets", env.admin)).json() as OutletWithStations[]).map((o) => o.name)).toContain("Tower C");

    // 6. New staff for the new café can sign in and see only that café.
    const created = await call("POST", "/v1/admin/staff", env.admin, { name: "Cashier · Tower C", role: "CASHIER", pin: "6666", outletIds: [c.id] });
    expect(created.statusCode).toBe(201);
    const login = await env.app.inject({ method: "POST", url: "/v1/staff/login", payload: { tenantSlug: "400-coffee", staffUserId: created.json().id, pin: "6666" } });
    const cashierC = login.json() as StaffSession;
    expect(cashierC.outlets.map((o) => o.name)).toEqual(["Tower C"]);
    expect((await call("GET", `/v1/staff/orders?outletId=${env.outletA}`, cashierC)).statusCode).toBe(403);
    expect((await call("POST", `/v1/staff/orders/${order.orderId}/actions`, cashierC, { action: "HAND_OVER" })).statusCode).toBe(409); // not READY yet, but allowed to try

    // 7. Closing the café stops new orders.
    await call("PATCH", `/v1/admin/outlets/${c.id}`, env.admin, { isOpen: false });
    await expect(env.placeOrder([env.line("Cappuccino")], { outlet: "tower-c" })).rejects.toThrow(/409/);
  });

  it("manages the menu: sections, items with options, prices, and which café sells what", async () => {
    const cat = (await call("POST", "/v1/admin/categories", env.admin, { name: "Smoothies" })).json() as { id: string };
    const bad = await call("POST", "/v1/admin/items", env.admin, { categoryId: cat.id, name: "Bad", pricePaise: 50, isVeg: true, stationKey: "bar" });
    expect(bad.statusCode).toBe(400);
    const badGroup = await call("POST", "/v1/admin/items", env.admin, {
      categoryId: cat.id, name: "Bad2", pricePaise: 20000, isVeg: true, stationKey: "bar",
      modifierGroups: [{ name: "Size", minSelect: 2, maxSelect: 1, options: [{ name: "R", pricePaise: 0 }] }],
    });
    expect(badGroup.statusCode).toBe(400);

    const created = await call("POST", "/v1/admin/items", env.admin, {
      categoryId: cat.id,
      name: "Mango Smoothie",
      description: "Alphonso mango, yoghurt and honey.",
      pricePaise: 22000,
      isVeg: true,
      tags: ["seasonal"],
      stationKey: "bar",
      modifierGroups: [{ name: "Size", minSelect: 1, maxSelect: 1, options: [{ name: "Regular", pricePaise: 0 }, { name: "Large", pricePaise: 5000 }] }],
    });
    expect(created.statusCode).toBe(201);
    const item = created.json() as AdminSetup["items"][number];

    const menuA = async () => (await env.app.inject({ method: "GET", url: "/v1/cafes/400-coffee/tower-a/menu" })).json() as MenuResponse;
    const find = (m: MenuResponse) => m.categories.flatMap((c) => c.items).find((i) => i.id === item.id);
    expect(find(await menuA())?.modifierGroups[0]?.options.map((o) => o.name)).toEqual(["Regular", "Large"]);

    // Price change applies to new orders; existing orders keep their price.
    const before = await env.placeOrder([{ itemId: item.id, quantity: 1, modifierIds: [find(await menuA())!.modifierGroups[0]!.options[1]!.id] }]);
    await call("PATCH", `/v1/admin/items/${item.id}`, env.admin, { pricePaise: 24000, modifierGroups: [{ name: "Size", minSelect: 1, maxSelect: 1, options: [{ name: "Regular", pricePaise: 0 }] }] });
    expect(find(await menuA())?.pricePaise).toBe(24000);
    expect((await env.track(before.trackingToken)).totalPaise).toBe(27000);
    expect((await env.track(before.trackingToken)).lines[0]!.modifiers[0]!.name).toBe("Large");

    // Not sold at Tower B: hidden from its menu and refused if ordered.
    await call("PUT", "/v1/admin/listings", env.admin, { outletId: env.outletB, itemId: item.id, listed: false });
    const menuB = (await env.app.inject({ method: "GET", url: "/v1/cafes/400-coffee/tower-b/menu" })).json() as MenuResponse;
    expect(find(menuB)).toBeUndefined();
    expect(find(await menuA())).toBeDefined();
    const regular = find(await menuA())!.modifierGroups[0]!.options[0]!.id;
    await expect(env.placeOrder([{ itemId: item.id, quantity: 1, modifierIds: [regular] }], { outlet: "tower-b" })).rejects.toThrow(/400/);

    // Hiding a whole section removes it from every café's menu.
    await call("PATCH", `/v1/admin/categories/${cat.id}`, env.admin, { name: "Smoothies", active: false });
    expect((await menuA()).categories.some((c) => c.name === "Smoothies")).toBe(false);

    const setup = (await call("GET", "/v1/admin/setup", env.admin)).json() as AdminSetup;
    expect(setup.items.find((i) => i.id === item.id)?.unlistedAt).toEqual([env.outletB]);
  });

  it("manages staff: reset PIN, deactivate, and protects the admin's own access", async () => {
    const u = (await call("POST", "/v1/admin/staff", env.admin, { name: "Temp Kitchen", role: "KITCHEN", pin: "7777", outletIds: [env.outletA] })).json() as { id: string };
    const tryLogin = (pin: string) => env.app.inject({ method: "POST", url: "/v1/staff/login", payload: { tenantSlug: "400-coffee", staffUserId: u.id, pin } });
    expect((await tryLogin("7777")).statusCode).toBe(200);
    await call("PATCH", `/v1/admin/staff/${u.id}`, env.admin, { pin: "8888" });
    expect((await tryLogin("8888")).statusCode).toBe(200);
    await call("PATCH", `/v1/admin/staff/${u.id}`, env.admin, { active: false });
    expect((await tryLogin("8888")).statusCode).toBe(401);
    expect((await call("PATCH", `/v1/admin/staff/${env.admin.user.id}`, env.admin, { active: false })).statusCode).toBe(409);
    expect((await call("POST", "/v1/admin/staff", env.admin, { name: "X", role: "CASHIER", pin: "1234", outletIds: [] })).statusCode).toBe(400);
  });

  it("updates café settings shown to customers", async () => {
    const r = await call("PUT", "/v1/admin/settings", env.admin, { displayName: "400 Coffee Cafe", tagline: "Fresh every morning", greeting: "Hi there! Ready for a coffee?", managerName: "Meera", taxRateBps: 500 });
    expect(r.statusCode).toBe(200);
    const menu = (await env.app.inject({ method: "GET", url: "/v1/cafes/400-coffee/tower-a/menu" })).json() as MenuResponse;
    expect(menu.tenant.branding.managerName).toBe("Meera");
    expect(menu.tenant.branding.greeting).toBe("Hi there! Ready for a coffee?");
  });

  it("gives customers the filmed barista when one is set, and keeps it when the owner saves settings", async () => {
    const menuOf = async () => ((await env.app.inject({ method: "GET", url: "/v1/cafes/400-coffee/tower-a/menu" })).json() as MenuResponse).tenant.branding;
    expect((await menuOf()).baristaVideo).toBeNull();
    const [t] = await env.db.select().from(tenants).where(eq(tenants.slug, "400-coffee"));
    await env.db.update(tenants).set({ branding: { ...(t!.branding as object), baristaVideo: { idle: "/baristas/400-coffee/idle.mp4", wave: "/baristas/400-coffee/wave.mp4" } } }).where(eq(tenants.id, t!.id));
    expect((await menuOf()).baristaVideo).toEqual({ idle: "/baristas/400-coffee/idle.mp4", wave: "/baristas/400-coffee/wave.mp4" });
    await call("PUT", "/v1/admin/settings", env.admin, { displayName: "400 Coffee Cafe", tagline: "Fresh every morning", greeting: "Hello!", managerName: "Meera", taxRateBps: 500 });
    expect((await menuOf()).baristaVideo?.idle).toBe("/baristas/400-coffee/idle.mp4");
  });

  it("keeps the last kitchen of a café", async () => {
    const setup = (await call("GET", "/v1/admin/setup", env.admin)).json() as AdminSetup;
    const b = setup.outlets.find((o) => o.id === env.outletB)!;
    expect((await call("DELETE", `/v1/admin/stations/${b.stations[0]!.id}`, env.admin)).statusCode).toBe(200);
    expect((await call("DELETE", `/v1/admin/stations/${b.stations[1]!.id}`, env.admin)).statusCode).toBe(409);
  });
});
