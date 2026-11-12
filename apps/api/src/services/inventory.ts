import { and, asc, desc, eq, gte, inArray, lt, sql, sum } from "drizzle-orm";
import type { z } from "zod";
import type { IngredientInput, IngredientUpdate, LowStockInput, RecipeInput, StockMovementInput } from "@brew-haven/contracts";
import { consumption, type RecipeRow } from "@brew-haven/domain";
import type { StaffClaims } from "../auth.js";
import type { Db, Tx } from "../db/client.js";
import { ingredients, menuItems, modifierGroups, modifierOptions, outletIngredients, outlets, recipeRows, staffUsers, stockMovements } from "../db/schema.js";
import { AppError, notFound } from "../errors.js";
import { assertStaffOutlet } from "./staff.js";

type ModifierSnapshot = { id: string; name: string };
type SoldLine = { itemId: string; quantity: number; modifiers: ModifierSnapshot[] };

const isUnique = (e: unknown) => (e as { code?: string }).code === "23505" || (e as { cause?: { code?: string } }).cause?.code === "23505";
const assertAdmin = (s: StaffClaims) => {
  if (s.role !== "ADMIN") throw new AppError("FORBIDDEN", "Only the owner can change ingredients and recipes");
};

/**
 * Writes what placed order lines use as SALE movements. Called in the same transaction that takes
 * the order, so stock and sales can't drift apart. Items without a recipe use nothing.
 */
export async function consumeIngredients(tx: Tx, order: { id: string; tenantId: string; outletId: string }, lines: SoldLine[]) {
  if (!lines.length) return;
  const itemIds = [...new Set(lines.map((l) => l.itemId))];
  const rows = await tx.select().from(recipeRows).where(inArray(recipeRows.itemId, itemIds));
  if (!rows.length) return;

  // A line records the choices it was made with by id; recipes refer to them by group and option name.
  const optionIds = [...new Set(lines.flatMap((l) => l.modifiers.map((m) => m.id)))];
  const opts = optionIds.length
    ? await tx
        .select({ id: modifierOptions.id, option: modifierOptions.name, group: modifierGroups.name, itemId: modifierGroups.itemId })
        .from(modifierOptions)
        .innerJoin(modifierGroups, eq(modifierGroups.id, modifierOptions.groupId))
        .where(inArray(modifierOptions.id, optionIds))
    : [];

  const itemRecipes = new Map<string, RecipeRow[]>();
  for (const r of rows.filter((r) => !r.groupName)) itemRecipes.set(r.itemId, [...(itemRecipes.get(r.itemId) ?? []), { ingredientId: r.ingredientId, quantity: r.quantity }]);
  const optionRecipes = new Map<string, RecipeRow[]>();
  for (const o of opts) {
    const match = rows.filter((r) => r.itemId === o.itemId && r.groupName === o.group && r.optionName === o.option);
    if (match.length) optionRecipes.set(o.id, match.map((r) => ({ ingredientId: r.ingredientId, quantity: r.quantity })));
  }

  const used = consumption(
    lines.map((l) => ({ itemId: l.itemId, quantity: l.quantity, modifierIds: l.modifiers.map((m) => m.id) })),
    itemRecipes,
    optionRecipes,
  );
  if (!used.size) return;
  await tx.insert(stockMovements).values(
    [...used].map(([ingredientId, q]) => ({ tenantId: order.tenantId, outletId: order.outletId, ingredientId, kind: "SALE" as const, quantity: -q, orderId: order.id })),
  );
}

