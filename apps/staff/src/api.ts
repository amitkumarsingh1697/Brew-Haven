import type { AdminSetup, SignupRequest, DaySummary, MenuResponse, OrderView, OutletWithStations, ReceiptView, StaffSession } from "@brew-haven/contracts";

export const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "http://localhost:8080";
export const CUSTOMER_URL = (import.meta.env.VITE_CUSTOMER_URL as string | undefined)?.replace(/\/$/, "") ?? "http://localhost:5173";
const DEFAULT_TENANT = (import.meta.env.VITE_TENANT as string | undefined) ?? "400-coffee";
const TENANT_KEY = "bh:business";

/**
 * The business this device signs in to: a "?business=" link, then the one remembered on this
 * device (set at sign-up or by "Different business?"), then the build default.
 */
export function getTenant(): string {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get("business");
    if (fromUrl && /^[a-z0-9-]{1,60}$/.test(fromUrl)) {
      localStorage.setItem(TENANT_KEY, fromUrl);
      return fromUrl;
    }
    return localStorage.getItem(TENANT_KEY) || DEFAULT_TENANT;
  } catch {
    return DEFAULT_TENANT;
  }
}
export function setTenant(slug: string) {
  try {
    localStorage.setItem(TENANT_KEY, slug);
  } catch {
    /* private mode: the link still works for this visit */
  }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

let token: string | null = null;
let onUnauthorized: () => void = () => undefined;
export function setSessionToken(t: string | null, onExpire?: () => void) {
  token = t;
  if (onExpire) onUnauthorized = onExpire;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError(0, "Can't reach the server. Check the café Wi-Fi.");
  }
  const body = await res.json().catch(() => null);
  if (res.status === 401 && token) onUnauthorized();
  if (!res.ok) throw new ApiError(res.status, body?.error?.message ?? "Something went wrong");
  return body as T;
}

/** Fetches a file the API sends (e.g. a CSV export) and saves it in the browser. */
async function saveFile(path: string, filename: string) {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  } catch {
    throw new ApiError(0, "Can't reach the server. Check the café Wi-Fi.");
  }
  if (res.status === 401 && token) onUnauthorized();
  if (!res.ok) throw new ApiError(res.status, (await res.json().catch(() => null))?.error?.message ?? "Download failed");
  const url = URL.createObjectURL(await res.blob());
  Object.assign(document.createElement("a"), { href: url, download: filename }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const post = <T>(path: string, body: unknown) => call<T>(path, { method: "POST", body: JSON.stringify(body) });
const send = <T>(method: "PUT" | "PATCH" | "DELETE", path: string, body?: unknown) => call<T>(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) });

export type AdminItem = AdminSetup["items"][number];
export type ItemInput = Omit<AdminItem, "id" | "unlistedAt" | "imageUrl">;

export interface StockRow {
  itemId: string;
  name: string;
  available: boolean;
  stockCount: number | null;
}

export interface ActivityEntry {
  id: number;
  at: string;
  actor: string;
  action: string;
  summary: string;
  outlet: string | null;
}

export interface DayClose {
  id: string;
  outletId: string;
  businessDate: string;
  closedBy: string;
  closedAt: string;
  openingFloatPaise: number;
  countedCashPaise: number;
  expectedCashPaise: number;
  variancePaise: number;
  takingsByMethod: Record<string, number>;
  netPaise: number;
  openOrders: number;
  note: string | null;
}

export interface GstSums {
  invoices: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  totalPaise: number;
}
export interface GstSummary {
  from: string;
  to: string;
  gstin: string | null;
  legalName: string | null;
  sac: string;
  totals: GstSums;
  byRate: Array<GstSums & { rateBps: number }>;
  byCafe: Array<GstSums & { outlet: string }>;
  documents: Array<{ series: string; outlet: string; first: string; last: string; issued: number; cancelled: number }>;
}

export interface SalesReport {
  from: string;
  to: string;
  totals: { orders: number; cancelled: number; open: number; capturedPaise: number; refundedPaise: number; netPaise: number; averageOrderPaise: number };
  byDay: Array<{ date: string; orders: number; netPaise: number }>;
  byCafe: Array<{ outletId: string; name: string; orders: number; cancelled: number; netPaise: number; online: number; counter: number }>;
  byMethod: Record<string, number>;
  topItems: Array<{ name: string; quantity: number; revenuePaise: number }>;
  busiestHours: Array<{ hour: number; orders: number }>;
  closes: Array<DayClose & { outlet: string }>;
}

