import { and, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import type { StaffClaims } from "../auth.js";
import type { Db } from "../db/client.js";
import { orders, outlets, payments, refunds } from "../db/schema.js";
import { AppError } from "../errors.js";

export type ExceptionKind = "REFUND_FAILED" | "REFUND_STUCK" | "PAID_NOT_SERVED" | "UPI_NO_REFERENCE";
export interface PaymentException {
  kind: ExceptionKind;
  /** "act" needs someone to do something; "check" is worth a look when reconciling. */
  severity: "act" | "check";
  at: string;
  orderId: string;
  orderCode: string | null;
  outlet: string;
  amountPaise: number;
  message: string;
}

const STUCK_AFTER_MS = 30 * 60_000;
const LOOKBACK_DAYS = 30;

/**
 * Payments that need a person: refunds that failed or are stuck, money taken for orders that were
 * never served and not fully refunded, and counter UPI payments recorded without a reference.
 * Looks back 30 days. Owner only.
 */
export async function listPaymentExceptions(db: Db, staff: StaffClaims, q: { outletId?: string } = {}): Promise<{ items: PaymentException[] }> {
  if (staff.role !== "ADMIN") throw new AppError("FORBIDDEN", "Only the owner can see payment checks");
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000);
  const scope = [eq(orders.tenantId, staff.tenantId), ...(q.outletId ? [eq(orders.outletId, q.outletId)] : [])];
  const items: PaymentException[] = [];
  const base = { orderId: orders.id, code: orders.pickupCode, outlet: outlets.name, state: orders.state };

  // Refunds that failed, or have been pending too long.
  const refundRows = await db
    .select({ ...base, r: refunds })
    .from(refunds)
    .innerJoin(orders, eq(orders.id, refunds.orderId))
    .innerJoin(outlets, eq(outlets.id, orders.outletId))
    .where(and(...scope, gte(refunds.createdAt, since), inArray(refunds.status, ["FAILED", "PENDING"])));
  for (const row of refundRows) {
    const r = row.r;
    if (r.status === "FAILED") {
      items.push({ kind: "REFUND_FAILED", severity: "act", at: r.createdAt.toISOString(), orderId: row.orderId, orderCode: row.code, outlet: row.outlet, amountPaise: r.amountPaise, message: "Refund failed. Refund the customer by hand and note it." });
    } else if (Date.now() - r.createdAt.getTime() > STUCK_AFTER_MS) {
      items.push({ kind: "REFUND_STUCK", severity: "act", at: r.createdAt.toISOString(), orderId: row.orderId, orderCode: row.code, outlet: row.outlet, amountPaise: r.amountPaise, message: "Refund has been pending for over 30 minutes. Check it with the payment gateway." });
    }
  }

  // Money taken online for orders that ended without being served, and not refunded in full.
  const unserved = await db
    .select({ ...base, p: payments })
    .from(payments)
    .innerJoin(orders, eq(orders.id, payments.orderId))
    .innerJoin(outlets, eq(outlets.id, orders.outletId))
    .where(and(...scope, gte(payments.createdAt, since), eq(payments.status, "CAPTURED"), inArray(orders.state, ["CANCELLED", "EXPIRED"])));
  if (unserved.length) {
    const back = await db
      .select({ paymentId: refunds.paymentId, amount: refunds.amountPaise, status: refunds.status })
      .from(refunds)
      .where(inArray(refunds.paymentId, unserved.map((u) => u.p.id)));
    for (const u of unserved) {
      const refunded = back.filter((b) => b.paymentId === u.p.id && b.status !== "FAILED").reduce((n, b) => n + b.amount, 0);
      const owed = u.p.amountPaise - refunded;
      if (owed > 0)
        items.push({ kind: "PAID_NOT_SERVED", severity: "act", at: (u.p.capturedAt ?? u.p.createdAt).toISOString(), orderId: u.orderId, orderCode: u.code, outlet: u.outlet, amountPaise: owed, message: `Paid but ${u.state === "EXPIRED" ? "expired" : "cancelled"}, and not refunded in full.` });
    }
  }

  // Counter UPI with no reference: can't be matched to the bank statement.
  const noRef = await db
    .select({ ...base, p: payments })
    .from(payments)
    .innerJoin(orders, eq(orders.id, payments.orderId))
    .innerJoin(outlets, eq(outlets.id, orders.outletId))
    .where(and(...scope, gte(payments.createdAt, since), eq(payments.method, "UPI_COUNTER"), eq(payments.status, "CAPTURED"), isNull(payments.providerPaymentId)))
    .orderBy(desc(payments.createdAt))
    .limit(200);
  for (const u of noRef)
    items.push({ kind: "UPI_NO_REFERENCE", severity: "check", at: u.p.createdAt.toISOString(), orderId: u.orderId, orderCode: u.code, outlet: u.outlet, amountPaise: u.p.amountPaise, message: "UPI at the counter, no reference entered. Match it on the bank statement." });

  items.sort((a, b) => (a.severity === b.severity ? b.at.localeCompare(a.at) : a.severity === "act" ? -1 : 1));
  return { items };
}
