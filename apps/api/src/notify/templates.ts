import { TEMPLATES, TEMPLATE_EXAMPLES, type TemplateName } from "./provider.js";

/** WhatsApp writes {{1}}; Meta's template API wants the same placeholders, with sample values beside them. */
export function templateRequest(name: TemplateName, language: string) {
  return {
    name,
    language,
    category: "UTILITY",
    components: [{ type: "BODY", text: TEMPLATES[name], example: { body_text: [TEMPLATE_EXAMPLES[name]] } }],
  };
}

export interface TemplateState {
  name: TemplateName;
  /** APPROVED, PENDING, REJECTED, PAUSED, … as WhatsApp reports it; MISSING when not registered. */
  status: string;
  reason?: string;
  submitted?: boolean;
  error?: string;
}

/**
 * Compares Brew Haven's templates with those registered on the WhatsApp Business Account, and with
 * `submit` sends any that are missing for approval. Templates already there are never changed: an
 * edit to an approved template goes through Meta's review again, so it is done by hand.
 */
export async function syncTemplates(opts: { token: string; businessAccountId: string; language: string; submit: boolean; apiVersion?: string; fetchImpl?: typeof fetch }): Promise<TemplateState[]> {
  const f = opts.fetchImpl ?? fetch;
  const base = `https://graph.facebook.com/${opts.apiVersion ?? "v23.0"}/${opts.businessAccountId}/message_templates`;
  const headers = { Authorization: `Bearer ${opts.token}`, "Content-Type": "application/json" };
  const res = await f(`${base}?fields=name,status,language,rejected_reason&limit=200`, { headers });
  const body = (await res.json().catch(() => null)) as { data?: Array<{ name: string; status: string; language: string; rejected_reason?: string }>; error?: { message?: string } } | null;
  if (!res.ok) throw new Error(`Could not list WhatsApp templates (${res.status}): ${body?.error?.message ?? "no details"}`);
  const have = new Map((body?.data ?? []).filter((t) => t.language === opts.language).map((t) => [t.name, t]));

  const out: TemplateState[] = [];
  for (const name of Object.keys(TEMPLATES) as TemplateName[]) {
    const t = have.get(name);
    if (t) {
      out.push({ name, status: t.status, ...(t.rejected_reason && t.rejected_reason !== "NONE" ? { reason: t.rejected_reason } : {}) });
      continue;
    }
    if (!opts.submit) {
      out.push({ name, status: "MISSING" });
      continue;
    }
    const r = await f(base, { method: "POST", headers, body: JSON.stringify(templateRequest(name, opts.language)) });
    const rb = (await r.json().catch(() => null)) as { status?: string; error?: { message?: string; error_user_msg?: string } } | null;
    out.push(r.ok ? { name, status: rb?.status ?? "PENDING", submitted: true } : { name, status: "MISSING", error: rb?.error?.error_user_msg ?? rb?.error?.message ?? `HTTP ${r.status}` });
  }
  return out;
}
