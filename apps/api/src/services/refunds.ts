import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { RefundCategory, StaffRefundPreview, StaffRefundRequest } from "@brew-haven/contracts";
import { financialYear, formatInvoiceNo, formatInr } from "@brew-haven/domain";
import type { z } from "zod";
import { verifyPin, type AttemptLimiter, type StaffClaims } from "../auth.js";
import { withTx, type Tx } from "../db/client.js";
import { creditNotes, invoiceCounters, orderLines, outlets, refunds, staffUsers, tenants } from "../db/schema.js";
import { AppError } from "../errors.js";
import { lockStaffOrder, type Ctx } from "./flows.js";
import { COUNTED, businessDate, issueRefund, moneyOnOrder, orderBill, orderView, type OrderRow } from "./orders.js";

const sqlIncrement = sql`${invoiceCounters.lastSeq} + 1`;

/** Orders that were paid and placed and are still standing. Earlier, cancel with Reject instead. */
const REFUNDABLE = ["PLACED", "PREPARING", "READY", "COLLECTED"];

const CATEGORY_WORDS: Record<z.output<typeof RefundCategory>, string> = {
  WRONG_ITEM: "Wrong item or customisation",
  QUALITY: "Quality complaint",
  SAFETY: "Food safety (foreign object, allergen or veg/non-veg mix-up)",
  MISSING: "Item missing from the order",
  GOODWILL: "Goodwill",
  OTHER: "Other",
};

interface Plan {
  amountPaise: number;
  taxPaise: number;
  lines: Array<{ lineId: string; name: string; quantity: number; amountPaise: number }>;
}

/**
 * How much to give back. For chosen lines, the difference in the whole bill (with GST and its
 * rounding) with and without those items, the same way an item-unavailable removal is priced, so a
 * line is never refunded at more than it added to the bill. A line can't be refunded twice.
 */
async function plan(tx: Tx, order: OrderRow, body: z.output<typeof StaffRefundRequest>): Promise<Plan> {
  const { captured, refunded } = await moneyOnOrder(tx, order.id);
  const left = captured - refunded;
  if (left <= 0) throw new AppError("CONFLICT", "Everything paid on this order has already been refunded");
  if (body.wholeOrder) {
    const taxPaise = order.totalPaise > 0 ? Math.round((order.taxPaise * left) / order.totalPaise) : 0;
    return { amountPaise: left, taxPaise, lines: [] };
  }
  const all = await tx.select().from(orderLines).where(eq(orderLines.orderId, order.id));
  const counted = all.filter((l) => (COUNTED as readonly string[]).includes(l.status));
  const earlier = await tx.select({ lines: creditNotes.lines }).from(creditNotes).where(eq(creditNotes.orderId, order.id));
  const alreadyByLine = new Map<string, number>();
  for (const n of earlier) for (const l of n.lines) alreadyByLine.set(l.lineId, (alreadyByLine.get(l.lineId) ?? 0) + l.quantity);

  const wanted = new Map<string, number>();
  for (const l of body.lines) wanted.set(l.lineId, (wanted.get(l.lineId) ?? 0) + l.quantity);
  let removedPaise = 0;
  const chosen: Plan["lines"] = [];
  for (const [lineId, qty] of wanted) {
    const line = counted.find((l) => l.id === lineId);
    if (!line) throw new AppError("VALIDATION", "That item isn't on this order");
    const room = line.quantity - (alreadyByLine.get(lineId) ?? 0);
    if (qty > room) throw new AppError("CONFLICT", room <= 0 ? `${line.name} has already been refunded` : `Only ${room} × ${line.name} can still be refunded`);
    const value = Math.round((line.lineTotalPaise * qty) / line.quantity);
    removedPaise += value;
    chosen.push({ lineId, name: line.name, quantity: qty, amountPaise: value });
  }
  // Lines refunded before no longer count toward the bill, so each refund is priced on what's left.
  const earlierPaise = counted.reduce((s, l) => s + Math.round((l.lineTotalPaise * Math.min(l.quantity, alreadyByLine.get(l.id) ?? 0)) / l.quantity), 0);
  const base = counted.reduce((s, l) => s + l.lineTotalPaise, 0) - earlierPaise;
  const before = orderBill(order, base);
  const after = orderBill(order, Math.max(0, base - removedPaise));
  const amountPaise = Math.min(left, before.totalPaise - after.totalPaise);
  // Spread the bill difference back over the lines so the credit note's lines add up to it.
  let spread = 0;
  chosen.forEach((c, i) => {
    c.amountPaise = i === chosen.length - 1 ? amountPaise - spread : Math.round((amountPaise * c.amountPaise) / Math.max(1, removedPaise));
    spread += c.amountPaise;
  });
  return { amountPaise, taxPaise: Math.min(amountPaise, before.taxPaise - after.taxPaise), lines: chosen };
}

/**
 * A refund after service (refund policy K12, K13, K14), always to the way the customer paid (P14).
 * Cashiers can give up to the café's limit alone; above it the owner approves with their PIN (C5).
 * Counter card and UPI refunds carry the machine's reference (C4). When the order has a standing
 * tax invoice, a GST credit note is issued for the refunded value (T1).
 */
