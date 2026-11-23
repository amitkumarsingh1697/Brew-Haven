import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OrderView } from "@brew-haven/contracts";
import { setup, teardown, type TestEnv } from "./helpers.js";

// Refund policy K8: an outage cancels every open order at a café in one go, with full refunds.
let env: TestEnv;
beforeAll(async () => {
  env = await setup();
});
afterAll(async () => teardown(env));

const cancelAll = (outletId: string, who: TestEnv["admin"], payload: object) =>
  env.app.inject({ method: "POST", url: `/v1/staff/outlets/${outletId}/cancel-open-orders`, headers: env.auth(who), payload });
const act = (id: string, action: string, who: TestEnv["admin"]) =>
  env.app.inject({ method: "POST", url: `/v1/staff/orders/${id}/actions`, headers: env.auth(who), payload: { action } });

describe("cancel all open orders (K8)", () => {
  it("only the owner can do it, and a reason is needed", async () => {
    expect((await cancelAll(env.outletA, env.cashierA, { reason: "Power cut" })).statusCode).toBe(403);
    expect((await cancelAll(env.outletA, env.admin, { reason: "" })).statusCode).toBe(400);
  });

  it("refunds paid orders in full, voids unpaid counter orders, leaves ready orders and the other café alone", async () => {
    const placed = await env.placeOrder([env.line("Veg Puff")]);
    const preparing = await env.placeOrder([env.line("Café Latte")]);
    await act(preparing.orderId, "START", env.kitchenA);
    const ready = await env.placeOrder([env.line("Veg Puff")]);
    await act(ready.orderId, "START", env.kitchenA);
    await act(ready.orderId, "MARK_READY", env.kitchenA);
    const unpaid = (await env.app.inject({ method: "POST", url: "/v1/staff/orders/counter", headers: env.auth(env.cashierA), payload: { outletId: env.outletA, lines: [env.line("Café Latte")] } })).json() as OrderView;
    const other = await env.placeOrder([env.line("Veg Puff")], { outlet: "tower-b" });

    const r = await cancelAll(env.outletA, env.admin, { reason: "Power cut", closeCafe: true });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { cancelled: number; refundedPaise: number; cafeClosed: boolean };
    expect(body.cancelled).toBe(3);
    expect(body.refundedPaise).toBe(placed.totalPaise + preparing.totalPaise);
    expect(body.cafeClosed).toBe(true);

    for (const o of [placed, preparing]) {
      const v = await env.track(o.trackingToken);
      expect(v.state).toBe("CANCELLED");
      expect(v.refundedPaise).toBe(o.totalPaise);
    }
    expect((await env.track(ready.trackingToken)).state).toBe("READY");
    expect((await env.track(other.trackingToken)).state).toBe("PLACED");
    const board = (await env.app.inject({ method: "GET", url: `/v1/staff/orders?outletId=${env.outletA}&scope=live`, headers: env.auth(env.cashierA) })).json() as OrderView[];
    expect(board.find((x) => x.id === unpaid.id)).toBeUndefined();

    // The café stopped taking orders, and the owner's Activity shows what happened.
    const menu = (await env.app.inject({ method: "GET", url: "/v1/cafes/400-coffee/tower-a/menu" })).json();
    expect(menu.outlet.isOpen).toBe(false);
    const log = JSON.stringify((await env.app.inject({ method: "GET", url: "/v1/admin/activity", headers: env.auth(env.admin) })).json());
    expect(log).toMatch(/Cancelled 3 open orders at Tower A and stopped new orders: Power cut/);
  });
});
