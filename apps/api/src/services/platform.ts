import { and, count, eq, gte, inArray, max, sum } from "drizzle-orm";
import { PLANS, type PlanId, billingStatus, formatInr, planOf } from "@brew-haven/domain";
import { type AttemptLimiter, type PlatformClaims, type PlatformTokens, verifyPin } from "../auth.js";
import type { Db } from "../db/client.js";
import { orders, outlets, platformAdmins, staffUsers, tenants } from "../db/schema.js";
import { AppError, notFound } from "../errors.js";
import { recordAudit } from "./audit.js";

const SOLD = ["PLACED", "PREPARING", "ACTION_REQUIRED", "READY", "COLLECTED"];

/** Sign-in for Brew Haven's own team, by email and password. */
export async function platformLogin(db: Db, tokens: PlatformTokens, limiter: AttemptLimiter, input: { email: string; password: string }, ip: string) {
  const email = input.email.trim().toLowerCase();
  const key = `platform|${email}|${ip}`;
  const personKey = `platform|${email}`;
  limiter.check(key);
  limiter.check(personKey, Date.now(), 20);
  const [admin] = await db.select().from(platformAdmins).where(and(eq(platformAdmins.email, email), eq(platformAdmins.active, true)));
  if (!admin || !(await verifyPin(input.password, admin.passwordHash))) {
    limiter.fail(key);
    limiter.fail(personKey, Date.now(), 60 * 60 * 1000);
    throw new AppError("UNAUTHORIZED", "That email or password is not right");
  }
  limiter.reset(key);
  limiter.reset(personKey);
  const token = await tokens.issue({ sub: admin.id, email: admin.email, name: admin.name });
  return { token, name: admin.name, email: admin.email };
}

/**
 * Every business on Brew Haven, with totals only: plan, cafés, team, orders and sales in the last 30
 * days, last order. No customer details, because each café owns its customers' data.
 */
export async function listBusinesses(db: Db) {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const all = await db.select().from(tenants).orderBy(tenants.createdAt);
  const ids = all.map((t) => t.id);
  if (!ids.length) return { businesses: [] };
  const cafes = await db.select({ tenantId: outlets.tenantId, name: outlets.name, isOpen: outlets.isOpen }).from(outlets).where(inArray(outlets.tenantId, ids)).orderBy(outlets.name);
  const team = await db.select({ tenantId: staffUsers.tenantId, n: count() }).from(staffUsers).where(and(inArray(staffUsers.tenantId, ids), eq(staffUsers.active, true))).groupBy(staffUsers.tenantId);
  const recent = await db
    .select({ tenantId: orders.tenantId, n: count(), salesPaise: sum(orders.totalPaise) })
    .from(orders)
    .where(and(inArray(orders.tenantId, ids), inArray(orders.state, SOLD), gte(orders.placedAt, since)))
    .groupBy(orders.tenantId);
  const last = await db.select({ tenantId: orders.tenantId, at: max(orders.placedAt) }).from(orders).where(inArray(orders.tenantId, ids)).groupBy(orders.tenantId);
  const by = <T extends { tenantId: string }>(rows: T[]) => new Map(rows.map((r) => [r.tenantId, r]));
  const teamBy = by(team);
  const recentBy = by(recent);
  const lastBy = by(last);
  return {
    businesses: all.map((t) => ({
      id: t.id,
      slug: t.slug,
      name: t.name,
      plan: t.plan,
      planName: PLANS[t.plan as PlanId]?.name ?? t.plan,
      monthlyPaise: planOf(t.plan).monthlyPaise,
      billing: billingStatus({ trialEndsAt: t.trialEndsAt, paidUntil: t.paidUntil }),
      suspended: t.suspendedAt !== null,
      demo: t.demoData,
      createdAt: t.createdAt.toISOString(),
      contact: t.contact,
      cafes: cafes.filter((c) => c.tenantId === t.id).map((c) => ({ name: c.name, isOpen: c.isOpen })),
      team: teamBy.get(t.id)?.n ?? 0,
      ordersLast30Days: recentBy.get(t.id)?.n ?? 0,
      salesLast30DaysPaise: Number(recentBy.get(t.id)?.salesPaise ?? 0),
      lastOrderAt: lastBy.get(t.id)?.at?.toISOString() ?? null,
    })),
  };
}

/** The end of a day in India, as a moment: a business paid "until 31 Dec" can use all of that day. */
const endOfDayIst = (day: string) => new Date(`${day}T23:59:59.999+05:30`);
const dayLabel = (day: string) => new Date(`${day}T12:00:00+05:30`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

/**
 * Changes a business's plan, records a payment or a trial change, or pauses or resumes it. The change is written to the business's own
 * activity log, so its owner can see what Brew Haven changed and when.
 */
export async function updateBusiness(db: Db, who: PlatformClaims, id: string, body: { plan?: string | undefined; suspended?: boolean | undefined; paidUntil?: string | null | undefined; trialEndsOn?: string | null | undefined }, ip: string) {
  if (body.plan !== undefined && !(body.plan in PLANS)) throw new AppError("VALIDATION", "No such plan");
  const [t] = await db.select().from(tenants).where(eq(tenants.id, id));
  if (!t) throw notFound("Business");
  const notes: string[] = [];
  const patch: Partial<typeof tenants.$inferInsert> = {};
  if (body.plan !== undefined && body.plan !== t.plan) {
    patch.plan = body.plan;
    notes.push(`Brew Haven moved the business to the ${PLANS[body.plan as PlanId].name} plan`);
  }
  const notesBilling: string[] = [];
  if (body.paidUntil !== undefined) {
    patch.paidUntil = body.paidUntil === null ? null : endOfDayIst(body.paidUntil);
    notesBilling.push(body.paidUntil === null ? "Brew Haven cleared the paid-until date" : `Brew Haven recorded a payment: paid until ${dayLabel(body.paidUntil)} (${planOf(patch.plan ?? t.plan).name}, ${formatInr(planOf(patch.plan ?? t.plan).monthlyPaise)} a month)`);
  }
  if (body.trialEndsOn !== undefined) {
    patch.trialEndsAt = body.trialEndsOn === null ? null : endOfDayIst(body.trialEndsOn);
    notesBilling.push(body.trialEndsOn === null ? "Brew Haven ended the free trial" : `Brew Haven set the free trial to end on ${dayLabel(body.trialEndsOn)}`);
  }
  notes.push(...notesBilling);
  if (body.suspended !== undefined && body.suspended !== (t.suspendedAt !== null)) {
    patch.suspendedAt = body.suspended ? new Date() : null;
    notes.push(body.suspended ? "Brew Haven paused the account: no new orders until it is resumed" : "Brew Haven resumed the account");
  }
  if (!notes.length) return { id, changed: false };
  await db.update(tenants).set(patch).where(eq(tenants.id, id));
  for (const summary of notes)
    await recordAudit(db, { tenantId: id, actorId: null, actorName: `Brew Haven (${who.name})`, action: notesBilling.includes(summary) ? "platform.billing" : summary.includes(" plan") ? "platform.plan" : "platform.suspend", summary, ip });
  return { id, changed: true };
}