export async function staffRefund(ctx: Ctx, limiter: AttemptLimiter, staff: StaffClaims, orderId: string, body: z.output<typeof StaffRefundRequest>, ip: string) {
  if (staff.role === "KITCHEN") throw new AppError("FORBIDDEN", "Only the cashier or the owner can give refunds");
  return withTx(ctx.db, async (tx, after) => {
    const order = await lockStaffOrder(tx, staff, orderId);
    if (!REFUNDABLE.includes(order.state)) {
      throw new AppError("CONFLICT", order.state === "ACTION_REQUIRED" ? "The customer is choosing what to do about an unavailable item. Wait for them first." : "Only paid orders can be refunded here");
    }
    const [tenant] = await tx.select({ limit: tenants.cashierRefundLimitPaise }).from(tenants).where(eq(tenants.id, order.tenantId));
    const p = await plan(tx, order, body);
    const { pays } = await moneyOnOrder(tx, order.id);
    const methods = [...new Set(pays.map((x) => x.method))];
    const toOriginalPayment = methods.map((m) => ({ ONLINE: "the customer's online payment", CASH: "cash from the drawer", UPI_COUNTER: "the customer's UPI", CARD_COUNTER: "the customer's card" })[m] ?? m).join(" and ");
    const needsApproval = staff.role !== "ADMIN" && p.amountPaise > tenant!.limit;
    const creditNote = !!order.invoiceNo;
    if (body.preview) {
      const preview: StaffRefundPreview = { amountPaise: p.amountPaise, needsApproval, limitPaise: tenant!.limit, creditNote, toOriginalPayment };
      return { preview, order: null };
    }

    let approvedBy: string | null = null;
    if (needsApproval) {
      if (!body.approver) throw new AppError("FORBIDDEN", `Refunds over ${formatInr(tenant!.limit)} need the owner's PIN`);
      const key = `refund-approve|${body.approver.staffUserId}|${ip}`;
      limiter.check(key);
      const [owner] = await tx
        .select()
        .from(staffUsers)
        .where(and(eq(staffUsers.id, body.approver.staffUserId), eq(staffUsers.tenantId, order.tenantId), eq(staffUsers.role, "ADMIN"), eq(staffUsers.active, true)));
      if (!owner || !(await verifyPin(body.approver.pin, owner.pinHash))) {
        limiter.fail(key);
        throw new AppError("UNAUTHORIZED", "That owner PIN is not right");
      }
      limiter.reset(key);
      approvedBy = owner.id;
    }

    const counterCardOrUpi = pays.some((x) => x.method === "CARD_COUNTER" || x.method === "UPI_COUNTER");
    if (counterCardOrUpi && !body.reference) throw new AppError("VALIDATION", "Enter the refund reference from the card machine or UPI app");

    const lineWords = p.lines.map((l) => `${l.quantity} × ${l.name}`).join(", ");
    const reason = `${CATEGORY_WORDS[body.category]}${lineWords ? `: ${lineWords}` : ""}${body.note ? ` (${body.note})` : ""}`.slice(0, 300);
    const created = await issueRefund(tx, order, p.amountPaise, reason, `staff-refund:${randomUUID()}`);
    await tx
      .update(refunds)
      .set({ reference: body.reference ?? null, staffId: staff.sub, approvedByStaffId: approvedBy })
      .where(inArray(refunds.id, created.map((r) => r.id)));

    if (creditNote) await issueCreditNote(tx, order, p, reason);
    after(() => ctx.bus.orderChanged({ tenantId: order.tenantId, outletId: order.outletId, orderId: order.id, trackingToken: order.trackingToken, state: order.state }));
    return { preview: null, order: await orderView(tx, order.id) };
  });
}

async function issueCreditNote(tx: Tx, order: OrderRow, p: Plan, reason: string) {
  const [outlet] = await tx.select().from(outlets).where(eq(outlets.id, order.outletId));
  const day = businessDate(new Date(), outlet!.timezone);
  // Credit notes run in their own series per café and financial year, next to the invoices.
  const series = `CN${financialYear(day)}`;
  const [counter] = await tx
    .insert(invoiceCounters)
    .values({ outletId: order.outletId, financialYear: series, lastSeq: 1 })
    .onConflictDoUpdate({ target: [invoiceCounters.outletId, invoiceCounters.financialYear], set: { lastSeq: sqlIncrement } })
    .returning();
  await tx.insert(creditNotes).values({
    tenantId: order.tenantId,
    outletId: order.outletId,
    orderId: order.id,
    number: `CN${formatInvoiceNo(outlet!.pickupPrefix, financialYear(day), counter!.lastSeq)}`,
    invoiceNo: order.invoiceNo!,
    businessDate: day,
    reason,
    taxRateBps: order.taxRateBps,
    taxablePaise: p.amountPaise - p.taxPaise,
    taxPaise: p.taxPaise,
    totalPaise: p.amountPaise,
    lines: p.lines,
  });
}

