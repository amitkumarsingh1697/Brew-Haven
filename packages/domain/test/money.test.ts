import { describe, expect, it } from "vitest";
import { formatInr, inclusiveTax, quote } from "../src/index.js";

describe("money", () => {
  it("formats paise as rupees", () => {
    expect(formatInr(12550)).toBe("₹125.50");
    expect(formatInr(5)).toBe("₹0.05");
    expect(formatInr(12345600)).toBe("₹1,23,456.00");
  });

  it("extracts 5% GST from an inclusive price", () => {
    // ₹210 inclusive of 5% => ₹200 net + ₹10 tax
    expect(inclusiveTax(21000, 500)).toBe(1000);
    expect(inclusiveTax(0, 500)).toBe(0);
  });

  it("rejects floats and negatives", () => {
    expect(() => inclusiveTax(10.5, 500)).toThrow(RangeError);
    expect(() => inclusiveTax(-1, 500)).toThrow(RangeError);
  });
});

describe("quote", () => {
  it("adds modifiers per unit and multiplies by quantity", () => {
    const q = quote(
      [
        { itemId: "latte", name: "Latte", unitPricePaise: 18000, quantity: 2, modifiers: [{ id: "oat", name: "Oat milk", pricePaise: 3000 }] },
        { itemId: "croissant", name: "Croissant", unitPricePaise: 12000, quantity: 1, modifiers: [] },
      ],
      500,
    );
    expect(q.lines[0]?.lineTotalPaise).toBe(42000);
    expect(q.totalPaise).toBe(54000);
    expect(q.taxPaise + q.netPaise).toBe(q.totalPaise);
  });

  it("refuses empty orders and silly quantities", () => {
    expect(() => quote([], 500)).toThrow();
    expect(() => quote([{ itemId: "x", name: "x", unitPricePaise: 100, quantity: 0, modifiers: [] }], 500)).toThrow();
    expect(() => quote([{ itemId: "x", name: "x", unitPricePaise: 100, quantity: 21, modifiers: [] }], 500)).toThrow();
  });
});
