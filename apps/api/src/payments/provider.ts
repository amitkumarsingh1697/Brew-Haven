import { createHmac, timingSafeEqual } from "node:crypto";

/** Provider-neutral payment adapter (Q-R2-01 is still open, so nothing depends on one gateway). */

export interface ProviderOrder {
  providerOrderId: string;
  /** Public key for the client checkout widget, when the provider has one. */
  keyId?: string;
}

export type WebhookEvent =
  | { eventId: string; type: "payment.captured"; providerOrderId: string; providerPaymentId: string; amountPaise: number; instrument?: string | null }
  | { eventId: string; type: "payment.failed"; providerOrderId: string; providerPaymentId: string; amountPaise: number; instrument?: string | null }
  | { eventId: string; type: "refund.processed" | "refund.failed"; providerRefundId: string; providerPaymentId: string; amountPaise: number }
  | { eventId: string; type: "ignored" };

export interface RefundResult {
  providerRefundId: string;
  status: "PROCESSED" | "PENDING";
}

export interface PaymentProvider {
  readonly name: "simulated" | "razorpay";
  createOrder(input: { amountPaise: number; receipt: string; notes?: Record<string, string> }): Promise<ProviderOrder>;
  /** Verifies the signature and parses the body. Throws InvalidSignatureError if it does not verify. */
  parseWebhook(rawBody: string, headers: Record<string, string | string[] | undefined>): WebhookEvent;
  refund(input: { providerPaymentId: string; amountPaise: number; idempotencyKey: string }): Promise<RefundResult>;
}

export class InvalidSignatureError extends Error {
  constructor() {
    super("webhook signature did not verify");
  }
}

export function hmacHex(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ab.length === bb.length && ab.length > 0 && timingSafeEqual(ab, bb);
}

export function header(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const v = headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
}
