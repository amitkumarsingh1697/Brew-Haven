import { and, desc, eq, inArray, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import {
  CreateOrderRequest,
  type CounterOrderRequest,
  type FlagUnavailableRequest,
  type MarkPaidRequest,
  type ResolveAdjustmentRequest,
  type WalkInOrderRequest,
} from "@brew-haven/contracts";
import { NOT_COLLECTED_HOLD_MINUTES, cashChange, formatInr, quote, resolveAdjustment, type OrderAction } from "@brew-haven/domain";
import type { z } from "zod";
import type { StaffClaims } from "../auth.js";
import type { Alerter } from "../alerts.js";
import { withTx, type After, type Db, type Tx } from "../db/client.js";
import { adjustments, customers, orderEvents, orderLines, orders, outbox, outletItemStock, outlets, payments, refunds, tenants, webhookEvents } from "../db/schema.js";
import { AppError, notFound } from "../errors.js";
import type { EventBus } from "../events.js";
import type { Notifier } from "../notify/provider.js";
import { recordAudit } from "./audit.js";
import { consumeIngredients } from "./inventory.js";
import { notifyCustomer } from "./notifications.js";
import type { PaymentProvider, WebhookEvent } from "../payments/provider.js";
import { loadTenantOutlet, resolveLines } from "./catalog.js";
import {
  UNPAID_ORDER_TTL_MS,
  announce,
  applyTransition,
  customerCancelOption,
  billDelta,
  businessDate,
  insertLines,
  issueRefund,
  lockOrder,
  newTrackingToken,
  openAdjustments,
  orderView,
  placeOrder,
  refundEverything,
  settleIfAllResolved,
  takeStock,
  type OrderRow,
} from "./orders.js";

export interface Ctx {
  db: Db;
  bus: EventBus;
  provider: PaymentProvider;
  notifier: Notifier;
  customerAppUrl: string;
  /** Operational alerts (see alerts.ts). Optional so tests and scripts can leave it out. */
  alerter?: Alerter;
  /** Set by the background worker on each pass; the readiness check reads it. */
  worker?: { lastTickAt: number | null };
  log: { info: (o: object, msg?: string) => void; warn: (o: object, msg?: string) => void; error: (o: object, msg?: string) => void };
}

function checkout(ctx: Ctx, p: typeof payments.$inferSelect, keyId?: string) {
  return {
    paymentId: p.id,
    provider: ctx.provider.name,
    providerOrderId: p.providerOrderId!,
    amountPaise: p.amountPaise,
    currency: "INR" as const,
    ...(keyId ? { keyId } : {}),
  };
}

// ---------- Customer: place an online order (pay-now, D-02) ----------

export async function createOnlineOrder(ctx: Ctx, tenantSlug: string, outletSlug: string, body: z.output<typeof CreateOrderRequest>, idempotencyKey: string) {
  if (!/^[A-Za-z0-9-]{8,64}$/.test(idempotencyKey)) throw new AppError("VALIDATION", "Idempotency-Key header must be 8-64 letters, digits or dashes");
  const { tenant, outlet } = await loadTenantOutlet(ctx.db, tenantSlug, outletSlug);

  const replay = async () => {
    const [existing] = await ctx.db.select().from(orders).where(and(eq(orders.tenantId, tenant.id), eq(orders.idempotencyKey, idempotencyKey)));
    if (!existing) return null;
    const [pay] = await ctx.db.select().from(payments).where(and(eq(payments.orderId, existing.id), eq(payments.kind, "ORDER"))).orderBy(sql`${payments.createdAt} desc`).limit(1);
    return { orderId: existing.id, trackingToken: existing.trackingToken, totalPaise: existing.totalPaise, checkout: checkout(ctx, pay!) };
  };
  const prior = await replay();
  if (prior) return prior;

  if (!outlet.isOpen || tenant.suspendedAt) throw new AppError("UNAVAILABLE", `${outlet.name} is not taking orders right now`);
  const lines = await resolveLines(ctx.db, tenant.id, outlet.id, body.lines, { requireAvailable: true });
  const q = quote(lines, tenant.taxRateBps, tenant.pricesIncludeTax);
  const trackingToken = newTrackingToken();
  const providerOrder = await ctx.provider.createOrder({ amountPaise: q.totalPaise, receipt: trackingToken, notes: { outlet: outlet.slug } });

  try {
    return await withTx(ctx.db, async (tx) => {
      const now = new Date();
      const [customer] = await tx
        .insert(customers)
        .values({
          tenantId: tenant.id,
          phone: body.customer.phone,
          name: body.customer.name,
          consentUpdatesAt: now,
          consentOffers: body.consent.offers,
          consentOffersAt: body.consent.offers ? now : null,
        })
        .onConflictDoUpdate({
          target: [customers.tenantId, customers.phone],
          set: {
            name: body.customer.name,
            consentUpdatesAt: now,
            // An explicit opt-in is recorded; leaving the box unticked never withdraws an earlier opt-in silently.
            ...(body.consent.offers ? { consentOffers: true, consentOffersAt: now } : {}),
          },
        })
        .returning();
      const [order] = await tx
        .insert(orders)
        .values({
          tenantId: tenant.id,
          outletId: outlet.id,
          customerId: customer!.id,
          customerName: body.customer.name,
          channel: "ONLINE",
          state: "AWAITING_PAYMENT",
          totalPaise: q.totalPaise,
          taxPaise: q.taxPaise,
          taxRateBps: q.taxRateBps,
          pricesIncludeTax: q.pricesIncludeTax,
          roundOffPaise: q.roundOffPaise,
          trackingToken,
          idempotencyKey,
          expiresAt: new Date(now.getTime() + UNPAID_ORDER_TTL_MS),
        })
        .returning();
      await insertLines(tx, order!, lines);
      const [pay] = await tx
        .insert(payments)
        .values({ tenantId: tenant.id, orderId: order!.id, kind: "ORDER", method: "ONLINE", provider: ctx.provider.name, providerOrderId: providerOrder.providerOrderId, amountPaise: q.totalPaise, status: "CREATED" })
        .returning();
      await tx.insert(orderEvents).values({ tenantId: tenant.id, orderId: order!.id, action: "CREATE", fromState: null, toState: "AWAITING_PAYMENT", actor: "CUSTOMER" });
      return { orderId: order!.id, trackingToken, totalPaise: q.totalPaise, checkout: checkout(ctx, pay!, providerOrder.keyId) };
    });
  } catch (e) {
    // Two requests with the same key raced: return the one that won.
    if ((e as { code?: string }).code === "23505") {
      const again = await replay();
      if (again) return again;
    }
    throw e;
  }
}

/** A new payment attempt for an unpaid order (after a failed or abandoned checkout). */
export async function retryPayment(ctx: Ctx, trackingToken: string) {
  const [o] = await ctx.db.select().from(orders).where(eq(orders.trackingToken, trackingToken));
  if (!o) throw notFound("Order");
  if (o.state !== "AWAITING_PAYMENT") throw new AppError("CONFLICT", "This order no longer needs payment");
  const providerOrder = await ctx.provider.createOrder({ amountPaise: o.totalPaise, receipt: `${trackingToken}-r` });
  const [pay] = await ctx.db
    .insert(payments)
    .values({ tenantId: o.tenantId, orderId: o.id, kind: "ORDER", method: "ONLINE", provider: ctx.provider.name, providerOrderId: providerOrder.providerOrderId, amountPaise: o.totalPaise, status: "CREATED" })
    .returning();
  return checkout(ctx, pay!, providerOrder.keyId);
}

// ---------- Payment webhooks (the only way an online order becomes PLACED) ----------

export async function handleWebhook(ctx: Ctx, event: WebhookEvent): Promise<"processed" | "duplicate" | "ignored"> {
  if (event.type === "ignored") return "ignored";
  return withTx(ctx.db, async (tx, after) => {
    const inserted = await tx
      .insert(webhookEvents)
      .values({ provider: ctx.provider.name, eventId: event.eventId, payload: event })
      .onConflictDoNothing()
      .returning({ id: webhookEvents.id });
    if (inserted.length === 0) return "duplicate";

    if (event.type === "refund.processed" || event.type === "refund.failed") {
      await tx
        .update(refunds)
        .set({ status: event.type === "refund.processed" ? "PROCESSED" : "FAILED", processedAt: new Date() })
        .where(eq(refunds.providerRefundId, event.providerRefundId));
      return "processed";
    }
    if (!("providerOrderId" in event)) return "ignored";

    const [pay] = await tx
      .select()
      .from(payments)
      .where(and(eq(payments.provider, ctx.provider.name), eq(payments.providerOrderId, event.providerOrderId)))
      .for("update");
    if (!pay) {
      ctx.log.warn({ event }, "webhook for an unknown payment");
      return "ignored";
    }
    // A payment we closed locally (order expired, or another attempt won) can still be
    // captured at the gateway. That money is recorded and refunded below, never dropped.
    if (pay.status === "CAPTURED") return "duplicate";
    if (event.type === "payment.failed" && pay.status !== "CREATED") return "duplicate";

    if (event.type === "payment.failed") {
      await tx.update(payments).set({ status: "FAILED", providerPaymentId: event.providerPaymentId }).where(eq(payments.id, pay.id));
      const o = await lockOrder(tx, { id: pay.orderId });
      announce(after, ctx.bus, o);
      return "processed";
    }

    // payment.captured
    if (event.amountPaise !== pay.amountPaise) {
      // Refund policy P4: never place the order. Record what was actually taken and give all of it back.
      ctx.log.error({ event, expected: pay.amountPaise }, "captured amount does not match; order NOT placed, refunding");
      await tx.insert(outbox).values({ tenantId: pay.tenantId, topic: "alert.amount_mismatch", payload: { paymentId: pay.id, got: event.amountPaise, expected: pay.amountPaise } });
      await tx
        .update(payments)
        .set({ status: "CAPTURED", amountPaise: event.amountPaise, providerPaymentId: event.providerPaymentId, instrument: event.instrument ?? null, capturedAt: new Date() })
        .where(eq(payments.id, pay.id));
      const order = await lockOrder(tx, { id: pay.orderId });
      await issueRefund(tx, order, event.amountPaise, "The amount paid did not match the order, so it was given back", `mismatch:${pay.id}`);
      announce(after, ctx.bus, order);
      return "processed";
    }
    await tx
      .update(payments)
      .set({ status: "CAPTURED", providerPaymentId: event.providerPaymentId, instrument: event.instrument ?? null, capturedAt: new Date() })
      .where(eq(payments.id, pay.id));
    const order = await lockOrder(tx, { id: pay.orderId });

    if (pay.kind === "ORDER") {
      if (order.state === "AWAITING_PAYMENT" && order.totalPaise === pay.amountPaise) {
        await placeOrder(tx, after, ctx.bus, order, "PAYMENT_VERIFIED", "SYSTEM");
        // Any other open attempts for this order can no longer be used.
        await tx.update(payments).set({ status: "FAILED" }).where(and(eq(payments.orderId, order.id), eq(payments.status, "CREATED"), eq(payments.kind, "ORDER")));
      } else {
        // Paid after it expired, or a second attempt also succeeded: give the money back.
        await issueRefund(tx, order, pay.amountPaise, "Payment received after the order had closed", `late:${pay.id}`);
        announce(after, ctx.bus, order);
      }
      return "processed";
    }

    // TOPUP for a replacement item
    const [adj] = await tx.select().from(adjustments).where(eq(adjustments.id, pay.adjustmentId!)).for("update");
    if (!adj || adj.status !== "AWAITING_TOPUP" || order.state !== "ACTION_REQUIRED") {
      await issueRefund(tx, order, pay.amountPaise, "Top-up received after the change had closed", `late:${pay.id}`);
      announce(after, ctx.bus, order);
      return "processed";
    }
    await tx.update(orderLines).set({ status: "REPLACED" }).where(eq(orderLines.id, adj.lineId));
    await tx.update(orderLines).set({ status: "ACTIVE" }).where(eq(orderLines.id, adj.replacementLineId!));
    await tx.update(adjustments).set({ status: "RESOLVED", resolvedAt: new Date() }).where(eq(adjustments.id, adj.id));
    const [line] = await tx.select().from(orderLines).where(eq(orderLines.id, adj.replacementLineId!));
    await takeStock(tx, order.outletId, line!.itemId, line!.quantity);
    await consumeIngredients(tx, order, [line!]);
    await settleIfAllResolved(tx, after, ctx.bus, order.id, "SYSTEM");
    return "processed";
  });
}


// ---------- Staff ----------

export function assertOutlet(staff: StaffClaims, outletId: string) {
  if (staff.role !== "ADMIN" && !staff.outletIds.includes(outletId)) throw new AppError("FORBIDDEN", "You are not assigned to this café");
}

export async function lockStaffOrder(tx: Tx, staff: StaffClaims, orderId: string) {
  const o = await lockOrder(tx, { id: orderId });
  if (o.tenantId !== staff.tenantId) throw notFound("Order");
  assertOutlet(staff, o.outletId);
  return o;
}

export async function staffAction(ctx: Ctx, staff: StaffClaims, orderId: string, action: Extract<OrderAction, "START" | "MARK_READY" | "HAND_OVER" | "MARK_NOT_COLLECTED">) {
  return withTx(ctx.db, async (tx, after) => {
    const o = await lockStaffOrder(tx, staff, orderId);
    if (action === "MARK_NOT_COLLECTED" && o.state === "READY" && staff.role !== "KITCHEN") {
      // Refund policy K10: hold a ready order before giving up on it.
      const [ready] = await tx.select({ at: orderEvents.at }).from(orderEvents).where(and(eq(orderEvents.orderId, o.id), eq(orderEvents.toState, "READY"))).orderBy(desc(orderEvents.at)).limit(1);
      const waitMs = (ready?.at.getTime() ?? 0) + NOT_COLLECTED_HOLD_MINUTES * 60_000 - Date.now();
      if (waitMs > 0) throw new AppError("CONFLICT", `Keep the order for ${NOT_COLLECTED_HOLD_MINUTES} minutes after it's ready. ${Math.ceil(waitMs / 60_000)} min to go.`);
    }
    await applyTransition(tx, after, ctx.bus, o, action, staff.role, { actorId: staff.sub });
    return orderView(tx, o.id);
  });
}

/** D-09: reject a whole order with a reason; everything paid is refunded. */
export async function rejectOrder(ctx: Ctx, staff: StaffClaims, orderId: string, reason: string) {
  return withTx(ctx.db, async (tx, after) => {
    const o = await lockStaffOrder(tx, staff, orderId);
    const updated = await applyTransition(tx, after, ctx.bus, o, "REJECT", staff.role, { actorId: staff.sub, reason });
    await tx.update(adjustments).set({ status: "RESOLVED", resolvedAt: new Date() }).where(and(eq(adjustments.orderId, o.id), ne(adjustments.status, "RESOLVED")));
    await tx.update(payments).set({ status: "FAILED" }).where(and(eq(payments.orderId, o.id), eq(payments.status, "CREATED")));
    await refundEverything(tx, updated, `Rejected by café: ${reason}`, `order:${o.id}:reject`);
    return orderView(tx, o.id);
  });
}

/**
 * Refund policy K8: the café can't make anything (power cut, machine broken, has to close). The owner cancels every
 * open order at that café in one go: paid ones are rejected and refunded in full, unpaid counter orders are voided.
 * Ready orders are left alone, since they are already made. Optionally the café stops taking new orders too.
 */
export async function cancelOpenOrders(ctx: Ctx, staff: StaffClaims, outletId: string, body: { reason: string; closeCafe?: boolean | undefined }) {
  if (staff.role !== "ADMIN") throw new AppError("FORBIDDEN", "Only the owner can cancel all open orders");
  const [outlet] = await ctx.db.select().from(outlets).where(and(eq(outlets.id, outletId), eq(outlets.tenantId, staff.tenantId)));
  if (!outlet) throw notFound("Café outlet");
  if (body.closeCafe) await ctx.db.update(outlets).set({ isOpen: false }).where(eq(outlets.id, outlet.id));
  const open = await ctx.db
    .select({ id: orders.id, state: orders.state, channel: orders.channel })
    .from(orders)
    .where(and(eq(orders.outletId, outlet.id), or(inArray(orders.state, ["PLACED", "PREPARING", "ACTION_REQUIRED"]), and(eq(orders.state, "AWAITING_PAYMENT"), eq(orders.channel, "COUNTER")))));
  let cancelled = 0;
  let refundedPaise = 0;
  const skipped: string[] = [];
  for (const o of open) {
    try {
      const v = o.state === "AWAITING_PAYMENT" ? await voidCounterOrder(ctx, staff, o.id, body.reason) : await rejectOrder(ctx, staff, o.id, body.reason);
      cancelled++;
      refundedPaise += v.refundedPaise;
    } catch {
      // Its state changed in the meantime (for example the kitchen just marked it ready): leave it for staff to handle.
      skipped.push(o.id);
    }
  }
  await recordAudit(ctx.db, {
    tenantId: staff.tenantId,
    actorId: staff.sub,
    actorName: staff.name,
    action: "orders.cancel_all",
    summary: `Cancelled ${cancelled} open order${cancelled === 1 ? "" : "s"} at ${outlet.name}${body.closeCafe ? " and stopped new orders" : ""}: ${body.reason}`,
    outletId: outlet.id,
    ip: null,
  });
  return { cancelled, refundedPaise, skipped: skipped.length, cafeClosed: !!body.closeCafe };
}

/** D-10: staff flag items as unavailable; the customer then chooses replace, remove or cancel. */
export async function flagUnavailable(ctx: Ctx, staff: StaffClaims, orderId: string, body: z.output<typeof FlagUnavailableRequest>) {
  return withTx(ctx.db, async (tx, after) => {
    const o = await lockStaffOrder(tx, staff, orderId);
    if (o.channel === "COUNTER") throw new AppError("CONFLICT", "For counter orders, edit the order with the customer at the counter instead");
    const lines = await openAdjustments(tx, o, body.lineIds, body.note ?? null);
    if (body.markSoldOut) {
      for (const l of lines) {
        await tx
          .insert(outletItemStock)
          .values({ tenantId: o.tenantId, outletId: o.outletId, itemId: l.itemId, available: false })
          .onConflictDoUpdate({ target: [outletItemStock.outletId, outletItemStock.itemId], set: { available: false, updatedAt: new Date() } });
      }
    }
    if (o.state !== "ACTION_REQUIRED") await applyTransition(tx, after, ctx.bus, o, "FLAG_UNAVAILABLE", staff.role, { actorId: staff.sub, reason: body.note ?? null });
    else announce(after, ctx.bus, o);
    return orderView(tx, o.id);
  });
}

/** D-11: walk-in orders are rung up in Brew Haven and paid at the counter. */
export async function createWalkInOrder(ctx: Ctx, staff: StaffClaims, body: z.output<typeof WalkInOrderRequest>) {
  if (staff.role === "KITCHEN") throw new AppError("FORBIDDEN", "Only the cashier or admin can take counter orders");
  assertOutlet(staff, body.outletId);
  const [outlet] = await ctx.db.select().from(outlets).where(and(eq(outlets.id, body.outletId), eq(outlets.tenantId, staff.tenantId)));
  if (!outlet) throw notFound("Café outlet");
  const [tenant] = await ctx.db.select().from(tenants).where(eq(tenants.id, staff.tenantId));
  if (tenant!.suspendedAt) throw new AppError("FORBIDDEN", "This account is paused, so new orders can't be taken. Contact Brew Haven support.");
  const idempotencyKey = body.clientRef ? `counter:${body.clientRef}` : null;
  const already = async () => {
    if (!idempotencyKey) return null;
    const [o] = await ctx.db.select({ id: orders.id }).from(orders).where(and(eq(orders.tenantId, tenant!.id), eq(orders.idempotencyKey, idempotencyKey)));
    return o ? ctx.db.transaction((tx) => orderView(tx, o.id)) : null;
  };
  const prior = await already();
  if (prior) return prior;
  // An order taken while offline was already paid for, so an item that sold out since still goes through.
  let takenAt = new Date();
  if (body.takenOfflineAt) {
    const t = new Date(body.takenOfflineAt);
    if (t.getTime() > Date.now() + 5 * 60_000 || t.getTime() < Date.now() - 24 * 3_600_000) throw new AppError("VALIDATION", "This offline order is more than a day old. Enter it again as a new order if it was really sold.");
    takenAt = t;
  }
  const lines = await resolveLines(ctx.db, tenant!.id, outlet.id, body.lines, { requireAvailable: !body.takenOfflineAt });
  const q = quote(lines, tenant!.taxRateBps, tenant!.pricesIncludeTax);
  // Offline orders were paid at the old till price; anything else must be covered by the cash given.
  if (body.tenderedPaise !== undefined && !body.takenOfflineAt) assertCashCovers(q.totalPaise, body.tenderedPaise);
  return withTx(ctx.db, async (tx, after) => {
    if (body.upiReference) await assertNewUpiReference(tx, tenant!.id, body.upiReference);
    let customerId: string | null = null;
    if (body.customer?.phone) {
      const now = new Date();
      const [c] = await tx
        .insert(customers)
        .values({ tenantId: tenant!.id, phone: body.customer.phone, name: body.customer.name ?? "Guest", consentUpdatesAt: now })
        .onConflictDoUpdate({ target: [customers.tenantId, customers.phone], set: { consentUpdatesAt: now } })
        .returning();
      customerId = c!.id;
    }
    const [order] = await tx
      .insert(orders)
      .values({
        tenantId: tenant!.id,
        outletId: outlet.id,
        customerId,
        customerName: body.customer?.name ?? null,
        channel: "COUNTER",
        state: "AWAITING_PAYMENT",
        totalPaise: q.totalPaise,
        taxPaise: q.taxPaise,
        taxRateBps: q.taxRateBps,
        pricesIncludeTax: q.pricesIncludeTax,
        roundOffPaise: q.roundOffPaise,
        trackingToken: newTrackingToken(),
        createdByStaffId: staff.sub,
        idempotencyKey,
      })
      .returning();
    await insertLines(tx, order!, lines);
    await tx
      .insert(payments)
      .values({
        tenantId: tenant!.id,
        orderId: order!.id,
        kind: "ORDER",
        method: body.method,
        ...(body.upiReference ? { provider: "upi_counter", providerPaymentId: body.upiReference } : {}),
        tenderedPaise: body.tenderedPaise ?? null,
        reference: body.cardReference ?? null,
        amountPaise: q.totalPaise,
        status: "CAPTURED",
        capturedAt: takenAt,
        recordedByStaffId: staff.sub,
      })
      .catch((e: unknown) => {
        // Two tills entering the same reference at the same moment: the unique index catches the second.
        const err = e as { code?: string; cause?: { code?: string } };
        if ((err.code ?? err.cause?.code) === "23505") throw new AppError("CONFLICT", "This UPI reference was just used for another order. Check the customer's payment screen.");
        throw e;
      });
    await tx.insert(orderEvents).values({
      tenantId: tenant!.id,
      orderId: order!.id,
      action: "CREATE",
      fromState: null,
      toState: "AWAITING_PAYMENT",
      actor: staff.role,
      actorId: staff.sub,
      reason: body.takenOfflineAt ? `Taken while the till was offline, at ${takenAt.toISOString()}` : null,
    });
    // The cashier has taken the money, so the system records the payment as verified.
    await placeOrder(tx, after, ctx.bus, order!, "PAYMENT_VERIFIED", "SYSTEM", staff.sub);
    return orderView(tx, order!.id);
  }).catch(async (e: unknown) => {
    // The same queued order sent twice at once: the second finds the first.
    const again = await already();
    if (again) return again;
    throw e;
  });
}

/**
 * One UPI payment can't pay for two orders. The unique index is the backstop; this check gives
 * the cashier a useful message (which order already used it, and when).
 */
async function assertNewUpiReference(tx: Tx, tenantId: string, ref: string) {
  const [used] = await tx
    .select({ code: orders.pickupCode, at: payments.createdAt, outlet: outlets.name })
    .from(payments)
    .innerJoin(orders, eq(orders.id, payments.orderId))
    .innerJoin(outlets, eq(outlets.id, orders.outletId))
    .where(and(eq(payments.tenantId, tenantId), eq(payments.method, "UPI_COUNTER"), eq(payments.providerPaymentId, ref)));
  if (!used) return;
  const when = used.at.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  throw new AppError("CONFLICT", `This UPI reference was already used for order ${used.code ?? ""} at ${used.outlet} on ${when}. Check the customer's payment screen.`);
}

function assertCashCovers(totalPaise: number, tenderedPaise: number) {
  try {
    cashChange(totalPaise, tenderedPaise);
  } catch {
    throw new AppError("VALIDATION", `Cash received (${formatInr(tenderedPaise)}) is less than the bill (${formatInr(totalPaise)})`);
  }
}

/** How long a counter order waits for the customer to pay on their phone before it lapses. */
export const COUNTER_PAY_TTL_MS = 20 * 60 * 1000;

const payUrlFor = (ctx: Ctx, trackingToken: string) => `${ctx.customerAppUrl.replace(/\/$/, "")}/order/${trackingToken}`;

/**
 * The cashier places an order on behalf of a customer (Point 5). It waits for payment: the till
 * shows a QR code that opens this order's payment page on the customer's phone (UPI or card through
 * the gateway, confirmed by the gateway's webhook), or the cashier marks it paid in cash, on the
 * card machine or to the café's own UPI QR. Nothing reaches the kitchen until it is paid.
 */
export async function createCounterOrder(ctx: Ctx, staff: StaffClaims, body: z.output<typeof CounterOrderRequest>) {
  if (staff.role === "KITCHEN") throw new AppError("FORBIDDEN", "Only the cashier or admin can take counter orders");
  assertOutlet(staff, body.outletId);
  const [outlet] = await ctx.db.select().from(outlets).where(and(eq(outlets.id, body.outletId), eq(outlets.tenantId, staff.tenantId)));
  if (!outlet) throw notFound("Café outlet");
  const [tenant] = await ctx.db.select().from(tenants).where(eq(tenants.id, staff.tenantId));
  if (tenant!.suspendedAt) throw new AppError("FORBIDDEN", "This account is paused, so new orders can't be taken. Contact Brew Haven support.");
  const idempotencyKey = body.clientRef ? `counter:${body.clientRef}` : null;
  const already = async () => {
    if (!idempotencyKey) return null;
    const [o] = await ctx.db.select().from(orders).where(and(eq(orders.tenantId, tenant!.id), eq(orders.idempotencyKey, idempotencyKey)));
    return o ? { order: await ctx.db.transaction((tx) => orderView(tx, o.id)), payUrl: payUrlFor(ctx, o.trackingToken), expiresAt: (o.expiresAt ?? new Date()).toISOString() } : null;
  };
  const prior = await already();
  if (prior) return prior;

  const lines = await resolveLines(ctx.db, tenant!.id, outlet.id, body.lines, { requireAvailable: true });
  const q = quote(lines, tenant!.taxRateBps, tenant!.pricesIncludeTax);
  const trackingToken = newTrackingToken();
  const providerOrder = await ctx.provider.createOrder({ amountPaise: q.totalPaise, receipt: trackingToken, notes: { outlet: outlet.slug, channel: "counter" } });
  const expiresAt = new Date(Date.now() + COUNTER_PAY_TTL_MS);
  return withTx(ctx.db, async (tx, after) => {
    let customerId: string | null = null;
    if (body.customer?.phone) {
      const now = new Date();
      const [c] = await tx
        .insert(customers)
        .values({ tenantId: tenant!.id, phone: body.customer.phone, name: body.customer.name ?? "Guest", consentUpdatesAt: now })
        .onConflictDoUpdate({ target: [customers.tenantId, customers.phone], set: { consentUpdatesAt: now } })
        .returning();
      customerId = c!.id;
    }
    const [order] = await tx
      .insert(orders)
      .values({
        tenantId: tenant!.id,
        outletId: outlet.id,
        customerId,
        customerName: body.customer?.name ?? null,
        channel: "COUNTER",
        state: "AWAITING_PAYMENT",
        totalPaise: q.totalPaise,
        taxPaise: q.taxPaise,
        taxRateBps: q.taxRateBps,
        pricesIncludeTax: q.pricesIncludeTax,
        roundOffPaise: q.roundOffPaise,
        trackingToken,
        createdByStaffId: staff.sub,
        idempotencyKey,
        expiresAt,
      })
      .returning();
    await insertLines(tx, order!, lines);
    await tx.insert(payments).values({
      tenantId: tenant!.id,
      orderId: order!.id,
      kind: "ORDER",
      method: "ONLINE",
      provider: ctx.provider.name,
      providerOrderId: providerOrder.providerOrderId,
      amountPaise: q.totalPaise,
      status: "CREATED",
    });
    await tx.insert(orderEvents).values({ tenantId: tenant!.id, orderId: order!.id, action: "CREATE", fromState: null, toState: "AWAITING_PAYMENT", actor: staff.role, actorId: staff.sub, reason: "Placed at the counter for the customer" });
    announce(after, ctx.bus, order!);
    return { order: await orderView(tx, order!.id), payUrl: payUrlFor(ctx, trackingToken), expiresAt: expiresAt.toISOString() };
  }).catch(async (e: unknown) => {
    const again = await already();
    if (again) return again;
    throw e;
  });
}

/** The QR link for a counter order that is still waiting to be paid (to show it again). */
export async function counterPayLink(ctx: Ctx, staff: StaffClaims, orderId: string) {
  const [o] = await ctx.db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.tenantId, staff.tenantId)));
  if (!o) throw notFound("Order");
  assertOutlet(staff, o.outletId);
  if (o.channel !== "COUNTER" || o.state !== "AWAITING_PAYMENT") throw new AppError("CONFLICT", "This order is not waiting for payment");
  return { payUrl: payUrlFor(ctx, o.trackingToken), expiresAt: (o.expiresAt ?? new Date()).toISOString() };
}

