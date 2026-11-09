import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OrderView } from "@brew-haven/contracts";
import { SimulatedProvider } from "../src/payments/simulated.js";
import { drainOutbox, runSweeps } from "../src/services/flows.js";
import { setup, teardown, type TestEnv } from "./helpers.js";

let env: TestEnv;
beforeAll(async () => {
  env = await setup();
});
afterAll(async () => teardown(env));

const act = async (id: string, action: string, token: { token: string }) =>
  await env.app.inject({ method: "POST", url: `/v1/staff/orders/${id}/actions`, headers: { authorization: `Bearer ${token.token}` }, payload: { action } });

describe("menu and quote", () => {
  it("serves the demo menu for an outlet, marked as demo data", () => {
    expect(env.menu.demoData).toBe(true);
    expect(env.menu.tenant.name).toBe("400 Coffee Cafe");
    expect(env.menu.outlets.map((o) => o.slug)).toEqual(["tower-a", "tower-b"]);
    expect(env.menu.categories.length).toBeGreaterThanOrEqual(5);
  });

  it("prices on the server, including modifiers", async () => {
    const r = await env.app.inject({
      method: "POST",
      url: "/v1/cafes/400-coffee/tower-a/quote",
      payload: { lines: [env.line("Cappuccino", 2, ["Large", "Oat milk", "Extra shot"])] },
    });
    expect(r.statusCode).toBe(200);
    // (180 + 40 + 50 + 40) x 2 = ₹620
    expect(r.json().totalPaise).toBe(62000);
    expect(r.json().taxPaise).toBe(Math.round((62000 * 500) / 10500));
  });

  it("refuses a missing required choice and a foreign option", async () => {
    const latte = env.item("Café Latte");
    const r1 = await env.app.inject({ method: "POST", url: "/v1/cafes/400-coffee/tower-a/quote", payload: { lines: [{ itemId: latte.id, quantity: 1, modifierIds: [] }] } });
    expect(r1.statusCode).toBe(400);
    const chaiOpt = env.item("Masala Chai").modifierGroups[0]!.options[0]!.id;
    const r2 = await env.app.inject({ method: "POST", url: "/v1/cafes/400-coffee/tower-a/quote", payload: { lines: [{ ...env.line("Café Latte"), modifierIds: [...env.line("Café Latte").modifierIds, chaiOpt] }] } });
    expect(r2.statusCode).toBe(400);
  });

  it("requires a valid Indian mobile number and the order-updates consent", async () => {
    const base = { lines: [env.line("Veg Puff")], customer: { name: "A", phone: "12345" }, consent: { orderUpdates: true } };
    const r1 = await env.app.inject({ method: "POST", url: "/v1/cafes/400-coffee/tower-a/orders", headers: { "idempotency-key": "k-phone-0001" }, payload: base });
    expect(r1.statusCode).toBe(400);
    const r2 = await env.app.inject({ method: "POST", url: "/v1/cafes/400-coffee/tower-a/orders", headers: { "idempotency-key": "k-phone-0002" }, payload: { ...base, customer: { name: "A", phone: "+91 98765 43210" }, consent: { orderUpdates: false } } });
    expect(r2.statusCode).toBe(400);
  });
});

