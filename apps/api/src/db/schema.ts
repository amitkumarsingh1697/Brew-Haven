import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const tenantId = () => uuid("tenant_id").notNull().references(() => tenants.id);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export type ModifierSnapshot = { id: string; name: string; pricePaise: number };

export const tenants = pgTable("tenants", {
  id: id(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  taxRateBps: integer("tax_rate_bps").notNull().default(500),
  branding: jsonb("branding").$type<Record<string, unknown>>().notNull().default({}),
  /** Seller details printed on receipts: legal name, GSTIN, FSSAI licence, footer. */
  billing: jsonb("billing").$type<{ legalName?: string; gstin?: string; fssaiLicence?: string; footer?: string }>().notNull().default({}),
  demoData: boolean("demo_data").notNull().default(false),
  createdAt: createdAt(),
});

export const outlets = pgTable(
  "outlets",
  {
    id: id(),
    tenantId: tenantId(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    pickupPrefix: text("pickup_prefix").notNull(),
    address: text("address"),
    timezone: text("timezone").notNull().default("Asia/Kolkata"),
    isOpen: boolean("is_open").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("outlets_tenant_slug").on(t.tenantId, t.slug)],
);

export const stations = pgTable(
  "stations",
  {
    id: id(),
    tenantId: tenantId(),
    outletId: uuid("outlet_id").notNull().references(() => outlets.id),
    key: text("key").notNull(),
    name: text("name").notNull(),
    sort: integer("sort").notNull().default(0),
  },
  (t) => [uniqueIndex("stations_outlet_key").on(t.outletId, t.key)],
);

export const staffUsers = pgTable("staff_users", {
  id: id(),
  tenantId: tenantId(),
  name: text("name").notNull(),
  role: text("role", { enum: ["ADMIN", "CASHIER", "KITCHEN"] }).notNull(),
  pinHash: text("pin_hash").notNull(),
  outletIds: uuid("outlet_ids").array().notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

export const categories = pgTable("categories", {
  id: id(),
  tenantId: tenantId(),
  name: text("name").notNull(),
  sort: integer("sort").notNull().default(0),
  active: boolean("active").notNull().default(true),
});

export const menuItems = pgTable(
  "menu_items",
  {
    id: id(),
    tenantId: tenantId(),
    categoryId: uuid("category_id").notNull().references(() => categories.id),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    pricePaise: integer("price_paise").notNull(),
    isVeg: boolean("is_veg").notNull().default(true),
    imageUrl: text("image_url"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    stationKey: text("station_key").notNull().default("main"),
    sort: integer("sort").notNull().default(0),
    active: boolean("active").notNull().default(true),
  },
  (t) => [index("menu_items_tenant").on(t.tenantId)],
);

export const modifierGroups = pgTable("modifier_groups", {
  id: id(),
  tenantId: tenantId(),
  itemId: uuid("item_id").notNull().references(() => menuItems.id),
  name: text("name").notNull(),
  minSelect: integer("min_select").notNull().default(0),
  maxSelect: integer("max_select").notNull().default(1),
  sort: integer("sort").notNull().default(0),
});

export const modifierOptions = pgTable("modifier_options", {
  id: id(),
  tenantId: tenantId(),
  groupId: uuid("group_id").notNull().references(() => modifierGroups.id),
  name: text("name").notNull(),
  pricePaise: integer("price_paise").notNull().default(0),
  sort: integer("sort").notNull().default(0),
});

export const outletItemStock = pgTable(
  "outlet_item_stock",
  {
    tenantId: tenantId(),
    outletId: uuid("outlet_id").notNull().references(() => outlets.id),
    itemId: uuid("item_id").notNull().references(() => menuItems.id),
    /** false = this café does not sell the item at all (hidden from its menu). */
    listed: boolean("listed").notNull().default(true),
    available: boolean("available").notNull().default(true),
    /** null = not counted, just available/sold out. */
    stockCount: integer("stock_count"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.outletId, t.itemId] })],
);

export const customers = pgTable(
  "customers",
  {
    id: id(),
    tenantId: tenantId(),
    phone: text("phone").notNull(),
    name: text("name").notNull(),
    consentUpdatesAt: timestamp("consent_updates_at", { withTimezone: true }).notNull(),
    consentOffers: boolean("consent_offers").notNull().default(false),
    consentOffersAt: timestamp("consent_offers_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("customers_tenant_phone").on(t.tenantId, t.phone)],
);

export const orders = pgTable(
  "orders",
  {
    id: id(),
    tenantId: tenantId(),
    outletId: uuid("outlet_id").notNull().references(() => outlets.id),
    customerId: uuid("customer_id").references(() => customers.id),
    customerName: text("customer_name"),
    channel: text("channel", { enum: ["ONLINE", "COUNTER"] }).notNull(),
    state: text("state").notNull(),
    resumeState: text("resume_state"),
    pickupCode: text("pickup_code"),
    /** Receipt number, e.g. A2627-00042: per café, consecutive within an April–March financial year. */
    invoiceNo: text("invoice_no"),
    businessDate: date("business_date"),
    totalPaise: integer("total_paise").notNull(),
    taxPaise: integer("tax_paise").notNull(),
    taxRateBps: integer("tax_rate_bps").notNull(),
    trackingToken: text("tracking_token").notNull().unique(),
    idempotencyKey: text("idempotency_key"),
    cancelReason: text("cancel_reason"),
    createdByStaffId: uuid("created_by_staff_id").references(() => staffUsers.id),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    placedAt: timestamp("placed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("orders_tenant_idem").on(t.tenantId, t.idempotencyKey),
    uniqueIndex("orders_tenant_invoice").on(t.tenantId, t.invoiceNo),
    index("orders_outlet_state").on(t.outletId, t.state),
  ],
);

export const orderLines = pgTable("order_lines", {
  id: id(),
  tenantId: tenantId(),
  orderId: uuid("order_id").notNull().references(() => orders.id),
  itemId: uuid("item_id").notNull().references(() => menuItems.id),
  name: text("name").notNull(),
  quantity: integer("quantity").notNull(),
  unitTotalPaise: integer("unit_total_paise").notNull(),
  lineTotalPaise: integer("line_total_paise").notNull(),
  modifiers: jsonb("modifiers").$type<ModifierSnapshot[]>().notNull().default([]),
  note: text("note"),
  stationKey: text("station_key").notNull(),
  status: text("status", { enum: ["ACTIVE", "UNAVAILABLE", "PENDING_TOPUP", "REMOVED", "REPLACED"] }).notNull().default("ACTIVE"),
  replacesLineId: uuid("replaces_line_id"),
  createdAt: createdAt(),
});

export const orderEvents = pgTable("order_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  tenantId: tenantId(),
  orderId: uuid("order_id").notNull().references(() => orders.id),
  action: text("action").notNull(),
  fromState: text("from_state"),
  toState: text("to_state").notNull(),
  actor: text("actor").notNull(),
  actorId: uuid("actor_id"),
  reason: text("reason"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});

export const dailyCounters = pgTable(
  "daily_counters",
  {
    outletId: uuid("outlet_id").notNull().references(() => outlets.id),
    businessDate: date("business_date").notNull(),
    lastSeq: integer("last_seq").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.outletId, t.businessDate] })],
);

/** Receipt numbering: one sequence per café per financial year (e.g. "2627" for Apr 2026 to Mar 2027). */
export const invoiceCounters = pgTable(
  "invoice_counters",
  {
    outletId: uuid("outlet_id").notNull().references(() => outlets.id),
    financialYear: text("financial_year").notNull(),
    lastSeq: integer("last_seq").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.outletId, t.financialYear] })],
);

