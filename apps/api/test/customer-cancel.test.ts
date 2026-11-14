import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { CounterOrderResponse, OrderView, StaffSession } from "@brew-haven/contracts";
import { orders } from "../src/db/schema.js";
import { setup, teardown, type TestEnv } from "./helpers.js";

// Refund policy K1, K2, K4, C8: the customer cancels from their order link.
let env: TestEnv;
beforeAll(async () => {
  env = await setup({ pricesIncludeTax: false });
});
afterAll(async () => teardown(env));

const as = (s: StaffSession) => ({ authorization: `Bearer ${s.token}` });
const cancel = (token: string) => env.app.inject({ method: "POST", url: `/v1/track/${token}/cancel` });
const act = (id: string, action: string, who: StaffSession) => env.app.inject({ method: "POST", url: `/v1/staff/orders/${id}/actions`, headers: as(who), payload: { action } });
const backdate = (id: string, minutes: number) => env.db.update(orders).set({ placedAt: new Date(Date.now() - minutes * 60_000) }).where(eq(orders.id, id));

describe("customer cancels an online order", () => {
  it("is free before the kitchen starts, with a full refund to the source", async () => {
    const o = await env.placeOrder([env.line("Café Latte"), env.line("Veg Puff")]);
    const before = await env.track(o.trackingToken);
    expect(before.cancel).toEqual({ allowed: true, kind: "BEFORE_KITCHEN", lateFrom: null });

    const r = await cancel(o.trackingToken);
    expect(r.statusCode).toBe(200);
    const after = r.json() as OrderView;
    expect(after.state).toBe("CANCELLED");
    expect(after.cancelReason).toMatch(/before the kitchen started/);
    expect(after.refundedPaise).toBe(after.paidPaise);
    expect(after.cancel.allowed).toBe(false);

    // A second tap changes nothing and never refunds twice.
    const again = (await cancel(o.trackingToken)).json() as OrderView;
    expect(again.refundedPaise).toBe(after.paidPaise);
    expect(again.refunds).toHaveLength(after.refunds.length);

    // The kitchen can no longer start it.
    expect((await act(o.orderId, "START", env.kitchenA)).statusCode).toBe(409);
  });

  it("loses the race once the kitchen has started (K2), with a clear message", async () => {
    const o = await env.placeOrder([env.line("Café Latte")]);
    expect((await act(o.orderId, "START", env.kitchenA)).json().state).toBe("PREPARING");
    const view = await env.track(o.trackingToken);
    expect(view.cancel.allowed).toBe(false);
    expect(view.cancel.lateFrom).not.toBeNull();
    const r = await cancel(o.trackingToken);
    expect(r.statusCode).toBe(409);
    expect(r.json().error.message).toMatch(/started making your order/);
    expect((await env.track(o.trackingToken)).state).toBe("PREPARING");
  });

  it("can cancel a late order for a full refund (K4), using the owner's setting", async () => {
    const o = await env.placeOrder([env.line("Café Latte")]);
    await act(o.orderId, "START", env.kitchenA);
    await backdate(o.orderId, 31);
    expect((await env.track(o.trackingToken)).cancel).toMatchObject({ allowed: true, kind: "LATE" });
    const r = await cancel(o.trackingToken);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ state: "CANCELLED", cancelReason: "Cancelled by the customer: the order was late" });
    expect((r.json() as OrderView).refundedPaise).toBe((r.json() as OrderView).paidPaise);

    // The owner gives the kitchen longer: the same delay is no longer late.
    const s = await env.app.inject({ method: "GET", url: "/v1/admin/setup", headers: as(env.admin) });
    const t = s.json().tenant;
    const put = await env.app.inject({ method: "PUT", url: "/v1/admin/settings", headers: as(env.admin), payload: { displayName: t.branding.displayName, taxRateBps: t.taxRateBps, lateCancelMinutes: 45 } });
    expect(put.statusCode).toBe(200);
    expect(put.json().tenant.lateCancelMinutes).toBe(45);
    const o2 = await env.placeOrder([env.line("Café Latte")]);
    await act(o2.orderId, "START", env.kitchenA);
    await backdate(o2.orderId, 31);
    expect((await cancel(o2.trackingToken)).statusCode).toBe(409);
  });

  it("can't cancel once ready or collected, or before paying", async () => {
    const o = await env.placeOrder([env.line("Veg Puff")]);
    await act(o.orderId, "START", env.kitchenA);
    await act(o.orderId, "MARK_READY", env.kitchenA);
    await backdate(o.orderId, 90);
    expect((await env.track(o.trackingToken)).cancel.allowed).toBe(false);
    expect((await cancel(o.trackingToken)).statusCode).toBe(409);

    const unpaid = await env.placeOrder([env.line("Veg Puff")], { pay: false });
    const r = await cancel(unpaid.trackingToken);
    expect(r.statusCode).toBe(409);
    expect(r.json().error.message).toMatch(/isn't paid yet/);
  });

  it("counter orders are cancelled by the cashier, not from the customer's link (C8)", async () => {
    const r = await env.app.inject({ method: "POST", url: "/v1/staff/orders/counter", headers: as(env.cashierA), payload: { outletId: env.outletA, lines: [env.line("Café Latte")] } });
    const c = r.json() as CounterOrderResponse;
    await env.app.inject({ method: "POST", url: `/v1/staff/orders/${c.order.id}/mark-paid`, headers: as(env.cashierA), payload: { method: "CASH", tenderedPaise: 50_000 } });
    const token = c.payUrl.split("/order/")[1]!;
    expect((await env.track(token)).cancel.allowed).toBe(false);
    const res = await cancel(token);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.message).toMatch(/ask the cashier/);
  });

  it("refuses a made-up link", async () => {
    expect((await cancel("not-a-real-token-123456")).statusCode).toBe(404);
  });
});
