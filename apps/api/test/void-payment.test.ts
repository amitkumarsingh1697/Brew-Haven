import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OrderView } from "@brew-haven/contracts";
import { setup, teardown, type TestEnv } from "./helpers.js";

// Refund policy C2: undo a counter payment marked by hand by mistake (or the customer walked off without paying).
let env: TestEnv;
beforeAll(async () => {
  env = await setup();
});
afterAll(async () => teardown(env));

type Who = TestEnv["admin"];
const counter = async () => (await env.app.inject({ method: "POST", url: "/v1/staff/orders/counter", headers: env.auth(env.cashierA), payload: { outletId: env.outletA, lines: [env.line("Café Latte")] } })).json().order as OrderView;
const markCash = (id: string, tenderedPaise: number) => env.app.inject({ method: "POST", url: `/v1/staff/orders/${id}/mark-paid`, headers: env.auth(env.cashierA), payload: { method: "CASH", tenderedPaise } });
const voidPay = (id: string, who: Who, reason = "Marked the wrong order paid") => env.app.inject({ method: "POST", url: `/v1/staff/orders/${id}/void-payment`, headers: env.auth(who), payload: { reason } });
const takings = async () => (await env.app.inject({ method: "GET", url: `/v1/staff/summary?outletId=${env.outletA}`, headers: env.auth(env.admin) })).json() as { capturedByMethod: Record<string, number> };

describe("undo a payment marked by hand (C2)", () => {
  it("the owner voids it: order cancelled, no refund, cash takings drop, logged", async () => {
    const o = await counter();
    expect((await markCash(o.id, 100_000)).statusCode).toBe(200);
    const before = (await takings()).capturedByMethod.CASH ?? 0;

    expect((await voidPay(o.id, env.cashierA)).statusCode).toBe(403);
    const r = await voidPay(o.id, env.admin);
    expect(r.statusCode).toBe(200);
    const v = r.json() as OrderView;
    expect(v.state).toBe("CANCELLED");
    expect(v.refundedPaise).toBe(0);
    expect(v.paidPaise).toBe(0);
    expect((await takings()).capturedByMethod.CASH ?? 0).toBe(before - o.totalPaise);

    // Once is enough.
    expect((await voidPay(o.id, env.admin)).statusCode).toBe(409);
    const log = JSON.stringify((await env.app.inject({ method: "GET", url: "/v1/admin/activity", headers: env.auth(env.admin) })).json());
    expect(log).toMatch(/Undid the .* payment marked by hand on order .*: Marked the wrong order paid/);
  });

  it("is refused for online orders and for orders that were already handed over", async () => {
    const online = await env.placeOrder([env.line("Veg Puff")]);
    expect((await voidPay(online.orderId, env.admin)).statusCode).toBe(409);

    const o = await counter();
    await markCash(o.id, 100_000);
    for (const action of ["START", "MARK_READY", "HAND_OVER"]) {
      await env.app.inject({ method: "POST", url: `/v1/staff/orders/${o.id}/actions`, headers: env.auth(env.admin), payload: { action } });
    }
    expect((await voidPay(o.id, env.admin)).statusCode).toBe(409);
  });
});