export const adjustments = pgTable("adjustments", {
  id: id(),
  tenantId: tenantId(),
  orderId: uuid("order_id").notNull().references(() => orders.id),
  lineId: uuid("line_id").notNull().references(() => orderLines.id),
  status: text("status", { enum: ["OPEN", "AWAITING_TOPUP", "RESOLVED"] }).notNull().default("OPEN"),
  choice: text("choice", { enum: ["REPLACE", "REMOVE", "CANCEL_ORDER"] }),
  replacementLineId: uuid("replacement_line_id"),
  refundPaise: integer("refund_paise").notNull().default(0),
  topUpPaise: integer("top_up_paise").notNull().default(0),
  note: text("note"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const payments = pgTable(
  "payments",
  {
    id: id(),
    tenantId: tenantId(),
    orderId: uuid("order_id").notNull().references(() => orders.id),
    adjustmentId: uuid("adjustment_id").references(() => adjustments.id),
    kind: text("kind", { enum: ["ORDER", "TOPUP"] }).notNull(),
    method: text("method", { enum: ["ONLINE", "CASH", "UPI_COUNTER", "CARD_COUNTER"] }).notNull(),
    provider: text("provider"),
    providerOrderId: text("provider_order_id"),
    providerPaymentId: text("provider_payment_id"),
    amountPaise: integer("amount_paise").notNull(),
    status: text("status", { enum: ["CREATED", "CAPTURED", "FAILED"] }).notNull(),
    recordedByStaffId: uuid("recorded_by_staff_id").references(() => staffUsers.id),
    createdAt: createdAt(),
    capturedAt: timestamp("captured_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("payments_provider_order").on(t.provider, t.providerOrderId),
    /** A counter UPI reference (UTR) can only be recorded once per business. */
    uniqueIndex("payments_upi_reference").on(t.tenantId, t.providerPaymentId).where(sql`${t.method} = 'UPI_COUNTER'`),
  ],
);

export const refunds = pgTable("refunds", {
  id: id(),
  tenantId: tenantId(),
  orderId: uuid("order_id").notNull().references(() => orders.id),
  paymentId: uuid("payment_id").notNull().references(() => payments.id),
  amountPaise: integer("amount_paise").notNull(),
  reason: text("reason").notNull(),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  status: text("status", { enum: ["PENDING", "PROCESSED", "FAILED"] }).notNull().default("PENDING"),
  providerRefundId: text("provider_refund_id"),
  manual: boolean("manual").notNull().default(false),
  createdAt: createdAt(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
});

export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: id(),
    provider: text("provider").notNull(),
    eventId: text("event_id").notNull(),
    payload: jsonb("payload").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("webhook_events_provider_event").on(t.provider, t.eventId)],
);

export const outbox = pgTable(
  "outbox",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    tenantId: uuid("tenant_id"),
    topic: text("topic").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("outbox_pending").on(t.processedAt, t.availableAt)],
);

/** Who changed what (staff actions on orders and stock, every owner setup change, sign-ins). */
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    outletId: uuid("outlet_id"),
    actorId: uuid("actor_id"),
    actorName: text("actor_name").notNull(),
    action: text("action").notNull(),
    summary: text("summary").notNull(),
    targetId: text("target_id"),
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    ip: text("ip"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_tenant_time").on(t.tenantId, t.createdAt)],
);

/** Every customer message, sent or not, so the owner can see exactly what customers received. */
export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    tenantId: tenantId(),
    orderId: uuid("order_id").notNull().references(() => orders.id),
    /** The outbox job that produced it: a retried job never sends twice. */
    outboxId: bigint("outbox_id", { mode: "number" }).notNull(),
    channel: text("channel").notNull().default("whatsapp"),
    provider: text("provider").notNull(),
    toPhone: text("to_phone").notNull(),
    template: text("template").notNull(),
    body: text("body").notNull(),
    status: text("status", { enum: ["QUEUED", "SENT", "LOGGED", "FAILED"] }).notNull(),
    providerMessageId: text("provider_message_id"),
    error: text("error"),
    createdAt: createdAt(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("notifications_outbox").on(t.outboxId), index("notifications_tenant_time").on(t.tenantId, t.createdAt)],
);

/** End-of-day cash count per café (one per business day; re-closing replaces it and is audited). */
export const shiftCloses = pgTable(
  "shift_closes",
  {
    id: id(),
    tenantId: tenantId(),
    outletId: uuid("outlet_id").notNull().references(() => outlets.id),
    businessDate: date("business_date").notNull(),
    closedById: uuid("closed_by_id").references(() => staffUsers.id),
    closedByName: text("closed_by_name").notNull(),
    openingFloatPaise: integer("opening_float_paise").notNull(),
    countedCashPaise: integer("counted_cash_paise").notNull(),
    expectedCashPaise: integer("expected_cash_paise").notNull(),
    variancePaise: integer("variance_paise").notNull(),
    takingsByMethod: jsonb("takings_by_method").$type<Record<string, number>>().notNull(),
    netPaise: integer("net_paise").notNull(),
    openOrders: integer("open_orders").notNull(),
    note: text("note"),
    closedAt: timestamp("closed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("shift_closes_outlet_day").on(t.outletId, t.businessDate)],
);
