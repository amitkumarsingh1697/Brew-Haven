import { describe, expect, it } from "vitest";
import { consumption, formatQuantity } from "../src/inventory.js";

const items = new Map([
  ["latte", [{ ingredientId: "beans", quantity: 18 }, { ingredientId: "milk", quantity: 200 }]],
  ["espresso", [{ ingredientId: "beans", quantity: 18 }]],
]);
const options = new Map([
  ["large", [{ ingredientId: "milk", quantity: 100 }]],
  ["oat", [{ ingredientId: "oat", quantity: 200 }, { ingredientId: "milk", quantity: -200 }]],
  ["extra-shot", [{ ingredientId: "beans", quantity: 9 }]],
]);

describe("ingredient consumption", () => {
  it("adds up recipes times quantity, with choices on top", () => {
    const used = consumption(
      [
        { itemId: "latte", quantity: 2, modifierIds: ["large"] },
        { itemId: "espresso", quantity: 1, modifierIds: ["extra-shot"] },
      ],
      items,
      options,
    );
    expect(Object.fromEntries(used)).toEqual({ beans: 18 * 2 + 27, milk: 300 * 2 });
  });
  it("lets a choice swap one ingredient for another without going below zero", () => {
    const used = consumption([{ itemId: "latte", quantity: 1, modifierIds: ["oat", "large"] }], items, options);
    // milk: 200 − 200 + 100 = 100; oat: 200
    expect(Object.fromEntries(used)).toEqual({ beans: 18, milk: 100, oat: 200 });
    const noMilk = consumption([{ itemId: "espresso", quantity: 1, modifierIds: ["oat"] }], items, options);
    expect(noMilk.has("milk")).toBe(false);
  });
  it("ignores items without a recipe", () => {
    expect(consumption([{ itemId: "cookie", quantity: 3, modifierIds: [] }], items, options).size).toBe(0);
  });
});

describe("formatQuantity", () => {
  it("reads naturally", () => {
    expect(formatQuantity(1250, "g")).toBe("1.25 kg");
    expect(formatQuantity(350, "ml")).toBe("350 ml");
    expect(formatQuantity(-2000, "ml")).toBe("−2 L");
    expect(formatQuantity(1, "pc")).toBe("1 pc");
    expect(formatQuantity(12, "pc")).toBe("12 pcs");
  });
});
