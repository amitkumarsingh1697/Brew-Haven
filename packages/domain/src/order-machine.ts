/** Order state machine. Must match docs/adr/0004-order-and-payment-lifecycle.md. */

export const ORDER_STATES = [
  "AWAITING_PAYMENT",
  "PLACED",
  "PREPARING",
  "ACTION_REQUIRED",
  "READY",
  "COLLECTED",
  "CANCELLED",
  "EXPIRED",
] as const;
export type OrderState = (typeof ORDER_STATES)[number];

export const TERMINAL_STATES: ReadonlySet<OrderState> = new Set(["COLLECTED", "CANCELLED", "EXPIRED"]);

export type Actor = "SYSTEM" | "CUSTOMER" | "CASHIER" | "KITCHEN" | "ADMIN";

export type OrderAction =
  | "PAYMENT_VERIFIED"
  | "PAYMENT_FAILED_OR_TIMEOUT"
  | "START"
  | "FLAG_UNAVAILABLE"
  | "ADJUSTMENTS_RESOLVED"
  | "REJECT"
  | "CUSTOMER_CANCEL"
  | "ALL_LINES_REMOVED"
  | "MARK_READY"
  | "HAND_OVER";

interface Rule {
  from: readonly OrderState[];
  /** Fixed target, or "RESUME" to go back to the state before ACTION_REQUIRED. */
  to: OrderState | "RESUME";
  actors: readonly Actor[];
  requiresReason?: boolean;
}

const STAFF: readonly Actor[] = ["CASHIER", "ADMIN"];

export const RULES: Record<OrderAction, Rule> = {
  PAYMENT_VERIFIED: { from: ["AWAITING_PAYMENT"], to: "PLACED", actors: ["SYSTEM"] },
  PAYMENT_FAILED_OR_TIMEOUT: { from: ["AWAITING_PAYMENT"], to: "EXPIRED", actors: ["SYSTEM"] },
  START: { from: ["PLACED"], to: "PREPARING", actors: ["KITCHEN", "ADMIN"] },
  FLAG_UNAVAILABLE: { from: ["PLACED", "PREPARING"], to: "ACTION_REQUIRED", actors: ["CASHIER", "KITCHEN", "ADMIN"] },
  ADJUSTMENTS_RESOLVED: { from: ["ACTION_REQUIRED"], to: "RESUME", actors: ["CUSTOMER", "SYSTEM"] },
  REJECT: { from: ["PLACED", "PREPARING", "ACTION_REQUIRED"], to: "CANCELLED", actors: STAFF, requiresReason: true },
  CUSTOMER_CANCEL: { from: ["ACTION_REQUIRED"], to: "CANCELLED", actors: ["CUSTOMER"] },
  ALL_LINES_REMOVED: { from: ["ACTION_REQUIRED"], to: "CANCELLED", actors: ["SYSTEM", "CUSTOMER"] },
  MARK_READY: { from: ["PREPARING"], to: "READY", actors: ["KITCHEN", "ADMIN"] },
  HAND_OVER: { from: ["READY"], to: "COLLECTED", actors: ["CASHIER", "ADMIN"] },
};

export class TransitionError extends Error {
  constructor(
    message: string,
    readonly code: "INVALID_TRANSITION" | "FORBIDDEN_ACTOR" | "REASON_REQUIRED" | "NO_RESUME_STATE",
  ) {
    super(message);
    this.name = "TransitionError";
  }
}

export interface TransitionInput {
  state: OrderState;
  /** The state the order was in when it entered ACTION_REQUIRED. */
  resumeState?: OrderState | null;
  action: OrderAction;
  actor: Actor;
  reason?: string | null;
}

export interface TransitionResult {
  from: OrderState;
  to: OrderState;
  /** Set when entering ACTION_REQUIRED; cleared otherwise. */
  resumeState: OrderState | null;
}

export function transition(input: TransitionInput): TransitionResult {
  const rule = RULES[input.action];
  if (!rule.from.includes(input.state)) {
    throw new TransitionError(`cannot ${input.action} an order that is ${input.state}`, "INVALID_TRANSITION");
  }
  if (!rule.actors.includes(input.actor)) {
    throw new TransitionError(`${input.actor} may not ${input.action}`, "FORBIDDEN_ACTOR");
  }
  if (rule.requiresReason && !input.reason?.trim()) {
    throw new TransitionError(`${input.action} needs a reason`, "REASON_REQUIRED");
  }
  let to: OrderState;
  if (rule.to === "RESUME") {
    if (input.resumeState !== "PLACED" && input.resumeState !== "PREPARING") {
      throw new TransitionError("no state to resume to", "NO_RESUME_STATE");
    }
    to = input.resumeState;
  } else {
    to = rule.to;
  }
  return { from: input.state, to, resumeState: to === "ACTION_REQUIRED" ? input.state : null };
}

export function canTransition(input: TransitionInput): boolean {
  try {
    transition(input);
    return true;
  } catch {
    return false;
  }
}