/**
 * The cashier confirms a counter order is paid (Point 5): cash in hand, the card machine, or the
 * café's own UPI QR. This places the order (receipt number, pickup code, kitchen) and records who
 * took the money. Online orders can never be marked paid by hand: only the gateway confirms them.
 */
export async function markCounterPaid(ctx: Ctx, staff: StaffClaims, orderId: string, body: z.output<typeof MarkPaidRequest>) {
  if (staff.role === "KITCHEN") throw new AppError("FORBIDDEN", "Only the cashier or admin can take payments");
  return withTx(ctx.db, async (tx, after) => {
    const o = await lockStaffOrder(tx, staff, orderId);
    if (o.channel !== "COUNTER") throw new AppError("CONFLICT", "Online orders are confirmed by the payment gateway, not by hand");
    if (o.state === "EXPIRED") throw new AppError("CONFLICT", "This order lapsed before it was paid. Ring it up again.");
    if (o.state !== "AWAITING_PAYMENT") throw new AppError("CONFLICT", o.state === "CANCELLED" ? "This order was cancelled" : "This order is already paid");
    if (body.tenderedPaise !== undefined) assertCashCovers(o.totalPaise, body.tenderedPaise);
    if (body.upiReference) await assertNewUpiReference(tx, o.tenantId, body.upiReference);
    // The QR payment page can't be used any more. If the customer pays there anyway, the
    // gateway's confirmation finds the order already paid and the money is refunded.
    await tx.update(payments).set({ status: "FAILED" }).where(and(eq(payments.orderId, o.id), eq(payments.status, "CREATED"), eq(payments.kind, "ORDER")));
    await tx
      .insert(payments)
      .values({
        tenantId: o.tenantId,
        orderId: o.id,
        kind: "ORDER",
        method: body.method,
        ...(body.upiReference ? { provider: "upi_counter", providerPaymentId: body.upiReference } : {}),
        tenderedPaise: body.tenderedPaise ?? null,
        reference: body.cardReference ?? null,
        amountPaise: o.totalPaise,
        status: "CAPTURED",
        capturedAt: new Date(),
        recordedByStaffId: staff.sub,
      })
      .catch((e: unknown) => {
        const err = e as { code?: string; cause?: { code?: string } };
        if ((err.code ?? err.cause?.code) === "23505") throw new AppError("CONFLICT", "This UPI reference was just used for another order. Check the customer's payment screen.");
        throw e;
      });
    await placeOrder(tx, after, ctx.bus, o, "MARK_PAID", staff.role, staff.sub);
    return orderView(tx, o.id);
  });
}

