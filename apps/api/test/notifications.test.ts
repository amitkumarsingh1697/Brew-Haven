import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { StaffSession } from "@brew-haven/contracts";
import { outbox } from "../src/db/schema.js";
import { createHmac } from "node:crypto";
import { buildApp } from "../src/app.js";
import { notifications } from "../src/db/schema.js";
import { MetaWhatsAppNotifier, PermanentSendError, TEMPLATES, TEMPLATE_EXAMPLES, render, type Notifier, type OutgoingMessage } from "../src/notify/provider.js";
import { syncTemplates } from "../src/notify/templates.js";
import { drainOutbox } from "../src/services/flows.js";
import { notifyCustomer } from "../src/services/notifications.js";
import { setup, teardown, testConfig, type TestEnv } from "./helpers.js";

let env: TestEnv;
const sent: OutgoingMessage[] = [];
let failNext = 0;
let rejectNext = 0;
let nextId = 0;
const fake: Notifier = {
  name: "fake",
  delivers: true,
  async send(m) {
    if (rejectNext > 0) {
      rejectNext--;
      throw new PermanentSendError("WhatsApp send failed (400, code 131026): Message undeliverable");
    }
    if (failNext > 0) {
      failNext--;
      throw new Error("provider down");
    }
    sent.push(m);
    return { providerMessageId: `wamid.${++nextId}` };
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
    expect(sent[0]!.text).toBe(`Hi Priya, your order ${view.pickupCode} at 400 Coffee Cafe Tower A is confirmed. Total paid: ₹180. Track it at https://order.example.in/order/${order.trackingToken} and we'll message you when it's ready.`);

    await act(env.kitchenA, order.orderId, "START");
    await drain();
    expect(sent).toHaveLength(1); // "preparing" doesn't need a message
    await act(env.kitchenA, order.orderId, "MARK_READY");
    await drain();
    expect(sent[1]!.text).toBe(`Hi Priya, your order ${view.pickupCode} is ready! Please collect it at the Tower A counter. Enjoy!`);
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
    expect(calls[0]!.url).toBe("https://graph.facebook.com/v23.0/12345/messages");
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      messaging_product: "whatsapp",
      to: "919876543210",
      type: "template",
      template: { name: "order_ready", language: { code: "en" }, components: [{ type: "body", parameters: [{ type: "text", text: "Priya" }, { type: "text", text: "A-001" }, { type: "text", text: "Tower A" }] }] },
    });
  });

  it("reports provider errors so the job is retried, unless retrying can't help", async () => {
    const reply = (error: object, status = 400) => (async () => new Response(JSON.stringify({ error }), { status })) as unknown as typeof fetch;
    const busy = new MetaWhatsAppNotifier("tok", "12345", "en", reply({ message: "Rate limit hit", code: 130429 }, 429));
    const e1 = await busy.send({ to: "9876543210", template: "order_ready", params: [], text: "" }).catch((e) => e);
    expect(e1).toBeInstanceOf(Error);
    expect(e1).not.toBeInstanceOf(PermanentSendError);
    const nobody = new MetaWhatsAppNotifier("tok", "12345", "en", reply({ message: "Message undeliverable", code: 131026 }));
    await expect(nobody.send({ to: "9876543210", template: "order_ready", params: [], text: "" })).rejects.toBeInstanceOf(PermanentSendError);
  });
});

