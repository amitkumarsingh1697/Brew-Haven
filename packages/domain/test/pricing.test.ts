import { describe, expect, it } from "vitest";
import { billTotals, cashChange, exclusiveTax, quote, transition } from "../src/index.js";

const line = (rupees: number, quantity = 1) => ({ itemId: "i", name: "x", unitPricePaise: rupees * 100, quantity, modifiers: [] });

describe("GST on the whole bill", () => {
  it("prices include GST: the total is the menu price and GST is taken out of it", () => {
    const t = billTotals(21_000, 500, true);
    expect(t).toEqual({ subtotalPaise: 21_000, taxablePaise: 20_000, taxPaise: 1_000, roundOffPaise: 0, totalPaise: 21_000 });
  });

  it("GST added on the bill: 5% on the subtotal, then rounded to the rupee", () => {
    // ₹190 + 5% = ₹199.50, rounds up to ₹200 with +50 paise round-off.
    expect(billTotals(19_000, 500, false)).toEqual({ subtotalPaise: 19_000, taxablePaise: 19_000, taxPaise: 950, roundOffPaise: 50, totalPaise: 20_000 });
    // ₹183 + 5% = ₹192.15, rounds down to ₹192.
    expect(billTotals(18_300, 500, false)).toEqual({ subtotalPaise: 18_300, taxablePaise: 18_300, taxPaise: 915, roundOffPaise: -15, totalPaise: 19_200 });
  });

  it("taxes the bill once, not each item", () => {
    // Three ₹33 items: per-item GST would round 165 paise three times; bill GST is 495 paise.
    const q = quote([line(33), line(33), line(33)], 500, false);
    expect(q.subtotalPaise).toBe(9_900);
    expect(q.taxPaise).toBe(exclusiveTax(9_900, 500));
    expect(q.taxPaise).toBe(495);
    expect(q.totalPaise).toBe(10_400);
    expect(q.taxablePaise + q.taxPaise + q.roundOffPaise).toBe(q.totalPaise);
  });

  it("always adds up: taxable + GST + round-off = total, and round-off stays under a rupee", () => {
    for (let sub = 0; sub <= 200_000; sub += 137) {
      for (const inclusive of [true, false]) {
        const t = billTotals(sub, 500, inclusive);
        expect(t.taxablePaise + t.taxPaise + t.roundOffPaise).toBe(t.totalPaise);
        expect(Math.abs(t.roundOffPaise)).toBeLessThanOrEqual(50);
        if (!inclusive) expect(t.totalPaise % 100).toBe(0);
      }
    }
  });

  it("a zero rate adds nothing", () => {
    expect(billTotals(12_345, 0, false).taxPaise).toBe(0);
  });
});

describe("cash at the counter", () => {
  it("works out the change", () => {
    expect(cashChange(20_000, 50_000)).toBe(30_000);
    expect(cashChange(20_000, 20_000)).toBe(0);
  });
  it("refuses less cash than the bill", () => {
    expect(() => cashChange(20_000, 19_900)).toThrow(RangeError);
  });
});

describe("marking a counter order paid", () => {
  it("only the cashier or owner can mark an unpaid order paid", () => {
    expect(transition({ state: "AWAITING_PAYMENT", action: "MARK_PAID", actor: "CASHIER" }).to).toBe("PLACED");
    expect(() => transition({ state: "AWAITING_PAYMENT", action: "MARK_PAID", actor: "KITCHEN" })).toThrow();
    expect(() => transition({ state: "AWAITING_PAYMENT", action: "MARK_PAID", actor: "CUSTOMER" })).toThrow();
    expect(() => transition({ state: "PLACED", action: "MARK_PAID", actor: "CASHIER" })).toThrow();
  });
  it("voiding an unpaid order needs a reason", () => {
    expect(() => transition({ state: "AWAITING_PAYMENT", action: "VOID_UNPAID", actor: "CASHIER" })).toThrow();
    expect(transition({ state: "AWAITING_PAYMENT", action: "VOID_UNPAID", actor: "CASHIER", reason: "Customer left" }).to).toBe("CANCELLED");
  });
});