/** The customer left without paying: cancel the unpaid counter order. Nothing was taken, so nothing is refunded. */
export async function voidCounterOrder(ctx: Ctx, staff: StaffClaims, orderId: string, reason: string) {
  if (staff.role === "KITCHEN") throw new AppError("FORBIDDEN", "Only the cashier or admin can cancel unpaid orders");
  return withTx(ctx.db, async (tx, after) => {
    const o = await lockStaffOrder(tx, staff, orderId);
    if (o.channel !== "COUNTER") throw new AppError("CONFLICT", "Only unpaid counter orders can be cancelled this way");
    await tx.update(payments).set({ status: "FAILED" }).where(and(eq(payments.orderId, o.id), eq(payments.status, "CREATED")));
    await applyTransition(tx, after, ctx.bus, o, "VOID_UNPAID", staff.role, { actorId: staff.sub, reason });
    return orderView(tx, o.id);
  });
}

/**
 * Refund policy C2: a counter order was marked paid by mistake, or the customer walked off without paying.
 * The owner voids the hand-recorded payment and cancels the order: no refund is made (no money was taken),
 * the takings and the expected cash in the drawer drop by that amount, the invoice counts as cancelled,
 * and Activity records who did it and why.
 */
export async function voidMistakenPayment(ctx: Ctx, staff: StaffClaims, orderId: string, reason: string) {
  if (staff.role !== "ADMIN") throw new AppError("FORBIDDEN", "Only the owner can undo a payment marked by hand");
  return withTx(ctx.db, async (tx, after) => {
    const o = await lockStaffOrder(tx, staff, orderId);
    if (o.channel !== "COUNTER") throw new AppError("CONFLICT", "Online payments come from the payment gateway. Refund the order instead.");
    const pays = await tx.select().from(payments).where(and(eq(payments.orderId, o.id), eq(payments.status, "CAPTURED")));
    if (pays.length === 0) throw new AppError("CONFLICT", "This order has no payment to undo");
    if (pays.some((p) => p.method === "ONLINE")) throw new AppError("CONFLICT", "This order was paid through the payment gateway. Refund it instead.");
    const [refunded] = await tx.select({ id: refunds.id }).from(refunds).where(and(eq(refunds.orderId, o.id), ne(refunds.status, "FAILED"))).limit(1);
    if (refunded) throw new AppError("CONFLICT", "Part of this order was already refunded. Refund the rest instead.");
    const updated = await applyTransition(tx, after, ctx.bus, o, "VOID_MISTAKEN_PAYMENT", staff.role, { actorId: staff.sub, reason });
    await tx.update(payments).set({ status: "FAILED" }).where(inArray(payments.id, pays.map((p) => p.id)));
    await tx.update(adjustments).set({ status: "RESOLVED", resolvedAt: new Date() }).where(and(eq(adjustments.orderId, o.id), ne(adjustments.status, "RESOLVED")));
    const amount = pays.reduce((s, p) => s + p.amountPaise, 0);
    await recordAudit(tx as unknown as Db, {
      tenantId: o.tenantId,
      actorId: staff.sub,
      actorName: staff.name,
      action: "order.void_payment",
      summary: `Undid the ${formatInr(amount)} payment marked by hand on order ${o.pickupCode ?? ""} and cancelled it: ${reason}`,
      outletId: o.outletId,
      targetId: o.id,
      ip: null,
    });
    return orderView(tx, updated.id);
  });
}

