import {
  InvalidSignatureError,
  header,
  hmacHex,
  safeEqualHex,
  type PaymentProvider,
  type ProviderOrder,
  type RefundResult,
  type WebhookEvent,
} from "./provider.js";

/**
 * Razorpay adapter (test mode works without KYC). Docs:
 * https://razorpay.com/docs/api/orders/ , /docs/api/refunds/ , /docs/webhooks/
 * Payments must be set to auto-capture in the Razorpay dashboard.
 */
export class RazorpayProvider implements PaymentProvider {
  readonly name = "razorpay" as const;
  private auth: string;
  constructor(
    private keyId: string,
    keySecret: string,
    private webhookSecret: string,
    private baseUrl = "https://api.razorpay.com/v1",
    private fetchImpl: typeof fetch = fetch,
  ) {
    this.auth = "Basic " + Buffer.from(`${keyId}:${keySecret}`).toString("base64");
  }

  private async call<T>(path: string, body: unknown, idempotencyKey?: string): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: this.auth,
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "X-Razorpay-Idempotency-Key": idempotencyKey } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Razorpay ${path} failed with ${res.status}: ${await res.text()}`);
    return (await res.json()) as T;
  }

  async createOrder(input: { amountPaise: number; receipt: string; notes?: Record<string, string> }): Promise<ProviderOrder> {
    const order = await this.call<{ id: string }>("/orders", {
      amount: input.amountPaise,
      currency: "INR",
      receipt: input.receipt.slice(0, 40),
      notes: input.notes ?? {},
    });
    return { providerOrderId: order.id, keyId: this.keyId };
  }

  parseWebhook(rawBody: string, headers: Record<string, string | string[] | undefined>): WebhookEvent {
    const sig = header(headers, "x-razorpay-signature") ?? "";
    if (!safeEqualHex(sig, hmacHex(this.webhookSecret, rawBody))) throw new InvalidSignatureError();
    const body = JSON.parse(rawBody) as {
      event: string;
      payload: {
        payment?: { entity: { id: string; order_id: string; amount: number } };
        refund?: { entity: { id: string; payment_id: string; amount: number } };
      };
    };
    const eventId = header(headers, "x-razorpay-event-id") ?? hmacHex("event", rawBody);
    const payment = body.payload.payment?.entity;
    const refund = body.payload.refund?.entity;
    if ((body.event === "payment.captured" || body.event === "payment.failed") && payment) {
      return { eventId, type: body.event, providerOrderId: payment.order_id, providerPaymentId: payment.id, amountPaise: payment.amount };
    }
    if ((body.event === "refund.processed" || body.event === "refund.failed") && refund) {
      return { eventId, type: body.event, providerRefundId: refund.id, providerPaymentId: refund.payment_id, amountPaise: refund.amount };
    }
    return { eventId, type: "ignored" };
  }

  async refund(input: { providerPaymentId: string; amountPaise: number; idempotencyKey: string }): Promise<RefundResult> {
    const r = await this.call<{ id: string; status: string }>(
      `/payments/${encodeURIComponent(input.providerPaymentId)}/refund`,
      { amount: input.amountPaise, speed: "normal", receipt: input.idempotencyKey.slice(0, 40) },
      input.idempotencyKey,
    );
    return { providerRefundId: r.id, status: r.status === "processed" ? "PROCESSED" : "PENDING" };
  }
}
