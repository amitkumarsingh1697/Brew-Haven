import { assertPaise, inclusiveTax, type Paise } from "./money.js";

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

export interface Quote {
  lines: PricedLine[];
  totalPaise: Paise;
  taxPaise: Paise;
  netPaise: Paise;
  taxRateBps: number;
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

/** Prices are tax-inclusive (ADR-0004); tax is extracted for the bill. */
export function quote(lines: PriceLineInput[], taxRateBps: number): Quote {
  if (lines.length === 0) throw new RangeError("an order needs at least one line");
  const priced = lines.map(priceLine);
  const total = priced.reduce((sum, l) => sum + l.lineTotalPaise, 0);
  const tax = inclusiveTax(total, taxRateBps);
  return { lines: priced, totalPaise: total, taxPaise: tax, netPaise: total - tax, taxRateBps };
}
