import { and, asc, desc, eq, gte, inArray, ne } from "drizzle-orm";
import type { DaySummary, OrderView, StaffSession } from "@brew-haven/contracts";
import { verifyPin, type AttemptLimiter, type StaffClaims, type StaffTokens } from "../auth.js";
import type { Db } from "../db/client.js";
import { orders, outletItemStock, outlets, payments, refunds, staffUsers, tenants, menuItems } from "../db/schema.js";
import { AppError, notFound } from "../errors.js";
import { businessDate, orderView } from "./orders.js";

export async function listStaffUsers(db: Db, tenantSlug: string) {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, tenantSlug));
  if (!tenant) throw notFound("Café");
  const users = await db
    .select({ id: staffUsers.id, name: staffUsers.name, role: staffUsers.role })
    .from(staffUsers)
    .where(and(eq(staffUsers.tenantId, tenant.id), eq(staffUsers.active, true)))
    .orderBy(asc(staffUsers.name));
  return { tenant: { slug: tenant.slug, name: tenant.name }, users };
}

export async function login(
  db: Db,
  tokens: StaffTokens,
  limiter: AttemptLimiter,
  input: { tenantSlug: string; staffUserId: string; pin: string },
  ip: string,
): Promise<StaffSession> {
  const key = `${input.staffUserId}|${ip}`;
  // Also per person across all addresses (20 wrong PINs an hour), so a 4-digit PIN can't be guessed from many IPs.
  const personKey = `person|${input.staffUserId}`;
  limiter.check(key);
  limiter.check(personKey, Date.now(), 20);
  const [row] = await db
    .select({ user: staffUsers, tenant: tenants })
    .from(staffUsers)
    .innerJoin(tenants, eq(tenants.id, staffUsers.tenantId))
    .where(and(eq(staffUsers.id, input.staffUserId), eq(tenants.slug, input.tenantSlug), eq(staffUsers.active, true)));
  if (!row || !(await verifyPin(input.pin, row.user.pinHash))) {
    limiter.fail(key);
    limiter.fail(personKey, Date.now(), 60 * 60 * 1000);
    throw new AppError("UNAUTHORIZED", "That PIN is not right");
  }
  limiter.reset(key);
  limiter.reset(personKey);
  const outletRows =
    row.user.role === "ADMIN"
      ? await db.select().from(outlets).where(eq(outlets.tenantId, row.tenant.id)).orderBy(asc(outlets.name))
      : await db.select().from(outlets).where(and(eq(outlets.tenantId, row.tenant.id), inArray(outlets.id, row.user.outletIds))).orderBy(asc(outlets.name));
  const claims: StaffClaims = {
    sub: row.user.id,
    tenantId: row.tenant.id,
    role: row.user.role,
    outletIds: outletRows.map((o) => o.id),
    name: row.user.name,
  };
  return {
    token: await tokens.issue(claims),
    user: { id: row.user.id, name: row.user.name, role: row.user.role },
    tenant: { slug: row.tenant.slug, name: row.tenant.name },
    outlets: outletRows.map((o) => ({ id: o.id, slug: o.slug, name: o.name })),
  };
}

/** Admins can use every café of their tenant, including ones added after they signed in. */
export async function assertStaffOutlet(db: Db, staff: StaffClaims, outletId: string) {
  if (staff.role === "ADMIN") {
    const [o] = await db.select({ id: outlets.id }).from(outlets).where(and(eq(outlets.id, outletId), eq(outlets.tenantId, staff.tenantId)));
    if (o) return;
  } else if (staff.outletIds.includes(outletId)) return;
  throw new AppError("FORBIDDEN", "You are not assigned to this café");
}

const LIVE_STATES = ["PLACED", "PREPARING", "ACTION_REQUIRED", "READY"];

