import type { CheckoutInfo, CreateOrderResponse, MenuResponse, OrderView, QuoteResponse, ResolveAdjustmentRequest } from "@brew-haven/contracts";

export const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "http://localhost:8080";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers ?? {}) },
    });
  } catch {
    throw new ApiError(0, "NETWORK", "We couldn't reach the café. Check your connection and try again.");
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, body?.error?.code ?? "ERROR", body?.error?.message ?? "Something went wrong. Please try again.");
  return body as T;
}

export interface LineInput {
  itemId: string;
  quantity: number;
  modifierIds: string[];
  note?: string;
}

export const api = {
  menu: (tenant: string, outlet: string) => call<MenuResponse>(`/v1/cafes/${tenant}/${outlet}/menu`),
  quote: (tenant: string, outlet: string, lines: LineInput[]) =>
    call<QuoteResponse>(`/v1/cafes/${tenant}/${outlet}/quote`, { method: "POST", body: JSON.stringify({ lines }) }),
  createOrder: (
    tenant: string,
    outlet: string,
    body: { lines: LineInput[]; customer: { name: string; phone: string }; consent: { orderUpdates: true; offers: boolean } },
    idempotencyKey: string,
  ) =>
    call<CreateOrderResponse>(`/v1/cafes/${tenant}/${outlet}/orders`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Idempotency-Key": idempotencyKey },
    }),
  track: (token: string) => call<OrderView>(`/v1/track/${token}`),
  retryPayment: (token: string) => call<CheckoutInfo>(`/v1/track/${token}/pay`, { method: "POST" }),
  resolve: (token: string, adjustmentId: string, body: ResolveAdjustmentRequest) =>
    call<OrderView>(`/v1/track/${token}/adjustments/${adjustmentId}/resolve`, { method: "POST", body: JSON.stringify(body) }),
  simulatePayment: (paymentId: string, outcome: "SUCCESS" | "FAILURE") =>
    call<{ result: string; order: OrderView }>(`/v1/payments/simulate`, { method: "POST", body: JSON.stringify({ paymentId, outcome }) }),
  streamUrl: (token: string) => `${API_URL}/v1/track/${token}/stream`,
};
