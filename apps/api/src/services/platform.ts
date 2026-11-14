import { and, count, eq, gte, inArray, max, sum } from "drizzle-orm";
import { PLANS, type PlanId, billingStatus, formatInr, planOf } from "@brew-haven/domain";
import { type AttemptLimiter, type PlatformClaims, type PlatformTokens, verifyPin } from "../auth.js";
import { hashRecoveryCode, newRecoveryCodes, newTotpSecret, openSecret, otpauthUrl, sealSecret, verifyTotp } from "../totp.js";
import type { Db } from "../db/client.js";
import { orders, outlets, platformAdmins, staffUsers, tenants } from "../db/schema.js";
import { AppError, notFound } from "../errors.js";
import { recordAudit } from "./audit.js";

const SOLD = ["PLACED", "PREPARING", "ACTION_REQUIRED", "READY", "COLLECTED", "NOT_COLLECTED"];

/**
 * Sign-in for Brew Haven's own team: email and password, then, once two-step sign-in is on, a code
 * from their authenticator app (or a one-time recovery code). The first step then returns only a
 * short-lived ticket for the second.
 */
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
  if (admin.totpEnabledAt) return { step: "CODE" as const, ticket: await tokens.issueCodeTicket(admin.id) };
  const token = await tokens.issue({ sub: admin.id, email: admin.email, name: admin.name, mfa: false });
  return { step: "DONE" as const, token, name: admin.name, email: admin.email, twoStep: false };
}

/** The second step: an authenticator code, or one of the recovery codes (each works once). */
export async function platformLoginCode(db: Db, tokens: PlatformTokens, limiter: AttemptLimiter, serverSecret: string, input: { ticket: string; code: string }) {
  const adminId = await tokens.verifyCodeTicket(input.ticket);
  const key = `platform-code|${adminId}`;
  limiter.check(key);
  const [admin] = await db.select().from(platformAdmins).where(and(eq(platformAdmins.id, adminId), eq(platformAdmins.active, true)));
  if (!admin?.totpSecret) throw new AppError("UNAUTHORIZED", "Sign in again.");
  const code = input.code.trim();
  let ok = false;
  if (/^\d[\d\s]{5,7}$/.test(code)) {
    const step = verifyTotp(openSecret(admin.totpSecret, serverSecret), code, Date.now(), admin.totpLastStep);
    if (step !== null) {
      await db.update(platformAdmins).set({ totpLastStep: step }).where(eq(platformAdmins.id, admin.id));
      ok = true;
    }
  } else {
    const h = hashRecoveryCode(code);
    if (admin.recoveryCodeHashes.includes(h)) {
      await db
        .update(platformAdmins)
        .set({ recoveryCodeHashes: admin.recoveryCodeHashes.filter((x) => x !== h) })
        .where(eq(platformAdmins.id, admin.id));
      ok = true;
    }
  }
  if (!ok) {
    limiter.fail(key);
    throw new AppError("UNAUTHORIZED", "That code is not right. Check the time on your phone, or use a recovery code.");
  }
  limiter.reset(key);
  const token = await tokens.issue({ sub: admin.id, email: admin.email, name: admin.name, mfa: true });
  return { step: "DONE" as const, token, name: admin.name, email: admin.email, twoStep: true };
}

/** Starts turning on two-step sign-in: a new secret to scan, kept aside until a code confirms it. */
export async function startTwoStep(db: Db, who: PlatformClaims, serverSecret: string) {
  const [admin] = await db.select({ on: platformAdmins.totpEnabledAt }).from(platformAdmins).where(eq(platformAdmins.id, who.sub));
  // Moving to a new phone needs a session that already passed the code step.
  if (admin?.on && !who.mfa) throw new AppError("FORBIDDEN", "Two-step sign-in is already on. Sign in with a code first.");
  const secret = newTotpSecret();
  await db.update(platformAdmins).set({ totpPendingSecret: sealSecret(secret, serverSecret) }).where(eq(platformAdmins.id, who.sub));
  return { secret, otpauthUrl: otpauthUrl(secret, who.email) };
}

/** Confirms the scanned secret with a first code, turns two-step sign-in on, and hands out recovery codes once. */
export async function confirmTwoStep(db: Db, tokens: PlatformTokens, who: PlatformClaims, serverSecret: string, code: string) {
  const [admin] = await db.select().from(platformAdmins).where(eq(platformAdmins.id, who.sub));
  if (!admin?.totpPendingSecret) throw new AppError("CONFLICT", "Start again: scan a new QR code first.");
  const secret = openSecret(admin.totpPendingSecret, serverSecret);
  const step = verifyTotp(secret, code, Date.now(), null);
  if (step === null) throw new AppError("VALIDATION", "That code is not right. Check the time on your phone and try the newest code.");
  const recoveryCodes = newRecoveryCodes();
  await db
    .update(platformAdmins)
    .set({ totpSecret: admin.totpPendingSecret, totpPendingSecret: null, totpEnabledAt: new Date(), totpLastStep: step, recoveryCodeHashes: recoveryCodes.map(hashRecoveryCode) })
    .where(eq(platformAdmins.id, admin.id));
  const token = await tokens.issue({ sub: admin.id, email: admin.email, name: admin.name, mfa: true });
  return { recoveryCodes, token };
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