/** The live queue for POS and kitchen, plus today's finished orders. */
export async function listOutletOrders(db: Db, staff: StaffClaims, outletId: string, scope: "live" | "today"): Promise<OrderView[]> {
  await assertStaffOutlet(db, staff, outletId);
  const since = new Date(Date.now() - 18 * 60 * 60 * 1000);
  const cond =
    scope === "live"
      ? and(eq(orders.tenantId, staff.tenantId), eq(orders.outletId, outletId), inArray(orders.state, LIVE_STATES))
      : and(eq(orders.tenantId, staff.tenantId), eq(orders.outletId, outletId), ne(orders.state, "AWAITING_PAYMENT"), gte(orders.createdAt, since));
  const rows = await db.select({ id: orders.id }).from(orders).where(cond).orderBy(scope === "live" ? asc(orders.placedAt) : desc(orders.createdAt)).limit(200);
  return db.transaction(async (tx) => Promise.all(rows.map((r) => orderView(tx, r.id))));
}

export async function updateStock(db: Db, staff: StaffClaims, input: { outletId: string; itemId: string; available: boolean; stockCount?: number | null | undefined }) {
  if (staff.role === "KITCHEN" && input.stockCount !== undefined) throw new AppError("FORBIDDEN", "Kitchen staff can mark items sold out, but not set counts");
  await assertStaffOutlet(db, staff, input.outletId);
  const [item] = await db.select().from(menuItems).where(and(eq(menuItems.id, input.itemId), eq(menuItems.tenantId, staff.tenantId)));
  if (!item) throw notFound("Menu item");
  const set: { available: boolean; updatedAt: Date; stockCount?: number | null } = { available: input.available, updatedAt: new Date() };
  if (input.stockCount !== undefined) set.stockCount = input.stockCount;
  await db
    .insert(outletItemStock)
    .values({ tenantId: staff.tenantId, outletId: input.outletId, itemId: input.itemId, available: input.available, stockCount: input.stockCount ?? null })
    .onConflictDoUpdate({ target: [outletItemStock.outletId, outletItemStock.itemId], set });
  return { itemId: input.itemId, available: input.available, stockCount: input.stockCount ?? null };
}

export async function stockList(db: Db, staff: StaffClaims, outletId: string) {
  await assertStaffOutlet(db, staff, outletId);
  const items = await db.select().from(menuItems).where(and(eq(menuItems.tenantId, staff.tenantId), eq(menuItems.active, true))).orderBy(asc(menuItems.sort));
  const stock = await db.select().from(outletItemStock).where(eq(outletItemStock.outletId, outletId));
  const byItem = new Map(stock.map((s) => [s.itemId, s]));
  return items.map((i) => {
    const s = byItem.get(i.id);
    return { itemId: i.id, name: i.name, available: s ? s.available : true, stockCount: s?.stockCount ?? null };
  });
}

/** Minimal collections view for the cashier and owner (the pilot's shift close). */
export async function daySummary(db: Db, staff: StaffClaims, outletId: string, date?: string): Promise<DaySummary> {
  if (staff.role === "KITCHEN") throw new AppError("FORBIDDEN", "Only the cashier or admin can see takings");
  await assertStaffOutlet(db, staff, outletId);
  const [outlet] = await db.select().from(outlets).where(eq(outlets.id, outletId));
  const day = date ?? businessDate(new Date(), outlet!.timezone);
  const dayOrders = await db.select().from(orders).where(and(eq(orders.outletId, outletId), eq(orders.businessDate, day)));
  const ids = dayOrders.map((o) => o.id);
  const pays = ids.length ? await db.select().from(payments).where(and(inArray(payments.orderId, ids), eq(payments.status, "CAPTURED"))) : [];
  const refs = ids.length ? await db.select().from(refunds).where(and(inArray(refunds.orderId, ids), ne(refunds.status, "FAILED"))) : [];
  const byMethod: Record<string, number> = {};
  for (const p of pays) byMethod[p.method] = (byMethod[p.method] ?? 0) + p.amountPaise;
  const captured = pays.reduce((s, p) => s + p.amountPaise, 0);
  const refunded = refs.reduce((s, r) => s + r.amountPaise, 0);
  return {
    outletId,
    businessDate: day,
    orders: {
      total: dayOrders.length,
      collected: dayOrders.filter((o) => o.state === "COLLECTED").length,
      cancelled: dayOrders.filter((o) => o.state === "CANCELLED").length,
      open: dayOrders.filter((o) => LIVE_STATES.includes(o.state)).length,
    },
    capturedByMethod: byMethod,
    capturedPaise: captured,
    refundedPaise: refunded,
    netPaise: captured - refunded,
  };
}

