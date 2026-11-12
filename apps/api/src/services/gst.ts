import { and, asc, eq, gte, inArray, isNotNull, lte } from "drizzle-orm";
import { splitGst } from "@brew-haven/domain";
import type { StaffClaims } from "../auth.js";
import type { Db } from "../db/client.js";
import { orders, outlets, tenants } from "../db/schema.js";
import { AppError } from "../errors.js";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** Restaurant and café service (SAC 996331), the code a café's GST return uses. */
export const CAFE_SAC = "996331";
/** States in which an invoice stands; a cancelled order's invoice is reported as cancelled. */
const ISSUED = ["PLACED", "PREPARING", "ACTION_REQUIRED", "READY", "COLLECTED"];

type Sums = { invoices: number; taxablePaise: number; cgstPaise: number; sgstPaise: number; totalPaise: number };
const zero = (): Sums => ({ invoices: 0, taxablePaise: 0, cgstPaise: 0, sgstPaise: 0, totalPaise: 0 });

export interface GstInvoiceRow {
  invoiceNo: string;
  businessDate: string;
  outlet: string;
  cancelled: boolean;
  rateBps: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  totalPaise: number;
}

/**
 * Invoices in a date range (business dates), with each invoice's final value. When an item is
 * removed or swapped after payment, the order's total and tax are recalculated, so the value here
 * is what the café finally supplied. A cancelled order's invoice counts as cancelled, with no value.
 */
export async function gstInvoices(db: Db, staff: StaffClaims, q: { from?: string | undefined; to?: string | undefined; outletId?: string | undefined }) {
  if (staff.role !== "ADMIN") throw new AppError("FORBIDDEN", "Only the owner can see the GST summary");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  const to = q.to && DAY.test(q.to) ? q.to : today;
  const from = q.from && DAY.test(q.from) ? q.from : to;
  if (from > to) throw new AppError("VALIDATION", "The start date is after the end date");
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > 366) throw new AppError("VALIDATION", "Choose a range of up to a year");

  const cafes = await db.select({ id: outlets.id, name: outlets.name }).from(outlets).where(eq(outlets.tenantId, staff.tenantId)).orderBy(asc(outlets.name));
  const ids = q.outletId ? cafes.filter((c) => c.id === q.outletId).map((c) => c.id) : cafes.map((c) => c.id);
  if (!ids.length) throw new AppError("NOT_FOUND", "Café not found");
  const name = new Map(cafes.map((c) => [c.id, c.name]));

  const rows = await db
    .select({ invoiceNo: orders.invoiceNo, businessDate: orders.businessDate, outletId: orders.outletId, state: orders.state, total: orders.totalPaise, tax: orders.taxPaise, rate: orders.taxRateBps })
    .from(orders)
    .where(and(eq(orders.tenantId, staff.tenantId), inArray(orders.outletId, ids), isNotNull(orders.invoiceNo), gte(orders.businessDate, from), lte(orders.businessDate, to)))
    .orderBy(asc(orders.invoiceNo));

  const invoices: GstInvoiceRow[] = rows.map((o) => {
    const cancelled = !ISSUED.includes(o.state);
    const tax = cancelled ? 0 : o.tax;
    const total = cancelled ? 0 : o.total;
    const { cgstPaise, sgstPaise } = splitGst(tax);
    return { invoiceNo: o.invoiceNo!, businessDate: o.businessDate!, outlet: name.get(o.outletId) ?? "", cancelled, rateBps: o.rate, taxablePaise: total - tax, cgstPaise, sgstPaise, totalPaise: total };
  });
  const [tenant] = await db.select({ billing: tenants.billing }).from(tenants).where(eq(tenants.id, staff.tenantId));
  return { from, to, billing: tenant?.billing ?? {}, invoices, cafes: cafes.filter((c) => ids.includes(c.id)) };
}

/**
 * The GST summary an accountant needs for the return: sales by tax rate (all within the state, so
 * CGST and SGST), by café, and the invoice series issued with first and last number and how many
 * were cancelled.
 */
export async function gstSummary(db: Db, staff: StaffClaims, q: { from?: string | undefined; to?: string | undefined; outletId?: string | undefined }) {
  const { from, to, billing, invoices, cafes } = await gstInvoices(db, staff, q);
  const add = (s: Sums, i: GstInvoiceRow) => {
    s.invoices++;
    s.taxablePaise += i.taxablePaise;
    s.cgstPaise += i.cgstPaise;
    s.sgstPaise += i.sgstPaise;
    s.totalPaise += i.totalPaise;
  };
  const totals = zero();
  const byRate = new Map<number, Sums & { rateBps: number }>();
  const byCafe = new Map(cafes.map((c) => [c.name, { outlet: c.name, ...zero() }]));
  // A series is one café's numbers for one financial year, e.g. "A2627".
  const series = new Map<string, { series: string; outlet: string; first: string; last: string; issued: number; cancelled: number }>();
  for (const i of invoices) {
    const key = i.invoiceNo.split("-")[0]!;
    const s = series.get(key) ?? { series: key, outlet: i.outlet, first: i.invoiceNo, last: i.invoiceNo, issued: 0, cancelled: 0 };
    if (i.invoiceNo < s.first) s.first = i.invoiceNo;
    if (i.invoiceNo > s.last) s.last = i.invoiceNo;
    s.issued++;
    if (i.cancelled) {
      s.cancelled++;
    } else {
      add(totals, i);
      const r = byRate.get(i.rateBps) ?? { rateBps: i.rateBps, ...zero() };
      add(r, i);
      byRate.set(i.rateBps, r);
      const c = byCafe.get(i.outlet);
      if (c) add(c, i);
    }
    series.set(key, s);
  }
  return {
    from,
    to,
    gstin: billing.gstin || null,
    legalName: billing.legalName || null,
    sac: CAFE_SAC,
    totals,
    byRate: [...byRate.values()].sort((a, b) => a.rateBps - b.rateBps),
    byCafe: [...byCafe.values()],
    documents: [...series.values()].sort((a, b) => a.series.localeCompare(b.series)),
  };
}
