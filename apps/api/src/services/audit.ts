import { and, desc, eq, inArray, lt } from "drizzle-orm";
import type { StaffClaims } from "../auth.js";
import type { Db } from "../db/client.js";
import { auditLog, menuItems, orders, outlets, staffUsers } from "../db/schema.js";
import { AppError } from "../errors.js";

/**
 * The audit trail: a plain-language record of who changed what. It is written after a
 * successful staff or owner change (see the hooks in app.ts), never inside the change's own
 * transaction, so a failure to audit can't block service at the counter.
 */
export interface AuditInput {
  tenantId: string;
  actorId: string | null;
  actorName: string;
  action: string;
  summary: string;
  outletId?: string | null;
  targetId?: string | null;
  meta?: Record<string, unknown> | null;
  ip?: string | null;
}

export async function recordAudit(db: Db, e: AuditInput) {
  await db.insert(auditLog).values({
    tenantId: e.tenantId,
    actorId: e.actorId,
    actorName: e.actorName,
    action: e.action,
    summary: e.summary.slice(0, 300),
    outletId: e.outletId ?? null,
    targetId: e.targetId ?? null,
    meta: e.meta ?? null,
    ip: e.ip ?? null,
  });
}

type Obj = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");
const ACTION_WORDS: Record<string, string> = { START: "Started", MARK_READY: "Marked ready", HAND_OVER: "Handed over" };
const METHOD_WORDS: Record<string, string> = { CASH: "cash", UPI_COUNTER: "UPI at counter", CARD_COUNTER: "card at counter" };

