import { describe, expect, it } from "vitest";
import { PLANS, billingStatus, limitReached, planOf, trialEndFrom } from "../src/plans.js";

describe("plans", () => {
  it("falls back to Starter for an unknown plan", () => {
    expect(planOf("gold").id).toBe("starter");
    expect(planOf(undefined).id).toBe("starter");
    expect(planOf("multi").maxCafes).toBeNull();
  });
  it("says when a limit is reached", () => {
    expect(limitReached(PLANS.starter, "cafe", 0)).toBeNull();
    expect(limitReached(PLANS.starter, "cafe", 1)).toBe("The Starter plan allows 1 café. Contact us to move to a bigger plan.");
    expect(limitReached(PLANS.growth, "staff", 19)).toBeNull();
    expect(limitReached(PLANS.growth, "staff", 20)).toMatch(/allows 20 active team members/);
    expect(limitReached(PLANS.multi, "cafe", 500)).toBeNull();
  });
});

describe("billing status", () => {
  const now = new Date("2026-11-12T06:30:00Z");
  const at = (iso: string) => new Date(iso);
  it("prices every plan, with a year costing ten months", () => {
    expect(PLANS.starter.monthlyPaise).toBe(99_900);
    for (const p of Object.values(PLANS)) expect(p.yearlyPaise).toBe(p.monthlyPaise * 10);
  });
  it("gives a new business a 30-day trial", () => {
    expect(trialEndFrom(now).toISOString()).toBe("2026-12-12T06:30:00.000Z");
    expect(billingStatus({ trialEndsAt: trialEndFrom(now), paidUntil: null }, now)).toEqual({ state: "trial", until: "2026-12-12T06:30:00.000Z", daysLeft: 30 });
  });
  it("moves from trial to trial over, paid and overdue", () => {
    expect(billingStatus({ trialEndsAt: at("2026-11-10T00:00:00Z"), paidUntil: null }, now).state).toBe("trial_over");
    expect(billingStatus({ trialEndsAt: at("2026-11-10T00:00:00Z"), paidUntil: at("2026-12-10T00:00:00Z") }, now).state).toBe("paid");
    const overdue = billingStatus({ trialEndsAt: at("2026-10-01T00:00:00Z"), paidUntil: at("2026-11-01T00:00:00Z") }, now);
    expect(overdue.state).toBe("overdue");
    expect(overdue.daysLeft).toBeLessThan(0);
  });
  it("leaves a business with no trial or payment as not billed", () => {
    expect(billingStatus({ trialEndsAt: null, paidUntil: null }, now)).toEqual({ state: "not_billed", until: null, daysLeft: null });
  });
});
