import { and, asc, eq, inArray } from "drizzle-orm";
import type { LineRequest, MenuResponse } from "@brew-haven/contracts";
import { priceLine, type PricedLine } from "@brew-haven/domain";
import type { Db, Tx } from "../db/client.js";
import {
  categories,
  menuItems,
  modifierGroups,
  modifierOptions,
  outletItemStock,
  outlets,
  tenants,
} from "../db/schema.js";
import { AppError, notFound } from "../errors.js";

export type TenantRow = typeof tenants.$inferSelect;
export type OutletRow = typeof outlets.$inferSelect;
type Exec = Db | Tx;

export async function loadTenantOutlet(db: Exec, tenantSlug: string, outletSlug: string) {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, tenantSlug));
  if (!tenant) throw notFound("Café");
  const [outlet] = await db
    .select()
    .from(outlets)
    .where(and(eq(outlets.tenantId, tenant.id), eq(outlets.slug, outletSlug)));
  if (!outlet) throw notFound("Café outlet");
  return { tenant, outlet };
}

async function stockMap(db: Exec, outletId: string) {
  const rows = await db.select().from(outletItemStock).where(eq(outletItemStock.outletId, outletId));
  return new Map(rows.map((r) => [r.itemId, r]));
}

export async function getMenu(db: Db, tenantSlug: string, outletSlug: string): Promise<MenuResponse> {
  const { tenant, outlet } = await loadTenantOutlet(db, tenantSlug, outletSlug);
  const [cats, items, groups, options, stock, allOutlets] = await Promise.all([
    db.select().from(categories).where(eq(categories.tenantId, tenant.id)).orderBy(asc(categories.sort)),
    db
      .select()
      .from(menuItems)
      .where(and(eq(menuItems.tenantId, tenant.id), eq(menuItems.active, true)))
      .orderBy(asc(menuItems.sort)),
    db.select().from(modifierGroups).where(eq(modifierGroups.tenantId, tenant.id)).orderBy(asc(modifierGroups.sort)),
    db.select().from(modifierOptions).where(eq(modifierOptions.tenantId, tenant.id)).orderBy(asc(modifierOptions.sort)),
    stockMap(db, outlet.id),
    db.select().from(outlets).where(eq(outlets.tenantId, tenant.id)).orderBy(asc(outlets.name)),
  ]);

  const optionsByGroup = Map.groupBy(options, (o) => o.groupId);
  const groupsByItem = Map.groupBy(groups, (g) => g.itemId);
  const itemsByCat = Map.groupBy(items, (i) => i.categoryId);
  const b = tenant.branding as Record<string, string | undefined>;

  return {
    tenant: {
      slug: tenant.slug,
      name: tenant.name,
      taxRateBps: tenant.taxRateBps,
      branding: {
        displayName: b.displayName ?? tenant.name,
        tagline: b.tagline,
        greeting: b.greeting,
        managerName: b.managerName,
        primaryColor: b.primaryColor,
        accentColor: b.accentColor,
        logoUrl: b.logoUrl ?? null,
      },
    },
    outlet: { id: outlet.id, slug: outlet.slug, name: outlet.name, isOpen: outlet.isOpen },
    outlets: allOutlets.map((o) => ({ slug: o.slug, name: o.name })),
    demoData: tenant.demoData,
    categories: cats
      .map((c) => ({
        id: c.id,
        name: c.name,
        items: (itemsByCat.get(c.id) ?? []).map((i) => {
          const s = stock.get(i.id);
          return {
            id: i.id,
            name: i.name,
            description: i.description,
            pricePaise: i.pricePaise,
            isVeg: i.isVeg,
            imageUrl: i.imageUrl,
            tags: i.tags,
            stationKey: i.stationKey,
            available: s ? s.available && (s.stockCount === null || s.stockCount > 0) : true,
            modifierGroups: (groupsByItem.get(i.id) ?? []).map((g) => ({
              id: g.id,
              name: g.name,
              minSelect: g.minSelect,
              maxSelect: g.maxSelect,
              options: (optionsByGroup.get(g.id) ?? []).map((o) => ({ id: o.id, name: o.name, pricePaise: o.pricePaise })),
            })),
          };
        }),
      }))
      .filter((c) => c.items.length > 0),
  };
}

export interface ResolvedLine extends PricedLine {
  stationKey: string;
  note?: string;
}

/**
 * Turns client line requests into server-priced lines. Prices always come from the
 * database, never from the client. Validates modifier choices against their groups,
 * and (when requireAvailable) that the outlet has the item in stock.
 */
export async function resolveLines(
  db: Exec,
  tenantId: string,
  outletId: string,
  lines: LineRequest[],
  opts: { requireAvailable: boolean },
): Promise<ResolvedLine[]> {
  const itemIds = [...new Set(lines.map((l) => l.itemId))];
  const items = await db
    .select()
    .from(menuItems)
    .where(and(eq(menuItems.tenantId, tenantId), inArray(menuItems.id, itemIds), eq(menuItems.active, true)));
  const itemById = new Map(items.map((i) => [i.id, i]));
  const groups = itemIds.length
    ? await db.select().from(modifierGroups).where(and(eq(modifierGroups.tenantId, tenantId), inArray(modifierGroups.itemId, itemIds)))
    : [];
  const groupIds = groups.map((g) => g.id);
  const options = groupIds.length
    ? await db.select().from(modifierOptions).where(and(eq(modifierOptions.tenantId, tenantId), inArray(modifierOptions.groupId, groupIds)))
    : [];
  const optionById = new Map(options.map((o) => [o.id, o]));
  const stock = await stockMap(db, outletId);

  const qtyByItem = new Map<string, number>();
  for (const l of lines) qtyByItem.set(l.itemId, (qtyByItem.get(l.itemId) ?? 0) + l.quantity);

  return lines.map((l) => {
    const item = itemById.get(l.itemId);
    if (!item) throw new AppError("VALIDATION", "One of the items is no longer on the menu");
    if (opts.requireAvailable) {
      const s = stock.get(item.id);
      const wanted = qtyByItem.get(item.id) ?? l.quantity;
      if (s && (!s.available || (s.stockCount !== null && s.stockCount < wanted))) {
        throw new AppError("UNAVAILABLE", `${item.name} is sold out right now`);
      }
    }
    const itemGroups = groups.filter((g) => g.itemId === item.id);
    const chosen = [...new Set(l.modifierIds)].map((id) => {
      const o = optionById.get(id);
      if (!o || !itemGroups.some((g) => g.id === o.groupId)) {
        throw new AppError("VALIDATION", `That option is not available for ${item.name}`);
      }
      return o;
    });
    for (const g of itemGroups) {
      const n = chosen.filter((o) => o.groupId === g.id).length;
      if (n < g.minSelect || n > g.maxSelect) {
        throw new AppError("VALIDATION", `Choose ${g.minSelect === g.maxSelect ? g.minSelect : `${g.minSelect}–${g.maxSelect}`} for "${g.name}" on ${item.name}`);
      }
    }
    const priced = priceLine({
      itemId: item.id,
      name: item.name,
      unitPricePaise: item.pricePaise,
      quantity: l.quantity,
      modifiers: chosen.map((o) => ({ id: o.id, name: o.name, pricePaise: o.pricePaise })),
    });
    return { ...priced, stationKey: item.stationKey, ...(l.note ? { note: l.note } : {}) };
  });
}