// ---------- Customer cancels (refund policy K1, K2, K4) ----------

/**
 * The customer cancels from their order link: free before the kitchen starts, or once the order is late.
 * The order row is locked, so if the kitchen starts it at the same moment, whichever reaches the server
 * first wins and the other gets a clear message (K2). Everything paid is refunded to the source.
 */
export async function customerCancel(ctx: Ctx, trackingToken: string) {
  return withTx(ctx.db, async (tx, after) => {
    const order = await lockOrder(tx, { trackingToken });
    if (order.state === "CANCELLED") return orderView(tx, order.id);
    const [tenant] = await tx.select({ lateCancelMinutes: tenants.lateCancelMinutes }).from(tenants).where(eq(tenants.id, order.tenantId));
    const option = customerCancelOption(order, tenant!.lateCancelMinutes);
    if (!option.allowed) {
      if (order.channel !== "ONLINE") throw new AppError("CONFLICT", "This order was placed at the counter. Please ask the cashier to cancel it.");
      if (order.state === "PREPARING") throw new AppError("CONFLICT", "The café has started making your order, so it can't be cancelled now. If it isn't ready in time you can cancel it for a full refund.");
      if (order.state === "AWAITING_PAYMENT") throw new AppError("CONFLICT", "This order isn't paid yet, so there is nothing to cancel. It will expire on its own.");
      throw new AppError("CONFLICT", "This order can't be cancelled any more.");
    }
    const late = option.kind === "LATE";
    const reason = late ? "Cancelled by the customer: the order was late" : "Cancelled by the customer before the kitchen started";
    await tx.update(adjustments).set({ status: "RESOLVED", choice: "CANCEL_ORDER", resolvedAt: new Date() }).where(and(eq(adjustments.orderId, order.id), inArray(adjustments.status, ["OPEN", "AWAITING_TOPUP"])));
    await tx.update(payments).set({ status: "FAILED" }).where(and(eq(payments.orderId, order.id), eq(payments.status, "CREATED")));
    const updated = await applyTransition(tx, after, ctx.bus, order, late ? "LATE_CANCEL" : "CUSTOMER_CANCEL", "CUSTOMER", { reason });
    await refundEverything(tx, updated, reason, `order:${order.id}:customer-cancel`);
    return orderView(tx, order.id);
  });
}

