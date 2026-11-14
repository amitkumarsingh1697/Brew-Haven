import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CounterOrderResponse, OrderView, StaffSession } from "@brew-haven/contracts";
import { DEMO_PINS } from "../src/db/seed-data.js";
import { setup, teardown, type TestEnv } from "./helpers.js";

// Refund policy K12-K14 (refund after service), C4 (reference), C5 (cashier limit), T1 (credit notes), P14 (to source).
let env: TestEnv;
beforeAll(async () => {
  env = await setup({ pricesIncludeTax: false });
});
afterAll(async () => teardown(env));

const as = (s: StaffSession) => ({ authorization: `Bearer ${s.token}` });
const act = (id: string, action: string, who: StaffSession) => env.app.inject({ method: "POST", url: `/v1/staff/orders/${id}/actions`, headers: as(who), payload: { action } });
const refund = (id: string, body: Record<string, unknown>, who: StaffSession = env.cashierA) =>
  env.app.inject({ method: "POST", url: `/v1/staff/orders/${id}/refund`, headers: as(who), payload: body });
const ownerId = () => env.users.users.find((u) => u.name === "Owner (Admin)")!.id;

async function servedOnline(lines = [env.line("Café Latte"), env.line("Veg Puff", 2)]) {
  const o = await env.placeOrder(lines);
  await act(o.orderId, "START", env.kitchenA);
  await act(o.orderId, "MARK_READY", env.kitchenA);
  await act(o.orderId, "HAND_OVER", env.cashierA);
  return env.track(o.trackingToken);
}