describe("pay-now online order (D-02, D-09)", () => {
  it("is invisible to the kitchen until paid, then runs to collection", async () => {
    const o = await env.placeOrder([env.line("Café Latte"), env.line("Butter Croissant")], { pay: false });
    expect((await env.track(o.trackingToken)).state).toBe("AWAITING_PAYMENT");
    const queue = await env.app.inject({ method: "GET", url: `/v1/staff/orders?outletId=${env.outletA}`, headers: env.auth(env.kitchenA) });
    expect((queue.json() as OrderView[]).some((x) => x.id === o.orderId)).toBe(false);

    const paid = await env.pay(o.checkout.paymentId);
    expect(paid.order.state).toBe("PLACED");
    expect(paid.order.pickupCode).toMatch(/^A-\d{3}$/);
    expect(paid.order.paidPaise).toBe(o.totalPaise);

    const queue2 = (await env.app.inject({ method: "GET", url: `/v1/staff/orders?outletId=${env.outletA}`, headers: env.auth(env.kitchenA) })).json() as OrderView[];
    expect(queue2.some((x) => x.id === o.orderId)).toBe(true);

    expect((await act(o.orderId, "START", env.kitchenA)).json().state).toBe("PREPARING");
    expect((await act(o.orderId, "MARK_READY", env.kitchenA)).json().state).toBe("READY");
    expect((await act(o.orderId, "HAND_OVER", env.kitchenA)).statusCode).toBe(403); // kitchen can't hand over
    expect((await act(o.orderId, "HAND_OVER", env.cashierA)).json().state).toBe("COLLECTED");
  });

  it("staff at the other tower cannot touch the order", async () => {
    const o = await env.placeOrder([env.line("Veg Puff")]);
    expect((await act(o.orderId, "START", env.cashierB)).statusCode).toBe(403);
    const list = await env.app.inject({ method: "GET", url: `/v1/staff/orders?outletId=${env.outletA}`, headers: env.auth(env.cashierB) });
    expect(list.statusCode).toBe(403);
  });

  it("is idempotent on the Idempotency-Key", async () => {
    const a = await env.placeOrder([env.line("Veg Puff")], { pay: false, key: "same-key-123456" });
    const b = await env.placeOrder([env.line("Veg Puff")], { pay: false, key: "same-key-123456" });
    expect(b.orderId).toBe(a.orderId);
    expect(b.checkout.paymentId).toBe(a.checkout.paymentId);
  });

  it("rejects forged webhooks and ignores duplicates", async () => {
    const o = await env.placeOrder([env.line("Veg Puff")], { pay: false });
    const forged = await env.app.inject({
      method: "POST",
      url: "/v1/payments/webhook/simulated",
      headers: { "content-type": "application/json", "x-simulated-signature": "00".repeat(32) },
      payload: JSON.stringify({ eventId: "x", type: "payment.captured", providerOrderId: "sim_order_x", providerPaymentId: "p", amountPaise: 6000 }),
    });
    expect(forged.statusCode).toBe(401);
    expect((await env.track(o.trackingToken)).state).toBe("AWAITING_PAYMENT");

    const sim = env.ctx.provider as SimulatedProvider;
    const [pay] = await env.db.query.payments.findMany({ where: (p, { eq }) => eq(p.id, o.checkout.paymentId) });
    const signed = sim.paymentEvent("payment.captured", pay!.providerOrderId!, pay!.amountPaise);
    const send = () => env.app.inject({ method: "POST", url: "/v1/payments/webhook/simulated", headers: { "content-type": "application/json", ...signed.headers }, payload: signed.body });
    expect((await send()).json().result).toBe("processed");
    expect((await send()).json().result).toBe("duplicate");
    expect((await env.track(o.trackingToken)).state).toBe("PLACED");
  });

  it("never places an order when the captured amount does not match", async () => {
    const o = await env.placeOrder([env.line("Veg Puff")], { pay: false });
    const sim = env.ctx.provider as SimulatedProvider;
    const [pay] = await env.db.query.payments.findMany({ where: (p, { eq }) => eq(p.id, o.checkout.paymentId) });
    const signed = sim.paymentEvent("payment.captured", pay!.providerOrderId!, 100);
    await env.app.inject({ method: "POST", url: "/v1/payments/webhook/simulated", headers: { "content-type": "application/json", ...signed.headers }, payload: signed.body });
    expect((await env.track(o.trackingToken)).state).toBe("AWAITING_PAYMENT");
  });

  it("lets the customer retry after a failed payment, and expires unpaid orders", async () => {
    const o = await env.placeOrder([env.line("Veg Puff")], { pay: false });
    await env.pay(o.checkout.paymentId, "FAILURE");
    expect((await env.track(o.trackingToken)).state).toBe("AWAITING_PAYMENT");
    const retry = await env.app.inject({ method: "POST", url: `/v1/track/${o.trackingToken}/pay` });
    expect(retry.statusCode).toBe(200);
    expect(retry.json().paymentId).not.toBe(o.checkout.paymentId);

    const o2 = await env.placeOrder([env.line("Veg Puff")], { pay: false });
    await runSweeps(env.ctx, new Date(Date.now() + 16 * 60 * 1000));
    expect((await env.track(o2.trackingToken)).state).toBe("EXPIRED");
    // A late capture on an expired order is refunded automatically.
    const late = await env.pay(o2.checkout.paymentId);
    expect(late.order.state).toBe("EXPIRED");
    expect(late.order.paidPaise).toBe(o2.totalPaise);
    expect(late.order.refundedPaise).toBe(o2.totalPaise);
  });
});

