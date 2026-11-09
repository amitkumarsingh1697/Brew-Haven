# Customer WhatsApp messages

Customers get a message when their order is confirmed, when it's ready, when an item runs out after payment, and when an order is cancelled. Until a provider is connected, the API runs with `NOTIFY_PROVIDER=log`. Every message is still written and shown to the owner in **Setup › Customer messages** as a preview, so the demo shows exactly what customers will get.

## Templates to register

WhatsApp only allows business-initiated messages through pre-approved templates. Register these four, category **Utility**, language **English (en)**, with exactly these names and bodies:

| Name | Body |
|---|---|
| `order_confirmed` | Hi {{1}}, your order {{2}} at {{3}} is confirmed. Total {{4}}. Track it here: {{5}} |
| `order_ready` | {{1}}, your order {{2}} is ready! Please collect it at the {{3}} counter. |
| `order_action_required` | {{1}}, an item in your order {{2}} has just run out. Please choose a replacement, remove it or cancel here: {{3}} |
| `order_cancelled` | {{1}}, your order {{2}} at {{3}} was cancelled: {{4}}. {{5}} |

The source of truth is `TEMPLATES` in `apps/api/src/notify/provider.ts`.

## Connecting the WhatsApp Cloud API (Meta)

1. Set up a WhatsApp Business Account and a phone number in Meta Business Manager, and get the templates above approved.
2. Create a system-user access token with `whatsapp_business_messaging` permission.
3. On the API service, set:
   - `NOTIFY_PROVIDER=meta`
   - `WHATSAPP_TOKEN`
   - `WHATSAPP_PHONE_NUMBER_ID`
   - `WHATSAPP_TEMPLATE_LANGUAGE` (optional, default `en`)
   - `CUSTOMER_APP_URL`, used for tracking links

Another provider (Gupshup, Twilio, Interakt, or an SMS gateway) is one more class implementing `Notifier` in the same file.

## Guarantees

* Messages are sent from the transactional outbox after the order change commits, so a slow provider never delays the counter.
* Each outbox job sends at most once. A retried job finds the existing message and won't send it again.
* Failures retry with backoff, up to 8 attempts, and show as "Failed, retrying" in the owner's view.
* Only order-update consent is used (it is required at checkout). Marketing messages would need the separate offers consent and their own templates.
* The owner's view masks phone numbers (••••••3210).
