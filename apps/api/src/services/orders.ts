import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { LineRequest, OrderView } from "@brew-haven/contracts";
import {
  ADJUSTMENT_TIMEOUT_MS,
  assertRefundAllowed,
  formatPickupCode,
  inclusiveTax,
  transition,
  type Actor,
  type OrderAction,
  type OrderState,
} from "@brew-haven/domain";
import type { After, Tx } from "../db/client.js";
import {
  adjustments,
  dailyCounters,
  orderEvents,
  orderLines,
  orders,
  outbox,
  outletItemStock,
  outlets,
  payments,
  refunds,
  tenants,
} from "../db/schema.js";
import { AppError, notFound } from "../errors.js";
import type { EventBus } from "../events.js";
import type { ResolvedLine } from "./catalog.js";

export type OrderRow = typeof orders.$inferSelect;
export const UNPAID_ORDER_TTL_MS = 15 * 60 * 1000;

export function newTrackingToken(): string {
  return randomBytes(18).toString("base64url");
}

export function businessDate(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export async function lockOrder(tx: Tx, where: { id: string } | { trackingToken: string }): Promise<OrderRow> {
  const cond = "id" in where ? eq(orders.id, where.id) : eq(orders.trackingToken, where.trackingToken);
  const [o] = await tx.select().from(orders).where(cond).for("update");
  if (!o) throw notFound("Order");
  return o;
}

export function announce(after: After, bus: EventBus, o: Pick<OrderRow, "tenantId" | "outletId" | "id" | "trackingToken" | "state">) {
  after(() => bus.orderChanged({ tenantId: o.tenantId, outletId: o.outletId, orderId: o.id, trackingToken: o.trackingToken, state: o.state }));
}

export async function insertLines(tx: Tx, order: Pick<OrderRow, "id" | "tenantId">, lines: ResolvedLine[], status: "ACTIVE" | "PENDING_TOPUP" = "ACTIVE", replacesLineId: string | null = null) {
  return tx
    .insert(orderLines)
    .values(
      lines.map((l) => ({
        tenantId: order.tenantId,
        orderId: order.id,
        itemId: l.itemId,
        name: l.name,
        quantity: l.quantity,
        unitTotalPaise: l.unitTotalPaise,
        lineTotalPaise: l.lineTotalPaise,
        modifiers: l.modifiers,
        note: l.note ?? null,
        stationKey: l.stationKey,
        status,
        replacesLineId,
      })),
    )
    .returning();
}

/** Applies a state-machine transition, records the event, and announces it after commit. */
export async function applyTransition(
  tx: Tx,
  after: After,
  bus: EventBus,
  order: OrderRow,
  action: OrderAction,
  actor: Actor,
  opts: { actorId?: string | null; reason?: string | null } = {},
): Promise<OrderRow> {
  let result;
  try {
    result = transition({ state: order.state as OrderState, resumeState: order.resumeState as OrderState | null, action, actor, reason: opts.reason ?? null });
  } catch (e) {
    throw new AppError(e instanceof Error && "code" in e && e.code === "FORBIDDEN_ACTOR" ? "FORBIDDEN" : "INVALID_TRANSITION", (e as Error).message);
  }
  const patch: Partial<OrderRow> = { state: result.to, resumeState: result.resumeState, updatedAt: new Date() };
  if (result.to === "CANCELLED") patch.cancelReason = opts.reason ?? order.cancelReason;
  const [updated] = await tx.update(orders).set(patch).where(eq(orders.id, order.id)).returning();
  await tx.insert(orderEvents).values({
    tenantId: order.tenantId,
    orderId: order.id,
    action,
    fromState: result.from,
    toState: result.to,
    actor,
    actorId: opts.actorId ?? null,
    reason: opts.reason ?? null,
  });
  await tx.insert(outbox).values({ tenantId: order.tenantId, topic: "notify.customer", payload: { orderId: order.id, state: result.to } });
  announce(after, bus, updated!);
  return updated!;
}

/** PLACED: assigns the daily pickup code and takes the items out of stock. */
export async function placeOrder(tx: Tx, after: After, bus: EventBus, order: OrderRow, action: OrderAction, actor: Actor, actorId?: string | null) {
  const [outlet] = await tx.select().from(outlets).where(eq(outlets.id, order.outletId));
  const day = businessDate(new Date(), outlet!.timezone);
  const [counter] = await tx
    .insert(dailyCounters)
    .values({ outletId: order.outletId, businessDate: day, lastSeq: 1 })
    .onConflictDoUpdate({ target: [dailyCounters.outletId, dailyCounters.businessDate], set: { lastSeq: sql`${dailyCounters.lastSeq} + 1` } })
    .returning();
  const lines = await tx.select().from(orderLines).where(and(eq(orderLines.orderId, order.id), eq(orderLines.status, "ACTIVE")));
  for (const l of lines) await takeStock(tx, order.outletId, l.itemId, l.quantity);
  await tx
    .update(orders)
    .set({ pickupCode: formatPickupCode(outlet!.pickupPrefix, counter!.lastSeq), businessDate: day, placedAt: new Date() })
    .where(eq(orders.id, order.id));
  const fresh = await lockOrder(tx, { id: order.id });
  return applyTransition(tx, after, bus, fresh, action, actor, { actorId: actorId ?? null });
}

export async function takeStock(tx: Tx, outletId: string, itemId: string, qty: number) {
  await tx
    .update(outletItemStock)
    .set({
      stockCount: sql`GREATEST(${outletItemStock.stockCount} - ${qty}, 0)`,
      available: sql`CASE WHEN ${outletItemStock.stockCount} - ${qty} <= 0 THEN false ELSE ${outletItemStock.available} END`,
      updatedAt: new Date(),
    })
    .where(and(eq(outletItemStock.outletId, outletId), eq(outletItemStock.itemId, itemId), sql`${outletItemStock.stockCount} IS NOT NULL`));
}

/** Recomputes total and tax from the lines that are still being made. */
export async function recomputeTotals(tx: Tx, order: OrderRow) {
  const [row] = await tx
    .select({ total: sql<number>`COALESCE(SUM(${orderLines.lineTotalPaise}), 0)::int` })
    .from(orderLines)
    .where(and(eq(orderLines.orderId, order.id), inArray(orderLines.status, ["ACTIVE", "UNAVAILABLE"])));
  const total = row?.total ?? 0;
  await tx.update(orders).set({ totalPaise: total, taxPaise: inclusiveTax(total, order.taxRateBps), updatedAt: new Date() }).where(eq(orders.id, order.id));
}

// ---------- Money on an order ----------

export async function moneyOnOrder(tx: Tx, orderId: string) {
  const pays = await tx.select().from(payments).where(and(eq(payments.orderId, orderId), eq(payments.status, "CAPTURED"))).orderBy(asc(payments.capturedAt));
  const refs = await tx.select().from(refunds).where(and(eq(refunds.orderId, orderId), ne(refunds.status, "FAILED")));
  const refundedByPayment = new Map<string, number>();
  for (const r of refs) refundedByPayment.set(r.paymentId, (refundedByPayment.get(r.paymentId) ?? 0) + r.amountPaise);
  const captured = pays.reduce((s, p) => s + p.amountPaise, 0);
  const refunded = refs.reduce((s, r) => s + r.amountPaise, 0);
  return { pays, refundedByPayment, captured, refunded };
}

/**
 * Refunds `amountPaise` across the order's captured payments, newest first.
 * Online payments are queued for the gateway; counter payments are recorded as
 * manual refunds for the cashier to hand back. Idempotent per key.
 */
export async function issueRefund(tx: Tx, order: OrderRow, amountPaise: number, reason: string, key: string) {
  if (amountPaise <= 0) return [];
  const existing = await tx.select().from(refunds).where(sql`${refunds.idempotencyKey} LIKE ${key + "#%"}`);
  if (existing.length > 0) return existing;
  const { pays, refundedByPayment, captured, refunded } = await moneyOnOrder(tx, order.id);
  assertRefundAllowed(captured, refunded, amountPaise);
  let left = amountPaise;
  const created = [];
  for (const p of [...pays].reverse()) {
    if (left === 0) break;
    const available = p.amountPaise - (refundedByPayment.get(p.id) ?? 0);
    const take = Math.min(available, left);
    if (take <= 0) continue;
    left -= take;
    const manual = p.method !== "ONLINE";
    const [r] = await tx
      .insert(refunds)
      .values({
        tenantId: order.tenantId,
        orderId: order.id,
        paymentId: p.id,
        amountPaise: take,
        reason,
        idempotencyKey: `${key}#${p.id}`,
        manual,
        status: manual ? "PROCESSED" : "PENDING",
        processedAt: manual ? new Date() : null,
      })
      .returning();
    if (!manual) await tx.insert(outbox).values({ tenantId: order.tenantId, topic: "refund.process", payload: { refundId: r!.id } });
    created.push(r!);
  }
  return created;
}

export async function refundEverything(tx: Tx, order: OrderRow, reason: string, key: string) {
  const { captured, refunded } = await moneyOnOrder(tx, order.id);
  return issueRefund(tx, order, captured - refunded, reason, key);
}

// ---------- Item unavailable ----------

export async function openAdjustments(tx: Tx, order: OrderRow, lineIds: string[], note: string | null) {
  const lines = await tx.select().from(orderLines).where(and(eq(orderLines.orderId, order.id), inArray(orderLines.id, lineIds)));
  if (lines.length !== new Set(lineIds).size) throw new AppError("VALIDATION", "Some of those items are not on this order");
  for (const l of lines) if (l.status !== "ACTIVE") throw new AppError("CONFLICT", `${l.name} has already been changed`);
  await tx.update(orderLines).set({ status: "UNAVAILABLE" }).where(inArray(orderLines.id, lineIds));
  const expiresAt = new Date(Date.now() + ADJUSTMENT_TIMEOUT_MS);
  await tx.insert(adjustments).values(lines.map((l) => ({ tenantId: order.tenantId, orderId: order.id, lineId: l.id, note, expiresAt })));
  return lines;
}

/** After an adjustment closes: resume the order, or cancel it if nothing is left to make. */
export async function settleIfAllResolved(tx: Tx, after: After, bus: EventBus, orderId: string, actor: "CUSTOMER" | "SYSTEM") {
  const order = await lockOrder(tx, { id: orderId });
  if (order.state !== "ACTION_REQUIRED") return order;
  const pending = await tx.select({ id: adjustments.id }).from(adjustments).where(and(eq(adjustments.orderId, orderId), ne(adjustments.status, "RESOLVED")));
  if (pending.length > 0) return order;
  await recomputeTotals(tx, order);
  const fresh = await lockOrder(tx, { id: orderId });
  const active = await tx.select({ id: orderLines.id }).from(orderLines).where(and(eq(orderLines.orderId, orderId), eq(orderLines.status, "ACTIVE")));
  if (active.length === 0) {
    const reason = "All items on this order became unavailable";
    await refundEverything(tx, fresh, reason, `order:${orderId}:all-removed`);
    return applyTransition(tx, after, bus, fresh, "ALL_LINES_REMOVED", actor, { reason });
  }
  return applyTransition(tx, after, bus, fresh, "ADJUSTMENTS_RESOLVED", actor);
}

// ---------- Views ----------

export async function orderView(tx: Tx, orderId: string): Promise<OrderView> {
  const [o] = await tx.select().from(orders).where(eq(orders.id, orderId));
  if (!o) throw notFound("Order");
  const [outlet] = await tx.select().from(outlets).where(eq(outlets.id, o.outletId));
  const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, o.tenantId));
  const lines = await tx.select().from(orderLines).where(eq(orderLines.orderId, o.id)).orderBy(asc(orderLines.createdAt));
  const adjs = await tx.select().from(adjustments).where(eq(adjustments.orderId, o.id)).orderBy(asc(adjustments.createdAt));
  const pays = await tx.select().from(payments).where(eq(payments.orderId, o.id));
  const refs = await tx.select().from(refunds).where(eq(refunds.orderId, o.id)).orderBy(desc(refunds.createdAt));
  const paid = pays.filter((p) => p.status === "CAPTURED").reduce((s, p) => s + p.amountPaise, 0);
  const refunded = refs.filter((r) => r.status !== "FAILED").reduce((s, r) => s + r.amountPaise, 0);
  return {
    id: o.id,
    outlet: { slug: outlet!.slug, name: outlet!.name, tenantSlug: tenant!.slug, cafeName: String((tenant!.branding as { displayName?: string }).displayName ?? tenant!.name) },
    channel: o.channel,
    state: o.state as OrderView["state"],
    pickupCode: o.pickupCode,
    totalPaise: o.totalPaise,
    taxPaise: o.taxPaise,
    paidPaise: paid,
    refundedPaise: refunded,
    cancelReason: o.cancelReason,
    customerName: o.customerName,
    lines: lines.map((l) => ({
      id: l.id,
      itemId: l.itemId,
      name: l.name,
      quantity: l.quantity,
      modifiers: l.modifiers,
      lineTotalPaise: l.lineTotalPaise,
      status: l.status,
      note: l.note,
      replacesLineId: l.replacesLineId,
    })),
    adjustments: adjs.map((a) => {
      const topUp = pays.find((p) => p.adjustmentId === a.id && p.status === "CREATED");
      return {
        id: a.id,
        lineId: a.lineId,
        status: a.status,
        choice: a.choice,
        refundPaise: a.refundPaise,
        topUpPaise: a.topUpPaise,
        expiresAt: a.expiresAt.toISOString(),
        note: a.note,
        topUpCheckout:
          a.status === "AWAITING_TOPUP" && topUp
            ? { paymentId: topUp.id, provider: topUp.provider as "simulated" | "razorpay", providerOrderId: topUp.providerOrderId!, amountPaise: topUp.amountPaise, currency: "INR" as const }
            : null,
      };
    }),
    refunds: refs.map((r) => ({ id: r.id, amountPaise: r.amountPaise, reason: r.reason, status: r.status })),
    createdAt: o.createdAt.toISOString(),
    placedAt: o.placedAt?.toISOString() ?? null,
    updatedAt: o.updatedAt.toISOString(),
  };
}

export type { LineRequest };
