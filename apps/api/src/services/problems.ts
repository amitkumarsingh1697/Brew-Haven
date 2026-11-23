import { and, eq } from "drizzle-orm";
import { formatInr } from "@brew-haven/domain";
import type { z } from "zod";
import type { ReportProblemRequest } from "@brew-haven/contracts";
import type { StaffClaims } from "../auth.js";
import { withTx, type After, type Db, type Tx } from "../db/client.js";
import { outlets, problemReports } from "../db/schema.js";
import { AppError, notFound } from "../errors.js";
import { recordAudit } from "./audit.js";
import type { Ctx } from "./flows.js";
import { announce, canReportProblem, lockOrder, orderView } from "./orders.js";

export const PROBLEM_WORDS: Record<z.output<typeof ReportProblemRequest>["category"], string> = {
  WRONG_ITEM: "Wrong item or customisation",
  MISSING: "Something missing",
  QUALITY: "Quality (taste, temperature, how it was made)",
  SAFETY: "Food safety (foreign object, allergen or veg/non-veg mix-up)",
  OTHER: "Something else",
};

/**
 * Refund policy K13/K14: the customer reports a problem with a served order from their order link, on the
 * day of the order. One report per order. It lands in the owner's Payment checks; a food-safety report
 * also raises an alert straight away, so the owner hears about it before the end of the day.
 */
export async function reportProblem(ctx: Ctx, trackingToken: string, body: z.output<typeof ReportProblemRequest>) {
  return withTx(ctx.db, async (tx, after) => {
    const order = await lockOrder(tx, { trackingToken });
    const [outlet] = await tx.select().from(outlets).where(eq(outlets.id, order.outletId));
    const [existing] = await tx.select({ id: problemReports.id }).from(problemReports).where(eq(problemReports.orderId, order.id));
    if (existing) throw new AppError("CONFLICT", "You've already reported a problem with this order. The café will get back to you.");
    if (!canReportProblem(order, outlet!.timezone)) {
      if (order.businessDate && ["READY", "COLLECTED", "NOT_COLLECTED"].includes(order.state)) throw new AppError("CONFLICT", "Problems can be reported here on the day of the order. For an older order, please contact the café.");
      throw new AppError("CONFLICT", "You can report a problem once your order is ready.");
    }
    await tx.insert(problemReports).values({ tenantId: order.tenantId, orderId: order.id, category: body.category, note: body.note });
    const label = `${order.pickupCode ?? "an order"} at ${outlet!.name}`;
    await recordAudit(tx as unknown as Db, {
      tenantId: order.tenantId,
      actorId: null,
      actorName: order.customerName ? `Customer (${order.customerName})` : "Customer",
      action: "order.problem",
      summary: `Customer reported a problem with ${label}: ${PROBLEM_WORDS[body.category]}. "${body.note}"`,
      outletId: order.outletId,
      targetId: order.id,
      ip: null,
    });
    if (body.category === "SAFETY") {
      after(() => void ctx.alerter?.send({ key: `safety ${order.id}`, title: `Food-safety report: ${label}`, detail: body.note }));
    }
    announce(after, ctx.bus, order);
    return orderView(tx, order.id);
  });
}

/** Staff close a report once they've dealt with it (refunded, remade, or spoken to the customer). */
export async function resolveProblem(ctx: Ctx, staff: StaffClaims, orderId: string) {
  if (staff.role === "KITCHEN") throw new AppError("FORBIDDEN", "Only the cashier or owner can close a reported problem");
  return withTx(ctx.db, async (tx, after) => {
    const order = await lockOrder(tx, { id: orderId });
    if (order.tenantId !== staff.tenantId) throw notFound("Order");
    if (staff.role !== "ADMIN" && !staff.outletIds.includes(order.outletId)) throw new AppError("FORBIDDEN", "You are not assigned to this café");
    const done = await tx
      .update(problemReports)
      .set({ status: "RESOLVED", resolvedAt: new Date(), resolvedBy: staff.name })
      .where(and(eq(problemReports.orderId, order.id), eq(problemReports.status, "OPEN")))
      .returning({ id: problemReports.id });
    if (!done.length) throw new AppError("CONFLICT", "There's no open problem report on this order");
    await recordAudit(tx as unknown as Db, { tenantId: order.tenantId, actorId: staff.sub, actorName: staff.name, action: "order.problem_resolved", summary: `Closed the problem report on ${order.pickupCode ?? "an order"}`, outletId: order.outletId, targetId: order.id, ip: null });
    announce(after, ctx.bus, order);
    return orderView(tx, order.id);
  });
}

/** Refund policy K13: a staff refund closes the order's open report; a food-safety refund also alerts straight away. */
export async function closeProblemOnRefund(tx: Tx, orderId: string, staffName: string) {
  await tx.update(problemReports).set({ status: "RESOLVED", resolvedAt: new Date(), resolvedBy: staffName }).where(and(eq(problemReports.orderId, orderId), eq(problemReports.status, "OPEN")));
}

export async function safetyRefundAlert(tx: Tx, ctx: Pick<Ctx, "alerter">, after: After, order: { id: string; pickupCode: string | null; outletId: string }, amountPaise: number, staffName: string) {
  const [outlet] = await tx.select({ name: outlets.name }).from(outlets).where(eq(outlets.id, order.outletId));
  after(() => void ctx.alerter?.send({ key: `safety-refund ${order.id}`, title: `Food-safety refund: ${order.pickupCode ?? "order"} at ${outlet?.name ?? ""}`, detail: `${staffName} refunded ${formatInr(amountPaise)}.` }));
}