// ---------- Customer resolves an unavailable item ----------

export async function resolveCustomerAdjustment(ctx: Ctx, trackingToken: string, adjustmentId: string, body: ResolveAdjustmentRequest) {
  return withTx(ctx.db, async (tx, after) => {
    const order = await lockOrder(tx, { trackingToken });
    const [adj] = await tx.select().from(adjustments).where(and(eq(adjustments.id, adjustmentId), eq(adjustments.orderId, order.id))).for("update");
    if (!adj) throw notFound("Change request");
    if (adj.status !== "OPEN" || order.state !== "ACTION_REQUIRED") throw new AppError("CONFLICT", "This change has already been handled");
    const [line] = await tx.select().from(orderLines).where(eq(orderLines.id, adj.lineId));

    if (body.kind === "CANCEL_ORDER") {
      const reason = "Cancelled by the customer after an item became unavailable";
      await tx.update(adjustments).set({ status: "RESOLVED", choice: "CANCEL_ORDER", resolvedAt: new Date() }).where(eq(adjustments.orderId, order.id));
      const updated = await applyTransition(tx, after, ctx.bus, order, "CUSTOMER_CANCEL", "CUSTOMER", { reason });
      await refundEverything(tx, updated, reason, `order:${order.id}:customer-cancel`);
      return orderView(tx, order.id);
    }

    if (body.kind === "REMOVE") {
      const { before, after: then } = await billDelta(tx, order, line!.lineTotalPaise, 0);
      await removeLine(tx, order, adj.id, line!.id, Math.max(0, before - then), `${line!.name} removed (unavailable)`);
      await settleIfAllResolved(tx, after, ctx.bus, order.id, "CUSTOMER");
      return orderView(tx, order.id);
    }

    // REPLACE
    const [replacement] = await resolveLines(tx, order.tenantId, order.outletId, [body.replacement], { requireAvailable: true });
    if (replacement!.itemId === line!.itemId) throw new AppError("VALIDATION", "Choose a different item as the replacement");
    // The difference in the whole bill (with GST), not just in the two items' prices.
    const bill = await billDelta(tx, order, line!.lineTotalPaise, replacement!.lineTotalPaise);
    const outcome = resolveAdjustment(bill.before, { kind: "REPLACE", replacementTotalPaise: bill.after });
    if (outcome.kind !== "REPLACE") throw new Error("unreachable");

    if (outcome.topUpPaise === 0) {
      const [newLine] = await insertLines(tx, order, [replacement!], "ACTIVE", line!.id);
      await tx.update(orderLines).set({ status: "REPLACED" }).where(eq(orderLines.id, line!.id));
      await tx
        .update(adjustments)
        .set({ status: "RESOLVED", choice: "REPLACE", replacementLineId: newLine!.id, refundPaise: outcome.refundPaise, resolvedAt: new Date() })
        .where(eq(adjustments.id, adj.id));
      await takeStock(tx, order.outletId, newLine!.itemId, newLine!.quantity);
      await consumeIngredients(tx, order, [newLine!]);
      if (outcome.refundPaise > 0) await issueRefund(tx, order, outcome.refundPaise, `Difference for replacing ${line!.name}`, `adj:${adj.id}`);
      await settleIfAllResolved(tx, after, ctx.bus, order.id, "CUSTOMER");
      return orderView(tx, order.id);
    }

    // Customer pays the balance first; the swap happens when the top-up is verified.
    const [pending] = await insertLines(tx, order, [replacement!], "PENDING_TOPUP", line!.id);
    const providerOrder = await ctx.provider.createOrder({ amountPaise: outcome.topUpPaise, receipt: `topup-${adj.id}` });
    await tx.insert(payments).values({
      tenantId: order.tenantId,
      orderId: order.id,
      adjustmentId: adj.id,
      kind: "TOPUP",
      method: "ONLINE",
      provider: ctx.provider.name,
      providerOrderId: providerOrder.providerOrderId,
      amountPaise: outcome.topUpPaise,
      status: "CREATED",
    });
    await tx
      .update(adjustments)
      .set({ status: "AWAITING_TOPUP", choice: "REPLACE", replacementLineId: pending!.id, topUpPaise: outcome.topUpPaise })
      .where(eq(adjustments.id, adj.id));
    announce(after, ctx.bus, order);
    return orderView(tx, order.id);
  });
}

