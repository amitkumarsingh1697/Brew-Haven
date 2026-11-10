import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { StaffSession } from "@brew-haven/contracts";
import { setup, teardown, type TestEnv } from "./helpers.js";

let env: TestEnv;
beforeAll(async () => {
  env = await setup();
});
afterAll(async () => teardown(env));

const as = (s: StaffSession) => ({ authorization: `Bearer ${s.token}` });
type Inv = { ingredients: Array<{ id: string; name: string; onHand: number; status: string; lowAt: number | null; usedLast7Days: number }> };
const inventory = async (outletId = env.outletA, who = env.cashierA) =>
  ((await env.app.inject({ method: "GET", url: `/v1/staff/inventory?outletId=${outletId}`, headers: as(who) })).json() as Inv).ingredients;
const move = (payload: Record<string, unknown>, who = env.cashierA) =>
  env.app.inject({ method: "POST", url: "/v1/staff/inventory/movements", headers: as(who), payload: { outletId: env.outletA, ...payload } });

let milk: string;
let beans: string;
let oat: string;

describe("ingredients and recipes", () => {
  it("only the owner sets them up", async () => {
    expect((await env.app.inject({ method: "POST", url: "/v1/admin/ingredients", headers: as(env.cashierA), payload: { name: "Milk", unit: "ml" } })).statusCode).toBe(403);
    const mk = async (name: string, unit: string) => {
      const r = await env.app.inject({ method: "POST", url: "/v1/admin/ingredients", headers: as(env.admin), payload: { name, unit } });
      expect(r.statusCode).toBe(201);
      return r.json().id as string;
    };
    milk = await mk("Milk", "ml");
    beans = await mk("Coffee beans", "g");
    oat = await mk("Oat milk", "ml");
    expect((await env.app.inject({ method: "POST", url: "/v1/admin/ingredients", headers: as(env.admin), payload: { name: "Milk", unit: "ml" } })).statusCode).toBe(409);

    // A cappuccino uses 18 g of beans and 150 ml of milk; oat milk swaps the milk for oat.
    const cap = env.item("Cappuccino");
    const r = await env.app.inject({
      method: "PUT",
      url: `/v1/admin/recipes/${cap.id}`,
      headers: as(env.admin),
      payload: {
        rows: [
          { ingredientId: beans, quantity: 18 },
          { ingredientId: milk, quantity: 150 },
          { groupName: "Milk", optionName: "Oat milk", ingredientId: milk, quantity: -150 },
          { groupName: "Milk", optionName: "Oat milk", ingredientId: oat, quantity: 150 },
        ],
      },
    });
    expect(r.statusCode).toBe(200);
    const book = (await env.app.inject({ method: "GET", url: "/v1/admin/recipes", headers: as(env.admin) })).json() as { items: Array<{ id: string; rows: unknown[]; choices: unknown[] }> };
    const entry = book.items.find((i) => i.id === cap.id)!;
    expect(entry.rows).toHaveLength(4);
    expect(entry.choices.length).toBeGreaterThan(0);
  });

  it("rejects a recipe with a negative base amount", async () => {
    const r = await env.app.inject({ method: "PUT", url: `/v1/admin/recipes/${env.item("Cappuccino").id}`, headers: as(env.admin), payload: { rows: [{ ingredientId: milk, quantity: -5 }] } });
    expect(r.statusCode).toBe(400);
  });
});

describe("stock at a café", () => {
  it("receives, wastes and counts, keeping a running total", async () => {
    expect((await move({ kind: "RECEIVE", ingredientId: milk, quantity: 5000, note: "Morning delivery" })).json()).toMatchObject({ onHand: 5000 });
    expect((await move({ kind: "RECEIVE", ingredientId: beans, quantity: 1000 })).json()).toMatchObject({ onHand: 1000 });
    expect((await move({ kind: "WASTE", ingredientId: milk, quantity: 200, note: "Spilt" })).json()).toMatchObject({ onHand: 4800 });
    // The shelf has 4700: the count records the 100 ml difference.
    expect((await move({ kind: "COUNT", ingredientId: milk, quantity: 4700 })).json()).toMatchObject({ change: -100, onHand: 4700 });
    // Another café's staff can't touch this café's stock.
    expect((await move({ kind: "RECEIVE", ingredientId: milk, quantity: 1 }, env.cashierB)).statusCode).toBe(403);
    expect((await move({ kind: "RECEIVE", ingredientId: milk, quantity: 0 })).statusCode).toBe(400);
  });

  it("takes what an order uses when it's placed, including the choices", async () => {
    await env.placeOrder([env.line("Cappuccino", 2)]);
    await env.placeOrder([env.line("Cappuccino", 1, ["Oat milk"])]);
    const inv = await inventory();
    expect(inv.find((i) => i.id === milk)).toMatchObject({ onHand: 4700 - 300, usedLast7Days: 300 });
    expect(inv.find((i) => i.id === oat)).toMatchObject({ onHand: -150, status: "OUT" });
    expect(inv.find((i) => i.id === beans)).toMatchObject({ onHand: 1000 - 54 });
    // Tower B hasn't been touched.
    expect((await inventory(env.outletB, env.admin)).find((i) => i.id === milk)).toMatchObject({ onHand: 0, status: "UNTRACKED" });
  });

  it("flags low stock against the owner's level, and lists it across cafés", async () => {
    expect((await env.app.inject({ method: "PUT", url: "/v1/admin/low-stock", headers: as(env.cashierA), payload: { outletId: env.outletA, ingredientId: beans, lowAt: 1000 } })).statusCode).toBe(403);
    await env.app.inject({ method: "PUT", url: "/v1/admin/low-stock", headers: as(env.admin), payload: { outletId: env.outletA, ingredientId: beans, lowAt: 1000 } });
    expect((await inventory()).find((i) => i.id === beans)).toMatchObject({ status: "LOW", lowAt: 1000 });
    const low = (await env.app.inject({ method: "GET", url: "/v1/admin/low-stock", headers: as(env.admin) })).json() as { items: Array<{ ingredient: string; status: string }> };
    expect(low.items).toEqual(expect.arrayContaining([expect.objectContaining({ ingredient: "Coffee beans", status: "LOW" }), expect.objectContaining({ ingredient: "Oat milk", status: "OUT" })]));
  });

  it("shows the history and records changes in the activity log", async () => {
    const hist = (await env.app.inject({ method: "GET", url: `/v1/staff/inventory/history?outletId=${env.outletA}&ingredientId=${milk}`, headers: as(env.cashierA) })).json() as Array<{ kind: string }>;
    expect(hist.map((h) => h.kind)).toEqual(expect.arrayContaining(["RECEIVE", "WASTE", "COUNT", "SALE"]));
    const log = (await env.app.inject({ method: "GET", url: "/v1/admin/activity", headers: as(env.admin) })).json() as { entries: Array<{ summary: string }> };
    const summaries = log.entries.map((i) => i.summary);
    expect(summaries).toContain("Received 5000 ml of Milk");
    expect(summaries).toContain("Counted Milk: 4700 ml on the shelf");
    expect(summaries.some((s) => s.startsWith("Updated the recipe for Cappuccino"))).toBe(true);
  });
});
