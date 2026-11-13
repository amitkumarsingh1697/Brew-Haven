import { and, asc, eq, gte, inArray, isNotNull, lt, lte, ne } from "drizzle-orm";
import type { StaffClaims } from "../auth.js";
import type { Db } from "../db/client.js";
import { ingredients, orderLines, orders, outlets, payments, refunds, shiftCloses, staffUsers, stockMovements } from "../db/schema.js";
import { AppError } from "../errors.js";
import { gstInvoices } from "./gst.js";

export const EXPORT_KINDS = ["orders", "items", "payments", "closes", "stock", "gst"] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const IST = "Asia/Kolkata";
const istDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: IST }).format(d);
/** "2026-11-12 17:30", which spreadsheets read as a date and time. */
const istTime = (d: Date | null) => {
  if (!d) return "";
  const hm = new Intl.DateTimeFormat("en-GB", { timeZone: IST, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  return `${istDay(d)} ${hm}`;
};
const rupees = (p: number) => (p / 100).toFixed(2);

type Cell = string | number | null | undefined;

/**
 * One CSV cell. Text that a spreadsheet would read as a formula (=, +, -, @, tab, CR) gets a
 * leading apostrophe, since customer names and notes are typed by the public. Plain numbers such as
 * a refund's -300.00 are left alone.
 */
function cell(v: Cell): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return String(v);
  let s = v;
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const toCsv = (head: string[], rows: Cell[][]) => [head, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";

/** Owner CSV downloads for a date range (India time, up to a year), all cafés or one. */
export async function exportCsv(db: Db, staff: StaffClaims, kind: string, q: { from?: string; to?: string; outletId?: string }) {
  if (staff.role !== "ADMIN") throw new AppError("FORBIDDEN", "Only the owner can download exports");
  if (!EXPORT_KINDS.includes(kind as ExportKind)) throw new AppError("NOT_FOUND", "No such export");
  const today = istDay(new Date());
  const to = q.to && DAY.test(q.to) ? q.to : today;
  const from = q.from && DAY.test(q.from) ? q.from : to;
  if (from > to) throw new AppError("VALIDATION", "The start date is after the end date");
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > 366) throw new AppError("VALIDATION", "Choose a range of up to a year");
  const start = new Date(`${from}T00:00:00+05:30`);
  const end = new Date(new Date(`${to}T00:00:00+05:30`).getTime() + 86_400_000);

  const cafes = await db.select({ id: outlets.id, name: outlets.name }).from(outlets).where(eq(outlets.tenantId, staff.tenantId));
  const ids = q.outletId ? cafes.filter((c) => c.id === q.outletId).map((c) => c.id) : cafes.map((c) => c.id);
  if (!ids.length) throw new AppError("NOT_FOUND", "Café not found");
  const cafe = new Map(cafes.map((c) => [c.id, c.name]));
  const filename = `brew-haven-${kind}-${from}-to-${to}.csv`;

  const placed = () =>
    db
      .select()
      .from(orders)
      .where(and(eq(orders.tenantId, staff.tenantId), inArray(orders.outletId, ids), isNotNull(orders.businessDate), gte(orders.businessDate, from), lte(orders.businessDate, to)))
      .orderBy(asc(orders.placedAt));

  switch (kind as ExportKind) {
    case "gst": {
      const { invoices } = await gstInvoices(db, staff, { from, to, outletId: q.outletId });
      return {
        filename,
        csv: toCsv(
          ["Invoice no", "Business date", "Café", "Status", "GST rate (%)", "Taxable value (₹)", "CGST (₹)", "SGST (₹)", "Invoice value (₹)"],
          invoices.map((i) => [i.invoiceNo, i.businessDate, i.outlet, i.cancelled ? "Cancelled" : "Issued", (i.rateBps / 100).toFixed(2), rupees(i.taxablePaise), rupees(i.cgstPaise), rupees(i.sgstPaise), rupees(i.totalPaise)]),
        ),
      };
    }
    case "orders": {
      const rows = await placed();
      const paid = rows.length
        ? await db.select({ orderId: payments.orderId, method: payments.method, amount: payments.amountPaise }).from(payments).where(and(inArray(payments.orderId, rows.map((r) => r.id)), eq(payments.status, "CAPTURED")))
        : [];
      const back = rows.length
        ? await db.select({ orderId: refunds.orderId, amount: refunds.amountPaise }).from(refunds).where(and(inArray(refunds.orderId, rows.map((r) => r.id)), ne(refunds.status, "FAILED")))
        : [];
      const sumBy = (list: Array<{ orderId: string; amount: number }>, id: string) => list.filter((x) => x.orderId === id).reduce((n, x) => n + x.amount, 0);
      return {
        filename,
        csv: toCsv(
          ["Business date", "Placed at", "Café", "Order", "Receipt no", "Channel", "State", "Customer", "Total (₹)", "GST (₹)", "Round-off (₹)", "Paid (₹)", "Refunded (₹)", "Payment methods", "Cancel reason"],
          rows.map((o) => [
            o.businessDate,
            istTime(o.placedAt),
            cafe.get(o.outletId),
            o.pickupCode,
            o.invoiceNo,
            o.channel,
            o.state,
            o.customerName,
            rupees(o.totalPaise),
            rupees(o.taxPaise),
            rupees(o.roundOffPaise),
            rupees(sumBy(paid, o.id)),
            rupees(sumBy(back, o.id)),
            [...new Set(paid.filter((p) => p.orderId === o.id).map((p) => p.method))].join(" + "),
            o.cancelReason,
          ]),
        ),
      };
    }
    case "items": {
      const rows = await placed();
      const lines = rows.length ? await db.select().from(orderLines).where(and(inArray(orderLines.orderId, rows.map((r) => r.id)), eq(orderLines.status, "ACTIVE"))) : [];
      const byId = new Map(rows.map((o) => [o.id, o]));
      return {
        filename,
        csv: toCsv(
          ["Business date", "Café", "Order", "Order state", "Item", "Choices", "Quantity", "Unit price (₹)", "Line total (₹)", "Note"],
          lines.map((l) => {
            const o = byId.get(l.orderId)!;
            return [o.businessDate, cafe.get(o.outletId), o.pickupCode, o.state, l.name, l.modifiers.map((m) => m.name).join(", "), l.quantity, rupees(l.unitTotalPaise), rupees(l.lineTotalPaise), l.note];
          }),
        ),
      };
    }
    case "payments": {
      const pays = await db
        .select({ p: payments, code: orders.pickupCode, outletId: orders.outletId, by: staffUsers.name })
        .from(payments)
        .innerJoin(orders, eq(orders.id, payments.orderId))
        .leftJoin(staffUsers, eq(staffUsers.id, payments.recordedByStaffId))
        .where(and(eq(payments.tenantId, staff.tenantId), inArray(orders.outletId, ids), eq(payments.status, "CAPTURED"), gte(payments.capturedAt, start), lt(payments.capturedAt, end)));
      const refs = await db
        .select({ r: refunds, code: orders.pickupCode, outletId: orders.outletId, method: payments.method })
        .from(refunds)
        .innerJoin(orders, eq(orders.id, refunds.orderId))
        .innerJoin(payments, eq(payments.id, refunds.paymentId))
        .where(and(eq(refunds.tenantId, staff.tenantId), inArray(orders.outletId, ids), gte(refunds.createdAt, start), lt(refunds.createdAt, end)));
      const rows: Array<{ at: Date; cells: Cell[] }> = [
        ...pays.map((x) => ({
          at: x.p.capturedAt!,
          cells: [istTime(x.p.capturedAt), cafe.get(x.outletId), x.code, "Payment", x.p.kind === "TOPUP" ? "Top-up" : "Order", x.p.method, rupees(x.p.amountPaise), "Captured", x.p.providerPaymentId, x.by],
        })),
        ...refs.map((x) => ({
          at: x.r.createdAt,
          cells: [istTime(x.r.createdAt), cafe.get(x.outletId), x.code, "Refund", x.r.reason, x.method, rupees(-x.r.amountPaise), x.r.status === "PROCESSED" ? "Refunded" : x.r.status === "FAILED" ? "Failed" : "Pending", x.r.providerRefundId, x.r.manual ? "Manual" : ""],
        })),
      ].sort((a, b) => a.at.getTime() - b.at.getTime());
      return { filename, csv: toCsv(["Time", "Café", "Order", "Type", "For", "Method", "Amount (₹)", "Status", "Reference", "Recorded by"], rows.map((r) => r.cells)) };
    }
    case "closes": {
      const rows = await db
        .select()
        .from(shiftCloses)
        .where(and(eq(shiftCloses.tenantId, staff.tenantId), inArray(shiftCloses.outletId, ids), gte(shiftCloses.businessDate, from), lte(shiftCloses.businessDate, to)))
        .orderBy(asc(shiftCloses.businessDate));
      return {
        filename,
        csv: toCsv(
          ["Business date", "Café", "Closed by", "Closed at", "Opening float (₹)", "Cash expected (₹)", "Cash counted (₹)", "Over / short (₹)", "Cash (₹)", "UPI at counter (₹)", "Card at counter (₹)", "Online (₹)", "Net takings (₹)", "Orders still open", "Note"],
          rows.map((c) => [
            c.businessDate,
            cafe.get(c.outletId),
            c.closedByName,
            istTime(c.closedAt),
            rupees(c.openingFloatPaise),
            rupees(c.expectedCashPaise),
            rupees(c.countedCashPaise),
            rupees(c.variancePaise),
            rupees(c.takingsByMethod.CASH ?? 0),
            rupees(c.takingsByMethod.UPI_COUNTER ?? 0),
            rupees(c.takingsByMethod.CARD_COUNTER ?? 0),
            rupees(c.takingsByMethod.ONLINE ?? 0),
            rupees(c.netPaise),
            c.openOrders,
            c.note,
          ]),
        ),
      };
    }
    case "stock": {
      const rows = await db
        .select({ m: stockMovements, ingredient: ingredients.name, unit: ingredients.unit, by: staffUsers.name, code: orders.pickupCode })
        .from(stockMovements)
        .innerJoin(ingredients, eq(ingredients.id, stockMovements.ingredientId))
        .leftJoin(staffUsers, eq(staffUsers.id, stockMovements.staffId))
        .leftJoin(orders, eq(orders.id, stockMovements.orderId))
        .where(and(eq(stockMovements.tenantId, staff.tenantId), inArray(stockMovements.outletId, ids), gte(stockMovements.createdAt, start), lt(stockMovements.createdAt, end)))
        .orderBy(asc(stockMovements.id));
      const KIND: Record<string, string> = { RECEIVE: "Received", SALE: "Sold", WASTE: "Wasted", COUNT: "Count difference" };
      return {
        filename,
        csv: toCsv(
          ["Time", "Café", "Ingredient", "Unit", "What", "Change", "Order", "By", "Note"],
          rows.map((r) => [istTime(r.m.createdAt), cafe.get(r.m.outletId), r.ingredient, r.unit, KIND[r.m.kind] ?? r.m.kind, r.m.quantity, r.code, r.by, r.m.note]),
        ),
      };
    }
  }
}
