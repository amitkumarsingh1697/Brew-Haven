import { and, asc, eq, gte, inArray, lte, ne } from "drizzle-orm";
import type { StaffClaims } from "../auth.js";
import type { Db } from "../db/client.js";
import { orderLines, orders, outlets, payments, refunds, shiftCloses } from "../db/schema.js";
import { AppError } from "../errors.js";
import { assertStaffOutlet, daySummary } from "./staff.js";
import { businessDate } from "./orders.js";

const LIVE = ["PLACED", "PREPARING", "ACTION_REQUIRED", "READY"];
/** Orders that count as sales: paid and not cancelled. */
const SOLD = ["PLACED", "PREPARING", "ACTION_REQUIRED", "READY", "COLLECTED"];

/** Cash that should be in the drawer: opening float + cash taken − cash handed back. */
async function cashFor(db: Db, outletId: string, day: string) {
  const dayOrders = await db.select({ id: orders.id }).from(orders).where(and(eq(orders.outletId, outletId), eq(orders.businessDate, day)));
  const ids = dayOrders.map((o) => o.id);
  if (!ids.length) return { cashIn: 0, cashOut: 0 };
  const cashPays = await db.select().from(payments).where(and(inArray(payments.orderId, ids), eq(payments.method, "CASH"), eq(payments.status, "CAPTURED")));
  const cashPayIds = cashPays.map((p) => p.id);
  const cashRefs = cashPayIds.length ? await db.select().from(refunds).where(and(inArray(refunds.paymentId, cashPayIds), ne(refunds.status, "FAILED"))) : [];
  return { cashIn: cashPays.reduce((s, p) => s + p.amountPaise, 0), cashOut: cashRefs.reduce((s, r) => s + r.amountPaise, 0) };
}

export async function getClose(db: Db, staff: StaffClaims, outletId: string) {
  if (staff.role === "KITCHEN") throw new AppError("FORBIDDEN", "Only the cashier or owner can close the day");
  await assertStaffOutlet(db, staff, outletId);
  const summary = await daySummary(db, staff, outletId);
  const { cashIn, cashOut } = await cashFor(db, outletId, summary.businessDate);
  const [existing] = await db.select().from(shiftCloses).where(and(eq(shiftCloses.outletId, outletId), eq(shiftCloses.businessDate, summary.businessDate)));
  return { summary, cash: { takenPaise: cashIn, refundedPaise: cashOut }, close: existing ? closeView(existing) : null };
}

export async function closeDay(db: Db, staff: StaffClaims, input: { outletId: string; openingFloatPaise: number; countedCashPaise: number; note?: string | undefined }) {
  const { summary, cash } = await getClose(db, staff, input.outletId);
  const expected = input.openingFloatPaise + cash.takenPaise - cash.refundedPaise;
  const values = {
    tenantId: staff.tenantId,
    outletId: input.outletId,
    businessDate: summary.businessDate,
    closedById: staff.sub,
    closedByName: staff.name,
    openingFloatPaise: input.openingFloatPaise,
    countedCashPaise: input.countedCashPaise,
    expectedCashPaise: expected,
    variancePaise: input.countedCashPaise - expected,
    takingsByMethod: summary.capturedByMethod,
    netPaise: summary.netPaise,
    openOrders: summary.orders.open,
    note: input.note?.trim() || null,
    closedAt: new Date(),
  };
  const [row] = await db
    .insert(shiftCloses)
    .values(values)
    .onConflictDoUpdate({ target: [shiftCloses.outletId, shiftCloses.businessDate], set: values })
    .returning();
  return closeView(row!);
}

