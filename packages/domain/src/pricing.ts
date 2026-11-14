import { assertPaise, exclusiveTax, inclusiveTax, type Paise } from "./money.js";

export interface PricedModifier {
  id: string;
  name: string;
  pricePaise: Paise;
}

export interface PriceLineInput {
  itemId: string;
  name: string;
  unitPricePaise: Paise;
  quantity: number;
  modifiers: PricedModifier[];
}

export interface PricedLine extends PriceLineInput {
  unitTotalPaise: Paise;
  lineTotalPaise: Paise;
}

export interface Quote extends BillTotals {
  lines: PricedLine[];
  /** Same as taxablePaise; kept for older clients. */
  netPaise: Paise;
  taxRateBps: number;
  pricesIncludeTax: boolean;
}

/**
 * The money on a bill. GST is worked out once, on the whole bill (never item by item), and split
 * into CGST and SGST on the receipt.
 *
 * - Prices include GST: the bill total is the sum of the menu prices and GST is taken out of it.
 * - GST added on the bill (400 Coffee, SO-6): the menu prices are before tax, GST is added on the
 *   subtotal, and the total is rounded to the nearest rupee with the difference shown as round-off,
 *   so a cash customer is never asked for 50 paise.
 */
export interface BillTotals {
  /** Sum of the line prices as shown on the menu. */
  subtotalPaise: Paise;
  /** Value GST is charged on. */
  taxablePaise: Paise;
  taxPaise: Paise;
  /** Rounding to the nearest rupee (between -50 and +49 paise). Zero when prices include GST. */
  roundOffPaise: number;
  /** What the customer pays. */
  totalPaise: Paise;
}

export function billTotals(subtotalPaise: Paise, taxRateBps: number, pricesIncludeTax: boolean): BillTotals {
  assertPaise(subtotalPaise, "subtotal");
  if (pricesIncludeTax) {
    const tax = inclusiveTax(subtotalPaise, taxRateBps);
    return { subtotalPaise, taxablePaise: subtotalPaise - tax, taxPaise: tax, roundOffPaise: 0, totalPaise: subtotalPaise };
  }
  const tax = exclusiveTax(subtotalPaise, taxRateBps);
  const exact = subtotalPaise + tax;
  const total = Math.round(exact / 100) * 100;
  return { subtotalPaise, taxablePaise: subtotalPaise, taxPaise: tax, roundOffPaise: total - exact, totalPaise: total };
}

export const MAX_QUANTITY_PER_LINE = 20;

export function priceLine(input: PriceLineInput): PricedLine {
  assertPaise(input.unitPricePaise, "unit price");
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > MAX_QUANTITY_PER_LINE) {
    throw new RangeError(`quantity must be between 1 and ${MAX_QUANTITY_PER_LINE}`);
  }
  let unitTotal = input.unitPricePaise;
  for (const m of input.modifiers) {
    assertPaise(m.pricePaise, `modifier ${m.name}`);
    unitTotal += m.pricePaise;
  }
  return { ...input, unitTotalPaise: unitTotal, lineTotalPaise: unitTotal * input.quantity };
}

export function quote(lines: PriceLineInput[], taxRateBps: number, pricesIncludeTax = true): Quote {
  if (lines.length === 0) throw new RangeError("an order needs at least one line");
  const priced = lines.map(priceLine);
  const subtotal = priced.reduce((sum, l) => sum + l.lineTotalPaise, 0);
  const totals = billTotals(subtotal, taxRateBps, pricesIncludeTax);
  return { lines: priced, ...totals, netPaise: totals.taxablePaise, taxRateBps, pricesIncludeTax };
}