/** On hand, low-stock level and the last week's use for every ingredient at a café. All staff of the café can see it. */
export async function inventoryFor(db: Db, staff: StaffClaims, outletId: string) {
  await assertStaffOutlet(db, staff, outletId);
  const list = await db.select().from(ingredients).where(eq(ingredients.tenantId, staff.tenantId)).orderBy(asc(ingredients.name));
  const onHand = await db
    .select({ id: stockMovements.ingredientId, n: sum(stockMovements.quantity) })
    .from(stockMovements)
    .where(eq(stockMovements.outletId, outletId))
    .groupBy(stockMovements.ingredientId);
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);
  const used = await db
    .select({ id: stockMovements.ingredientId, n: sum(stockMovements.quantity) })
    .from(stockMovements)
    .where(and(eq(stockMovements.outletId, outletId), eq(stockMovements.kind, "SALE"), gte(stockMovements.createdAt, weekAgo)))
    .groupBy(stockMovements.ingredientId);
  const lows = await db.select().from(outletIngredients).where(eq(outletIngredients.outletId, outletId));
  const recipeCounts = await db
    .select({ id: recipeRows.ingredientId, n: sql<number>`count(distinct ${recipeRows.itemId})::int` })
    .from(recipeRows)
    .where(eq(recipeRows.tenantId, staff.tenantId))
    .groupBy(recipeRows.ingredientId);
  const get = (rows: Array<{ id: string; n: string | number | null }>, id: string) => Number(rows.find((r) => r.id === id)?.n ?? 0);
  return {
    ingredients: list.map((i) => {
      const have = get(onHand, i.id);
      const lowAt = lows.find((l) => l.ingredientId === i.id)?.lowAt ?? null;
      // Nothing recorded at this café yet: don't call it "out" before anyone has counted it.
      const tracked = onHand.some((r) => r.id === i.id) || lowAt !== null;
      return {
        id: i.id,
        name: i.name,
        unit: i.unit,
        active: i.active,
        onHand: have,
        lowAt,
        tracked,
        status: !tracked ? ("UNTRACKED" as const) : have <= 0 ? ("OUT" as const) : lowAt !== null && have <= lowAt ? ("LOW" as const) : ("OK" as const),
        usedLast7Days: -get(used, i.id),
        usedIn: get(recipeCounts, i.id),
      };
    }),
  };
}

export async function stockHistory(db: Db, staff: StaffClaims, outletId: string, ingredientId?: string) {
  await assertStaffOutlet(db, staff, outletId);
  const rows = await db
    .select({ m: stockMovements, ingredient: ingredients.name, unit: ingredients.unit, by: staffUsers.name })
    .from(stockMovements)
    .innerJoin(ingredients, eq(ingredients.id, stockMovements.ingredientId))
    .leftJoin(staffUsers, eq(staffUsers.id, stockMovements.staffId))
    .where(and(eq(stockMovements.outletId, outletId), ...(ingredientId ? [eq(stockMovements.ingredientId, ingredientId)] : [])))
    .orderBy(desc(stockMovements.id))
    .limit(100);
  return rows.map((r) => ({ id: r.m.id, at: r.m.createdAt.toISOString(), ingredient: r.ingredient, unit: r.unit, kind: r.m.kind, quantity: r.m.quantity, note: r.m.note, by: r.by }));
}

/** A delivery, waste, or a shelf count (which records the difference from what the system expected). */
export async function recordStock(db: Db, staff: StaffClaims, body: z.output<typeof StockMovementInput>) {
  await assertStaffOutlet(db, staff, body.outletId);
  const [ing] = await db.select().from(ingredients).where(and(eq(ingredients.id, body.ingredientId), eq(ingredients.tenantId, staff.tenantId)));
  if (!ing) throw notFound("Ingredient");
  return db.transaction(async (tx) => {
    // Serialise counts per ingredient and café so two counts at once can't both apply a difference.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${body.outletId}:${body.ingredientId}`}))`);
    let quantity: number;
    if (body.kind === "RECEIVE") quantity = body.quantity;
    else if (body.kind === "WASTE") quantity = -body.quantity;
    else {
      const [row] = await tx
        .select({ n: sum(stockMovements.quantity) })
        .from(stockMovements)
        .where(and(eq(stockMovements.outletId, body.outletId), eq(stockMovements.ingredientId, body.ingredientId)));
      quantity = body.quantity - Number(row?.n ?? 0);
    }
    const [m] = await tx
      .insert(stockMovements)
      .values({ tenantId: staff.tenantId, outletId: body.outletId, ingredientId: body.ingredientId, kind: body.kind, quantity, note: body.note ?? null, staffId: staff.sub })
      .returning();
    const [after] = await tx
      .select({ n: sum(stockMovements.quantity) })
      .from(stockMovements)
      .where(and(eq(stockMovements.outletId, body.outletId), eq(stockMovements.ingredientId, body.ingredientId)));
    return { id: m!.id, kind: m!.kind, change: quantity, onHand: Number(after?.n ?? 0), ingredient: ing.name, unit: ing.unit };
  });
}