async function removeLine(tx: Tx, order: OrderRow, adjustmentId: string, lineId: string, refundPaise: number, reason: string) {
  await tx.update(orderLines).set({ status: "REMOVED" }).where(eq(orderLines.id, lineId));
  await tx.update(adjustments).set({ status: "RESOLVED", choice: "REMOVE", refundPaise, resolvedAt: new Date() }).where(eq(adjustments.id, adjustmentId));
  if (refundPaise > 0) await issueRefund(tx, order, refundPaise, reason, `adj:${adjustmentId}`);
}

// ---------- Background work ----------

/** Expires unpaid orders and applies the adjustment timeouts (Q-R3-04, Q-R3-05 defaults). */
export async function runSweeps(ctx: Ctx, now = new Date()) {
  const stale = await ctx.db.select({ id: orders.id }).from(orders).where(and(eq(orders.state, "AWAITING_PAYMENT"), lt(orders.expiresAt, now)));
  for (const { id } of stale) {
    await withTx(ctx.db, async (tx, after) => {
      const o = await lockOrder(tx, { id });
      if (o.state !== "AWAITING_PAYMENT") return;
      await tx.update(payments).set({ status: "FAILED" }).where(and(eq(payments.orderId, id), eq(payments.status, "CREATED")));
      await applyTransition(tx, after, ctx.bus, o, "PAYMENT_FAILED_OR_TIMEOUT", "SYSTEM", { reason: "Payment was not completed in time" });
    });
  }

  const overdue = await ctx.db
    .select({ id: adjustments.id, orderId: adjustments.orderId })
    .from(adjustments)
    .where(and(inArray(adjustments.status, ["OPEN", "AWAITING_TOPUP"]), lte(adjustments.expiresAt, now)));
  for (const a of overdue) {
    await withTx(ctx.db, async (tx, after) => {
      const order = await lockOrder(tx, { id: a.orderId });
      const [adj] = await tx.select().from(adjustments).where(eq(adjustments.id, a.id)).for("update");
      if (!adj || adj.status === "RESOLVED") return;
      if (adj.status === "AWAITING_TOPUP") {
        await tx.update(orderLines).set({ status: "REMOVED" }).where(eq(orderLines.id, adj.replacementLineId!));
        await tx.update(payments).set({ status: "FAILED" }).where(and(eq(payments.adjustmentId, adj.id), eq(payments.status, "CREATED")));
      }
      const [line] = await tx.select().from(orderLines).where(eq(orderLines.id, adj.lineId));
      const { before, after: then } = await billDelta(tx, order, line!.lineTotalPaise, 0);
      await removeLine(tx, order, adj.id, line!.id, Math.max(0, before - then), `${line!.name} removed automatically (no choice made in time)`);
      await settleIfAllResolved(tx, after, ctx.bus, order.id, "SYSTEM");
    });
  }

  // Refund policy K10: ready orders still waiting when their business day is over were not collected.
  const ready = await ctx.db
    .select({ id: orders.id, day: orders.businessDate, tz: outlets.timezone })
    .from(orders)
    .innerJoin(outlets, eq(outlets.id, orders.outletId))
    .where(eq(orders.state, "READY"));
  const notCollected = ready.filter((r) => r.day && r.day < businessDate(now, r.tz));
  for (const { id } of notCollected) {
    await withTx(ctx.db, async (tx, after) => {
      const o = await lockOrder(tx, { id });
      if (o.state !== "READY") return;
      await applyTransition(tx, after, ctx.bus, o, "MARK_NOT_COLLECTED", "SYSTEM", { reason: "Not collected by the end of the day" });
    });
  }
  return { expired: stale.length, adjustmentsTimedOut: overdue.length, notCollected: notCollected.length };
}

