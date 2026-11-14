import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CounterOrderResponse, OrderView, ReceiptView, StaffSession } from "@brew-haven/contracts";
import { setup, teardown, type TestEnv } from "./helpers.js";

/**
 * Point 5: every order goes through the app. A cashier can place an order for a customer, who then
 * pays by scanning a QR code (UPI or card, confirmed by the gateway), or the cashier takes cash or
 * the card machine and marks the order paid. Nothing reaches the kitchen until it is paid.
 */
let env: TestEnv;
beforeAll(async () => {
  env = await setup({ pricesIncludeTax: false });
});
afterAll(async () => teardown(env));

const as = (s: StaffSession) => ({ authorization: `Bearer ${s.token}` });
const place = async (lines = [env.line("Café Latte")], who = env.cashierA, extra: Record<string, unknown> = {}) => {
  const r = await env.app.inject({ method: "POST", url: "/v1/staff/orders/counter", headers: as(who), payload: { outletId: env.outletA, lines, ...extra } });
  return r;
};
const markPaid = (id: string, body: Record<string, unknown>, who = env.cashierA) => env.app.inject({ method: "POST", url: `/v1/staff/orders/${id}/mark-paid`, headers: as(who), payload: body });
const live = async (who: StaffSession) => (await env.app.inject({ method: "GET", url: `/v1/staff/orders?outletId=${env.outletA}`, headers: as(who) })).json() as OrderView[];
const tokenOf = (c: CounterOrderResponse) => c.payUrl.split("/order/")[1]!;

