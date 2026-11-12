import { and, count, eq, gte, inArray, max, sum } from "drizzle-orm";
import { PLANS, type PlanId } from "@brew-haven/domain";
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
  limiter.check(key);
  const [admin] = await db.select().from(platformAdmins).where(and(eq(platformAdmins.email, email), eq(platformAdmins.active, true)));
  if (!admin || !(await verifyPin(input.password, admin.passwordHash))) {
    limiter.fail(key);
    throw new AppError("UNAUTHORIZED", "That email or password is not right");
  }
  limiter.reset(key);
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

/**
 * Changes a business's plan, or pauses or resumes it. The change is written to the business's own
 * activity log, so its owner can see what Brew Haven changed and when.
 */
export async function updateBusiness(db: Db, who: PlatformClaims, id: string, body: { plan?: string | undefined; suspended?: boolean | undefined }, ip: string) {
  if (body.plan !== undefined && !(body.plan in PLANS)) throw new AppError("VALIDATION", "No such plan");
  const [t] = await db.select().from(tenants).where(eq(tenants.id, id));
  if (!t) throw notFound("Business");
  const notes: string[] = [];
  const patch: Partial<typeof tenants.$inferInsert> = {};
  if (body.plan !== undefined && body.plan !== t.plan) {
    patch.plan = body.plan;
    notes.push(`Brew Haven moved the business to the ${PLANS[body.plan as PlanId].name} plan`);
  }
  if (body.suspended !== undefined && body.suspended !== (t.suspendedAt !== null)) {
    patch.suspendedAt = body.suspended ? new Date() : null;
    notes.push(body.suspended ? "Brew Haven paused the account: no new orders until it is resumed" : "Brew Haven resumed the account");
  }
  if (!notes.length) return { id, changed: false };
  await db.update(tenants).set(patch).where(eq(tenants.id, id));
  for (const summary of notes)
    await recordAudit(db, { tenantId: id, actorId: null, actorName: `Brew Haven (${who.name})`, action: summary.includes("plan") ? "platform.plan" : "platform.suspend", summary, ip });
  return { id, changed: true };
}