const rupees = (p: number) => `₹${(p / 100).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

/** "cash ₹200 (received ₹500, change ₹300)", "card at counter ₹200, ref 1234". */
function paidWords(body: Obj, totalPaise: number) {
  const how = METHOD_WORDS[str(body.method)] ?? str(body.method);
  const tendered = typeof body.tenderedPaise === "number" ? body.tenderedPaise : null;
  if (tendered !== null) return `${how} ${rupees(totalPaise)} (received ${rupees(tendered)}, change ${rupees(Math.max(0, tendered - totalPaise))})`;
  const ref = str(body.cardReference) || str(body.upiReference);
  return `${how} ${rupees(totalPaise)}${ref ? `, ref ${ref}` : ""}`;
}

/** Never store secrets in the trail. */
export function scrub(body: unknown): Obj | null {
  if (!body || typeof body !== "object") return null;
  const out: Obj = {};
  for (const [k, v] of Object.entries(body as Obj)) out[k] = /pin|password|secret|token/i.test(k) ? "•••" : v;
  return out;
}

/**
 * Turns a successful request into an audit entry. `route` is the route pattern, `result` is the
 * object the route returned. Returns null for requests that aren't worth recording.
 */
export async function describe(
  db: Db,
  staff: StaffClaims,
  method: string,
  route: string,
  params: Obj,
  body: Obj,
  result: Obj,
): Promise<Omit<AuditInput, "tenantId" | "actorId" | "actorName" | "ip"> | null> {
  const id = str(params.id) || null;
  const code = str(result.pickupCode);
  const orderId = str(result.id) || id;
  const outletOfOrder = route.startsWith("/v1/staff/orders/:id") && orderId ? (await db.select({ o: orders.outletId }).from(orders).where(eq(orders.id, orderId)))[0]?.o : undefined;
  const itemName = async (itemId: string) => (await db.select({ name: menuItems.name }).from(menuItems).where(eq(menuItems.id, itemId)))[0]?.name ?? "an item";
  const outletName = async (outletId: string) => (await db.select({ name: outlets.name }).from(outlets).where(eq(outlets.id, outletId)))[0]?.name ?? "a café";
  const key = `${method} ${route}`;
  switch (key) {
    case "POST /v1/staff/orders/:id/actions":
      return { action: `order.${str(body.action).toLowerCase()}`, summary: `${ACTION_WORDS[str(body.action)] ?? str(body.action)} order ${code}`, targetId: id, outletId: outletOfOrder };
    case "POST /v1/staff/orders/:id/reject":
      return { action: "order.reject", summary: `Rejected order ${code}: ${str(body.reason)}`, targetId: id, outletId: outletOfOrder };
    case "POST /v1/staff/orders/:id/flag-unavailable":
      return { action: "order.flag_unavailable", summary: `Marked items unavailable on order ${code}`, targetId: id, outletId: outletOfOrder };
    case "POST /v1/staff/orders/walk-in":
      return { action: "order.walk_in", summary: `Took counter order ${code} (${paidWords(body, Number(result.totalPaise ?? 0))})`, targetId: str(result.id), outletId: str(body.outletId) };
    case "POST /v1/staff/orders/counter": {
      const order = (result.order ?? {}) as Obj;
      return { action: "order.counter_place", summary: `Placed an order for a customer at the counter, ${rupees(Number(order.totalPaise ?? 0))} waiting for payment`, targetId: str(order.id), outletId: str(body.outletId) };
    }
    case "POST /v1/staff/orders/:id/mark-paid":
      return { action: "order.mark_paid", summary: `Marked order ${code} paid: ${paidWords(body, Number(result.totalPaise ?? 0))}`, targetId: id, outletId: outletOfOrder };
    case "POST /v1/staff/orders/:id/void":
      return { action: "order.void_unpaid", summary: `Cancelled an unpaid counter order: ${str(body.reason)}`, targetId: id, outletId: outletOfOrder };
    case "PUT /v1/staff/stock": {
      const name = await itemName(str(body.itemId));
      const count = typeof body.stockCount === "number" ? `, ${body.stockCount} left` : "";
      return { action: "stock.update", summary: `${body.available ? "Marked available" : "Marked sold out"}: ${name}${count}`, targetId: str(body.itemId), outletId: str(body.outletId) };
    }
    case "POST /v1/staff/close": {
      const v = Number(result.variancePaise ?? 0);
      const r = (p: number) => `₹${(Math.abs(p) / 100).toLocaleString("en-IN")}`;
      const diff = v === 0 ? "cash matched" : v < 0 ? `cash short by ${r(v)}` : `cash over by ${r(v)}`;
      return { action: "day.close", summary: `Closed the day: counted ${r(Number(result.countedCashPaise ?? 0))}, ${diff}`, targetId: str(result.id), outletId: str(body.outletId) };
    }
    case "POST /v1/staff/inventory/movements": {
      const amount = `${Math.abs(Number(result.change ?? 0))} ${str(result.unit)}`;
      const what = body.kind === "RECEIVE" ? `Received ${amount} of` : body.kind === "WASTE" ? `Wasted ${amount} of` : `Counted`;
      const tail = body.kind === "COUNT" ? `: ${Number(result.onHand ?? 0)} ${str(result.unit)} on the shelf` : "";
      return { action: `inventory.${str(body.kind).toLowerCase()}`, summary: `${what} ${str(result.ingredient)}${tail}`, targetId: str(body.ingredientId), outletId: str(body.outletId) };
    }
    case "POST /v1/admin/ingredients":
      return { action: "ingredient.create", summary: `Added ingredient ${str(result.name)}`, targetId: str(result.id) };
    case "PATCH /v1/admin/ingredients/:id":
      return { action: "ingredient.update", summary: `${body.active === false ? "Retired" : "Edited"} ingredient ${str(result.name)}`, targetId: id };
    case "PUT /v1/admin/recipes/:itemId":
      return { action: "recipe.update", summary: `Updated the recipe for ${str(result.name)}`, targetId: str(params.itemId) };
    case "PUT /v1/admin/low-stock":
      return { action: "inventory.low_level", summary: "Changed a low-stock level", targetId: str(body.ingredientId), outletId: str(body.outletId) };
    case "PUT /v1/admin/settings":
      return { action: "settings.update", summary: "Updated café settings" };
    case "POST /v1/admin/outlets":
      return { action: "outlet.create", summary: `Added café ${str(result.name)} (orders ${str(result.pickupPrefix)}-001…)`, targetId: str(result.id), outletId: str(result.id) };
    case "PATCH /v1/admin/outlets/:id":
      if (typeof body.isOpen === "boolean") return { action: body.isOpen ? "outlet.open" : "outlet.close", summary: `${body.isOpen ? "Opened" : "Closed"} ${str(result.name)} for orders`, targetId: id, outletId: id };
      return { action: "outlet.update", summary: `Edited café ${str(result.name)}`, targetId: id, outletId: id };
    case "POST /v1/admin/outlets/:id/stations":
      return { action: "station.create", summary: `Added kitchen ${str(body.name)} at ${str(result.name)}`, targetId: id, outletId: id };
    case "PATCH /v1/admin/stations/:id":
      return { action: "station.rename", summary: `Renamed a kitchen at ${str(result.name)} to ${str(body.name)}`, targetId: id, outletId: str(result.id) };
    case "DELETE /v1/admin/stations/:id":
      return { action: "station.remove", summary: `Removed a kitchen at ${str(result.name)}`, targetId: id, outletId: str(result.id) };
    case "POST /v1/admin/categories":
      return { action: "category.create", summary: `Added menu section ${str(body.name)}`, targetId: str(result.id) };
    case "PATCH /v1/admin/categories/:id":
      if (body.active === false) return { action: "category.hide", summary: `Hid menu section ${str(body.name)}`, targetId: id };
      return { action: "category.update", summary: `Edited menu section ${str(body.name)}`, targetId: id };
    case "POST /v1/admin/items":
      return { action: "item.create", summary: `Added ${str(result.name)} to the menu`, targetId: str(result.id) };
    case "PATCH /v1/admin/items/:id": {
      const price = typeof body.pricePaise === "number" ? ` (price now ₹${(body.pricePaise as number) / 100})` : "";
      return { action: "item.update", summary: `Edited ${str(result.name)}${price}`, targetId: id };
    }
    case "PUT /v1/admin/listings": {
      const [item, cafe] = await Promise.all([itemName(str(body.itemId)), outletName(str(body.outletId))]);
      return { action: body.listed ? "listing.add" : "listing.remove", summary: `${body.listed ? "Started" : "Stopped"} selling ${item} at ${cafe}`, targetId: str(body.itemId), outletId: str(body.outletId) };
    }
    case "POST /v1/admin/staff":
      return { action: "staff.create", summary: `Added team member ${str(result.name)}`, targetId: str(result.id) };
    case "PATCH /v1/admin/staff/:id": {
      const who = str(result.name) || (await db.select({ name: staffUsers.name }).from(staffUsers).where(eq(staffUsers.id, id ?? "")))[0]?.name || "a team member";
      if (body.active === false) return { action: "staff.deactivate", summary: `Removed sign-in access for ${who}`, targetId: id };
      if (body.active === true) return { action: "staff.reactivate", summary: `Restored sign-in access for ${who}`, targetId: id };
      if (body.pin) return { action: "staff.reset_pin", summary: `Reset the PIN for ${who}`, targetId: id };
      return { action: "staff.update", summary: `Edited team member ${who}`, targetId: id };
    }
    default:
      return null;
  }
}

export async function listActivity(db: Db, staff: StaffClaims, q: { limit?: number; before?: number; outletId?: string }) {
  if (staff.role !== "ADMIN") throw new AppError("FORBIDDEN", "Only the owner can see the activity log");
  const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 200);
  const conds = [eq(auditLog.tenantId, staff.tenantId)];
  if (q.before) conds.push(lt(auditLog.id, Number(q.before)));
  if (q.outletId) conds.push(eq(auditLog.outletId, q.outletId));
  const rows = await db.select().from(auditLog).where(and(...conds)).orderBy(desc(auditLog.id)).limit(limit);
  const outletIds = [...new Set(rows.map((r) => r.outletId).filter((x): x is string => Boolean(x)))];
  const names = outletIds.length ? await db.select({ id: outlets.id, name: outlets.name }).from(outlets).where(inArray(outlets.id, outletIds)) : [];
  const nameOf = new Map(names.map((n) => [n.id, n.name]));
  return {
    entries: rows.map((r) => ({
      id: r.id,
      at: r.createdAt.toISOString(),
      actor: r.actorName,
      action: r.action,
      summary: r.summary,
      outlet: r.outletId ? (nameOf.get(r.outletId) ?? null) : null,
    })),
    nextBefore: rows.length === limit ? rows[rows.length - 1]!.id : null,
  };
}
