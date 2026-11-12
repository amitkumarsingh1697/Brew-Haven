/**
 * Subscription plans and what each allows. The names and limits are placeholders until the
 * business decides its plans and prices; only the limits are enforced, nothing is billed.
 */
export type PlanId = "starter" | "growth" | "multi";

export interface Plan {
  id: PlanId;
  name: string;
  /** Most cafés (branches) the business can have; null means no limit. */
  maxCafes: number | null;
  /** Most active staff sign-ins, the owner included; null means no limit. */
  maxStaff: number | null;
}

export const PLANS: Record<PlanId, Plan> = {
  starter: { id: "starter", name: "Starter", maxCafes: 1, maxStaff: 5 },
  growth: { id: "growth", name: "Growth", maxCafes: 3, maxStaff: 20 },
  multi: { id: "multi", name: "Multi-café", maxCafes: null, maxStaff: null },
};

export const planOf = (id: string | null | undefined): Plan => PLANS[(id ?? "") as PlanId] ?? PLANS.starter;

/** Null when one more is allowed, otherwise a message saying why not. */
export function limitReached(plan: Plan, what: "cafe" | "staff", current: number): string | null {
  const max = what === "cafe" ? plan.maxCafes : plan.maxStaff;
  if (max === null || current < max) return null;
  const noun = what === "cafe" ? (max === 1 ? "café" : "cafés") : max === 1 ? "active team member" : "active team members";
  return `The ${plan.name} plan allows ${max} ${noun}. Contact us to move to a bigger plan.`;
}