describe("refunds after service", () => {
  it("refunds one item from a collected order, priced on the whole bill, with a credit note", async () => {
    const v = await servedOnline();
    expect(v.state).toBe("COLLECTED");
    const puff = v.lines.find((l) => l.name === "Veg Puff")!;

    const preview = await refund(v.id, { lines: [{ lineId: puff.id, quantity: 1 }], category: "QUALITY", preview: true });
    expect(preview.statusCode).toBe(200);
    // One puff is ₹60; 5% GST on top makes ₹63, and the bill rounds to the rupee.
    expect(preview.json().preview).toMatchObject({ amountPaise: 6300, needsApproval: false, creditNote: true });

    const r = await refund(v.id, { lines: [{ lineId: puff.id, quantity: 1 }], category: "QUALITY", note: "Cold in the middle" });
    expect(r.statusCode).toBe(200);
    const after = r.json().order as OrderView;
    expect(after.refundedPaise).toBe(6300);
    expect(after.refunds[0]!.reason).toBe("Quality complaint: 1 × Veg Puff (Cold in the middle)");
    expect(after.creditNotes).toHaveLength(1);
    expect(after.creditNotes[0]).toMatchObject({ number: "CNA2627-00001", totalPaise: 6300, taxPaise: 300 });

    // The second puff can still be refunded, but never a third.
    expect((await refund(v.id, { lines: [{ lineId: puff.id, quantity: 2 }], category: "QUALITY" })).json().error.message).toMatch(/Only 1 × Veg Puff/);
    const second = await refund(v.id, { lines: [{ lineId: puff.id, quantity: 1 }], category: "QUALITY" });
    expect(second.json().order.creditNotes.map((n: { number: string }) => n.number)).toEqual(["CNA2627-00001", "CNA2627-00002"]);
    expect((await refund(v.id, { lines: [{ lineId: puff.id, quantity: 1 }], category: "QUALITY" })).json().error.message).toMatch(/already been refunded/);
  });

  it("needs the owner's PIN above the cashier's limit, and the owner can refund anything", async () => {
    const v = await servedOnline([env.line("Cappuccino", 3)]);
    const tooBig = await refund(v.id, { wholeOrder: true, category: "SAFETY" });
    expect(tooBig.statusCode).toBe(403);
    expect(tooBig.json().error.message).toMatch(/need the owner's PIN/);

    const wrong = await refund(v.id, { wholeOrder: true, category: "SAFETY", approver: { staffUserId: ownerId(), pin: "9999" } });
    expect(wrong.statusCode).toBe(401);

    const ok = await refund(v.id, { wholeOrder: true, category: "SAFETY", note: "Hair in the drink", approver: { staffUserId: ownerId(), pin: DEMO_PINS.admin } });
    expect(ok.statusCode).toBe(200);
    const o = ok.json().order as OrderView;
    expect(o.refundedPaise).toBe(o.paidPaise);
    expect(o.state).toBe("COLLECTED");

    // Nothing left to give back.
    expect((await refund(v.id, { wholeOrder: true, category: "GOODWILL" }, env.admin)).json().error.message).toMatch(/already been refunded/);

    // The audit trail names the approval and the credit note.
    const log = await env.app.inject({ method: "GET", url: "/v1/admin/activity", headers: as(env.admin) });
    expect(JSON.stringify(log.json())).toMatch(/approved with the owner's PIN\), credit note CNA2627-/);
  });

  it("the owner's limit setting is respected", async () => {
    const s = (await env.app.inject({ method: "GET", url: "/v1/admin/setup", headers: as(env.admin) })).json().tenant;
    expect(s.cashierRefundLimitPaise).toBe(50_000);
    await env.app.inject({ method: "PUT", url: "/v1/admin/settings", headers: as(env.admin), payload: { displayName: s.branding.displayName, taxRateBps: s.taxRateBps, cashierRefundLimitPaise: 0 } });
    const v = await servedOnline([env.line("Veg Puff")]);
    expect((await refund(v.id, { wholeOrder: true, category: "GOODWILL", preview: true })).json().preview.needsApproval).toBe(true);
    await env.app.inject({ method: "PUT", url: "/v1/admin/settings", headers: as(env.admin), payload: { displayName: s.branding.displayName, taxRateBps: s.taxRateBps, cashierRefundLimitPaise: 50_000 } });
    expect((await refund(v.id, { wholeOrder: true, category: "GOODWILL", preview: true })).json().preview.needsApproval).toBe(false);
  });

  it("counter card payments need the machine's refund reference", async () => {
    const c = (await env.app.inject({ method: "POST", url: "/v1/staff/orders/counter", headers: as(env.cashierA), payload: { outletId: env.outletA, lines: [env.line("Café Latte")] } })).json() as CounterOrderResponse;
    await env.app.inject({ method: "POST", url: `/v1/staff/orders/${c.order.id}/mark-paid`, headers: as(env.cashierA), payload: { method: "CARD_COUNTER", cardReference: "4321" } });
    const line = c.order.lines[0]!;
    const noRef = await refund(c.order.id, { lines: [{ lineId: line.id, quantity: 1 }], category: "WRONG_ITEM" });
    expect(noRef.statusCode).toBe(400);
    expect(noRef.json().error.message).toMatch(/refund reference/);
    const ok = await refund(c.order.id, { lines: [{ lineId: line.id, quantity: 1 }], category: "WRONG_ITEM", reference: "RRN 778812" });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().order.refunds[0]).toMatchObject({ status: "PROCESSED" });
  });

  it("the kitchen can't refund, other cafés can't, and unpaid or waiting orders can't be refunded here", async () => {
    const v = await servedOnline([env.line("Veg Puff")]);
    expect((await refund(v.id, { wholeOrder: true, category: "GOODWILL" }, env.kitchenA)).statusCode).toBe(403);
    expect((await refund(v.id, { wholeOrder: true, category: "GOODWILL" }, env.cashierB)).statusCode).toBe(403);
    const unpaid = await env.placeOrder([env.line("Veg Puff")], { pay: false });
    expect((await refund(unpaid.orderId, { wholeOrder: true, category: "GOODWILL" })).statusCode).toBe(409);
    expect((await refund(v.id, { lines: [], category: "GOODWILL" })).statusCode).toBe(400);
  });

  it("the GST summary and download list the credit notes on the day they were issued", async () => {
    const g = (await env.app.inject({ method: "GET", url: "/v1/admin/gst-summary", headers: as(env.admin) })).json();
    expect(g.creditNotes.count).toBeGreaterThanOrEqual(3);
    expect(g.creditNotes.first).toBe("CNA2627-00001");
    const csv = await env.app.inject({ method: "GET", url: "/v1/admin/exports/credit-notes", headers: as(env.admin) });
    expect(csv.statusCode).toBe(200);
    expect(csv.body.split("\n")[0]).toMatch(/^\ufeff?Credit note no,Date,Café,Against invoice/);
    expect(csv.body).toMatch(/CNA2627-00001,.*,Tower A,A2627-\d{5},"?Quality complaint: 1 × Veg Puff/);
  });
});
