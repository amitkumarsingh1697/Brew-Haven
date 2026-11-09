import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPin } from "../src/auth.js";
import { outlets, staffUsers, tenants } from "../src/db/schema.js";
import { setup, teardown, type TestEnv } from "./helpers.js";

let env: TestEnv;
beforeAll(async () => {
  env = await setup();
});
afterAll(async () => teardown(env));

describe("tenant isolation (ADR-0005, TC-001)", () => {
  it("another café's staff cannot see or change 400 Coffee orders", async () => {
    const [t] = await env.db.insert(tenants).values({ slug: "other-cafe", name: "Other Cafe" }).returning();
    const [o] = await env.db.insert(outlets).values({ tenantId: t!.id, slug: "main", name: "Main", pickupPrefix: "M" }).returning();
    const [u] = await env.db.insert(staffUsers).values({ tenantId: t!.id, name: "Other admin", role: "ADMIN", pinHash: await hashPin("9999"), outletIds: [o!.id] }).returning();
    const login = await env.app.inject({ method: "POST", url: "/v1/staff/login", payload: { tenantSlug: "other-cafe", staffUserId: u!.id, pin: "9999" } });
    const other = login.json();
    expect(other.outlets).toHaveLength(1);

    const order = await env.placeOrder([env.line("Veg Puff")]);
    const h = { authorization: `Bearer ${other.token}` };
    expect((await env.app.inject({ method: "GET", url: `/v1/staff/orders?outletId=${env.outletA}`, headers: h })).statusCode).toBe(403);
    expect((await env.app.inject({ method: "POST", url: `/v1/staff/orders/${order.orderId}/actions`, headers: h, payload: { action: "START" } })).statusCode).toBe(404);
    expect((await env.app.inject({ method: "POST", url: `/v1/staff/orders/${order.orderId}/reject`, headers: h, payload: { reason: "nope nope" } })).statusCode).toBe(404);
    expect((await env.app.inject({ method: "GET", url: `/v1/staff/summary?outletId=${env.outletA}`, headers: h })).statusCode).toBe(403);
  });

  it("a staff user cannot log in through another café's slug", async () => {
    const u = env.users.users[0]!;
    const r = await env.app.inject({ method: "POST", url: "/v1/staff/login", payload: { tenantSlug: "other-cafe", staffUserId: u.id, pin: "1111" } });
    expect(r.statusCode).toBe(401);
  });
});
