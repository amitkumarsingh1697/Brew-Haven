import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Customer messages (order confirmed, ready, item ran out, cancelled). The sender is pluggable:
 * "log" records the exact message without sending it (demo and until a WhatsApp provider is
 * chosen), "meta" sends approved templates through the WhatsApp Cloud API. Another provider
 * (Gupshup, Twilio, an SMS gateway) is one more class implementing Notifier.
 */
export interface OutgoingMessage {
  /** 10-digit Indian mobile number, as stored. */
  to: string;
  template: TemplateName;
  /** Template body parameters, in order ({{1}}, {{2}}, …). */
  params: string[];
  /** The rendered text, for the owner's message log and for providers that send free text. */
  text: string;
}

export interface Notifier {
  readonly name: string;
  /** True when messages actually leave the system. */
  readonly delivers: boolean;
  send(m: OutgoingMessage): Promise<{ providerMessageId: string | null }>;
}

export type TemplateName = "order_confirmed" | "order_ready" | "order_action_required" | "order_cancelled";

/**
 * Text of each template, registered with WhatsApp for approval (see `whatsapp-templates` script).
 * WhatsApp rejects a template that starts or ends with a {{n}}, so each one opens and closes in words.
 */
export const TEMPLATES: Record<TemplateName, string> = {
  order_confirmed: "Hi {{1}}, your order {{2}} at {{3}} is confirmed. Total paid: {{4}}. Track it at {{5}} and we'll message you when it's ready.",
  order_ready: "Hi {{1}}, your order {{2}} is ready! Please collect it at the {{3}} counter. Enjoy!",
  order_action_required: "Hi {{1}}, an item in your order {{2}} has just run out. Please open {{3}} to choose a replacement, remove the item or cancel the order.",
  order_cancelled: "Hi {{1}}, your order {{2}} at {{3}} was cancelled: {{4}}. {{5}} We're sorry about this.",
};

/** Sample values WhatsApp asks for with each template when it is submitted for approval. */
export const TEMPLATE_EXAMPLES: Record<TemplateName, string[]> = {
  order_confirmed: ["Priya", "A042", "400 Coffee Cafe Tower A", "₹180", "https://order.brewhaven.in/order/abc123"],
  order_ready: ["Priya", "A042", "Tower A"],
  order_action_required: ["Priya", "A042", "https://order.brewhaven.in/order/abc123"],
  order_cancelled: ["Priya", "A042", "400 Coffee Cafe Tower A", "Milk ran out", "Your refund of ₹180 is on its way."],
};

/** A send WhatsApp will never accept as it stands (no such number, template not approved): don't retry. */
export class PermanentSendError extends Error {}

/**
 * WhatsApp Cloud API error codes that retrying can't fix. Anything else (rate limits, outages,
 * an expired token we can renew) is retried by the outbox.
 * https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes
 */
export const PERMANENT_META_CODES = new Set([100, 131008, 131009, 131021, 131026, 131051, 132000, 132001, 132005, 132007, 132012, 132015, 132016, 133010]);

export function render(template: TemplateName, params: string[]) {
  return TEMPLATES[template].replace(/\{\{(\d+)\}\}/g, (_, n: string) => params[Number(n) - 1] ?? "");
}

export class LogNotifier implements Notifier {
  readonly name = "log";
  readonly delivers = false;
  async send() {
    return { providerMessageId: null };
  }
}

/** WhatsApp Cloud API (Meta). Needs an approved template per TemplateName in the given language. */
export class MetaWhatsAppNotifier implements Notifier {
  readonly name = "meta";
  readonly delivers = true;
  constructor(
    private readonly token: string,
    private readonly phoneNumberId: string,
    private readonly language = "en",
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly apiVersion = "v23.0",
  ) {}

  async send(m: OutgoingMessage) {
    const res = await this.fetchImpl(`https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: `91${m.to}`,
        type: "template",
        template: {
          name: m.template,
          language: { code: this.language },
          components: [{ type: "body", parameters: m.params.map((text) => ({ type: "text", text })) }],
        },
      }),
    });
    const body = (await res.json().catch(() => null)) as { messages?: Array<{ id: string }>; error?: { message?: string; code?: number; error_data?: { details?: string } } } | null;
    if (!res.ok) {
      const e = body?.error;
      const msg = `WhatsApp send failed (${res.status}${e?.code ? `, code ${e.code}` : ""}): ${e?.error_data?.details ?? e?.message ?? "no details"}`;
      throw e?.code && PERMANENT_META_CODES.has(e.code) ? new PermanentSendError(msg) : new Error(msg);
    }
    return { providerMessageId: body?.messages?.[0]?.id ?? null };
  }
}

export type DeliveryStatus = "SENT" | "DELIVERED" | "READ" | "REJECTED";
export interface StatusUpdate {
  providerMessageId: string;
  status: DeliveryStatus;
  error?: string;
}

/** Checks the X-Hub-Signature-256 header Meta signs each webhook with, using the app secret. */
export function verifyMetaSignature(rawBody: string, header: string | undefined, appSecret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const a = Buffer.from(header.slice(7));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const META_STATUS: Record<string, DeliveryStatus> = { sent: "SENT", delivered: "DELIVERED", read: "READ", failed: "REJECTED" };

/** Delivery updates (sent, delivered, read, failed) from a WhatsApp Cloud API webhook body. */
export function parseMetaStatuses(body: unknown): StatusUpdate[] {
  type Status = { id?: string; status?: string; errors?: Array<{ code?: number; title?: string; message?: string; error_data?: { details?: string } }> };
  const entries = (body as { entry?: Array<{ changes?: Array<{ value?: { statuses?: Status[] } }> }> } | null)?.entry ?? [];
  const out: StatusUpdate[] = [];
  for (const e of entries)
    for (const c of e.changes ?? [])
      for (const s of c.value?.statuses ?? []) {
        const status = META_STATUS[s.status ?? ""];
        if (!s.id || !status) continue;
        const err = s.errors?.[0];
        out.push({ providerMessageId: s.id, status, ...(err ? { error: `${err.code ?? ""} ${err.error_data?.details ?? err.message ?? err.title ?? ""}`.trim() } : {}) });
      }
  return out;
}
