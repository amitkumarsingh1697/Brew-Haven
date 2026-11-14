import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { OrderView, StaffSession } from "@brew-haven/contracts";
import { orderEvents } from "../src/db/schema.js";
import { SimulatedProvider } from "../src/payments/simulated.js";
import { runSweeps } from "../src/services/flows.js";
import { setup, teardown, type TestEnv } from "./helpers.js";

// Refund policy K10 (not collected) and P2-P4 (captures that can't place an order are given back).
let env: TestEnv;
beforeAll(async () => {
  env = await setup();
});
afterAll(async () => teardown(env));

const act = (id: string, action: string, who: StaffSession) =>
  env.app.inject({ method: "POST", url: `/v1/staff/orders/${id}/actions`, headers: { authorization: `Bearer ${who.token}` }, payload: { action } });

async function readyOrder() {
  const o = await env.placeOrder([env.line("Veg Puff")]);
  await act(o.orderId, "START", env.kitchenA);
  await act(o.orderId, "MARK_READY", env.kitchenA);
  return o;
}

/** Pretends the order was marked ready this many minutes ago. */
async function readyMinutesAgo(orderId: string, minutes: number) {
  await env.db.update(orderEvents).set({ at: new Date(Date.now() - minutes * 60_000) }).where(eq(orderEvents.orderId, orderId));
}

async function capture(paymentId: string, amountPaise?: number) {
  const sim = env.ctx.provider as SimulatedProvider;
  const [pay] = await env.db.query.payments.findMany({ where: (p, { eq }) => eq(p.id, paymentId) });
  const signed = sim.paymentEvent("payment.captured", pay!.providerOrderId!, amountPaise ?? pay!.amountPaise);
  const r = await env.app.inject({ method: "POST", url: "/v1/payments/webhook/simulated", headers: { "content-type": "application/json", ...signed.headers }, payload: signed.body });
  expect(r.statusCode).toBe(200);
}

describe("orders that are ready but never collected (K10)", () => {
  it("the cashier can close it only after the 30-minute hold, with no refund", async () => {
    const o = await readyOrder();
    const v = await env.track(o.trackingToken);
    expect(v.readyAt).not.toBeNull();

    const early = await act(o.orderId, "MARK_NOT_COLLECTED", env.cashierA);
    expect(early.statusCode).toBe(409);
    expect(early.json().error.message).toMatch(/30 minutes after it's ready/);
    expect((await act(o.orderId, "MARK_NOT_COLLECTED", env.kitchenA)).statusCode).toBe(403);

    await readyMinutesAgo(o.orderId, 31);
    const ok = await act(o.orderId, "MARK_NOT_COLLECTED", env.cashierA);
    expect(ok.statusCode).toBe(200);
    const after = ok.json() as OrderView;
    expect(after.state).toBe("NOT_COLLECTED");
    expect(after.refundedPaise).toBe(0);
    // It can't be handed over afterwards, and it is no longer on the live board.
    expect((await act(o.orderId, "HAND_OVER", env.cashierA)).statusCode).toBe(409);
    const live = await env.app.inject({ method: "GET", url: `/v1/staff/orders?outletId=${env.outletA}&scope=live`, headers: env.auth(env.cashierA) });
    expect((live.json() as OrderView[]).map((x) => x.id)).not.toContain(o.orderId);
  });

  it("at day close, ready orders from the day become not collected and still count as sales", async () => {
    const o = await readyOrder();
    // Same day: nothing changes.
    expect((await runSweeps(env.ctx)).notCollected).toBe(0);
    const tomorrow = new Date(Date.now() + 26 * 60 * 60_000);
    expect((await runSweeps(env.ctx, tomorrow)).notCollected).toBe(1);
    const v = await env.track(o.trackingToken);
    expect(v.state).toBe("NOT_COLLECTED");
    expect(v.refundedPaise).toBe(0);

    const day = await env.app.inject({ method: "GET", url: `/v1/staff/summary?outletId=${env.outletA}`, headers: env.auth(env.cashierA) });
    expect(day.json().orders.notCollected).toBe(2);
    // A not-collected order can still be refunded by the cashier if the café chooses to.
    const r = await env.app.inject({ method: "POST", url: `/v1/staff/orders/${o.orderId}/refund`, headers: env.auth(env.cashierA), payload: { wholeOrder: true, category: "GOODWILL", preview: true } });
    expect(r.statusCode).toBe(200);
  });
});

describe("captures that can't place an order are refunded automatically (P2-P4)", () => {
  it("a second successful payment for the same order is refunded in full (P3)", async () => {
    const o = await env.placeOrder([env.line("Veg Puff")], { pay: false });
    const retry = (await env.app.inject({ method: "POST", url: `/v1/track/${o.trackingToken}/pay` })).json() as { paymentId: string };
    await capture(o.checkout.paymentId);
    await capture(retry.paymentId);
    const v = await env.track(o.trackingToken);
    expect(v.state).toBe("PLACED");
    expect(v.paidPaise).toBe(2 * o.totalPaise);
    expect(v.refundedPaise).toBe(o.totalPaise);
    expect(v.refunds[0]!.reason).toMatch(/after the order had closed/);
  });

  it("a capture for the wrong amount is recorded and given back, and the order is not placed (P4)", async () => {
    const o = await env.placeOrder([env.line("Veg Puff")], { pay: false });
    await capture(o.checkout.paymentId, 100);
    const v = await env.track(o.trackingToken);
    expect(v.state).toBe("AWAITING_PAYMENT");
    expect(v.paidPaise).toBe(100);
    expect(v.refundedPaise).toBe(100);
    expect(v.refunds[0]!.reason).toMatch(/did not match/);
    // The same webhook again changes nothing.
    await capture(o.checkout.paymentId, 100);
    expect((await env.track(o.trackingToken)).refundedPaise).toBe(100);
  });
});
