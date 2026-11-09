import { and, asc, eq, inArray } from "drizzle-orm";
import type { ReceiptView } from "@brew-haven/contracts";
import { splitGst } from "@brew-haven/domain";
import type { StaffClaims } from "../auth.js";
import type { Db } from "../db/client.js";
import { orderLines, orders, outlets, payments, refunds, tenants } from "../db/schema.js";
import { AppError, notFound } from "../errors.js";
import { assertStaffOutlet } from "./staff.js";

/**
 * The receipt for a placed order. It is a tax invoice when the café has a GSTIN on file,
 * otherwise a plain receipt. Prices are tax-inclusive (ADR-0004), so the taxable value is the
 * total less the GST it contains.
 */
async function buildReceipt(db: Db, orderId: string): Promise<ReceiptView> {
  const [row] = await db
    .select({ o: orders, outlet: outlets, tenant: tenants })
    .from(orders)
    .innerJoin(outlets, eq(outlets.id, orders.outletId))
    .innerJoin(tenants, eq(tenants.id, orders.tenantId))
    .where(eq(orders.id, orderId));
  if (!row) throw notFound("Order");
  const { o, outlet, tenant } = row;
  if (!o.invoiceNo || !o.placedAt) throw new AppError("CONFLICT", "A receipt is ready once the order is paid and placed");

  const lines = await db
    .select()
    .from(orderLines)
    .where(and(eq(orderLines.orderId, o.id), eq(orderLines.status, "ACTIVE")))
    .orderBy(asc(orderLines.createdAt));
  const pays = await db.select().from(payments).where(and(eq(payments.orderId, o.id), eq(payments.status, "CAPTURED"))).orderBy(asc(payments.createdAt));
  const refundRows = pays.length
    ? await db.select({ amount: refunds.amountPaise, status: refunds.status }).from(refunds).where(inArray(refunds.paymentId, pays.map((p) => p.id)))
    : [];

  const billing = tenant.billing ?? {};
  const branding = tenant.branding as { displayName?: string };
  const gstin = billing.gstin || null;
  const { cgstPaise, sgstPaise } = splitGst(o.taxPaise);
  return {
    kind: gstin ? "TAX_INVOICE" : "RECEIPT",
    number: o.invoiceNo,
    issuedAt: o.placedAt.toISOString(),
    pickupCode: o.pickupCode,
    seller: {
      name: branding.displayName ?? tenant.name,
      legalName: billing.legalName || null,
      outlet: outlet.name,
      address: outlet.address,
      gstin,
      fssaiLicence: billing.fssaiLicence || null,
    },
    customerName: o.customerName,
    channel: o.channel,
    lines: lines.map((l) => ({ name: l.name, options: l.modifiers.map((m) => m.name), quantity: l.quantity, amountPaise: l.lineTotalPaise })),
    totals: { totalPaise: o.totalPaise, taxablePaise: o.totalPaise - o.taxPaise, taxRateBps: o.taxRateBps, cgstPaise, sgstPaise },
    payments: pays.map((p) => ({ method: p.method, amountPaise: p.amountPaise, reference: p.providerPaymentId })),
    refundedPaise: refundRows.filter((r) => r.status !== "FAILED").reduce((n, r) => n + r.amount, 0),
    footer: billing.footer || null,
  };
}

/** Customer side: anyone holding the order's tracking link can see its receipt. */
export async function receiptByToken(db: Db, token: string) {
  const [o] = await db.select({ id: orders.id }).from(orders).where(eq(orders.trackingToken, token));
  if (!o) throw notFound("Order");
  return buildReceipt(db, o.id);
}

/** Staff side: cashiers and the owner, for cafés they work at. */
export async function receiptForStaff(db: Db, staff: StaffClaims, orderId: string) {
  if (staff.role === "KITCHEN") throw new AppError("FORBIDDEN", "Receipts are printed at the counter");
  const [o] = await db.select({ outletId: orders.outletId, tenantId: orders.tenantId }).from(orders).where(eq(orders.id, orderId));
  if (!o || o.tenantId !== staff.tenantId) throw notFound("Order");
  await assertStaffOutlet(db, staff, o.outletId);
  return buildReceipt(db, orderId);
}
