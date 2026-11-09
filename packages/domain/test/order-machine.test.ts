import { describe, expect, it } from "vitest";
import { ORDER_STATES, RULES, TERMINAL_STATES, TransitionError, transition, type OrderAction } from "../src/index.js";

describe("order state machine", () => {
  it("runs the happy path", () => {
    let s = transition({ state: "AWAITING_PAYMENT", action: "PAYMENT_VERIFIED", actor: "SYSTEM" }).to;
    s = transition({ state: s, action: "START", actor: "KITCHEN" }).to;
    s = transition({ state: s, action: "MARK_READY", actor: "KITCHEN" }).to;
    s = transition({ state: s, action: "HAND_OVER", actor: "CASHIER" }).to;
    expect(s).toBe("COLLECTED");
  });

  it("only the server can mark an order paid", () => {
    for (const actor of ["CUSTOMER", "CASHIER", "ADMIN", "KITCHEN"] as const) {
      expect(() => transition({ state: "AWAITING_PAYMENT", action: "PAYMENT_VERIFIED", actor })).toThrow(TransitionError);
    }
  });

  it("rejecting needs a reason and a cashier or admin", () => {
    expect(() => transition({ state: "PLACED", action: "REJECT", actor: "CASHIER" })).toThrow(/reason/);
    expect(() => transition({ state: "PLACED", action: "REJECT", actor: "KITCHEN", reason: "x" })).toThrow(/may not/);
    expect(transition({ state: "PREPARING", action: "REJECT", actor: "ADMIN", reason: "Out of milk" }).to).toBe("CANCELLED");
  });

  it("returns to the state it came from after adjustments", () => {
    const flagged = transition({ state: "PREPARING", action: "FLAG_UNAVAILABLE", actor: "KITCHEN" });
    expect(flagged).toEqual({ from: "PREPARING", to: "ACTION_REQUIRED", resumeState: "PREPARING" });
    const back = transition({ state: "ACTION_REQUIRED", resumeState: flagged.resumeState, action: "ADJUSTMENTS_RESOLVED", actor: "CUSTOMER" });
    expect(back.to).toBe("PREPARING");
    expect(() => transition({ state: "ACTION_REQUIRED", action: "ADJUSTMENTS_RESOLVED", actor: "CUSTOMER" })).toThrow(/resume/);
  });

  it("terminal states have no way out", () => {
    for (const state of TERMINAL_STATES) {
      for (const action of Object.keys(RULES) as OrderAction[]) {
        expect(RULES[action].from.includes(state)).toBe(false);
      }
    }
  });

  it("every non-terminal state is reachable and can leave", () => {
    const reachable = new Set(["AWAITING_PAYMENT"]);
    for (const rule of Object.values(RULES)) if (rule.to !== "RESUME") reachable.add(rule.to);
    for (const s of ORDER_STATES) expect(reachable.has(s)).toBe(true);
    for (const s of ORDER_STATES.filter((x) => !TERMINAL_STATES.has(x))) {
      expect(Object.values(RULES).some((r) => r.from.includes(s))).toBe(true);
    }
  });
});
