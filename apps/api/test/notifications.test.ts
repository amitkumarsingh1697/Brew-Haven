import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { StaffSession } from "@brew-haven/contracts";
import { outbox } from "../src/db/schema.js";
import { MetaWhatsAppNotifier, type Notifier, type OutgoingMessage } from "../src/notify/provider.js";
import { drainOutbox } from "../src/services/flows.js";
import { notifyCustomer } from "../src/services/notifications.js";
import { setup, teardown, type TestEnv } from "./helpers.js";

let env: TestEnv;
const sent: OutgoingMessage[] = [];
let failNext = 0;
const fake: Notifier = {
  name: "fake",
  delivers: true,
  async send(m) {
    if (failNext > 0) {
      failNext--;
      throw new Error("provider down");
    }
    sent.push(m);
    return { providerMessageId: `wamid.${sent.length}` };
  },
};

beforeAll(async () => {
  env = await setup();
  env.ctx.notifier = fake;
  env.ctx.customerAppUrl = "https://order.example.in";
});
afterAll(async () => teardown(env));

const as = (s: StaffSession) => ({ authorization: `Bearer ${s.token}` });
const act = (s: StaffSession, id: string, action: string) => env.app.inject({ method: "POST", url: `/v1/staff/orders/${id}/actions`, headers: as(s), payload: { action } });
const drain = async () => {
  while ((await drainOutbox(env.ctx, 50)) > 0);
};

describe("customer WhatsApp messages", () => {
  it("confirms a paid order with its pickup code, total and tracking link, then says when it's ready", async () => {
    sent.length = 0;
    const order = await env.placeOrder([env.line("Cappuccino")]);
    await drain();
    const view = await env.track(order.trackingToken);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "9876543210", template: "order_confirmed" });
    expect(sent[0]!.text).toBe(`Hi Priya, your order ${view.pickupCode} at 400 Coffee Cafe Tower A is confirmed. Total ₹180. Track it here: https://order.example.in/order/${order.trackingToken}`);

    await act(env.kitchenA, order.orderId, "START");
    await drain();
    expect(sent).toHaveLength(1); // "preparing" doesn't need a message
    await act(env.kitchenA, order.orderId, "MARK_READY");
    await drain();
    expect(sent[1]!.text).toBe(`Priya, your order ${view.pickupCode} is ready! Please collect it at the Tower A counter.`);
  });

  it("tells the customer when an order is rejected, including the refund", async () => {
    sent.length = 0;
    const order = await env.placeOrder([env.line("Cappuccino")]);
    await drain();
    const r = await env.app.inject({ method: "POST", url: `/v1/staff/orders/${order.orderId}/reject`, headers: as(env.cashierA), payload: { reason: "Milk ran out" } });
    expect(r.statusCode).toBe(200);
    await drain();
    const last = sent.at(-1)!;
    expect(last.template).toBe("order_cancelled");
    expect(last.text).toContain("was cancelled: Milk ran out. Your refund of ₹180 is on its way.");
  });

  it("never sends the same message twice when a job is retried", async () => {
    sent.length = 0;
    failNext = 1;
    const order = await env.placeOrder([env.line("Americano")]);
    await drain(); // first attempt fails and is rescheduled
    expect(sent).toHaveLength(0);
    const [job] = await env.db.select().from(outbox).where(eq(outbox.lastError, "Error: provider down"));
    expect(job!.attempts).toBe(1);
    expect(await notifyCustomer(env.ctx, job!.id, order.orderId, "PLACED")).toBe("sent");
    expect(await notifyCustomer(env.ctx, job!.id, order.orderId, "PLACED")).toBe("already-sent");
    expect(sent).toHaveLength(1);
  });

  it("shows the owner every message with the phone number masked", async () => {
    expect((await env.app.inject({ method: "GET", url: "/v1/admin/notifications", headers: as(env.cashierA) })).statusCode).toBe(403);
    const r = (await env.app.inject({ method: "GET", url: "/v1/admin/notifications", headers: as(env.admin) })).json() as {
      messages: Array<{ to: string; status: string; body: string; orderCode: string; outlet: string }>;
    };
    expect(r.messages.length).toBeGreaterThanOrEqual(4);
    expect(r.messages.every((m) => m.to === "••••••3210")).toBe(true);
    expect(r.messages.some((m) => m.status === "SENT")).toBe(true);
    expect(JSON.stringify(r)).not.toContain("9876543210");
  });
});

describe("WhatsApp Cloud API sender", () => {
  it("sends an approved template with the parameters in order", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchStub = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ messages: [{ id: "wamid.ABC" }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const n = new MetaWhatsAppNotifier("tok", "12345", "en", fetchStub);
    const r = await n.send({ to: "9876543210", template: "order_ready", params: ["Priya", "A-001", "Tower A"], text: "" });
    expect(r.providerMessageId).toBe("wamid.ABC");
    expect(calls[0]!.url).toBe("https://graph.facebook.com/v21.0/12345/messages");
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      messaging_product: "whatsapp",
      to: "919876543210",
      type: "template",
      template: { name: "order_ready", language: { code: "en" }, components: [{ type: "body", parameters: [{ type: "text", text: "Priya" }, { type: "text", text: "A-001" }, { type: "text", text: "Tower A" }] }] },
    });
  });

  it("reports provider errors so the job is retried", async () => {
    const fetchStub = (async () => new Response(JSON.stringify({ error: { message: "Template not approved" } }), { status: 400 })) as unknown as typeof fetch;
    const n = new MetaWhatsAppNotifier("tok", "12345", "en", fetchStub);
    await expect(n.send({ to: "9876543210", template: "order_ready", params: [], text: "" })).rejects.toThrow(/Template not approved/);
  });
});
