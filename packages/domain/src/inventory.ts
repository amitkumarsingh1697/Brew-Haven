/**
 * Inventory foundation (backlog S10). Ingredients are counted in whole base units: grams, millilitres
 * or pieces. A menu item's recipe lists what one serving uses; a choice (e.g. "Large", "Oat milk")
 * can add to or take away from that, so "Oat milk" is +200 ml oat milk and −200 ml milk.
 */
export type InventoryUnit = "g" | "ml" | "pc";

export interface RecipeRow {
  ingredientId: string;
  /** Per one serving. Negative only on a choice, to take away from the base recipe. */
  quantity: number;
}

export interface SoldLine {
  itemId: string;
  quantity: number;
  modifierIds: string[];
}

/**
 * What a set of order lines uses, per ingredient. Items without a recipe use nothing (so a café
 * can start with a few recipes). A choice can't take an ingredient below zero for a serving.
 */
export function consumption(lines: SoldLine[], itemRecipes: Map<string, RecipeRow[]>, optionRecipes: Map<string, RecipeRow[]>): Map<string, number> {
  const total = new Map<string, number>();
  for (const line of lines) {
    const perServing = new Map<string, number>();
    for (const r of itemRecipes.get(line.itemId) ?? []) perServing.set(r.ingredientId, (perServing.get(r.ingredientId) ?? 0) + r.quantity);
    for (const m of line.modifierIds) for (const r of optionRecipes.get(m) ?? []) perServing.set(r.ingredientId, (perServing.get(r.ingredientId) ?? 0) + r.quantity);
    for (const [id, q] of perServing) {
      const used = Math.max(0, q) * line.quantity;
      if (used > 0) total.set(id, (total.get(id) ?? 0) + used);
    }
  }
  return total;
}

/** "1.2 kg", "350 ml", "12 pcs": readable amounts for screens. */
export function formatQuantity(amount: number, unit: InventoryUnit): string {
  const sign = amount < 0 ? "−" : "";
  const a = Math.abs(amount);
  const n = (x: number) => x.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  if (unit === "pc") return `${sign}${n(a)} ${a === 1 ? "pc" : "pcs"}`;
  if (a >= 1000) return `${sign}${n(a / 1000)} ${unit === "g" ? "kg" : "L"}`;
  return `${sign}${n(a)} ${unit}`;
}
