import type { DaySummary, MenuResponse, OrderView, StaffSession } from "@brew-haven/contracts";

export const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "http://localhost:8080";
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

export interface StockRow {
  itemId: string;
  name: string;
  available: boolean;
  stockCount: number | null;
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
  streamUrl: (outletId: string) => `${API_URL}/v1/staff/stream?outletId=${outletId}&token=${encodeURIComponent(token ?? "")}`,
};