const MAX_ATTEMPTS = 8;

/** Drains the transactional outbox. Each job is retried with backoff. */
export async function drainOutbox(ctx: Ctx, limit = 20) {
  const jobs = await ctx.db
    .select()
    .from(outbox)
    .where(and(isNull(outbox.processedAt), lte(outbox.availableAt, new Date())))
    .orderBy(outbox.id)
    .limit(limit);
  for (const job of jobs) {
    try {
      if (job.topic === "refund.process") await processRefund(ctx, String(job.payload.refundId));
      else if (job.topic === "notify.customer") await notifyCustomer(ctx, job.id, String(job.payload.orderId), String(job.payload.state));
      else ctx.log.warn({ job }, "outbox job");
      await ctx.db.update(outbox).set({ processedAt: new Date() }).where(eq(outbox.id, job.id));
    } catch (e) {
      const attempts = job.attempts + 1;
      // After MAX_ATTEMPTS the job is parked (processed with its last error) so one bad job can't retry forever.
      const giveUp = attempts >= MAX_ATTEMPTS;
      await ctx.db
        .update(outbox)
        .set({ attempts, lastError: String(e), availableAt: new Date(Date.now() + Math.min(2 ** attempts, 600) * 1000), ...(giveUp ? { processedAt: new Date() } : {}) })
        .where(eq(outbox.id, job.id));
      ctx.log.error({ err: String(e), jobId: job.id }, "outbox job failed");
      if (giveUp) void ctx.alerter?.send({ key: `parked ${job.topic}`, title: `A ${job.topic} job gave up after ${MAX_ATTEMPTS} tries`, detail: `Job ${job.id}: ${String(e)}` });
    }
  }
  return jobs.length;
}

async function processRefund(ctx: Ctx, refundId: string) {
  const [r] = await ctx.db.select().from(refunds).where(eq(refunds.id, refundId));
  if (!r || r.status !== "PENDING" || r.providerRefundId) return;
  const [p] = await ctx.db.select().from(payments).where(eq(payments.id, r.paymentId));
  const result = await ctx.provider.refund({ providerPaymentId: p!.providerPaymentId!, amountPaise: r.amountPaise, idempotencyKey: r.id });
  await ctx.db
    .update(refunds)
    .set({ providerRefundId: result.providerRefundId, status: result.status, processedAt: result.status === "PROCESSED" ? new Date() : null })
    .where(eq(refunds.id, r.id));
  const [o] = await ctx.db.select().from(orders).where(eq(orders.id, r.orderId));
  if (o) ctx.bus.orderChanged({ tenantId: o.tenantId, outletId: o.outletId, orderId: o.id, trackingToken: o.trackingToken, state: o.state });
}