describe("cashier places an order for a customer", () => {
  it("waits for payment, shows on the till but not in the kitchen, with a QR link to pay", async () => {
    const r = await place();
    expect(r.statusCode).toBe(201);
    const c = r.json() as CounterOrderResponse;
    expect(c.order).toMatchObject({ state: "AWAITING_PAYMENT", channel: "COUNTER", totalPaise: 20_000, pickupCode: null });
    expect(c.payUrl).toMatch(/\/order\/[\w-]+$/);
    expect((await live(env.cashierA)).some((o) => o.id === c.order.id)).toBe(true);
    expect((await live(env.kitchenA)).some((o) => o.id === c.order.id)).toBe(false);
    const again = await env.app.inject({ method: "GET", url: `/v1/staff/orders/${c.order.id}/pay-link`, headers: as(env.cashierA) });
    expect(again.json().payUrl).toBe(c.payUrl);
  });

  it("cash: the cashier marks it paid, which places it, records the change and who took the money", async () => {
    const c = (await place()).json() as CounterOrderResponse;
    const short = await markPaid(c.order.id, { method: "CASH", tenderedPaise: 10_000 });
    expect(short.statusCode).toBe(400);
    expect(short.json().error.message).toContain("less than the bill");

    const r = await markPaid(c.order.id, { method: "CASH", tenderedPaise: 50_000 });
    expect(r.statusCode).toBe(200);
    const v = r.json() as OrderView;
    expect(v.state).toBe("PLACED");
    expect(v.pickupCode).toMatch(/^A-\d{3}$/);
    expect(v.paidPaise).toBe(20_000);
    expect(v.payments).toEqual([{ method: "CASH", instrument: null, amountPaise: 20_000, tenderedPaise: 50_000, recordedBy: "Cashier · Tower A" }]);
    expect((await live(env.kitchenA)).some((o) => o.id === v.id)).toBe(true);

    const receipt = (await env.app.inject({ method: "GET", url: `/v1/staff/orders/${v.id}/receipt`, headers: as(env.cashierA) })).json() as ReceiptView;
    expect(receipt.payments[0]).toMatchObject({ method: "CASH", tenderedPaise: 50_000, changePaise: 30_000 });

    const log = (await env.app.inject({ method: "GET", url: "/v1/admin/activity", headers: as(env.admin) })).json() as { entries: Array<{ actor: string; summary: string }> };
    expect(log.entries.find((e) => e.summary.startsWith(`Marked order ${v.pickupCode} paid`))).toMatchObject({
      actor: "Cashier · Tower A",
      summary: `Marked order ${v.pickupCode} paid: cash ₹200 (received ₹500, change ₹300)`,
    });

    // Paid once only.
    expect((await markPaid(c.order.id, { method: "CASH" })).statusCode).toBe(409);
  });

  it("card machine: marked paid with the approval code, printed on the receipt", async () => {
    const c = (await place()).json() as CounterOrderResponse;
    const v = (await markPaid(c.order.id, { method: "CARD_COUNTER", cardReference: "ab12cd" })).json() as OrderView;
    expect(v.state).toBe("PLACED");
    const receipt = (await env.app.inject({ method: "GET", url: `/v1/staff/orders/${v.id}/receipt`, headers: as(env.cashierA) })).json() as ReceiptView;
    expect(receipt.payments[0]).toMatchObject({ method: "CARD_COUNTER", reference: "AB12CD" });
  });

  it("QR: the customer pays on their phone and the gateway's confirmation places the order", async () => {
    const c = (await place()).json() as CounterOrderResponse;
    const token = tokenOf(c);
    const checkout = (await env.app.inject({ method: "POST", url: `/v1/track/${token}/pay` })).json() as { paymentId: string; amountPaise: number };
    expect(checkout.amountPaise).toBe(20_000);
    const r = await env.app.inject({ method: "POST", url: "/v1/payments/simulate", payload: { paymentId: checkout.paymentId, outcome: "SUCCESS", instrument: "card" } });
    const v = r.json().order as OrderView;
    expect(v.state).toBe("PLACED");
    expect(v.payments).toEqual([{ method: "ONLINE", instrument: "card", amountPaise: 20_000, tenderedPaise: null, recordedBy: null }]);
    expect((await markPaid(c.order.id, { method: "CASH" })).statusCode).toBe(409);
  });

  it("customer pays cash after opening the QR page: a late QR payment is refunded automatically", async () => {
    const c = (await place()).json() as CounterOrderResponse;
    const token = tokenOf(c);
    const checkout = (await env.app.inject({ method: "POST", url: `/v1/track/${token}/pay` })).json() as { paymentId: string };
    expect((await markPaid(c.order.id, { method: "CASH" })).statusCode).toBe(200);
    const late = (await env.pay(checkout.paymentId)).order;
    expect(late.state).toBe("PLACED");
    expect(late.paidPaise).toBe(40_000);
    expect(late.refundedPaise).toBe(20_000);
  });

  it("the customer leaves: the cashier cancels the unpaid order with a reason, and nothing is invoiced", async () => {
    const c = (await place()).json() as CounterOrderResponse;
    const noReason = await env.app.inject({ method: "POST", url: `/v1/staff/orders/${c.order.id}/void`, headers: as(env.cashierA), payload: { reason: "" } });
    expect(noReason.statusCode).toBe(400);
    const r = await env.app.inject({ method: "POST", url: `/v1/staff/orders/${c.order.id}/void`, headers: as(env.cashierA), payload: { reason: "Customer left" } });
    expect(r.json()).toMatchObject({ state: "CANCELLED", cancelReason: "Customer left", pickupCode: null, paidPaise: 0 });
    expect((await markPaid(c.order.id, { method: "CASH" })).statusCode).toBe(409);
  });

  it("only the counter can take money, and online orders are never marked paid by hand", async () => {
    const c = (await place()).json() as CounterOrderResponse;
    expect((await markPaid(c.order.id, { method: "CASH" }, env.kitchenA)).statusCode).toBe(403);
    expect((await markPaid(c.order.id, { method: "CASH" }, env.cashierB)).statusCode).toBe(403);
    expect((await place(undefined, env.kitchenA)).statusCode).toBe(403);
    const online = await env.placeOrder([env.line("Cappuccino")], { pay: false });
    const r = await markPaid(online.orderId, { method: "CASH" });
    expect(r.statusCode).toBe(409);
    expect(r.json().error.message).toContain("gateway");
  });

  it("sending the same order twice from the till makes one order", async () => {
    const clientRef = randomUUID();
    const a = (await place(undefined, env.cashierA, { clientRef })).json() as CounterOrderResponse;
    const b = (await place(undefined, env.cashierA, { clientRef })).json() as CounterOrderResponse;
    expect(b.order.id).toBe(a.order.id);
    expect(b.payUrl).toBe(a.payUrl);
  });

  it("one-step cash at the till still works, with cash received and change", async () => {
    const r = await env.app.inject({ method: "POST", url: "/v1/staff/orders/walk-in", headers: as(env.cashierA), payload: { outletId: env.outletA, method: "CASH", tenderedPaise: 20_000, lines: [env.line("Cappuccino")] } });
    expect(r.statusCode).toBe(201);
    expect((r.json() as OrderView).payments[0]).toMatchObject({ method: "CASH", tenderedPaise: 20_000, amountPaise: 18_900 });
    const bad = await env.app.inject({ method: "POST", url: "/v1/staff/orders/walk-in", headers: as(env.cashierA), payload: { outletId: env.outletA, method: "UPI_COUNTER", tenderedPaise: 20_000, lines: [env.line("Cappuccino")] } });
    expect(bad.statusCode).toBe(400);
  });
});
