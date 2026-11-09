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

/** Text of each template. Register these exact bodies with the WhatsApp provider for approval. */
export const TEMPLATES: Record<TemplateName, string> = {
  order_confirmed: "Hi {{1}}, your order {{2}} at {{3}} is confirmed. Total {{4}}. Track it here: {{5}}",
  order_ready: "{{1}}, your order {{2}} is ready! Please collect it at the {{3}} counter.",
  order_action_required: "{{1}}, an item in your order {{2}} has just run out. Please choose a replacement, remove it or cancel here: {{3}}",
  order_cancelled: "{{1}}, your order {{2}} at {{3}} was cancelled: {{4}}. {{5}}",
};

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
    private readonly apiVersion = "v21.0",
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
    const body = (await res.json().catch(() => null)) as { messages?: Array<{ id: string }>; error?: { message?: string } } | null;
    if (!res.ok) throw new Error(`WhatsApp send failed (${res.status}): ${body?.error?.message ?? "no details"}`);
    return { providerMessageId: body?.messages?.[0]?.id ?? null };
  }
}
