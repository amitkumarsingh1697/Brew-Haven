import { describe, expect, it } from "vitest";
import { InvalidSignatureError, hmacHex } from "../src/payments/provider.js";
import { RazorpayProvider } from "../src/payments/razorpay.js";

const secret = "whsec_test";

describe("Razorpay adapter", () => {
  it("verifies the webhook signature and maps payment.captured", () => {
    const rp = new RazorpayProvider("rzp_test_key", "s", secret);
    const body = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_1", order_id: "order_1", amount: 18000 } } } });
    const ev = rp.parseWebhook(body, { "x-razorpay-signature": hmacHex(secret, body), "x-razorpay-event-id": "evt_1" });
    expect(ev).toEqual({ eventId: "evt_1", type: "payment.captured", providerOrderId: "order_1", providerPaymentId: "pay_1", amountPaise: 18000 });
  });

  it("rejects a bad or missing signature", () => {
    const rp = new RazorpayProvider("k", "s", secret);
    const body = JSON.stringify({ event: "payment.captured", payload: {} });
    expect(() => rp.parseWebhook(body, { "x-razorpay-signature": hmacHex("wrong", body) })).toThrow(InvalidSignatureError);
    expect(() => rp.parseWebhook(body, {})).toThrow(InvalidSignatureError);
  });

  it("ignores events it does not handle", () => {
    const rp = new RazorpayProvider("k", "s", secret);
    const body = JSON.stringify({ event: "order.paid", payload: {} });
    expect(rp.parseWebhook(body, { "x-razorpay-signature": hmacHex(secret, body), "x-razorpay-event-id": "e" }).type).toBe("ignored");
  });

  it("creates orders and refunds with basic auth and an idempotency key", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const body = url.endsWith("/orders") ? { id: "order_9" } : { id: "rfnd_9", status: "processed" };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;
    const rp = new RazorpayProvider("rzp_test_key", "secret", secret, "https://api.example", fakeFetch);
    expect(await rp.createOrder({ amountPaise: 5000, receipt: "r1" })).toEqual({ providerOrderId: "order_9", keyId: "rzp_test_key" });
    expect(await rp.refund({ providerPaymentId: "pay_1", amountPaise: 1000, idempotencyKey: "ref-1" })).toEqual({ providerRefundId: "rfnd_9", status: "PROCESSED" });
    expect(calls[0]!.url).toBe("https://api.example/orders");
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Basic " + Buffer.from("rzp_test_key:secret").toString("base64"));
    expect((calls[1]!.init.headers as Record<string, string>)["X-Razorpay-Idempotency-Key"]).toBe("ref-1");
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({ amount: 5000, currency: "INR" });
  });
});
