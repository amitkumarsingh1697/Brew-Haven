import { asc, desc, eq, sql } from "drizzle-orm";
import { PLANS, financialYear, formatInr, formatInvoiceNo, planOf, type PlanId } from "@brew-haven/domain";
import type { PlatformClaims, StaffClaims } from "../auth.js";
import { withTx, type Db } from "../db/client.js";
import { outlets, platformCounters, subscriptionInvoices, tenants } from "../db/schema.js";
import { AppError, notFound } from "../errors.js";
import { recordAudit } from "./audit.js";

/** GST on software subscriptions (SAC 998314 / 997331): 18%. */
export const SUBSCRIPTION_GST_BPS = 1800;

/** Brew Haven as the seller. Set from the environment once the company's GST registration is known. */
export interface BrewHavenSeller {
  legalName: string;
  gstin: string | null;
  address: string | null;
  email: string | null;
}

const istDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);
const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** The same day next month (or year), less a day: 15 Nov → 14 Dec. Month ends clamp: 31 Jan → 28 Feb. */
export function periodEnd(from: string, period: "MONTH" | "YEAR"): string {
  const [y, m, d] = from.split("-").map(Number) as [number, number, number];
  const ty = period === "YEAR" ? y + 1 : m === 12 ? y + 1 : y;
  const tm = period === "YEAR" ? m : (m % 12) + 1;
  const last = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
  const next = `${ty}-${String(tm).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
  return addDays(next, d > last ? 0 : -1);
}

/**
 * The GST split. Same state (the first two digits of both GSTINs) is CGST + SGST; different states
 * is IGST. A buyer without a GSTIN is taken to be in the seller's state. A seller without a GSTIN
 * charges no GST.
 */
export function subscriptionTax(taxablePaise: number, sellerGstin: string | null, buyerGstin: string | null) {
  if (!sellerGstin) return { cgstPaise: 0, sgstPaise: 0, igstPaise: 0 };
  const interState = !!buyerGstin && buyerGstin.slice(0, 2) !== sellerGstin.slice(0, 2);
  if (interState) return { cgstPaise: 0, sgstPaise: 0, igstPaise: Math.round((taxablePaise * SUBSCRIPTION_GST_BPS) / 10_000) };
  const half = Math.round((taxablePaise * SUBSCRIPTION_GST_BPS) / 2 / 10_000);
  return { cgstPaise: half, sgstPaise: half, igstPaise: 0 };
}

const endOfDayIst = (day: string) => new Date(`${day}T23:59:59.999+05:30`);
const METHODS = { UPI: "UPI", BANK: "Bank transfer", CARD: "Card", CASH: "Cash" } as const;

/**
 * Brew Haven records a café's payment for its plan: the paid period moves on by a month or a year
 * (from the later of today and the current end), and an invoice is issued for it.
 */
export async function recordSubscriptionPayment(
  db: Db,
  seller: BrewHavenSeller,
  who: PlatformClaims,
  tenantId: string,
  body: { period: "MONTH" | "YEAR"; method: keyof typeof METHODS; reference?: string | undefined; paidOn?: string | undefined },
  ip: string,
  now = new Date(),
) {
  return withTx(db, async (tx) => {
    const [t] = await tx.select().from(tenants).where(eq(tenants.id, tenantId)).for("update");
    if (!t) throw notFound("Business");
    const plan = planOf(t.plan);
    const today = istDay(now);
    const currentEnd = t.paidUntil ? istDay(t.paidUntil) : null;
    const from = currentEnd && currentEnd >= today ? addDays(currentEnd, 1) : today;
    const to = periodEnd(from, body.period);
    const taxablePaise = body.period === "YEAR" ? plan.yearlyPaise : plan.monthlyPaise;

    const [first] = await tx.select({ address: outlets.address, name: outlets.name }).from(outlets).where(eq(outlets.tenantId, t.id)).orderBy(asc(outlets.createdAt)).limit(1);
    const billing = t.billing ?? {};
    const buyer = {
      name: String((t.branding as { displayName?: string }).displayName ?? t.name),
      legalName: billing.legalName || null,
      gstin: billing.gstin || null,
      address: first?.address ?? null,
      email: t.contact.email ?? null,
    };
    const tax = subscriptionTax(taxablePaise, seller.gstin, buyer.gstin);

    const fy = financialYear(today);
    const series = `BH${fy}`;
    const [c] = await tx
      .insert(platformCounters)
      .values({ series, lastSeq: 1 })
      .onConflictDoUpdate({ target: platformCounters.series, set: { lastSeq: sql`${platformCounters.lastSeq} + 1` } })
      .returning();
    const number = formatInvoiceNo("BH", fy, c!.lastSeq);

    const [inv] = await tx
      .insert(subscriptionInvoices)
      .values({
        tenantId: t.id,
        number,
        issuedOn: today,
        plan: plan.id,
        period: body.period,
        periodFrom: from,
        periodTo: to,
        taxablePaise,
        ...tax,
        totalPaise: taxablePaise + tax.cgstPaise + tax.sgstPaise + tax.igstPaise,
        seller: { ...seller, stateCode: seller.gstin?.slice(0, 2) ?? null },
        buyer,
        payment: { method: METHODS[body.method], reference: body.reference?.trim() || null, paidOn: body.paidOn ?? today },
        createdBy: who.name,
      })
      .returning();
    await tx.update(tenants).set({ paidUntil: endOfDayIst(to) }).where(eq(tenants.id, t.id));
    await recordAudit(tx as unknown as Db, {
      tenantId: t.id,
      actorId: null,
      actorName: `Brew Haven (${who.name})`,
      action: "platform.billing",
      summary: `Brew Haven recorded a payment of ${formatInr(inv!.totalPaise)} for the ${plan.name} plan, ${from} to ${to}: invoice ${number}`,
      ip,
    });
    return toView(inv!);
  });
}

type InvoiceRow = typeof subscriptionInvoices.$inferSelect;
export function toView(r: InvoiceRow) {
  return {
    id: r.id,
    number: r.number,
    issuedOn: r.issuedOn,
    kind: r.seller.gstin ? ("TAX_INVOICE" as const) : ("INVOICE" as const),
    plan: PLANS[r.plan as PlanId]?.name ?? r.plan,
    period: r.period,
    periodFrom: r.periodFrom,
    periodTo: r.periodTo,
    taxablePaise: r.taxablePaise,
    taxRateBps: r.seller.gstin ? SUBSCRIPTION_GST_BPS : 0,
    cgstPaise: r.cgstPaise,
    sgstPaise: r.sgstPaise,
    igstPaise: r.igstPaise,
    totalPaise: r.totalPaise,
    seller: r.seller,
    buyer: r.buyer,
    payment: r.payment,
  };
}
export type SubscriptionInvoiceView = ReturnType<typeof toView>;

/** The owner's own invoices from Brew Haven, newest first. */
export async function ownerSubscriptionInvoices(db: Db, staff: StaffClaims) {
  if (staff.role !== "ADMIN") throw new AppError("FORBIDDEN", "Only the owner can see Brew Haven's invoices");
  const rows = await db.select().from(subscriptionInvoices).where(eq(subscriptionInvoices.tenantId, staff.tenantId)).orderBy(desc(subscriptionInvoices.createdAt));
  return { invoices: rows.map(toView) };
}

/** Brew Haven's team: one business's invoices. */
export async function businessSubscriptionInvoices(db: Db, tenantId: string) {
  const rows = await db.select().from(subscriptionInvoices).where(eq(subscriptionInvoices.tenantId, tenantId)).orderBy(desc(subscriptionInvoices.createdAt));
  return { invoices: rows.map(toView) };
}
