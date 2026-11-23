import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { OrderView } from "@brew-haven/contracts";
import { orders } from "../src/db/schema.js";
import { setup, teardown, type TestEnv } from "./helpers.js";

// Refund policy K13/K14: customers report a problem from their order link on the day of the order.
let env: TestEnv;
const alerts: Array<{ key: string; title: string }> = [];
beforeAll(async () => {
  env = await setup();
  env.ctx.alerter = { name: "test", send: async (a) => void alerts.push(a) };
});
afterAll(async () => teardown(env));

const act = (id: string, action: string) => env.app.inject({ method: "POST", url: `/v1/staff/orders/${id}/actions`, headers: env.auth(env.admin), payload: { action } });
const report = (token: string, payload: object) => env.app.inject({ method: "POST", url: `/v1/track/${token}/problem`, payload });
const checks = async () => (await env.app.inject({ method: "GET", url: "/v1/admin/payment-checks", headers: env.auth(env.admin) })).json() as { items: Array<{ kind: string; orderId: string; message: string }> };
async function served() {
  const o = await env.placeOrder([env.line("Veg Puff")]);
  for (const a of ["START", "MARK_READY", "HAND_OVER"]) await act(o.orderId, a);
  return o;
}

describe("report a problem (K14)", () => {
  it("only once the order is served", async () => {
    const o = await env.placeOrder([env.line("Veg Puff")]);
    expect((await env.track(o.trackingToken)).canReportProblem).toBe(false);
    expect((await report(o.trackingToken, { category: "QUALITY", note: "Cold" })).statusCode).toBe(409);
  });

  it("goes to the owner's payment checks, once per order, and staff can close it", async () => {
    const o = await served();
    expect((await env.track(o.trackingToken)).canReportProblem).toBe(true);
    expect((await report(o.trackingToken, { category: "QUALITY", note: "" })).statusCode).toBe(400);
    const r = await report(o.trackingToken, { category: "QUALITY", note: "The puff was cold" });
    expect(r.statusCode).toBe(200);
    const v = r.json() as OrderView;
    expect(v.problem).toMatchObject({ category: "QUALITY", status: "OPEN", note: "The puff was cold" });
    expect(v.canReportProblem).toBe(false);
    expect((await report(o.trackingToken, { category: "OTHER", note: "Again" })).statusCode).toBe(409);

    const item = (await checks()).items.find((i) => i.kind === "PROBLEM_REPORTED" && i.orderId === o.orderId);
    expect(item?.message).toMatch(/The puff was cold/);
    expect(alerts).toHaveLength(0);

    expect((await env.app.inject({ method: "POST", url: `/v1/staff/orders/${o.orderId}/problem/resolve`, headers: env.auth(env.kitchenA) })).statusCode).toBe(403);
    const done = await env.app.inject({ method: "POST", url: `/v1/staff/orders/${o.orderId}/problem/resolve`, headers: env.auth(env.cashierA) });
    expect(done.statusCode).toBe(200);
    expect((done.json() as OrderView).problem?.status).toBe("RESOLVED");
    expect((await checks()).items.find((i) => i.orderId === o.orderId)).toBeUndefined();
  });

  it("is refused after the day of the order", async () => {
    const o = await served();
    await env.db.update(orders).set({ businessDate: "2020-01-01" }).where(eq(orders.id, o.orderId));
    expect((await env.track(o.trackingToken)).canReportProblem).toBe(false);
    const r = await report(o.trackingToken, { category: "QUALITY", note: "Cold" });
    expect(r.statusCode).toBe(409);
    expect(r.json().error.message).toMatch(/on the day of the order/);
  });
});

describe("food safety (K13)", () => {
  it("a food-safety report alerts straight away, and a refund closes the report", async () => {
    const o = await served();
    await report(o.trackingToken, { category: "SAFETY", note: "Found a hair in it" });
    await new Promise((r) => setTimeout(r, 20));
    expect(alerts.some((a) => a.title.startsWith("Food-safety report"))).toBe(true);
    expect((await checks()).items.find((i) => i.orderId === o.orderId)?.message).toMatch(/^FOOD SAFETY/);

    const refund = await env.app.inject({ method: "POST", url: `/v1/staff/orders/${o.orderId}/refund`, headers: env.auth(env.admin), payload: { wholeOrder: true, category: "SAFETY" } });
    expect(refund.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 20));
    expect(alerts.some((a) => a.title.startsWith("Food-safety refund"))).toBe(true);
    expect((await env.track(o.trackingToken)).problem?.status).toBe("RESOLVED");
  });
});