describe("staff reject (D-09)", () => {
  it("needs a reason, cancels, and refunds the full payment", async () => {
    const o = await env.placeOrder([env.line("Cappuccino"), env.line("Veg Puff")]);
    const noReason = await env.app.inject({ method: "POST", url: `/v1/staff/orders/${o.orderId}/reject`, headers: env.auth(env.cashierA), payload: { reason: "" } });
    expect(noReason.statusCode).toBe(400);
    const kitchen = await env.app.inject({ method: "POST", url: `/v1/staff/orders/${o.orderId}/reject`, headers: env.auth(env.kitchenA), payload: { reason: "Out of milk" } });
    expect(kitchen.statusCode).toBe(403);

    const r = await env.app.inject({ method: "POST", url: `/v1/staff/orders/${o.orderId}/reject`, headers: env.auth(env.cashierA), payload: { reason: "Croissant oven is down" } });
    const v = r.json() as OrderView;
    expect(v.state).toBe("CANCELLED");
    expect(v.cancelReason).toBe("Croissant oven is down");
    expect(v.refundedPaise).toBe(o.totalPaise);
    expect(v.refunds[0]?.status).toBe("PENDING");
    await drainOutbox(env.ctx);
    expect((await env.track(o.trackingToken)).refunds[0]?.status).toBe("PROCESSED");
  });
});

describe("item unavailable after payment (D-10)", () => {
  const flag = async (orderId: string, lineIds: string[]) =>
    await env.app.inject({ method: "POST", url: `/v1/staff/orders/${orderId}/flag-unavailable`, headers: env.auth(env.kitchenA), payload: { lineIds, note: "Just ran out", markSoldOut: false } });
  const resolve = async (token: string, adjId: string, payload: object) =>
    await env.app.inject({ method: "POST", url: `/v1/track/${token}/adjustments/${adjId}/resolve`, payload });

  it("remove: refunds only that item and the order carries on", async () => {
    const o = await env.placeOrder([env.line("Café Latte"), env.line("Butter Croissant")]);
    await act(o.orderId, "START", env.kitchenA);
    const before = await env.track(o.trackingToken);
    const croissant = before.lines.find((l) => l.name === "Butter Croissant")!;
    const flagged = (await flag(o.orderId, [croissant.id])).json() as OrderView;
    expect(flagged.state).toBe("ACTION_REQUIRED");
    const adj = flagged.adjustments[0]!;

    const v = (await resolve(o.trackingToken, adj.id, { kind: "REMOVE" })).json() as OrderView;
    expect(v.state).toBe("PREPARING"); // back where it was
    expect(v.refundedPaise).toBe(croissant.lineTotalPaise);
    expect(v.totalPaise).toBe(o.totalPaise - croissant.lineTotalPaise);
    expect(v.lines.find((l) => l.id === croissant.id)?.status).toBe("REMOVED");
  });

  it("replace with something cheaper: refunds the difference", async () => {
    const o = await env.placeOrder([env.line("Paneer Tikka Sandwich")]); // ₹220
    const line = (await env.track(o.trackingToken)).lines[0]!;
    const adj = ((await flag(o.orderId, [line.id])).json() as OrderView).adjustments[0]!;
    const v = (await resolve(o.trackingToken, adj.id, { kind: "REPLACE", replacement: env.line("Veg Puff") })).json() as OrderView; // ₹60
    expect(v.state).toBe("PLACED");
    expect(v.refundedPaise).toBe(16000);
    expect(v.totalPaise).toBe(6000);
    expect(v.lines.map((l) => [l.name, l.status])).toEqual([
      ["Paneer Tikka Sandwich", "REPLACED"],
      ["Veg Puff", "ACTIVE"],
    ]);
  });

  it("replace with something dearer: customer pays only the balance", async () => {
    const o = await env.placeOrder([env.line("Veg Puff")]); // ₹60
    const line = (await env.track(o.trackingToken)).lines[0]!;
    const adj = ((await flag(o.orderId, [line.id])).json() as OrderView).adjustments[0]!;
    const v = (await resolve(o.trackingToken, adj.id, { kind: "REPLACE", replacement: env.line("Chicken Pesto Sandwich") })).json() as OrderView; // ₹260
    expect(v.state).toBe("ACTION_REQUIRED");
    const pending = v.adjustments[0]!;
    expect(pending.status).toBe("AWAITING_TOPUP");
    expect(pending.topUpPaise).toBe(20000);
    expect(pending.topUpCheckout?.amountPaise).toBe(20000);

    const after = await env.pay(pending.topUpCheckout!.paymentId);
    expect(after.order.state).toBe("PLACED");
    expect(after.order.paidPaise).toBe(26000);
    expect(after.order.totalPaise).toBe(26000);
    expect(after.order.lines.find((l) => l.name === "Chicken Pesto Sandwich")?.status).toBe("ACTIVE");
  });

  it("cancel: refunds the whole order", async () => {
    const o = await env.placeOrder([env.line("Cappuccino"), env.line("Veg Puff")]);
    const lines = (await env.track(o.trackingToken)).lines;
    const adj = ((await flag(o.orderId, [lines[1]!.id])).json() as OrderView).adjustments[0]!;
    const v = (await resolve(o.trackingToken, adj.id, { kind: "CANCEL_ORDER" })).json() as OrderView;
    expect(v.state).toBe("CANCELLED");
    expect(v.refundedPaise).toBe(o.totalPaise);
  });

  it("no answer in time: the item is removed and refunded; if nothing is left the order is cancelled", async () => {
    const o = await env.placeOrder([env.line("Veg Puff", 2)]);
    const line = (await env.track(o.trackingToken)).lines[0]!;
    await flag(o.orderId, [line.id]);
    await runSweeps(env.ctx, new Date(Date.now() + 6 * 60 * 1000));
    const v = await env.track(o.trackingToken);
    expect(v.state).toBe("CANCELLED");
    expect(v.refundedPaise).toBe(o.totalPaise);
  });
});

