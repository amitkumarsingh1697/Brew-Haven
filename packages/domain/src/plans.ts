/**
 * Subscription plans, their prices and what each allows. Prices are in paise, before GST. Change a
 * price or a limit here and it applies everywhere on the next deploy. Payment is collected outside
 * the app for now; Brew Haven records how far each business has paid.
 */
export type PlanId = "starter" | "growth" | "multi";

export interface Plan {
  id: PlanId;
  name: string;
  /** Most cafés (branches) the business can have; null means no limit. */
  maxCafes: number | null;
  /** Most active staff sign-ins, the owner included; null means no limit. */
  maxStaff: number | null;
  /** Price per month, in paise, before GST. */
  monthlyPaise: number;
  /** Price for a year paid up front, in paise, before GST (two months free). */
  yearlyPaise: number;
}

/** Days a new business uses Brew Haven free before its first payment is due. */
export const TRIAL_DAYS = 30;

export const PLANS: Record<PlanId, Plan> = {
  starter: { id: "starter", name: "Starter", maxCafes: 1, maxStaff: 5, monthlyPaise: 99_900, yearlyPaise: 999_000 },
  growth: { id: "growth", name: "Growth", maxCafes: 3, maxStaff: 20, monthlyPaise: 199_900, yearlyPaise: 1_999_000 },
  multi: { id: "multi", name: "Multi-café", maxCafes: null, maxStaff: null, monthlyPaise: 399_900, yearlyPaise: 3_999_000 },
};

export const planOf = (id: string | null | undefined): Plan => PLANS[(id ?? "") as PlanId] ?? PLANS.starter;

/** Null when one more is allowed, otherwise a message saying why not. */
export function limitReached(plan: Plan, what: "cafe" | "staff", current: number): string | null {
  const max = what === "cafe" ? plan.maxCafes : plan.maxStaff;
  if (max === null || current < max) return null;
  const noun = what === "cafe" ? (max === 1 ? "café" : "cafés") : max === 1 ? "active team member" : "active team members";
  return `The ${plan.name} plan allows ${max} ${noun}. Contact us to move to a bigger plan.`;
}

export type BillingState = "trial" | "trial_over" | "paid" | "overdue" | "not_billed";

export interface BillingStatus {
  state: BillingState;
  /** The date the trial ends or the paid period runs to, as an ISO timestamp; null when not billed. */
  until: string | null;
  /** Whole days left until then (0 on the last day), or days past it as a negative number. */
  daysLeft: number | null;
}

const DAY_MS = 86_400_000;

/**
 * Where a business stands with Brew Haven: on its free trial, paid up, or past either. A business
 * with neither a trial nor a payment recorded (the pilot) is "not billed". Nothing here stops a
 * business taking orders: Brew Haven pauses an account by hand.
 */
export function billingStatus(t: { trialEndsAt: Date | null; paidUntil: Date | null }, now: Date = new Date()): BillingStatus {
  const days = (d: Date) => Math.ceil((d.getTime() - now.getTime()) / DAY_MS);
  if (t.paidUntil && t.paidUntil > now) return { state: "paid", until: t.paidUntil.toISOString(), daysLeft: days(t.paidUntil) };
  if (t.trialEndsAt && t.trialEndsAt > now) return { state: "trial", until: t.trialEndsAt.toISOString(), daysLeft: days(t.trialEndsAt) };
  // The later of the two has passed.
  const last = [t.paidUntil, t.trialEndsAt].filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0];
  if (!last) return { state: "not_billed", until: null, daysLeft: null };
  return { state: t.paidUntil ? "overdue" : "trial_over", until: last.toISOString(), daysLeft: days(last) };
}

/** The trial end for a business signing up now. */
export const trialEndFrom = (now: Date = new Date()) => new Date(now.getTime() + TRIAL_DAYS * DAY_MS);
