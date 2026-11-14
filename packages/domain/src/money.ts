/** All money is integer paise. 100 paise = ₹1. */
export type Paise = number;

export function assertPaise(value: number, label = "amount"): asserts value is Paise {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer number of paise, got ${value}`);
  }
}

/** Formats paise as rupees, e.g. 12550 -> "₹125.50". */
export function formatInr(paise: Paise): string {
  const rupees = Math.floor(paise / 100);
  const rest = paise % 100;
  return `₹${rupees.toLocaleString("en-IN")}.${String(rest).padStart(2, "0")}`;
}

/**
 * Extracts the tax portion from a tax-inclusive amount.
 * rateBps is the tax rate in basis points (500 = 5%).
 */
export function inclusiveTax(grossPaise: Paise, rateBps: number): Paise {
  assertPaise(grossPaise, "gross");
  if (!Number.isInteger(rateBps) || rateBps < 0 || rateBps > 10_000) {
    throw new RangeError(`rateBps must be an integer between 0 and 10000, got ${rateBps}`);
  }
  return Math.round((grossPaise * rateBps) / (10_000 + rateBps));
}

/**
 * GST on a pre-tax amount, rounded to the nearest paisa.
 * rateBps is the tax rate in basis points (500 = 5%).
 */
export function exclusiveTax(netPaise: Paise, rateBps: number): Paise {
  assertPaise(netPaise, "net");
  if (!Number.isInteger(rateBps) || rateBps < 0 || rateBps > 10_000) {
    throw new RangeError(`rateBps must be an integer between 0 and 10000, got ${rateBps}`);
  }
  return Math.round((netPaise * rateBps) / 10_000);
}

/** Change to hand back for a cash payment. Throws if the cash given doesn't cover the bill. */
export function cashChange(totalPaise: Paise, tenderedPaise: Paise): Paise {
  assertPaise(totalPaise, "total");
  assertPaise(tenderedPaise, "cash received");
  if (tenderedPaise < totalPaise) throw new RangeError(`cash received ${tenderedPaise} is less than the bill ${totalPaise}`);
  return tenderedPaise - totalPaise;
}
