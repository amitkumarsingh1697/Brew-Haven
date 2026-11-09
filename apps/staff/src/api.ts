import type { AdminSetup, DaySummary, MenuResponse, OrderView, OutletWithStations, StaffSession } from "@brew-haven/contracts";

export const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "http://localhost:8080";
export const CUSTOMER_URL = (import.meta.env.VITE_CUSTOMER_URL as string | undefined)?.replace(/\/$/, "") ?? "http://localhost:5173";
export const TENANT = (import.meta.env.VITE_TENANT as string | undefined) ?? "400-coffee";

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

export const api = {
  users: () => call<{ tenant: { name: string }; users: Array<{ id: string; name: string; role: string }> }>(`/v1/staff/${TENANT}/users`),
  login: (staffUserId: string, pin: string) => post<StaffSession>("/v1/staff/login", { tenantSlug: TENANT, staffUserId, pin }),
  orders: (outletId: string, scope: "live" | "today" = "live") => call<OrderView[]>(`/v1/staff/orders?outletId=${outletId}&scope=${scope}`),
  action: (id: string, action: "START" | "MARK_READY" | "HAND_OVER") => post<OrderView>(`/v1/staff/orders/${id}/actions`, { action }),
  reject: (id: string, reason: string) => post<OrderView>(`/v1/staff/orders/${id}/reject`, { reason }),
  flag: (id: string, lineIds: string[], note: string) => post<OrderView>(`/v1/staff/orders/${id}/flag-unavailable`, { lineIds, note: note || undefined, markSoldOut: true }),
  walkIn: (body: { outletId: string; method: "CASH" | "UPI_COUNTER" | "CARD_COUNTER"; lines: Array<{ itemId: string; quantity: number; modifierIds: string[] }>; customer?: { name?: string } }) =>
    post<OrderView>("/v1/staff/orders/walk-in", body),
  stock: (outletId: string) => call<StockRow[]>(`/v1/staff/stock?outletId=${outletId}`),
  setStock: (body: { outletId: string; itemId: string; available: boolean; stockCount?: number | null }) => call<StockRow>("/v1/staff/stock", { method: "PUT", body: JSON.stringify(body) }),
  summary: (outletId: string) => call<DaySummary>(`/v1/staff/summary?outletId=${outletId}`),
  menu: (outletSlug: string) => call<MenuResponse>(`/v1/cafes/${TENANT}/${outletSlug}/menu`),
  outlets: () => call<OutletWithStations[]>("/v1/staff/outlets"),
  admin: {
    setup: () => call<AdminSetup>("/v1/admin/setup"),
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
    settings: (b: { displayName: string; tagline?: string; greeting?: string; managerName?: string; taxRateBps: number }) => send<AdminSetup>("PUT", "/v1/admin/settings", b),
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