export async function setLowStock(db: Db, staff: StaffClaims, body: z.output<typeof LowStockInput>) {
  assertAdmin(staff);
  await assertStaffOutlet(db, staff, body.outletId);
  const [ing] = await db.select({ id: ingredients.id }).from(ingredients).where(and(eq(ingredients.id, body.ingredientId), eq(ingredients.tenantId, staff.tenantId)));
  if (!ing) throw notFound("Ingredient");
  await db
    .insert(outletIngredients)
    .values({ outletId: body.outletId, ingredientId: body.ingredientId, lowAt: body.lowAt })
    .onConflictDoUpdate({ target: [outletIngredients.outletId, outletIngredients.ingredientId], set: { lowAt: body.lowAt } });
  return { ok: true };
}

export async function createIngredient(db: Db, staff: StaffClaims, body: z.output<typeof IngredientInput>) {
  assertAdmin(staff);
  try {
    const [row] = await db.insert(ingredients).values({ tenantId: staff.tenantId, name: body.name, unit: body.unit }).returning();
    return row!;
  } catch (e) {
    if (isUnique(e)) throw new AppError("CONFLICT", `There's already an ingredient called ${body.name}`);
    throw e;
  }
}

export async function updateIngredient(db: Db, staff: StaffClaims, id: string, body: z.output<typeof IngredientUpdate>) {
  assertAdmin(staff);
  try {
    const [row] = await db
      .update(ingredients)
      .set({ ...(body.name !== undefined ? { name: body.name } : {}), ...(body.active !== undefined ? { active: body.active } : {}) })
      .where(and(eq(ingredients.id, id), eq(ingredients.tenantId, staff.tenantId)))
      .returning();
    if (!row) throw notFound("Ingredient");
    return row;
  } catch (e) {
    if (isUnique(e)) throw new AppError("CONFLICT", `There's already an ingredient called ${body.name}`);
    throw e;
  }
}

/** Every menu item with its recipe and its current choices, for the recipe editor. Owner only. */
export async function recipeBook(db: Db, staff: StaffClaims) {
  assertAdmin(staff);
  const items = await db.select({ id: menuItems.id, name: menuItems.name, active: menuItems.active }).from(menuItems).where(eq(menuItems.tenantId, staff.tenantId)).orderBy(asc(menuItems.name));
  const groups = await db
    .select({ itemId: modifierGroups.itemId, group: modifierGroups.name, option: modifierOptions.name, gs: modifierGroups.sort, os: modifierOptions.sort })
    .from(modifierOptions)
    .innerJoin(modifierGroups, eq(modifierGroups.id, modifierOptions.groupId))
    .where(eq(modifierGroups.tenantId, staff.tenantId))
    .orderBy(asc(modifierGroups.sort), asc(modifierOptions.sort));
  const rows = await db.select().from(recipeRows).where(eq(recipeRows.tenantId, staff.tenantId));
  return {
    items: items.map((i) => ({
      ...i,
      choices: groups.filter((g) => g.itemId === i.id).map((g) => ({ group: g.group, option: g.option })),
      rows: rows.filter((r) => r.itemId === i.id).map((r) => ({ groupName: r.groupName, optionName: r.optionName, ingredientId: r.ingredientId, quantity: r.quantity })),
    })),
  };
}

/** Replaces an item's whole recipe (base and choices). */
export async function setRecipe(db: Db, staff: StaffClaims, itemId: string, body: z.output<typeof RecipeInput>) {
  assertAdmin(staff);
  const [item] = await db.select({ id: menuItems.id, name: menuItems.name }).from(menuItems).where(and(eq(menuItems.id, itemId), eq(menuItems.tenantId, staff.tenantId)));
  if (!item) throw notFound("Menu item");
  const ids = [...new Set(body.rows.map((r) => r.ingredientId))];
  if (ids.length) {
    const found = await db.select({ id: ingredients.id }).from(ingredients).where(and(eq(ingredients.tenantId, staff.tenantId), inArray(ingredients.id, ids)));
    if (found.length !== ids.length) throw notFound("Ingredient");
  }
  await db.transaction(async (tx) => {
    await tx.delete(recipeRows).where(eq(recipeRows.itemId, itemId));
    if (body.rows.length)
      await tx.insert(recipeRows).values(body.rows.map((r) => ({ tenantId: staff.tenantId, itemId, groupName: r.groupName ?? null, optionName: r.optionName ?? null, ingredientId: r.ingredientId, quantity: r.quantity })));
  });
  return { itemId, name: item.name, rows: body.rows.length };
}

