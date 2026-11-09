import { assertPaise, type Paise } from "./money.js";

/** Item-unavailable handling (D-10, ADR-0004). */
export type AdjustmentChoice =
  | { kind: "REPLACE"; replacementTotalPaise: Paise }
  | { kind: "REMOVE" }
  | { kind: "CANCEL_ORDER" };

export type AdjustmentOutcome =
  | { kind: "REPLACE"; refundPaise: Paise; topUpPaise: Paise }
  | { kind: "REMOVE"; refundPaise: Paise }
  | { kind: "CANCEL_ORDER" };

export function resolveAdjustment(originalLineTotalPaise: Paise, choice: AdjustmentChoice): AdjustmentOutcome {
  assertPaise(originalLineTotalPaise, "original line total");
  switch (choice.kind) {
    case "REPLACE": {
      assertPaise(choice.replacementTotalPaise, "replacement total");
      const diff = choice.replacementTotalPaise - originalLineTotalPaise;
      return { kind: "REPLACE", refundPaise: diff < 0 ? -diff : 0, topUpPaise: diff > 0 ? diff : 0 };
    }
    case "REMOVE":
      return { kind: "REMOVE", refundPaise: originalLineTotalPaise };
    case "CANCEL_ORDER":
      return { kind: "CANCEL_ORDER" };
  }
}

/** Customer gets this long to choose, and to pay a top-up (Q-R3-04, Q-R3-05 defaults). */
export const ADJUSTMENT_TIMEOUT_MS = 5 * 60 * 1000;

/** Invariant 2: never refund more than was captured. */
export function refundable(capturedPaise: Paise, alreadyRefundedPaise: Paise): Paise {
  assertPaise(capturedPaise, "captured");
  assertPaise(alreadyRefundedPaise, "refunded");
  if (alreadyRefundedPaise > capturedPaise) {
    throw new RangeError("refunded more than captured: ledger is inconsistent");
  }
  return capturedPaise - alreadyRefundedPaise;
}

export function assertRefundAllowed(capturedPaise: Paise, alreadyRefundedPaise: Paise, requestPaise: Paise): void {
  assertPaise(requestPaise, "refund request");
  if (requestPaise === 0) throw new RangeError("refund must be more than zero");
  const left = refundable(capturedPaise, alreadyRefundedPaise);
  if (requestPaise > left) {
    throw new RangeError(`refund of ${requestPaise} exceeds refundable ${left}`);
  }
}