function closeView(r: typeof shiftCloses.$inferSelect) {
  return {
    id: r.id,
    outletId: r.outletId,
    businessDate: r.businessDate,
    closedBy: r.closedByName,
    closedAt: r.closedAt.toISOString(),
    openingFloatPaise: r.openingFloatPaise,
    countedCashPaise: r.countedCashPaise,
    expectedCashPaise: r.expectedCashPaise,
    variancePaise: r.variancePaise,
    takingsByMethod: r.takingsByMethod,
    netPaise: r.netPaise,
    openOrders: r.openOrders,
    note: r.note,
  };
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Owner reports across cafés for a date range (inclusive, business dates, at most 92 days). */
export async function salesReport(db: Db, staff: StaffClaims, q: { from?: string; to?: string; outletId?: string }) {
  if (staff.role !== "ADMIN") throw new AppError("FORBIDDEN", "Only the owner can see reports");
  const today = businessDate(new Date(), "Asia/Kolkata");
  const to = q.to && DAY.test(q.to) ? q.to : today;
  const from = q.from && DAY.test(q.from) ? q.from : to;
  if (from > to) throw new AppError("VALIDATION", "The start date is after the end date");
  const span = (Date.parse(to) - Date.parse(from)) / 86_400_000;
  if (span > 92) throw new AppError("VALIDATION", "Choose a range of up to 3 months");

  const cafes = await db.select().from(outlets).where(eq(outlets.tenantId, staff.tenantId)).orderBy(asc(outlets.name));
  const cafeIds = q.outletId ? cafes.filter((c) => c.id === q.outletId).map((c) => c.id) : cafes.map((c) => c.id);
  if (!cafeIds.length) throw new AppError("NOT_FOUND", "Café not found");
  const rows = await db
    .select()
    .from(orders)
    .where(and(eq(orders.tenantId, staff.tenantId), inArray(orders.outletId, cafeIds), gte(orders.businessDate, from), lte(orders.businessDate, to)));
  const ids = rows.map((o) => o.id);
  const pays = ids.length ? await db.select().from(payments).where(and(inArray(payments.orderId, ids), eq(payments.status, "CAPTURED"))) : [];
  const refs = ids.length ? await db.select().from(refunds).where(and(inArray(refunds.orderId, ids), ne(refunds.status, "FAILED"))) : [];
  const soldIds = rows.filter((o) => SOLD.includes(o.state)).map((o) => o.id);
  const lines = soldIds.length ? await db.select().from(orderLines).where(and(inArray(orderLines.orderId, soldIds), eq(orderLines.status, "ACTIVE"))) : [];
  const closes = await db
    .select()
    .from(shiftCloses)
    .where(and(eq(shiftCloses.tenantId, staff.tenantId), inArray(shiftCloses.outletId, cafeIds), gte(shiftCloses.businessDate, from), lte(shiftCloses.businessDate, to)))
    .orderBy(asc(shiftCloses.businessDate));

  const orderById = new Map(rows.map((o) => [o.id, o]));
  const paidBy = new Map<string, number>();
  for (const p of pays) paidBy.set(p.orderId, (paidBy.get(p.orderId) ?? 0) + p.amountPaise);
  const refundedBy = new Map<string, number>();
  for (const r of refs) refundedBy.set(r.orderId, (refundedBy.get(r.orderId) ?? 0) + r.amountPaise);
  const net = (id: string) => (paidBy.get(id) ?? 0) - (refundedBy.get(id) ?? 0);

  // per day
  const days: string[] = [];
  for (let t = Date.parse(from); t <= Date.parse(to); t += 86_400_000) days.push(new Date(t).toISOString().slice(0, 10));
  const byDay = new Map(days.map((d) => [d, { date: d, orders: 0, netPaise: 0 }]));
  const byCafe = new Map(cafeIds.map((id) => [id, { outletId: id, name: cafes.find((c) => c.id === id)!.name, orders: 0, cancelled: 0, netPaise: 0, online: 0, counter: 0 }]));
  const byMethod: Record<string, number> = {};
  for (const p of pays) byMethod[p.method] = (byMethod[p.method] ?? 0) + p.amountPaise;
  const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, orders: 0 }));
  const hourOf = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", hourCycle: "h23" });
  let sold = 0, cancelled = 0, open = 0;
  for (const o of rows) {
    if (o.state === "AWAITING_PAYMENT" || o.state === "EXPIRED") continue;
    const cafe = byCafe.get(o.outletId)!;
    const day = byDay.get(o.businessDate ?? "");
    if (o.state === "CANCELLED") {
      cancelled++;
      cafe.cancelled++;
    } else {
      sold++;
      cafe.orders++;
      if (o.channel === "ONLINE") cafe.online++;
      else cafe.counter++;
      if (day) day.orders++;
      if (LIVE.includes(o.state)) open++;
      hours[Number(hourOf.format(o.placedAt ?? o.createdAt))]!.orders++;
    }
    cafe.netPaise += net(o.id);
    if (day) day.netPaise += net(o.id);
  }
  const items = new Map<string, { name: string; quantity: number; revenuePaise: number }>();
  for (const l of lines) {
    if (!orderById.has(l.orderId)) continue;
    const it = items.get(l.itemId) ?? { name: l.name, quantity: 0, revenuePaise: 0 };
    it.quantity += l.quantity;
    it.revenuePaise += l.lineTotalPaise;
    items.set(l.itemId, it);
  }
  const captured = pays.reduce((s, p) => s + p.amountPaise, 0);
  const refunded = refs.reduce((s, r) => s + r.amountPaise, 0);
  return {
    from,
    to,
    totals: {
      orders: sold,
      cancelled,
      open,
      capturedPaise: captured,
      refundedPaise: refunded,
      netPaise: captured - refunded,
      averageOrderPaise: sold ? Math.round((captured - refunded) / sold) : 0,
    },
    byDay: [...byDay.values()],
    byCafe: [...byCafe.values()],
    byMethod,
    topItems: [...items.values()].sort((a, b) => b.quantity - a.quantity || b.revenuePaise - a.revenuePaise).slice(0, 10),
    busiestHours: hours.filter((h) => h.orders > 0),
    closes: closes.map((c) => ({ ...closeView(c), outlet: cafes.find((x) => x.id === c.outletId)?.name ?? "" })),
  };
}