/** Ingredients that are low or out at any café, for the owner's overview. */
export async function lowStockAcrossCafes(db: Db, staff: StaffClaims) {
  assertAdmin(staff);
  const cafes = await db.select({ id: outlets.id, name: outlets.name }).from(outlets).where(eq(outlets.tenantId, staff.tenantId));
  const out: Array<{ outlet: string; ingredient: string; unit: string; onHand: number; lowAt: number | null; status: "LOW" | "OUT" }> = [];
  for (const c of cafes) {
    const inv = await inventoryFor(db, staff, c.id);
    for (const i of inv.ingredients) if (i.active && (i.status === "LOW" || i.status === "OUT")) out.push({ outlet: c.name, ingredient: i.name, unit: i.unit, onHand: i.onHand, lowAt: i.lowAt, status: i.status });
  }
  return out;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const IST_MIDNIGHT = (d: string) => new Date(`${d}T00:00:00+05:30`);

/**
 * Stock movement for one café over a date range (India time), per ingredient:
 * opening + received - used by sales - wasted + count corrections = closing.
 * The count corrections are the variance: stock that went missing (or turned up) beyond what the
 * recipes and recorded waste explain. Owner only.
 */
export async function stockReport(db: Db, staff: StaffClaims, q: { outletId?: string; from?: string; to?: string }) {
  assertAdmin(staff);
  if (!q.outletId) throw new AppError("VALIDATION", "Choose a café");
  await assertStaffOutlet(db, staff, q.outletId);
  const today = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
  const to = q.to && DAY.test(q.to) ? q.to : today;
  const from = q.from && DAY.test(q.from) ? q.from : to;
  if (from > to) throw new AppError("VALIDATION", "The start date is after the end date");
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > 92) throw new AppError("VALIDATION", "Choose a range of up to 3 months");
  const start = IST_MIDNIGHT(from);
  const end = new Date(IST_MIDNIGHT(to).getTime() + 86_400_000);

  const list = await db.select().from(ingredients).where(eq(ingredients.tenantId, staff.tenantId)).orderBy(asc(ingredients.name));
  const before = await db
    .select({ id: stockMovements.ingredientId, n: sum(stockMovements.quantity) })
    .from(stockMovements)
    .where(and(eq(stockMovements.outletId, q.outletId), lt(stockMovements.createdAt, start)))
    .groupBy(stockMovements.ingredientId);
  const during = await db
    .select({ id: stockMovements.ingredientId, kind: stockMovements.kind, n: sum(stockMovements.quantity) })
    .from(stockMovements)
    .where(and(eq(stockMovements.outletId, q.outletId), gte(stockMovements.createdAt, start), lt(stockMovements.createdAt, end)))
    .groupBy(stockMovements.ingredientId, stockMovements.kind);
  const of = (id: string, kind: string) => Number(during.find((d) => d.id === id && d.kind === kind)?.n ?? 0);

  const rows = list
    .map((i) => {
      const opening = Number(before.find((b) => b.id === i.id)?.n ?? 0);
      const received = of(i.id, "RECEIVE");
      const used = -of(i.id, "SALE");
      const wasted = -of(i.id, "WASTE");
      const variance = of(i.id, "COUNT");
      return {
        ingredientId: i.id,
        name: i.name,
        unit: i.unit,
        opening,
        received,
        used,
        wasted,
        variance,
        closing: opening + received - used - wasted + variance,
        /** Missing stock as a share of what sales used; null when nothing was used. */
        variancePct: used > 0 ? Math.round((variance / used) * 1000) / 10 : null,
      };
    })
    .filter((r) => r.opening || r.received || r.used || r.wasted || r.variance);
  return { from, to, outletId: q.outletId, rows };
}