describe("walk-in counter orders (D-11)", () => {
  it("are recorded with their payment method and show in the day summary", async () => {
    const before = (await env.app.inject({ method: "GET", url: `/v1/staff/summary?outletId=${env.outletA}`, headers: env.auth(env.cashierA) })).json();
    const r = await env.app.inject({
      method: "POST",
      url: "/v1/staff/orders/walk-in",
      headers: env.auth(env.cashierA),
      payload: { outletId: env.outletA, method: "CASH", lines: [env.line("Masala Chai", 2)] },
    });
    expect(r.statusCode).toBe(201);
    const v = r.json() as OrderView;
    expect(v.channel).toBe("COUNTER");
    expect(v.state).toBe("PLACED");
    expect(v.paidPaise).toBe(18000);

    const kitchenTry = await env.app.inject({ method: "POST", url: "/v1/staff/orders/walk-in", headers: env.auth(env.kitchenA), payload: { outletId: env.outletA, method: "CASH", lines: [env.line("Masala Chai")] } });
    expect(kitchenTry.statusCode).toBe(403);

    const s = (await env.app.inject({ method: "GET", url: `/v1/staff/summary?outletId=${env.outletA}`, headers: env.auth(env.cashierA) })).json();
    expect(s.capturedByMethod.CASH - (before.capturedByMethod.CASH ?? 0)).toBe(18000);

    const rej = (await env.app.inject({ method: "POST", url: `/v1/staff/orders/${v.id}/reject`, headers: env.auth(env.cashierA), payload: { reason: "Customer changed mind" } })).json() as OrderView;
    expect(rej.refunds[0]?.status).toBe("PROCESSED"); // cash handed back, recorded as a manual refund
  });
});

describe("stock", () => {
  it("blocks orders beyond the count and sells out at zero", async () => {
    const muffin = env.item("Double Chocolate Muffin");
    const set = await env.app.inject({ method: "PUT", url: "/v1/staff/stock", headers: env.auth(env.cashierA), payload: { outletId: env.outletA, itemId: muffin.id, available: true, stockCount: 1 } });
    expect(set.statusCode).toBe(200);
    await expect(env.placeOrder([env.line("Double Chocolate Muffin", 2)])).rejects.toThrow(/409/);
    await env.placeOrder([env.line("Double Chocolate Muffin", 1)]);
    const menu = (await env.app.inject({ method: "GET", url: "/v1/cafes/400-coffee/tower-a/menu" })).json();
    const m = menu.categories.flatMap((c: { items: Array<{ id: string; available: boolean }> }) => c.items).find((i: { id: string }) => i.id === muffin.id);
    expect(m.available).toBe(false);
    // Tower B is unaffected.
    const menuB = (await env.app.inject({ method: "GET", url: "/v1/cafes/400-coffee/tower-b/menu" })).json();
    const mb = menuB.categories.flatMap((c: { items: Array<{ id: string; available: boolean }> }) => c.items).find((i: { id: string }) => i.id === muffin.id);
    expect(mb.available).toBe(true);
  });
});

describe("staff login", () => {
  it("rejects a wrong PIN and locks out after repeated failures", async () => {
    const u = env.users.users.find((x) => x.name === "Kitchen · Tower B")!;
    const tryPin = (pin: string) => env.app.inject({ method: "POST", url: "/v1/staff/login", payload: { tenantSlug: "400-coffee", staffUserId: u.id, pin } });
    expect((await tryPin("0000")).statusCode).toBe(401);
    for (let i = 0; i < 4; i++) await tryPin("0000");
    expect((await tryPin("5555")).statusCode).toBe(429);
  });

  it("refuses requests without a valid token", async () => {
    expect((await env.app.inject({ method: "GET", url: `/v1/staff/orders?outletId=${env.outletA}` })).statusCode).toBe(401);
    expect((await env.app.inject({ method: "GET", url: `/v1/staff/orders?outletId=${env.outletA}`, headers: { authorization: "Bearer nope" } })).statusCode).toBe(401);
  });
});
