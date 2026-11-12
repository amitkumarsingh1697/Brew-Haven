import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { formatInr } from "@brew-haven/domain";
import type { StaffClaims } from "../auth.js";
import type { Db } from "../db/client.js";
import { customers, notifications, orders, outlets, refunds, tenants } from "../db/schema.js";
import { AppError } from "../errors.js";
import { PermanentSendError, render, type Notifier, type StatusUpdate, type TemplateName } from "../notify/provider.js";

export interface NotifyDeps {
  db: Db;
  notifier: Notifier;
  customerAppUrl: string;
}

const money = (paise: number) => formatInr(paise).replace(".00", "");

/**
 * Sends the customer message for an order state change, at most once per outbox job.
 * Only states the customer needs to act on or hear about produce a message.
 */
export async function notifyCustomer(deps: NotifyDeps, outboxId: number, orderId: string, state: string) {
  const [row] = await deps.db
    .select({ order: orders, outlet: outlets, tenant: tenants, customer: customers })
    .from(orders)
    .innerJoin(outlets, eq(outlets.id, orders.outletId))
    .innerJoin(tenants, eq(tenants.id, orders.tenantId))
    .leftJoin(customers, eq(customers.id, orders.customerId))
    .where(eq(orders.id, orderId));
  if (!row?.customer) return "no-customer";
  const { order, outlet, tenant, customer } = row;
  const first = customer.name.split(" ")[0] || customer.name;
  const code = order.pickupCode ?? "";
  const cafe = `${(tenant.branding as { displayName?: string } | null)?.displayName ?? tenant.name} ${outlet.name}`;
  const track = `${deps.customerAppUrl.replace(/\/$/, "")}/order/${order.trackingToken}`;

  let template: TemplateName;
  let params: string[];
  if (state === "PLACED" && order.channel === "ONLINE") {
    template = "order_confirmed";
    params = [first, code, cafe, money(order.totalPaise), track];
  } else if (state === "READY") {
    template = "order_ready";
    params = [first, code, outlet.name];
  } else if (state === "ACTION_REQUIRED") {
    template = "order_action_required";
    params = [first, code, track];
  } else if (state === "CANCELLED" && order.pickupCode) {
    const refs = await deps.db.select({ a: refunds.amountPaise }).from(refunds).where(and(eq(refunds.orderId, order.id), ne(refunds.status, "FAILED")));
    const refunded = refs.reduce((s, r) => s + r.a, 0);
    template = "order_cancelled";
    params = [first, code, cafe, order.cancelReason ?? "the café couldn't prepare it", refunded > 0 ? `Your refund of ${money(refunded)} is on its way.` : "You have not been charged."];
  } else {
    return "not-needed";
  }

  const body = render(template, params);
  const inserted = await deps.db
    .insert(notifications)
    .values({ tenantId: order.tenantId, orderId: order.id, outboxId, provider: deps.notifier.name, toPhone: customer.phone, template, body, status: "QUEUED" })
    .onConflictDoNothing({ target: notifications.outboxId })
    .returning();
  let n = inserted[0];
  if (!n) {
    [n] = await deps.db.select().from(notifications).where(eq(notifications.outboxId, outboxId));
    if (n && n.status !== "QUEUED" && n.status !== "FAILED") return "already-sent";
  }
  try {
    const r = await deps.notifier.send({ to: customer.phone, template, params, text: body });
    await deps.db
      .update(notifications)
      .set({ status: deps.notifier.delivers ? "SENT" : "LOGGED", providerMessageId: r.providerMessageId, error: null, sentAt: new Date() })
      .where(eq(notifications.id, n!.id));
    return deps.notifier.delivers ? "sent" : "logged";
  } catch (e) {
    const permanent = e instanceof PermanentSendError;
    await deps.db.update(notifications).set({ status: permanent ? "REJECTED" : "FAILED", error: String(e).slice(0, 500) }).where(eq(notifications.id, n!.id));
    if (permanent) return "rejected"; // retrying won't help, so the job is done
    throw e; // the outbox retries with backoff
  }
}

/** Which statuses each delivery update may move a message on from: never backwards (read, then a late "delivered"). */
const MOVES_FROM: Record<StatusUpdate["status"], Array<(typeof notifications.$inferSelect)["status"]>> = {
  SENT: ["QUEUED", "FAILED"],
  DELIVERED: ["QUEUED", "FAILED", "SENT"],
  READ: ["QUEUED", "FAILED", "SENT", "DELIVERED"],
  REJECTED: ["QUEUED", "FAILED", "SENT"],
};

/** Applies WhatsApp's delivery updates to the message log. Unknown message ids are ignored. */
export async function applyDeliveryUpdates(db: Db, updates: StatusUpdate[]) {
  let changed = 0;
  for (const u of updates) {
    const r = await db
      .update(notifications)
      .set({ status: u.status, ...(u.error ? { error: u.error.slice(0, 500) } : {}) })
      .where(and(eq(notifications.providerMessageId, u.providerMessageId), inArray(notifications.status, MOVES_FROM[u.status])))
      .returning({ id: notifications.id });
    changed += r.length;
  }
  return changed;
}

const mask = (phone: string) => `••••••${phone.slice(-4)}`;

export async function listNotifications(db: Db, staff: StaffClaims, limit = 100) {
  if (staff.role !== "ADMIN") throw new AppError("FORBIDDEN", "Only the owner can see customer messages");
  const rows = await db
    .select({ n: notifications, code: orders.pickupCode, outlet: outlets.name })
    .from(notifications)
    .innerJoin(orders, eq(orders.id, notifications.orderId))
    .innerJoin(outlets, eq(outlets.id, orders.outletId))
    .where(eq(notifications.tenantId, staff.tenantId))
    .orderBy(desc(notifications.createdAt))
    .limit(Math.min(Math.max(limit, 1), 200));
  return rows.map(({ n, code, outlet }) => ({
    id: n.id,
    at: n.createdAt.toISOString(),
    to: mask(n.toPhone),
    orderCode: code,
    outlet,
    template: n.template,
    body: n.body,
    status: n.status,
    provider: n.provider,
    error: n.error,
  }));
}
