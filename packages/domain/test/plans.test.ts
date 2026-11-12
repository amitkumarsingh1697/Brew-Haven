import { describe, expect, it } from "vitest";
import { PLANS, limitReached, planOf } from "../src/plans.js";

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
