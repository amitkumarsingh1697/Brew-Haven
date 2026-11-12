/**
 * Checks Brew Haven's customer message templates on the WhatsApp Business Account, and submits any
 * that are missing for approval:
 *   pnpm --filter @brew-haven/api whatsapp-templates            # show status
 *   pnpm --filter @brew-haven/api whatsapp-templates --submit   # submit the missing ones
 * Needs WHATSAPP_TOKEN and WHATSAPP_BUSINESS_ACCOUNT_ID (and optionally WHATSAPP_TEMPLATE_LANGUAGE).
 */
import { syncTemplates } from "../notify/templates.js";

const token = process.env.WHATSAPP_TOKEN;
const businessAccountId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
if (!token || !businessAccountId) {
  console.error("Set WHATSAPP_TOKEN and WHATSAPP_BUSINESS_ACCOUNT_ID first.");
  process.exit(1);
}
const submit = process.argv.includes("--submit");
const rows = await syncTemplates({ token, businessAccountId, language: process.env.WHATSAPP_TEMPLATE_LANGUAGE ?? "en", submit, apiVersion: process.env.WHATSAPP_API_VERSION || undefined });
for (const r of rows) console.log(`${r.name.padEnd(24)} ${r.status}${r.submitted ? " (just submitted)" : ""}${r.reason ? `: ${r.reason}` : ""}${r.error ? `: ${r.error}` : ""}`);
if (!submit && rows.some((r) => r.status === "MISSING")) console.log("\nRun again with --submit to send the missing templates for approval.");
if (rows.some((r) => r.error)) process.exit(1);
