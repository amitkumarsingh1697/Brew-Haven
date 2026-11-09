import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { StaffSession } from "@brew-haven/contracts";
import { buildApp } from "../src/app.js";
import { setup, teardown, testConfig, type TestEnv } from "./helpers.js";

let env: TestEnv;
beforeAll(async () => {
  env = await setup();
});
afterAll(async () => teardown(env));

const as = (s: StaffSession) => ({ authorization: `Bearer ${s.token}` });
type Activity = { entries: Array<{ actor: string; action: string; summary: string; outlet: string | null }>; nextBefore: number | null };
const activity = async (q = "") => (await env.app.inject({ method: "GET", url: `/v1/admin/activity${q}`, headers: as(env.admin) })).json() as Activity;

describe("audit trail", () => {
  it("records staff order actions in plain language, with who did it and where", async () => {
    const order = await env.placeOrder([env.line("Cappuccino")]);
    const code = (await env.track(order.trackingToken)).pickupCode;
    const steps: Array<[StaffSession, string]> = [
      [env.kitchenA, "START"],
      [env.kitchenA, "MARK_READY"],
      [env.cashierA, "HAND_OVER"],
    ];
    for (const [who, action] of steps) {
      const r = await env.app.inject({ method: "POST", url: `/v1/staff/orders/${order.orderId}/actions`, headers: as(who), payload: { action } });
      expect(r.statusCode).toBe(200);
    }
    const log = await activity();
    const orderEntries = log.entries.filter((e) => e.action.startsWith("order."));
    expect(orderEntries.map((e) => [e.actor, e.summary])).toEqual([
      ["Cashier · Tower A", `Handed over order ${code}`],
      ["Kitchen · Tower A", `Marked ready order ${code}`],
      ["Kitchen · Tower A", `Started order ${code}`],
    ]);
    expect(orderEntries[0]!.outlet).toBe("Tower A");
    // sign-ins are recorded too
    expect(log.entries.some((e) => e.action === "staff.sign_in" && e.actor === "Owner (Admin)")).toBe(true);
  });

  it("records owner setup changes and never stores PINs", async () => {
    const created = await env.app.inject({ method: "POST", url: "/v1/admin/staff", headers: as(env.admin), payload: { name: "Temp Barista", role: "CASHIER", pin: "4321", outletIds: [env.outletA] } });
    const id = created.json().id as string;
    await env.app.inject({ method: "PATCH", url: `/v1/admin/staff/${id}`, headers: as(env.admin), payload: { pin: "9876" } });
    await env.app.inject({ method: "PATCH", url: `/v1/admin/outlets/${env.outletB}`, headers: as(env.admin), payload: { isOpen: false } });
    const latte = env.item("Café Latte");
    await env.app.inject({ method: "PUT", url: "/v1/admin/listings", headers: as(env.admin), payload: { outletId: env.outletB, itemId: latte.id, listed: false } });
    await env.app.inject({ method: "PUT", url: "/v1/staff/stock", headers: as(env.cashierA), payload: { outletId: env.outletA, itemId: latte.id, available: false } });

    const summaries = (await activity()).entries.map((e) => e.summary);
    expect(summaries).toEqual(
      expect.arrayContaining([
        "Added team member Temp Barista",
        "Reset the PIN for Temp Barista",
        "Closed Tower B for orders",
        "Stopped selling Café Latte at Tower B",
        "Marked sold out: Café Latte",
      ]),
    );
    const raw = await env.pool.query("select meta::text as m from audit_log where meta is not null");
    expect(raw.rows.some((r: { m: string }) => r.m.includes("4321") || r.m.includes("9876"))).toBe(false);
  });

  it("only the owner can read it, and it pages and filters by café", async () => {
    expect((await env.app.inject({ method: "GET", url: "/v1/admin/activity", headers: as(env.cashierA) })).statusCode).toBe(403);
    const page1 = await activity("?limit=2");
    expect(page1.entries).toHaveLength(2);
    expect(page1.nextBefore).not.toBeNull();
    const page2 = await activity(`?limit=2&before=${page1.nextBefore}`);
    expect(page2.entries[0]!.summary).not.toBe(page1.entries[0]!.summary);
    const towerB = await activity(`?outletId=${env.outletB}`);
    expect(towerB.entries.length).toBeGreaterThan(0);
    expect(towerB.entries.every((e) => e.outlet === "Tower B")).toBe(true);
  });

  it("failed changes are not recorded", async () => {
    const before = (await activity("?limit=200")).entries.length;
    const r = await env.app.inject({ method: "POST", url: "/v1/admin/outlets", headers: as(env.admin), payload: { name: "Tower A", pickupPrefix: "A" } });
    expect(r.statusCode).toBe(409);
    expect((await activity("?limit=200")).entries.length).toBe(before);
  });
});

describe("abuse protection", () => {
  it("limits how fast one device can place orders, with a friendly message", async () => {
    const { app } = await buildApp({ config: testConfig, db: env.db, rateLimit: true });
    await app.ready();
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) {
      const r = await app.inject({ method: "POST", url: "/v1/cafes/400-coffee/tower-a/orders", headers: { "idempotency-key": `rate-limit-test-${i}` }, payload: {} });
      codes.push(r.statusCode);
      if (r.statusCode === 429) expect(r.json().error).toMatchObject({ code: "RATE_LIMITED", message: expect.stringMatching(/Too many requests/) });
    }
    expect(codes.slice(0, 10).every((c) => c === 400)).toBe(true); // invalid body, but counted
    expect(codes.slice(10)).toEqual([429, 429]);
    await app.close();
  });

  it("sends security headers", async () => {
    const r = await env.app.inject({ method: "GET", url: "/health" });
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    expect(r.headers["strict-transport-security"]).toBeDefined();
    expect(r.headers["x-frame-options"]).toBeDefined();
  });
});
