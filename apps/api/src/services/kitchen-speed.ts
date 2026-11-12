import { and, asc, eq, gte, inArray, isNotNull, lte } from "drizzle-orm";
import type { StaffClaims } from "../auth.js";
import type { Db } from "../db/client.js";
import { orderEvents, orderLines, orders, outlets } from "../db/schema.js";
import { AppError } from "../errors.js";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MIN = 60_000;

/** The middle value and the value 9 in 10 orders beat, in whole seconds. */
function spread(ms: number[]) {
  if (!ms.length) return { medianSec: null, p90Sec: null };
  const s = [...ms].sort((a, b) => a - b);
  const at = (q: number) => s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)]!;
  return { medianSec: Math.round(at(0.5) / 1000), p90Sec: Math.round(at(0.9) / 1000) };
}

/**
 * How fast the kitchen turns orders round, from each order's own history: waiting to start (paid to
 * "Start"), making (start to "Ready") and the whole ticket (paid to ready), plus how long ready orders
 * waited to be collected. An order is late when paid-to-ready takes longer than the target.
 */
export async function kitchenSpeed(db: Db, staff: StaffClaims, q: { from?: string | undefined; to?: string | undefined; outletId?: string | undefined; targetMinutes?: string | number | undefined }) {
  if (staff.role !== "ADMIN") throw new AppError("FORBIDDEN", "Only the owner can see kitchen reports");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  const to = q.to && DAY.test(q.to) ? q.to : today;
  const from = q.from && DAY.test(q.from) ? q.from : to;
  if (from > to) throw new AppError("VALIDATION", "The start date is after the end date");
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > 92) throw new AppError("VALIDATION", "Choose a range of up to 3 months");
  const target = Math.round(Number(q.targetMinutes ?? 10));
  if (!Number.isFinite(target) || target < 1 || target > 120) throw new AppError("VALIDATION", "Choose a target between 1 and 120 minutes");

  const cafes = await db.select({ id: outlets.id, name: outlets.name }).from(outlets).where(eq(outlets.tenantId, staff.tenantId)).orderBy(asc(outlets.name));
  const ids = q.outletId ? cafes.filter((c) => c.id === q.outletId).map((c) => c.id) : cafes.map((c) => c.id);
  if (!ids.length) throw new AppError("NOT_FOUND", "Café not found");
  const name = new Map(cafes.map((c) => [c.id, c.name]));

  const rows = await db
    .select({ id: orders.id, outletId: orders.outletId, code: orders.pickupCode, channel: orders.channel, state: orders.state, placedAt: orders.placedAt })
    .from(orders)
    .where(and(eq(orders.tenantId, staff.tenantId), inArray(orders.outletId, ids), isNotNull(orders.placedAt), gte(orders.businessDate, from), lte(orders.businessDate, to)));
  const orderIds = rows.map((r) => r.id);
  const events = orderIds.length
    ? await db
        .select({ orderId: orderEvents.orderId, toState: orderEvents.toState, at: orderEvents.at })
        .from(orderEvents)
        .where(and(inArray(orderEvents.orderId, orderIds), inArray(orderEvents.toState, ["PLACED", "PREPARING", "ACTION_REQUIRED", "READY", "COLLECTED"])))
        .orderBy(asc(orderEvents.id))
    : [];
  const items = orderIds.length ? await db.select({ orderId: orderLines.orderId, quantity: orderLines.quantity }).from(orderLines).where(and(inArray(orderLines.orderId, orderIds), eq(orderLines.status, "ACTIVE"))) : [];
  const itemCount = new Map<string, number>();
  for (const i of items) itemCount.set(i.orderId, (itemCount.get(i.orderId) ?? 0) + i.quantity);

  // The first time each order reached each state.
  const first = new Map<string, Map<string, Date>>();
  for (const e of events) {
    const m = first.get(e.orderId) ?? new Map<string, Date>();
    if (!m.has(e.toState)) m.set(e.toState, e.at);
    first.set(e.orderId, m);
  }

  const hourOf = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", hourCycle: "h23" });
  type Bucket = { wait: number[]; make: number[]; ticket: number[]; pickup: number[]; late: number };
  const bucket = (): Bucket => ({ wait: [], make: [], ticket: [], pickup: [], late: 0 });
  const all = bucket();
  const byCafe = new Map(ids.map((id) => [id, bucket()]));
  const byHour = new Map<number, Bucket>();
  const late: Array<{ orderId: string; code: string; outlet: string; channel: string; placedAt: string; ticketSec: number; items: number; hadIssue: boolean }> = [];
  let open = 0;

  for (const o of rows) {
    const m = first.get(o.id);
    const placed = m?.get("PLACED") ?? o.placedAt!;
    const started = m?.get("PREPARING");
    const ready = m?.get("READY");
    const collected = m?.get("COLLECTED");
    if (!ready) {
      if (o.state !== "CANCELLED" && o.state !== "EXPIRED" && o.state !== "COLLECTED") open++;
      continue;
    }
    const hour = Number(hourOf.format(placed));
    const h = byHour.get(hour) ?? bucket();
    byHour.set(hour, h);
    const targets = [all, byCafe.get(o.outletId)!, h];
    const ticket = ready.getTime() - placed.getTime();
    for (const b of targets) {
      b.ticket.push(ticket);
      if (started) {
        b.wait.push(started.getTime() - placed.getTime());
        b.make.push(ready.getTime() - started.getTime());
      }
      if (collected) b.pickup.push(collected.getTime() - ready.getTime());
    }
    if (ticket > target * MIN) {
      for (const b of targets) b.late++;
      late.push({ orderId: o.id, code: o.code ?? "", outlet: name.get(o.outletId) ?? "", channel: o.channel, placedAt: placed.toISOString(), ticketSec: Math.round(ticket / 1000), items: itemCount.get(o.id) ?? 0, hadIssue: m?.has("ACTION_REQUIRED") ?? false });
    }
  }

  const view = (b: Bucket) => ({
    orders: b.ticket.length,
    late: b.late,
    latePct: b.ticket.length ? Math.round((b.late / b.ticket.length) * 1000) / 10 : 0,
    ticket: spread(b.ticket),
    waitToStart: spread(b.wait),
    making: spread(b.make),
    waitForPickup: spread(b.pickup),
  });
  return {
    from,
    to,
    targetMinutes: target,
    stillOpen: open,
    totals: view(all),
    byCafe: ids.map((id) => ({ outletId: id, outlet: name.get(id) ?? "", ...view(byCafe.get(id)!) })),
    byHour: [...byHour.entries()].sort((a, b) => a[0] - b[0]).map(([hour, b]) => ({ hour, ...view(b) })),
    slowest: late.sort((a, b) => b.ticketSec - a.ticketSec).slice(0, 20),
  };
}
