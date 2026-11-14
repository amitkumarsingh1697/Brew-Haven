import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OrderView, QuoteResponse, ReceiptView } from "@brew-haven/contracts";
import { DEMO_TENANT_SLUG } from "../src/db/seed-data.js";
import { setup, teardown, type TestEnv } from "./helpers.js";

/** SO-6 as confirmed for 400 Coffee: menu prices are before GST, and 5% GST is added on the complete bill. */
let env: TestEnv;
beforeAll(async () => {
  env = await setup({ pricesIncludeTax: false });
});
afterAll(async () => teardown(env));

const quote = async (lines: unknown[]) =>
  (await env.app.inject({ method: "POST", url: `/v1/cafes/${DEMO_TENANT_SLUG}/tower-a/quote`, payload: { lines } })).json() as QuoteResponse;
const flag = (orderId: string, lineIds: string[]) =>
  env.app.inject({ method: "POST", url: `/v1/staff/orders/${orderId}/flag-unavailable`, headers: env.auth(env.cashierA), payload: { lineIds, markSoldOut: false } });
const resolve = (token: string, adjId: string, body: Record<string, unknown>) => env.app.inject({ method: "POST", url: `/v1/track/${token}/adjustments/${adjId}/resolve`, payload: body });

describe("GST added on the bill", () => {
  it("the menu says prices are before GST", () => {
    expect(env.menu.tenant.pricesIncludeTax).toBe(false);
    expect(env.menu.tenant.taxRateBps).toBe(500);
  });

  it("adds 5% on the whole bill and rounds the total to the rupee", async () => {
    // Café Latte ₹190 + Butter Croissant ₹140 = ₹330; GST ₹16.50; ₹346.50 rounds to ₹347.
    const q = await quote([env.line("Café Latte"), env.line("Butter Croissant")]);
    expect(q).toMatchObject({ subtotalPaise: 33_000, taxablePaise: 33_000, taxPaise: 1_650, roundOffPaise: 50, totalPaise: 34_700, pricesIncludeTax: false });
  });

  it("charges the customer the bill with GST, and the receipt splits CGST and SGST", async () => {
    const o = await env.placeOrder([env.line("Cappuccino", 2)]); // ₹360 + ₹18 GST
    expect(o.totalPaise).toBe(37_800);
    const v = await env.track(o.trackingToken);
    expect(v).toMatchObject({ state: "PLACED", subtotalPaise: 36_000, taxPaise: 1_800, roundOffPaise: 0, totalPaise: 37_800, paidPaise: 37_800, pricesIncludeTax: false });
    const r = (await env.app.inject({ method: "GET", url: `/v1/track/${o.trackingToken}/receipt` })).json() as ReceiptView;
    expect(r.totals).toEqual({ totalPaise: 37_800, taxablePaise: 36_000, taxRateBps: 500, cgstPaise: 900, sgstPaise: 900, roundOffPaise: 0, pricesIncludeTax: false });
    expect(r.payments[0]).toMatchObject({ method: "ONLINE", instrument: "upi" });
  });

  it("keeps the round-off out of the taxable value in the GST summary", async () => {
    await env.placeOrder([env.line("Café Latte")]); // ₹190 + ₹9.50 = ₹199.50 → ₹200
    const s = (await env.app.inject({ method: "GET", url: "/v1/admin/gst-summary", headers: env.auth(env.admin) })).json() as { totals: { taxablePaise: number; cgstPaise: number; sgstPaise: number; totalPaise: number } };
    expect(s.totals.taxablePaise + s.totals.cgstPaise + s.totals.sgstPaise).toBe(36_000 + 1_800 + 19_000 + 950);
    expect(s.totals.totalPaise).toBe(37_800 + 20_000);
  });
});

describe("an item runs out after payment, with GST on the bill", () => {
  it("remove: refunds the item's share of the bill including GST", async () => {
    // ₹330 → ₹347 paid. Without the croissant: ₹190 → ₹200. Refund ₹147.
    const o = await env.placeOrder([env.line("Café Latte"), env.line("Butter Croissant")]);
    const before = await env.track(o.trackingToken);
    const croissant = before.lines.find((l) => l.name === "Butter Croissant")!;
    const flagged = (await flag(o.orderId, [croissant.id])).json() as OrderView;
    expect(flagged.adjustments[0]!.removeRefundPaise).toBe(14_700);
    const v = (await resolve(o.trackingToken, flagged.adjustments[0]!.id, { kind: "REMOVE" })).json() as OrderView;
    expect(v.refundedPaise).toBe(14_700);
    expect(v.totalPaise).toBe(20_000);
    expect(v.taxPaise).toBe(950);
    expect(v.paidPaise - v.refundedPaise).toBe(v.totalPaise);
  });

  it("swap for something cheaper: refunds the difference in the bill", async () => {
    // Paneer Tikka Sandwich ₹220 → ₹231. Veg Puff ₹60 → ₹63. Refund ₹168.
    const o = await env.placeOrder([env.line("Paneer Tikka Sandwich")]);
    const line = (await env.track(o.trackingToken)).lines[0]!;
    const adj = ((await flag(o.orderId, [line.id])).json() as OrderView).adjustments[0]!;
    const v = (await resolve(o.trackingToken, adj.id, { kind: "REPLACE", replacement: env.line("Veg Puff") })).json() as OrderView;
    expect(v.refundedPaise).toBe(16_800);
    expect(v.totalPaise).toBe(6_300);
    expect(v.paidPaise - v.refundedPaise).toBe(v.totalPaise);
  });

  it("swap for something dearer: the top-up is the difference in the bill", async () => {
    const o = await env.placeOrder([env.line("Veg Puff")]); // ₹63
    const line = (await env.track(o.trackingToken)).lines[0]!;
    const adj = ((await flag(o.orderId, [line.id])).json() as OrderView).adjustments[0]!;
    const v = (await resolve(o.trackingToken, adj.id, { kind: "REPLACE", replacement: env.line("Paneer Tikka Sandwich") })).json() as OrderView;
    const a = v.adjustments[0]!;
    expect(a.status).toBe("AWAITING_TOPUP");
    expect(a.topUpPaise).toBe(16_800);
    const paid = await env.pay(a.topUpCheckout!.paymentId);
    expect(paid.order.totalPaise).toBe(23_100);
    expect(paid.order.paidPaise - paid.order.refundedPaise).toBe(23_100);
  });

  it("several items removed one by one never refund more than was paid", async () => {
    // Espresso ₹120, Veg Puff ₹60, Cortado ₹170 = ₹350 → ₹367.50 → ₹368.
    const o = await env.placeOrder([env.line("Espresso"), env.line("Veg Puff"), env.line("Cortado")]);
    expect(o.totalPaise).toBe(36_800);
    const v0 = await env.track(o.trackingToken);
    const ids = v0.lines.filter((l) => l.name !== "Cortado").map((l) => l.id);
    const flagged = (await flag(o.orderId, ids)).json() as OrderView;
    let last: OrderView = flagged;
    for (const a of flagged.adjustments) last = (await resolve(o.trackingToken, a.id, { kind: "REMOVE" })).json() as OrderView;
    // Left: Cortado ₹170 → ₹178.50 → ₹179.
    expect(last.totalPaise).toBe(17_900);
    expect(last.paidPaise - last.refundedPaise).toBe(17_900);
  });
});