describe("WhatsApp templates", () => {
  it("open and close in words, as WhatsApp requires, and have a sample for every placeholder", () => {
    for (const [name, text] of Object.entries(TEMPLATES)) {
      expect(text, name).not.toMatch(/^\s*\{\{|\}\}\s*$/);
      const n = new Set(text.match(/\{\{\d+\}\}/g)).size;
      expect(TEMPLATE_EXAMPLES[name as keyof typeof TEMPLATES], name).toHaveLength(n);
      expect(render(name as keyof typeof TEMPLATES, TEMPLATE_EXAMPLES[name as keyof typeof TEMPLATES])).not.toContain("{{");
    }
  });

  it("lists template status and submits only the missing ones", async () => {
    const posted: Array<{ name: string; category: string; components: unknown }> = [];
    const fetchStub = (async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        posted.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify({ id: "1", status: "PENDING", category: "UTILITY" }), { status: 200 });
      }
      expect(url).toContain("/v23.0/WABA1/message_templates?");
      return new Response(
        JSON.stringify({ data: [{ name: "order_ready", status: "APPROVED", language: "en" }, { name: "order_confirmed", status: "REJECTED", language: "en", rejected_reason: "INVALID_FORMAT" }, { name: "order_cancelled", status: "APPROVED", language: "hi" }] }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const look = await syncTemplates({ token: "t", businessAccountId: "WABA1", language: "en", submit: false, fetchImpl: fetchStub });
    expect(look.map((r) => `${r.name}:${r.status}`)).toEqual(["order_confirmed:REJECTED", "order_ready:APPROVED", "order_action_required:MISSING", "order_cancelled:MISSING"]);
    expect(look[0]!.reason).toBe("INVALID_FORMAT");
    expect(posted).toHaveLength(0);

    const done = await syncTemplates({ token: "t", businessAccountId: "WABA1", language: "en", submit: true, fetchImpl: fetchStub });
    expect(posted.map((p) => p.name)).toEqual(["order_action_required", "order_cancelled"]);
    expect(posted[0]).toMatchObject({ category: "UTILITY", language: "en", components: [{ type: "BODY", text: TEMPLATES.order_action_required, example: { body_text: [TEMPLATE_EXAMPLES.order_action_required] } }] });
    expect(done.filter((r) => r.submitted).map((r) => r.status)).toEqual(["PENDING", "PENDING"]);
  });
});

describe("WhatsApp delivery updates", () => {
  const secret = "app-secret";
  let app: Awaited<ReturnType<typeof buildApp>>["app"];
  beforeAll(async () => {
    ({ app } = await buildApp({
      config: { ...testConfig, notifications: { provider: "meta", customerAppUrl: "https://order.example.in", meta: { token: "t", phoneNumberId: "1", language: "en", appSecret: secret, verifyToken: "verify-me" } } },
      db: env.db,
      notifier: fake,
    }));
    await app.ready();
  });
  afterAll(async () => app.close());

  const status = (id: string, s: string, errors?: object[]) => ({ object: "whatsapp_business_account", entry: [{ id: "WABA", changes: [{ field: "messages", value: { statuses: [{ id, status: s, timestamp: "1", recipient_id: "919876543210", ...(errors ? { errors } : {}) }] } }] }] });
  const post = (body: object, sign = secret) => {
    const raw = JSON.stringify(body);
    return app.inject({ method: "POST", url: "/v1/webhooks/whatsapp", headers: { "content-type": "application/json", "x-hub-signature-256": `sha256=${createHmac("sha256", sign).update(raw).digest("hex")}` }, payload: raw });
  };

  it("answers Meta's verification check only with the right token", async () => {
    const ok = await app.inject({ method: "GET", url: "/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345" });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toBe("12345");
    expect((await app.inject({ method: "GET", url: "/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1" })).statusCode).toBe(403);
    // The default (log) setup has no WhatsApp webhook at all.
    expect((await env.app.inject({ method: "GET", url: "/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=1" })).statusCode).toBe(403);
  });

  it("moves a message on to delivered and read, never backwards, and refuses unsigned updates", async () => {
    sent.length = 0;
    const order = await env.placeOrder([env.line("Americano")]);
    await drain();
    const [n] = await env.db.select().from(notifications).where(eq(notifications.orderId, order.orderId));
    const id = n!.providerMessageId!;
    expect((await post(status(id, "delivered"), "wrong")).statusCode).toBe(401);
    expect((await post(status(id, "delivered"))).json()).toEqual({ updated: 1 });
    expect((await post(status(id, "read"))).json()).toEqual({ updated: 1 });
    expect((await post(status(id, "delivered"))).json()).toEqual({ updated: 0 }); // late, out of order
    expect((await post(status("wamid.unknown", "read"))).json()).toEqual({ updated: 0 });
    const [after] = await env.db.select().from(notifications).where(eq(notifications.id, n!.id));
    expect(after!.status).toBe("READ");
  });

  it("records a message WhatsApp couldn't deliver, and doesn't retry one it never will", async () => {
    sent.length = 0;
    const order = await env.placeOrder([env.line("Americano")]);
    await drain();
    const [n] = await env.db.select().from(notifications).where(eq(notifications.orderId, order.orderId));
    await post(status(n!.providerMessageId!, "failed", [{ code: 131026, title: "Message undeliverable", error_data: { details: "Receiver is not on WhatsApp" } }]));
    const [failed] = await env.db.select().from(notifications).where(eq(notifications.id, n!.id));
    expect(failed).toMatchObject({ status: "REJECTED", error: "131026 Receiver is not on WhatsApp" });

    rejectNext = 1;
    const second = await env.placeOrder([env.line("Americano")]);
    await drain();
    const [r] = await env.db.select().from(notifications).where(eq(notifications.orderId, second.orderId));
    expect(r!.status).toBe("REJECTED");
    const [job] = await env.db.select().from(outbox).where(eq(outbox.id, r!.outboxId));
    expect(job!.processedAt).not.toBeNull(); // done, not waiting to retry
    expect(job!.attempts).toBe(0);
  });
});
