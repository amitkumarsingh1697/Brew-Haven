import { describe, expect, it } from "vitest";
import { assertRefundAllowed, formatPickupCode, refundable, resolveAdjustment } from "../src/index.js";

describe("item unavailable adjustments (D-10)", () => {
  it("refunds the difference for a cheaper replacement", () => {
    expect(resolveAdjustment(25000, { kind: "REPLACE", replacementTotalPaise: 18000 })).toEqual({ kind: "REPLACE", refundPaise: 7000, topUpPaise: 0 });
  });
  it("asks for the balance for a dearer replacement", () => {
    expect(resolveAdjustment(18000, { kind: "REPLACE", replacementTotalPaise: 25000 })).toEqual({ kind: "REPLACE", refundPaise: 0, topUpPaise: 7000 });
  });
  it("moves no money for an equal replacement", () => {
    expect(resolveAdjustment(18000, { kind: "REPLACE", replacementTotalPaise: 18000 })).toEqual({ kind: "REPLACE", refundPaise: 0, topUpPaise: 0 });
  });
  it("refunds only the line when it is removed", () => {
    expect(resolveAdjustment(18000, { kind: "REMOVE" })).toEqual({ kind: "REMOVE", refundPaise: 18000 });
  });
});

describe("refund ledger invariant", () => {
  it("never refunds more than captured", () => {
    expect(refundable(50000, 20000)).toBe(30000);
    expect(() => assertRefundAllowed(50000, 20000, 30001)).toThrow();
    expect(() => assertRefundAllowed(50000, 0, 0)).toThrow();
    expect(() => assertRefundAllowed(50000, 0, 50000)).not.toThrow();
    expect(() => refundable(100, 200)).toThrow(/inconsistent/);
  });
});

describe("pickup codes", () => {
  it("pads the daily sequence", () => {
    expect(formatPickupCode("A", 42)).toBe("A-042");
    expect(formatPickupCode("TB", 1234)).toBe("TB-1234");
    expect(() => formatPickupCode("a", 1)).toThrow();
  });
});
