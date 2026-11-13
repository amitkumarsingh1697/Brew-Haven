import { randomBytes, randomUUID } from "node:crypto";
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
 * Demo provider. A "payment" is completed by the /v1/payments/simulate endpoint,
 * which signs a webhook and sends it through the same verification path as a real
 * gateway. So even in the demo, only a server-verified event marks an order paid.
 */
export class SimulatedProvider implements PaymentProvider {
  readonly name = "simulated" as const;
  constructor(private secret: string) {}

  async createOrder(): Promise<ProviderOrder> {
    return { providerOrderId: `sim_order_${randomBytes(9).toString("base64url")}` };
  }

  signedWebhook(event: Exclude<WebhookEvent, { type: "ignored" }>): { body: string; headers: Record<string, string> } {
    const body = JSON.stringify(event);
    return { body, headers: { "x-simulated-signature": hmacHex(this.secret, body) } };
  }

  paymentEvent(type: "payment.captured" | "payment.failed", providerOrderId: string, amountPaise: number, instrument: string | null = "upi") {
    return this.signedWebhook({
      eventId: randomUUID(),
      type,
      providerOrderId,
      providerPaymentId: `sim_pay_${randomBytes(9).toString("base64url")}`,
      amountPaise,
      instrument,
    });
  }

  parseWebhook(rawBody: string, headers: Record<string, string | string[] | undefined>): WebhookEvent {
    const sig = header(headers, "x-simulated-signature") ?? "";
    if (!safeEqualHex(sig, hmacHex(this.secret, rawBody))) throw new InvalidSignatureError();
    return JSON.parse(rawBody) as WebhookEvent;
  }

  async refund(): Promise<RefundResult> {
    return { providerRefundId: `sim_rfnd_${randomBytes(9).toString("base64url")}`, status: "PROCESSED" };
  }
}
