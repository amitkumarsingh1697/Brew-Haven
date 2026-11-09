import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OrderView, StaffSession } from "@brew-haven/contracts";
import { setup, teardown, type TestEnv } from "./helpers.js";

let env: TestEnv;
beforeAll(async () => {
  env = await setup();
});
afterAll(async () => teardown(env));

const as = (s: StaffSession) => ({ authorization: `Bearer ${s.token}` });
const walkIn = async (method: "CASH" | "UPI_COUNTER", item: string, outletId = env.outletA, who = env.cashierA) =>
  (await env.app.inject({ method: "POST", url: "/v1/staff/orders/walk-in", headers: as(who), payload: { outletId, method, lines: [env.line(item)] } })).json() as OrderView;

describe("closing the day at the counter", () => {
  it("works out the cash that should be in the drawer and records the difference", async () => {
    await walkIn("CASH", "Cappuccino"); // ₹180 cash
    await walkIn("CASH", "Masala Chai"); // ₹90 cash
    await walkIn("UPI_COUNTER", "Americano"); // ₹150, not cash
    const rejected = await walkIn("CASH", "Espresso"); // ₹120 cash, then handed back
    const r = await env.app.inject({ method: "POST", url: `/v1/staff/orders/${rejected.id}/reject`, headers: as(env.cashierA), payload: { reason: "Customer changed their mind" } });
    expect(r.statusCode).toBe(200);

    const before = (await env.app.inject({ method: "GET", url: `/v1/staff/close?outletId=${env.outletA}`, headers: as(env.cashierA) })).json();
    expect(before.cash).toEqual({ takenPaise: 39000, refundedPaise: 12000 });
    expect(before.close).toBeNull();

    // Float ₹1,000; expected ₹1,000 + ₹390 − ₹120 = ₹1,270; counted ₹1,250 → ₹20 short.
    const closed = await env.app.inject({ method: "POST", url: "/v1/staff/close", headers: as(env.cashierA), payload: { outletId: env.outletA, openingFloatPaise: 100000, countedCashPaise: 125000, note: "₹20 note missing" } });
    expect(closed.statusCode).toBe(200);
    expect(closed.json()).toMatchObject({ expectedCashPaise: 127000, variancePaise: -2000, closedBy: "Cashier · Tower A", note: "₹20 note missing" });

    // Re-closing the same day replaces the count.
    const again = await env.app.inject({ method: "POST", url: "/v1/staff/close", headers: as(env.cashierA), payload: { outletId: env.outletA, openingFloatPaise: 100000, countedCashPaise: 127000 } });
    expect(again.json()).toMatchObject({ variancePaise: 0 });
    const after = (await env.app.inject({ method: "GET", url: `/v1/staff/close?outletId=${env.outletA}`, headers: as(env.cashierA) })).json();
    expect(after.close.variancePaise).toBe(0);

    const log = (await env.app.inject({ method: "GET", url: "/v1/admin/activity", headers: as(env.admin) })).json() as { entries: Array<{ summary: string }> };
    expect(log.entries.map((e) => e.summary)).toEqual(expect.arrayContaining(["Closed the day: counted ₹1,250, cash short by ₹20", "Closed the day: counted ₹1,270, cash matched"]));
  });

  it("kitchen staff and other cafés' cashiers can't close a café's day", async () => {
    expect((await env.app.inject({ method: "GET", url: `/v1/staff/close?outletId=${env.outletA}`, headers: as(env.kitchenA) })).statusCode).toBe(403);
    expect((await env.app.inject({ method: "POST", url: "/v1/staff/close", headers: as(env.cashierB), payload: { outletId: env.outletA, openingFloatPaise: 0, countedCashPaise: 0 } })).statusCode).toBe(403);
  });
});

describe("owner reports", () => {
  it("adds up sales across cafés: totals, by café, by method, top items and busy hours", async () => {
    await env.placeOrder([env.line("Cappuccino", 2)]); // online, Tower A, ₹360
    await env.placeOrder([env.line("Café Latte")], { outlet: "tower-b" }); // online, Tower B, ₹190
    await walkIn("CASH", "Café Latte", env.outletB, env.cashierB); // ₹190
    await env.placeOrder([env.line("Americano")], { pay: false }); // unpaid: not a sale

    expect((await env.app.inject({ method: "GET", url: "/v1/admin/reports", headers: as(env.cashierA) })).statusCode).toBe(403);
    const r = (await env.app.inject({ method: "GET", url: "/v1/admin/reports", headers: as(env.admin) })).json();
    // Today: from the first test, A has 3 sold walk-ins (₹420) and 1 cancelled; plus ₹360 online. B has ₹380.
    expect(r.totals).toMatchObject({ orders: 6, cancelled: 1, netPaise: 42000 + 36000 + 38000 });
    const a = r.byCafe.find((c: { name: string }) => c.name === "Tower A");
    const b = r.byCafe.find((c: { name: string }) => c.name === "Tower B");
    expect(a).toMatchObject({ orders: 4, cancelled: 1, netPaise: 78000, online: 1, counter: 3 });
    expect(b).toMatchObject({ orders: 2, netPaise: 38000, online: 1, counter: 1 });
    expect(r.byMethod).toMatchObject({ ONLINE: 55000, CASH: 39000 + 19000, UPI_COUNTER: 15000 });
    expect(r.topItems[0]).toMatchObject({ name: "Cappuccino", quantity: 3 });
    expect(r.busiestHours.reduce((s: number, h: { orders: number }) => s + h.orders, 0)).toBe(6);
    expect(r.byDay).toHaveLength(1);
    expect(r.closes).toHaveLength(1);
    expect(r.totals.averageOrderPaise).toBe(Math.round(116000 / 6));

    const onlyB = (await env.app.inject({ method: "GET", url: `/v1/admin/reports?outletId=${env.outletB}`, headers: as(env.admin) })).json();
    expect(onlyB.totals.netPaise).toBe(38000);
  });

  it("checks the date range", async () => {
    const bad = await env.app.inject({ method: "GET", url: "/v1/admin/reports?from=2026-01-01&to=2026-12-31", headers: as(env.admin) });
    expect(bad.statusCode).toBe(400);
    const week = (await env.app.inject({ method: "GET", url: "/v1/admin/reports?from=2026-11-01&to=2026-11-07", headers: as(env.admin) })).json();
    expect(week.byDay).toHaveLength(7);
    expect(week.totals.orders).toBe(0);
  });
});
