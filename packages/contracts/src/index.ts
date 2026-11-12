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
  /**
   * Filmed barista for the 3D welcome scene, shot against a green screen: an idle loop, and
   * optionally a wave played when the visitor taps. Without it the scene uses the drawn barista.
   */
  baristaVideo: z.object({ idle: z.string(), wave: z.string().optional(), keyColor: z.string().optional() }).nullable().optional(),
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
/** Brew Haven's own team signs in with email and password, never a café PIN. */
export const PlatformLoginRequest = z.object({ email: z.string().trim().email().max(200), password: z.string().min(1).max(200) });
const DateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-12-31");
export const PlatformBusinessUpdate = z.object({
  plan: z.enum(["starter", "growth", "multi"]).optional(),
  suspended: z.boolean().optional(),
  /** Paid up to the end of this day (IST); null clears it. */
  paidUntil: DateOnly.nullable().optional(),
  /** Free trial runs to the end of this day (IST), to extend or end a trial; null clears it. */
  trialEndsOn: DateOnly.nullable().optional(),
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
/** The 12-digit UPI transaction reference (UTR) shown on the customer's payment screen. */
export const UpiReference = z.string().trim().regex(/^\d{12}$/, "The UPI reference (UTR) is the 12-digit number on the customer's payment screen");
export const WalkInOrderRequest = QuoteRequest.extend({
  outletId: Id,
  method: CounterPaymentMethod,
  customer: z.object({ name: z.string().trim().max(60).optional(), phone: IndianMobile.optional() }).optional(),
  /** Optional for UPI at the counter; when given it must be new, so one payment can't be used twice. */
  upiReference: UpiReference.optional(),
  /**
   * Set by the till for every counter order, so sending it twice (a retry, or a queue sent after
   * the connection came back) never makes two orders.
   */
  clientRef: z.string().uuid().optional(),
  /** When the order was taken, if the till saved it while offline and is sending it now. */
  takenOfflineAt: z.string().datetime().optional(),
}).refine((b) => !b.upiReference || b.method === "UPI_COUNTER", { message: "A UPI reference only goes with a UPI payment", path: ["upiReference"] });
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

// ---------- Owner admin (D-17) ----------

const Name = z.string().trim().min(1).max(60);
const OptionalText = z.string().trim().max(400).optional();
export const PickupPrefix = z.string().trim().toUpperCase().pipe(z.string().regex(/^[A-Z]{1,3}$/, "Use 1 to 3 letters, e.g. C"));
export const SlugInput = z.string().trim().toLowerCase().pipe(Slug);

/** GST registration number: 2-digit state code, PAN, entity number, Z, check character. */
export const Gstin = z
  .string()
  .trim()
  .toUpperCase()
  .pipe(z.string().regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, "That doesn't look like a GSTIN. It has 15 characters, e.g. 29ABCDE1234F1Z5"));
/** Printed on receipts. Empty strings clear a field. */
export const BillingDetails = z.object({
  legalName: z.string().trim().max(100).optional(),
  gstin: z.union([z.literal(""), Gstin]).optional(),
  fssaiLicence: z.union([z.literal(""), z.string().trim().regex(/^\d{14}$/, "The FSSAI licence number has 14 digits")]).optional(),
  footer: z.string().trim().max(140).optional(),
});
export type BillingDetails = z.infer<typeof BillingDetails>;

export const AdminSettingsRequest = z.object({
  displayName: Name,
  tagline: z.string().trim().max(80).optional(),
  greeting: z.string().trim().max(140).optional(),
  managerName: z.string().trim().max(30).optional(),
  /** GST in basis points, e.g. 500 = 5% (SO-6 pending with the owner). */
  taxRateBps: z.number().int().min(0).max(2800),
  billing: BillingDetails.optional(),
});

export const StationInput = z.object({ name: Name, key: SlugInput.optional() });

export const CreateOutletRequest = z.object({
  name: Name,
  slug: SlugInput.optional(),
  pickupPrefix: PickupPrefix,
  address: OptionalText,
  /** Kitchens/stations for the new café. Defaults to a copy of an existing café's stations. */
  stations: z.array(StationInput).max(10).optional(),
});
export const UpdateOutletRequest = z.object({
  name: Name.optional(),
  pickupPrefix: PickupPrefix.optional(),
  address: OptionalText,
  isOpen: z.boolean().optional(),
});

export const CategoryRequest = z.object({ name: Name, sort: z.number().int().min(0).max(999).optional(), active: z.boolean().optional() });

export const ModifierGroupInput = z
  .object({
    name: Name,
    minSelect: z.number().int().min(0).max(10),
    maxSelect: z.number().int().min(1).max(10),
    options: z.array(z.object({ name: Name, pricePaise: Paise.max(10_000_00) })).min(1).max(15),
  })
  .refine((g) => g.minSelect <= g.maxSelect && g.maxSelect <= g.options.length, { message: "Min must be ≤ max, and max ≤ the number of options" });

export const ItemRequest = z.object({
  categoryId: Id,
  name: Name,
  description: z.string().trim().max(240).default(""),
  pricePaise: Paise.min(100, "Price must be at least ₹1").max(10_000_00),
  isVeg: z.boolean(),
  tags: z.array(z.enum(["bestseller", "new", "spicy", "seasonal"])).max(4).default([]),
  stationKey: SlugInput,
  imageUrl: z.string().url().max(500).nullable().optional(),
  active: z.boolean().optional(),
  modifierGroups: z.array(ModifierGroupInput).max(6).optional(),
});
export const UpdateItemRequest = ItemRequest.partial().omit({ modifierGroups: true }).extend({ modifierGroups: z.array(ModifierGroupInput).max(6).optional() });

export const ListingRequest = z.object({ outletId: Id, itemId: Id, listed: z.boolean() });

export const StaffUserRequest = z.object({
  name: Name,
  role: StaffRole,
  pin: z.string().regex(/^\d{4}$/, "PIN must be 4 digits"),
  outletIds: z.array(Id).max(50),
});
export const UpdateStaffUserRequest = StaffUserRequest.partial().extend({ active: z.boolean().optional() });

export const OutletWithStations = z.object({
  id: Id,
  slug: z.string(),
  name: z.string(),
  pickupPrefix: z.string(),
  address: z.string().nullable(),
  isOpen: z.boolean(),
  stations: z.array(z.object({ id: Id, key: z.string(), name: z.string() })),
});
export type OutletWithStations = z.infer<typeof OutletWithStations>;

/** Where a business stands with Brew Haven: free trial, paid up, or past either. */
export const BillingStatusView = z.object({
  state: z.enum(["trial", "trial_over", "paid", "overdue", "not_billed"]),
  until: z.string().nullable(),
  daysLeft: z.number().int().nullable(),
});

export const AdminSetup = z.object({
  tenant: z.object({
    slug: z.string(),
    name: z.string(),
    taxRateBps: z.number().int(),
    branding: Branding,
    billing: BillingDetails,
    plan: z.object({
      id: z.string(),
      name: z.string(),
      maxCafes: z.number().int().nullable(),
      maxStaff: z.number().int().nullable(),
      cafes: z.number().int(),
      staff: z.number().int(),
      monthlyPaise: z.number().int(),
      yearlyPaise: z.number().int(),
      billing: BillingStatusView,
    }),
  }),
  outlets: z.array(OutletWithStations),
  categories: z.array(z.object({ id: Id, name: z.string(), sort: z.number().int(), active: z.boolean() })),
  items: z.array(
    z.object({
      id: Id,
      categoryId: Id,
      name: z.string(),
      description: z.string(),
      pricePaise: Paise,
      isVeg: z.boolean(),
      tags: z.array(z.string()),
      stationKey: z.string(),
      imageUrl: z.string().nullable(),
      active: z.boolean(),
      modifierGroups: z.array(z.object({ name: z.string(), minSelect: z.number().int(), maxSelect: z.number().int(), options: z.array(z.object({ name: z.string(), pricePaise: Paise })) })),
      /** Outlet ids where this item is NOT sold. */
      unlistedAt: z.array(Id),
    }),
  ),
  staff: z.array(z.object({ id: Id, name: z.string(), role: StaffRole, outletIds: z.array(Id), active: z.boolean() })),
});
export type AdminSetup = z.infer<typeof AdminSetup>;

// ---------- Day close and reports ----------

const RupeesPaise = z.number().int().min(0).max(100_000_00);
export const CloseDayRequest = z.object({
  outletId: Id,
  openingFloatPaise: RupeesPaise,
  countedCashPaise: RupeesPaise,
  note: z.string().trim().max(200).optional(),
});

// ---------- Receipts ----------

/**
 * A receipt for a placed order. With a GSTIN on file it is a tax invoice: consecutive number per
 * café per financial year, GST split into CGST and SGST (intra-state supply). Without one it is a
 * plain receipt.
 */
export const ReceiptView = z.object({
  kind: z.enum(["TAX_INVOICE", "RECEIPT"]),
  number: z.string(),
  issuedAt: z.string(),
  pickupCode: z.string().nullable(),
  seller: z.object({
    name: z.string(),
    legalName: z.string().nullable(),
    outlet: z.string(),
    address: z.string().nullable(),
    gstin: z.string().nullable(),
    fssaiLicence: z.string().nullable(),
  }),
  customerName: z.string().nullable(),
  channel: z.enum(["ONLINE", "COUNTER"]),
  lines: z.array(z.object({ name: z.string(), options: z.array(z.string()), quantity: z.number().int(), amountPaise: Paise })),
  totals: z.object({
    totalPaise: Paise,
    taxablePaise: Paise,
    taxRateBps: z.number().int(),
    cgstPaise: Paise,
    sgstPaise: Paise,
  }),
  payments: z.array(z.object({ method: z.string(), amountPaise: Paise, reference: z.string().nullable() })),
  refundedPaise: Paise,
  footer: z.string().nullable(),
});
export type ReceiptView = z.infer<typeof ReceiptView>;

// ---------- Inventory (backlog S10) ----------

export const InventoryUnit = z.enum(["g", "ml", "pc"]);
const WholeAmount = z.number().int().min(1).max(10_000_000);
export const IngredientInput = z.object({ name: Name, unit: InventoryUnit });
export const IngredientUpdate = z.object({ name: Name.optional(), active: z.boolean().optional() });
export const RecipeInput = z.object({
  rows: z
    .array(
      z.object({
        groupName: z.string().trim().min(1).max(60).optional(),
        optionName: z.string().trim().min(1).max(60).optional(),
        ingredientId: Id,
        quantity: z.number().int().min(-100_000).max(100_000).refine((n) => n !== 0, "Use a quantity other than 0"),
      }),
    )
    .max(60)
    .refine((rows) => rows.every((r) => (r.groupName ? !!r.optionName : !r.optionName)), "A choice needs both its group and option")
    .refine((rows) => rows.every((r) => r.groupName || r.quantity > 0), "The base recipe can't use a negative amount"),
});
/** RECEIVE: a delivery (adds). WASTE: spilt or spoilt (takes away). COUNT: what's actually on the shelf now. */
export const StockMovementInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("RECEIVE"), outletId: Id, ingredientId: Id, quantity: WholeAmount, note: z.string().trim().max(140).optional() }),
  z.object({ kind: z.literal("WASTE"), outletId: Id, ingredientId: Id, quantity: WholeAmount, note: z.string().trim().max(140).optional() }),
  z.object({ kind: z.literal("COUNT"), outletId: Id, ingredientId: Id, quantity: z.number().int().min(0).max(10_000_000), note: z.string().trim().max(140).optional() }),
]);
export const LowStockInput = z.object({ outletId: Id, ingredientId: Id, lowAt: z.number().int().min(0).max(10_000_000).nullable() });

// ---------- Self-serve sign-up (R2) ----------

export const SignupRequest = z.object({
  businessName: Name,
  cafeName: Name,
  /** Letters before order numbers at the first café; defaults to the café name's first letter. */
  pickupPrefix: PickupPrefix.optional(),
  address: OptionalText,
  ownerName: Name,
  pin: z.string().regex(/^\d{4}$/, "PIN must be 4 digits"),
  email: z.string().trim().toLowerCase().email("Enter a valid email address").max(200),
  phone: z
    .string()
    .trim()
    .transform((v) => v.replace(/[\s-]/g, ""))
    .pipe(z.string().regex(/^(\+91)?[6-9]\d{9}$/, "Enter a 10-digit Indian mobile number")),
  sampleMenu: z.boolean().default(true),
  acceptTerms: z.literal(true, { error: "Please accept the terms to continue" }),
});
export type SignupRequest = z.input<typeof SignupRequest>;
