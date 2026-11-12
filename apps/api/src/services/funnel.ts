import { and, asc, countDistinct, eq, gte, inArray, isNotNull, lt } from "drizzle-orm";
import type { StaffClaims } from "../auth.js";
import type { Db } from "../db/client.js";
import { orders, outlets, visitEvents } from "../db/schema.js";
import { AppError } from "../errors.js";
import { loadTenantOutlet } from "./catalog.js";

export const VISIT_STEPS = ["open", "menu", "add", "checkout", "pay"] as const;
export type VisitStep = (typeof VISIT_STEPS)[number];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Records one anonymous step of a visit. Repeats of the same step in a visit are ignored. */
export async function recordVisitStep(db: Db, tenantSlug: string, outletSlug: string, body: { visit?: unknown; kind?: unknown }) {
  const visit = typeof body.visit === "string" && /^[A-Za-z0-9_-]{8,40}$/.test(body.visit) ? body.visit : null;
  const kind = VISIT_STEPS.includes(body.kind as VisitStep) ? (body.kind as VisitStep) : null;
  if (!visit || !kind) throw new AppError("VALIDATION", "Unknown event");
  const { tenant, outlet } = await loadTenantOutlet(db, tenantSlug, outletSlug);
  await db.insert(visitEvents).values({ tenantId: tenant.id, outletId: outlet.id, visit, kind }).onConflictDoNothing();
}

/**
 * The online ordering funnel for a date range: how many visits reached each step, and how many
 * online orders were paid. Counts only; nothing here identifies a customer.
 */
export async function orderingFunnel(db: Db, staff: StaffClaims, q: { from?: string | undefined; to?: string | undefined; outletId?: string | undefined }) {
  if (staff.role !== "ADMIN") throw new AppError("FORBIDDEN", "Only the owner can see reports");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  const to = q.to && DAY.test(q.to) ? q.to : today;
  const from = q.from && DAY.test(q.from) ? q.from : to;
  if (from > to) throw new AppError("VALIDATION", "The start date is after the end date");
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > 92) throw new AppError("VALIDATION", "Choose a range of up to 3 months");
  const start = new Date(`${from}T00:00:00+05:30`);
  const end = new Date(new Date(`${to}T00:00:00+05:30`).getTime() + 86_400_000);
  const cafes = await db.select({ id: outlets.id }).from(outlets).where(eq(outlets.tenantId, staff.tenantId)).orderBy(asc(outlets.name));
  const ids = q.outletId ? cafes.filter((c) => c.id === q.outletId).map((c) => c.id) : cafes.map((c) => c.id);
  if (!ids.length) throw new AppError("NOT_FOUND", "Café not found");

  const rows = await db
    .select({ kind: visitEvents.kind, visits: countDistinct(visitEvents.visit) })
    .from(visitEvents)
    .where(and(eq(visitEvents.tenantId, staff.tenantId), inArray(visitEvents.outletId, ids), gte(visitEvents.at, start), lt(visitEvents.at, end)))
    .groupBy(visitEvents.kind);
  const by = new Map(rows.map((r) => [r.kind, Number(r.visits)]));
  const [paid] = await db
    .select({ n: countDistinct(orders.id) })
    .from(orders)
    .where(and(eq(orders.tenantId, staff.tenantId), inArray(orders.outletId, ids), eq(orders.channel, "ONLINE"), isNotNull(orders.placedAt), gte(orders.placedAt, start), lt(orders.placedAt, end)));
  // Anyone who reached the menu also opened the café, even if they came straight to the menu link.
  const [o] = await db
    .select({ n: countDistinct(visitEvents.visit) })
    .from(visitEvents)
    .where(and(eq(visitEvents.tenantId, staff.tenantId), inArray(visitEvents.outletId, ids), inArray(visitEvents.kind, ["open", "menu"]), gte(visitEvents.at, start), lt(visitEvents.at, end)));
  const opened = Number(o?.n ?? 0);
  const steps = [
    { step: "open", label: "Opened the café page", visits: opened },
    { step: "menu", label: "Looked at the menu", visits: by.get("menu") ?? 0 },
    { step: "add", label: "Added something", visits: by.get("add") ?? 0 },
    { step: "checkout", label: "Went to checkout", visits: by.get("checkout") ?? 0 },
    { step: "pay", label: "Started paying", visits: by.get("pay") ?? 0 },
    { step: "paid", label: "Paid orders", visits: Number(paid?.n ?? 0) },
  ];
  return { from, to, steps, conversionPct: opened ? Math.round((Number(paid?.n ?? 0) / opened) * 1000) / 10 : null };
}