export type Unit = "g" | "ml" | "pc";
export interface IngredientStock {
  id: string;
  name: string;
  unit: Unit;
  active: boolean;
  onHand: number;
  lowAt: number | null;
  tracked: boolean;
  status: "OK" | "LOW" | "OUT" | "UNTRACKED";
  usedLast7Days: number;
  usedIn: number;
}
export interface StockMove {
  id: number;
  at: string;
  ingredient: string;
  unit: Unit;
  kind: "RECEIVE" | "SALE" | "WASTE" | "COUNT";
  quantity: number;
  note: string | null;
  by: string | null;
}
export interface StockReportRow {
  ingredientId: string;
  name: string;
  unit: Unit;
  opening: number;
  received: number;
  used: number;
  wasted: number;
  variance: number;
  closing: number;
  variancePct: number | null;
}
export interface RecipeLine {
  groupName: string | null;
  optionName: string | null;
  ingredientId: string;
  quantity: number;
}
export interface RecipeItem {
  id: string;
  name: string;
  active: boolean;
  choices: Array<{ group: string; option: string }>;
  rows: RecipeLine[];
}

export const api = {
  users: () => call<{ tenant: { name: string }; users: Array<{ id: string; name: string; role: string }> }>(`/v1/staff/${getTenant()}/users`),
  login: (staffUserId: string, pin: string) => post<StaffSession>("/v1/staff/login", { tenantSlug: getTenant(), staffUserId, pin }),
  orders: (outletId: string, scope: "live" | "today" = "live") => call<OrderView[]>(`/v1/staff/orders?outletId=${outletId}&scope=${scope}`),
  action: (id: string, action: "START" | "MARK_READY" | "HAND_OVER") => post<OrderView>(`/v1/staff/orders/${id}/actions`, { action }),
  reject: (id: string, reason: string) => post<OrderView>(`/v1/staff/orders/${id}/reject`, { reason }),
  flag: (id: string, lineIds: string[], note: string) => post<OrderView>(`/v1/staff/orders/${id}/flag-unavailable`, { lineIds, note: note || undefined, markSoldOut: true }),
  walkIn: (body: { outletId: string; method: "CASH" | "UPI_COUNTER" | "CARD_COUNTER"; lines: Array<{ itemId: string; quantity: number; modifierIds: string[] }>; customer?: { name?: string }; upiReference?: string; clientRef?: string; takenOfflineAt?: string }) =>
    post<OrderView>("/v1/staff/orders/walk-in", body),
  stock: (outletId: string) => call<StockRow[]>(`/v1/staff/stock?outletId=${outletId}`),
  setStock: (body: { outletId: string; itemId: string; available: boolean; stockCount?: number | null }) => call<StockRow>("/v1/staff/stock", { method: "PUT", body: JSON.stringify(body) }),
  inventory: (outletId: string) => call<{ ingredients: IngredientStock[] }>(`/v1/staff/inventory?outletId=${outletId}`),
  stockHistory: (outletId: string, ingredientId?: string) => call<StockMove[]>(`/v1/staff/inventory/history?outletId=${outletId}${ingredientId ? `&ingredientId=${ingredientId}` : ""}`),
  recordStock: (b: { outletId: string; ingredientId: string; kind: "RECEIVE" | "WASTE" | "COUNT"; quantity: number; note?: string }) =>
    post<{ onHand: number; change: number; ingredient: string; unit: Unit }>("/v1/staff/inventory/movements", b),
  receipt: (orderId: string) => call<ReceiptView>(`/v1/staff/orders/${orderId}/receipt`),
  closeInfo: (outletId: string) => call<{ summary: DaySummary; cash: { takenPaise: number; refundedPaise: number }; close: DayClose | null }>(`/v1/staff/close?outletId=${outletId}`),
  closeDay: (b: { outletId: string; openingFloatPaise: number; countedCashPaise: number; note?: string }) => post<DayClose>("/v1/staff/close", b),
  summary: (outletId: string) => call<DaySummary>(`/v1/staff/summary?outletId=${outletId}`),
  /** The menu, kept on this device too so the till can still take counter orders offline. */
  menu: async (outletSlug: string) => {
    const k = `bh:menu:${getTenant()}:${outletSlug}`;
    try {
      const m = await call<MenuResponse>(`/v1/cafes/${getTenant()}/${outletSlug}/menu`);
      try {
        localStorage.setItem(k, JSON.stringify(m));
      } catch {
        /* ignore */
      }
      return m;
    } catch (e) {
      if ((e as ApiError).status !== 0) throw e;
      let saved: MenuResponse | null = null;
      try {
        saved = JSON.parse(localStorage.getItem(k) ?? "null");
      } catch {
        /* ignore */
      }
      if (!saved) throw e;
      return saved;
    }
  },
  signupOpen: () => call<{ open: boolean }>("/v1/signup"),
  signup: (b: SignupRequest) => post<{ tenantSlug: string; outletSlug: string; session: StaffSession }>("/v1/signup", b),
  outlets: () => call<OutletWithStations[]>("/v1/staff/outlets"),
  admin: {
    setup: () => call<AdminSetup>("/v1/admin/setup"),
    reports: (q: { from: string; to: string; outletId?: string }) => {
      const p = new URLSearchParams({ from: q.from, to: q.to });
      if (q.outletId) p.set("outletId", q.outletId);
      return call<SalesReport>(`/v1/admin/reports?${p}`);
    },
    paymentChecks: (outletId?: string) =>
      call<{ items: Array<{ kind: string; severity: "act" | "check"; at: string; orderId: string; orderCode: string | null; outlet: string; amountPaise: number; message: string }> }>(
        `/v1/admin/payment-checks${outletId ? `?outletId=${outletId}` : ""}`,
      ),
    notifications: () =>
      call<{
        provider: string;
        delivers: boolean;
        messages: Array<{ id: string; at: string; to: string; orderCode: string | null; outlet: string; template: string; body: string; status: string; error: string | null }>;
      }>("/v1/admin/notifications"),
    activity: (q: { outletId?: string; before?: number }) => {
      const p = new URLSearchParams({ limit: "50" });
      if (q.outletId) p.set("outletId", q.outletId);
      if (q.before) p.set("before", String(q.before));
      return call<{ entries: ActivityEntry[]; nextBefore: number | null }>(`/v1/admin/activity?${p}`);
    },
    settings: (b: { displayName: string; tagline?: string; greeting?: string; managerName?: string; taxRateBps: number; billing?: { legalName?: string; gstin?: string; fssaiLicence?: string; footer?: string } }) => send<AdminSetup>("PUT", "/v1/admin/settings", b),
    createIngredient: (b: { name: string; unit: Unit }) => post<{ id: string }>("/v1/admin/ingredients", b),
    updateIngredient: (id: string, b: { name?: string; active?: boolean }) => send<{ id: string }>("PATCH", `/v1/admin/ingredients/${id}`, b),
    recipes: () => call<{ items: RecipeItem[] }>("/v1/admin/recipes"),
    setRecipe: (itemId: string, rows: Array<{ groupName?: string; optionName?: string; ingredientId: string; quantity: number }>) => send<unknown>("PUT", `/v1/admin/recipes/${itemId}`, { rows }),
    setLowStock: (b: { outletId: string; ingredientId: string; lowAt: number | null }) => send<unknown>("PUT", "/v1/admin/low-stock", b),
    lowStock: () => call<{ items: Array<{ outlet: string; ingredient: string; unit: Unit; onHand: number; lowAt: number | null; status: "LOW" | "OUT" }> }>("/v1/admin/low-stock"),
    exportCsv: (kind: "orders" | "items" | "payments" | "closes" | "stock" | "gst", q: { from: string; to: string; outletId?: string }) => {
      const p = new URLSearchParams({ from: q.from, to: q.to });
      if (q.outletId) p.set("outletId", q.outletId);
      return saveFile(`/v1/admin/exports/${kind}?${p}`, `brew-haven-${kind}-${q.from}-to-${q.to}.csv`);
    },
    gstSummary: (q: { from: string; to: string; outletId?: string }) => {
      const p = new URLSearchParams({ from: q.from, to: q.to });
      if (q.outletId) p.set("outletId", q.outletId);
      return call<GstSummary>(`/v1/admin/gst-summary?${p}`);
    },
    stockReport: (q: { outletId: string; from: string; to: string }) =>
      call<{ from: string; to: string; rows: StockReportRow[] }>(`/v1/admin/stock-report?${new URLSearchParams(q)}`),
    createOutlet: (b: { name: string; pickupPrefix: string; address?: string }) => post<OutletWithStations>("/v1/admin/outlets", b),
    updateOutlet: (id: string, b: { name?: string; pickupPrefix?: string; address?: string; isOpen?: boolean }) => send<OutletWithStations>("PATCH", `/v1/admin/outlets/${id}`, b),
    addStation: (outletId: string, name: string) => post<OutletWithStations>(`/v1/admin/outlets/${outletId}/stations`, { name }),
    renameStation: (id: string, name: string) => send<OutletWithStations>("PATCH", `/v1/admin/stations/${id}`, { name }),
    removeStation: (id: string) => send<OutletWithStations>("DELETE", `/v1/admin/stations/${id}`),
    createCategory: (name: string) => post<AdminSetup["categories"][number]>("/v1/admin/categories", { name }),
    updateCategory: (id: string, b: { name: string; sort?: number; active?: boolean }) => send<AdminSetup["categories"][number]>("PATCH", `/v1/admin/categories/${id}`, b),
    createItem: (b: ItemInput) => post<AdminItem>("/v1/admin/items", b),
    updateItem: (id: string, b: Partial<ItemInput>) => send<AdminItem>("PATCH", `/v1/admin/items/${id}`, b),
    listing: (outletId: string, itemId: string, listed: boolean) => send<unknown>("PUT", "/v1/admin/listings", { outletId, itemId, listed }),
    createStaff: (b: { name: string; role: string; pin: string; outletIds: string[] }) => post<AdminSetup["staff"][number]>("/v1/admin/staff", b),
    updateStaff: (id: string, b: { name?: string; role?: string; pin?: string; outletIds?: string[]; active?: boolean }) => send<AdminSetup["staff"][number]>("PATCH", `/v1/admin/staff/${id}`, b),
  },
  streamUrl: (outletId: string) => `${API_URL}/v1/staff/stream?outletId=${outletId}&token=${encodeURIComponent(token ?? "")}`,
};
