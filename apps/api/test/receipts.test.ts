import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OrderView, ReceiptView, StaffSession } from "@brew-haven/contracts";
import { financialYear } from "@brew-haven/domain";
import { setup, teardown, type TestEnv } from "./helpers.js";

let env: TestEnv;
beforeAll(async () => {
  env = await setup();
});
afterAll(async () => teardown(env));

const as = (s: StaffSession) => ({ authorization: `Bearer ${s.token}` });
const fy = financialYear(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()));
const settings = (billing: Record<string, string>) =>
  env.app.inject({ method: "PUT", url: "/v1/admin/settings", headers: as(env.admin), payload: { displayName: "400 Coffee Cafe", taxRateBps: 500, billing } });

describe("receipts", () => {
  it("numbers receipts per café, consecutively, from the moment an order is placed", async () => {
    const first = await env.placeOrder([env.line("Cappuccino", 2)]);
    const unpaid = await env.placeOrder([env.line("Espresso")], { pay: false });
    const second = await env.placeOrder([env.line("Americano")]);
    const otherCafe = await env.placeOrder([env.line("Café Latte")], { outlet: "tower-b" });

    const r1 = (await env.app.inject({ method: "GET", url: `/v1/track/${first.trackingToken}/receipt` })).json() as ReceiptView;
    const r2 = (await env.app.inject({ method: "GET", url: `/v1/track/${second.trackingToken}/receipt` })).json() as ReceiptView;
    const rB = (await env.app.inject({ method: "GET", url: `/v1/track/${otherCafe.trackingToken}/receipt` })).json() as ReceiptView;
    expect(r1.number).toBe(`A${fy}-00001`);
    expect(r2.number).toBe(`A${fy}-00002`);
    expect(rB.number).toBe(`B${fy}-00001`);

    // No receipt until the order is paid and placed.
    const none = await env.app.inject({ method: "GET", url: `/v1/track/${unpaid.trackingToken}/receipt` });
    expect(none.statusCode).toBe(409);
  });

  it("is a plain receipt without a GSTIN, and a tax invoice with CGST and SGST once one is saved", async () => {
    const order = await env.placeOrder([env.line("Cappuccino", 2)]); // ₹360 including 5% GST
    const plain = (await env.app.inject({ method: "GET", url: `/v1/track/${order.trackingToken}/receipt` })).json() as ReceiptView;
    expect(plain.kind).toBe("RECEIPT");
    expect(plain.seller.gstin).toBeNull();

    const bad = await settings({ gstin: "12345" });
    expect(bad.statusCode).toBe(400);
    const ok = await settings({ legalName: "400 Coffee Pvt Ltd", gstin: "29abcde1234f1z5", fssaiLicence: "11223344556677", footer: "Thank you, see you tomorrow!" });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().tenant.billing).toMatchObject({ gstin: "29ABCDE1234F1Z5" });

    const inv = (await env.app.inject({ method: "GET", url: `/v1/track/${order.trackingToken}/receipt` })).json() as ReceiptView;
    expect(inv.kind).toBe("TAX_INVOICE");
    expect(inv.seller).toMatchObject({ legalName: "400 Coffee Pvt Ltd", gstin: "29ABCDE1234F1Z5", fssaiLicence: "11223344556677", outlet: "Tower A" });
    expect(inv.lines).toEqual([expect.objectContaining({ name: "Cappuccino", quantity: 2, amountPaise: 36000 })]);
    // ₹360 inclusive of 5%: GST = 360 × 5/105 = ₹17.14, split 8.57 + 8.57.
    expect(inv.totals).toEqual({ totalPaise: 36000, taxablePaise: 36000 - 1714, taxRateBps: 500, cgstPaise: 857, sgstPaise: 857 });
    expect(inv.payments).toEqual([expect.objectContaining({ method: "ONLINE", amountPaise: 36000 })]);
    expect(inv.footer).toBe("Thank you, see you tomorrow!");

    // Clearing a field removes it.
    await settings({ gstin: "" });
    const again = (await env.app.inject({ method: "GET", url: `/v1/track/${order.trackingToken}/receipt` })).json() as ReceiptView;
    expect(again.kind).toBe("RECEIPT");
    expect(again.seller.legalName).toBe("400 Coffee Pvt Ltd");
  });

  it("lets the counter print a walk-in receipt, but not the kitchen or another café", async () => {
    const o = (await env.app.inject({ method: "POST", url: "/v1/staff/orders/walk-in", headers: as(env.cashierA), payload: { outletId: env.outletA, method: "CASH", lines: [env.line("Masala Chai")] } })).json() as OrderView;
    const r = await env.app.inject({ method: "GET", url: `/v1/staff/orders/${o.id}/receipt`, headers: as(env.cashierA) });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ channel: "COUNTER", payments: [{ method: "CASH", amountPaise: 9000 }] });
    expect((await env.app.inject({ method: "GET", url: `/v1/staff/orders/${o.id}/receipt`, headers: as(env.kitchenA) })).statusCode).toBe(403);
    expect((await env.app.inject({ method: "GET", url: `/v1/staff/orders/${o.id}/receipt`, headers: as(env.cashierB) })).statusCode).toBe(403);
    expect((await env.app.inject({ method: "GET", url: `/v1/staff/orders/${o.id}/receipt`, headers: as(env.admin) })).statusCode).toBe(200);
  });
});
