import { z } from "zod";

/** Shared API contract (ADR-0001). Money is always integer paise. */

export const Paise = z.number().int().nonnegative();
const Id = z.string().uuid();
const Slug = z.string().regex(/^[a-z0-9-]{2,40}$/);

export const IndianMobile = z
  .string()
  .transform((s) => s.replace(/[\s-]/g, ""))
  .transform((s) => (s.startsWith("+91") ? s.slice(3) : s.startsWith("91") && s.length === 12 ? s.slice(2) : s))
  .pipe(z.string().regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit Indian mobile number"));

export const OrderStateSchema = z.enum([
  "AWAITING_PAYMENT",
  "PLACED",
  "PREPARING",
  "ACTION_REQUIRED",
  "READY",
  "COLLECTED",
  "CANCELLED",
  "EXPIRED",
]);
export type OrderStateDto = z.infer<typeof OrderStateSchema>;

// ---------- Menu ----------

export const ModifierOption = z.object({ id: Id, name: z.string(), pricePaise: Paise });
export const ModifierGroup = z.object({
  id: Id,
  name: z.string(),
  minSelect: z.number().int().nonnegative(),
  maxSelect: z.number().int().positive(),
  options: z.array(ModifierOption),
});
export const MenuItem = z.object({
  id: Id,
  name: z.string(),
  description: z.string(),
  pricePaise: Paise,
  isVeg: z.boolean(),
  imageUrl: z.string().nullable(),
  tags: z.array(z.string()),
  /** Preparation station, e.g. "bar" or "kitchen" (ADR-0005). */
  stationKey: z.string(),
  available: z.boolean(),
  modifierGroups: z.array(ModifierGroup),
});
export const MenuCategory = z.object({ id: Id, name: z.string(), items: z.array(MenuItem) });
export const Branding = z.object({
  displayName: z.string(),
  tagline: z.string().optional(),
  greeting: z.string().optional(),
  managerName: z.string().optional(),
  primaryColor: z.string().optional(),
  accentColor: z.string().optional(),
  logoUrl: z.string().nullable().optional(),
});
export const MenuResponse = z.object({
  tenant: z.object({ slug: Slug, name: z.string(), branding: Branding, taxRateBps: z.number().int() }),
  outlet: z.object({ id: Id, slug: Slug, name: z.string(), isOpen: z.boolean() }),
  outlets: z.array(z.object({ slug: Slug, name: z.string() })),
  categories: z.array(MenuCategory),
  demoData: z.boolean(),
});
export type MenuResponse = z.infer<typeof MenuResponse>;
export type MenuItemDto = z.infer<typeof MenuItem>;

// ---------- Quote and order ----------

export const LineRequest = z.object({
  itemId: Id,
  quantity: z.number().int().min(1).max(20),
  modifierIds: z.array(Id).max(20).default([]),
  note: z.string().trim().max(140).optional(),
});
export type LineRequest = z.infer<typeof LineRequest>;

export const QuoteRequest = z.object({ lines: z.array(LineRequest).min(1).max(30) });
export const QuoteLine = z.object({
  itemId: Id,
  name: z.string(),
  quantity: z.number().int(),
  modifiers: z.array(z.object({ id: Id, name: z.string(), pricePaise: Paise })),
  unitTotalPaise: Paise,
  lineTotalPaise: Paise,
  note: z.string().optional(),
});
export const QuoteResponse = z.object({
  lines: z.array(QuoteLine),
  totalPaise: Paise,
  taxPaise: Paise,
  netPaise: Paise,
  taxRateBps: z.number().int(),
});
export type QuoteResponse = z.infer<typeof QuoteResponse>;

export const CreateOrderRequest = QuoteRequest.extend({
  customer: z.object({ name: z.string().trim().min(1).max(60), phone: IndianMobile }),
  consent: z.object({
    /** Order updates are required for the service (D-03). */
    orderUpdates: z.literal(true),
    /** Offers are marketing and need a separate, unticked opt-in. */
    offers: z.boolean().default(false),
  }),
});
export type CreateOrderRequest = z.input<typeof CreateOrderRequest>;

export const CheckoutInfo = z.object({
  paymentId: Id,
  provider: z.enum(["simulated", "razorpay"]),
  providerOrderId: z.string(),
  amountPaise: Paise,
  currency: z.literal("INR"),
  /** Razorpay public key id, when provider is razorpay. */
  keyId: z.string().optional(),
});
export type CheckoutInfo = z.infer<typeof CheckoutInfo>;

export const CreateOrderResponse = z.object({
  orderId: Id,
  trackingToken: z.string(),
  totalPaise: Paise,
  checkout: CheckoutInfo,
});
export type CreateOrderResponse = z.infer<typeof CreateOrderResponse>;

// ---------- Order views ----------

export const LineStatus = z.enum(["ACTIVE", "UNAVAILABLE", "PENDING_TOPUP", "REMOVED", "REPLACED"]);
export const OrderLineView = z.object({
  id: Id,
  itemId: Id,
  name: z.string(),
  quantity: z.number().int(),
  modifiers: z.array(z.object({ id: Id, name: z.string(), pricePaise: Paise })),
  lineTotalPaise: Paise,
  status: LineStatus,
  note: z.string().nullable(),
  replacesLineId: Id.nullable(),
});
export const AdjustmentView = z.object({
  id: Id,
  lineId: Id,
  status: z.enum(["OPEN", "AWAITING_TOPUP", "RESOLVED"]),
  choice: z.enum(["REPLACE", "REMOVE", "CANCEL_ORDER"]).nullable(),
  refundPaise: Paise,
  topUpPaise: Paise,
  expiresAt: z.string(),
  note: z.string().nullable(),
  topUpCheckout: CheckoutInfo.nullable(),
});
export const OrderView = z.object({
  id: Id,
  outlet: z.object({ slug: z.string(), name: z.string(), tenantSlug: z.string(), cafeName: z.string() }),
  channel: z.enum(["ONLINE", "COUNTER"]),
  state: OrderStateSchema,
  pickupCode: z.string().nullable(),
  totalPaise: Paise,
  taxPaise: Paise,
  paidPaise: Paise,
  refundedPaise: Paise,
  cancelReason: z.string().nullable(),
  customerName: z.string().nullable(),
  lines: z.array(OrderLineView),
  adjustments: z.array(AdjustmentView),
  refunds: z.array(z.object({ id: Id, amountPaise: Paise, reason: z.string(), status: z.enum(["PENDING", "PROCESSED", "FAILED"]) })),
  createdAt: z.string(),
  placedAt: z.string().nullable(),
  updatedAt: z.string(),
});
export type OrderView = z.infer<typeof OrderView>;

export const ResolveAdjustmentRequest = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("REPLACE"), replacement: LineRequest }),
  z.object({ kind: z.literal("REMOVE") }),
  z.object({ kind: z.literal("CANCEL_ORDER") }),
]);
export type ResolveAdjustmentRequest = z.infer<typeof ResolveAdjustmentRequest>;

export const SimulatePaymentRequest = z.object({
  paymentId: Id,
  outcome: z.enum(["SUCCESS", "FAILURE"]),
});

// ---------- Staff ----------

export const StaffRole = z.enum(["ADMIN", "CASHIER", "KITCHEN"]);
export type StaffRole = z.infer<typeof StaffRole>;

export const StaffLoginRequest = z.object({
  tenantSlug: Slug,
  staffUserId: Id,
  pin: z.string().regex(/^\d{4,8}$/),
});
export const StaffSession = z.object({
  token: z.string(),
  user: z.object({ id: Id, name: z.string(), role: StaffRole }),
  tenant: z.object({ slug: z.string(), name: z.string() }),
  outlets: z.array(z.object({ id: Id, slug: z.string(), name: z.string() })),
});
export type StaffSession = z.infer<typeof StaffSession>;

export const StaffActionRequest = z.object({ action: z.enum(["START", "MARK_READY", "HAND_OVER"]) });
export const RejectRequest = z.object({ reason: z.string().trim().min(3).max(200) });
export const FlagUnavailableRequest = z.object({
  lineIds: z.array(Id).min(1),
  note: z.string().trim().max(200).optional(),
  /** Also mark the items sold out at this outlet. Defaults to true. */
  markSoldOut: z.boolean().default(true),
});
export const CounterPaymentMethod = z.enum(["CASH", "UPI_COUNTER", "CARD_COUNTER"]);
export const WalkInOrderRequest = QuoteRequest.extend({
  outletId: Id,
  method: CounterPaymentMethod,
  customer: z.object({ name: z.string().trim().max(60).optional(), phone: IndianMobile.optional() }).optional(),
});
export const StockUpdateRequest = z.object({
  outletId: Id,
  itemId: Id,
  available: z.boolean(),
  stockCount: z.number().int().nonnegative().nullable().optional(),
});

export const DaySummary = z.object({
  outletId: Id,
  businessDate: z.string(),
  orders: z.object({ total: z.number().int(), collected: z.number().int(), cancelled: z.number().int(), open: z.number().int() }),
  capturedByMethod: z.record(z.string(), Paise),
  capturedPaise: Paise,
  refundedPaise: Paise,
  netPaise: z.number().int(),
});
export type DaySummary = z.infer<typeof DaySummary>;

export const ApiError = z.object({ error: z.object({ code: z.string(), message: z.string() }) });
export type ApiError = z.infer<typeof ApiError>;
