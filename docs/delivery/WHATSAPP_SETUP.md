# Customer WhatsApp messages

Customers get a message when their order is confirmed, when it's ready, when an item runs out
after payment, and when an order is cancelled. Until WhatsApp is connected, the API runs with
`NOTIFY_PROVIDER=log`: every message is still written and shown to the owner in **Setup › Customer
messages** as a preview, so the demo shows exactly what customers will get.

**Provider: Meta's WhatsApp Cloud API, directly** (decided 12 Nov 2026). No reseller (BSP) fee;
Brew Haven pays only Meta's per-message price for utility messages. One Brew Haven number sends for
every café, and each message names the café ("your order A042 at 400 Coffee Cafe Tower A").

## Templates

WhatsApp only allows business-initiated messages through approved templates. These four are
category **Utility**, language **English (en)**. WhatsApp rejects a template that starts or ends with
a placeholder, so each one opens and closes in words.

| Name | Body | Example |
|---|---|---|
| `order_confirmed` | Hi {{1}}, your order {{2}} at {{3}} is confirmed. Total paid: {{4}}. Track it at {{5}} and we'll message you when it's ready. | Priya · A042 · 400 Coffee Cafe Tower A · ₹180 · tracking link |
| `order_ready` | Hi {{1}}, your order {{2}} is ready! Please collect it at the {{3}} counter. Enjoy! | Priya · A042 · Tower A |
| `order_action_required` | Hi {{1}}, an item in your order {{2}} has just run out. Please open {{3}} to choose a replacement, remove the item or cancel the order. | Priya · A042 · tracking link |
| `order_cancelled` | Hi {{1}}, your order {{2}} at {{3}} was cancelled: {{4}}. {{5}} We're sorry about this. | Priya · A042 · 400 Coffee Cafe Tower A · Milk ran out · "Your refund of ₹180 is on its way." |

The source of truth is `TEMPLATES` and `TEMPLATE_EXAMPLES` in `apps/api/src/notify/provider.ts`.
You don't type them into Meta by hand: the script below submits them.

## Connecting, step by step

What Amit (or whoever owns the Meta account) does, once:

1. **Meta Business account.** At business.facebook.com, create or use Inferra Software's business
   account and complete **Business verification** (company documents: GST certificate or
   incorporation certificate, and a matching website or utility bill). This takes a few days.
2. **WhatsApp number.** In Meta for Developers, create an app of type *Business*, add the
   **WhatsApp** product, and add a phone number that is not already on WhatsApp (a new SIM or a
   landline that can receive an OTP call). Set the display name to "Brew Haven"; Meta reviews it.
3. **Payment method** for the WhatsApp Business Account (Meta bills per message; see Meta's rate
   card for India).
4. **Permanent token.** In Business settings › System users, create a system user, give it the app
   and the WhatsApp account, and generate a token with `whatsapp_business_messaging` and
   `whatsapp_business_management`.
5. Share these with us securely (not in chat): the token, the **phone number ID**, the **WhatsApp
   Business Account ID** and the app's **App secret** (App settings › Basic).

What we do then:

6. Set on the API service: `NOTIFY_PROVIDER=meta`, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`,
   `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` (any long random
   string we choose), `CUSTOMER_APP_URL`. Optional: `WHATSAPP_TEMPLATE_LANGUAGE` (default `en`),
   `WHATSAPP_API_VERSION` (default `v23.0`).
7. Submit the templates and check their status:
   ```sh
   pnpm --filter @brew-haven/api whatsapp-templates            # shows APPROVED / PENDING / REJECTED / MISSING
   pnpm --filter @brew-haven/api whatsapp-templates --submit   # submits the missing ones
   ```
   Utility templates are usually approved within minutes to a day. A template already on the
   account is never changed by the script; edit a rejected one in WhatsApp Manager.
8. **Delivery updates.** In the app's WhatsApp › Configuration, set the webhook URL to
   `https://<api>/v1/webhooks/whatsapp` with the verify token from step 6, and subscribe to the
   **messages** field. The owner's message log then shows Sent, Delivered, Read or Not delivered.
9. Place a test order with your own number and check each message arrives.

## Guarantees

* Messages are sent from the transactional outbox after the order change commits, so a slow
  provider never delays the counter.
* Each outbox job sends at most once. A retried job finds the existing message and won't send it again.
* Failures that can clear up (rate limits, Meta outages) retry with backoff, up to 8 attempts, and
  show as "Failed, retrying". Failures retrying can't fix (the number isn't on WhatsApp, a template
  isn't approved) stop at once and show as "Not delivered" with WhatsApp's reason.
* Delivery updates must carry Meta's signature (`X-Hub-Signature-256`, checked with the app
  secret); unsigned ones are refused. A status never moves backwards (a late "delivered" after "read").
* Only order-update consent is used (it is required at checkout). Marketing messages would need the
  separate offers consent and their own Marketing templates.
* The owner's view masks phone numbers (••••••3210).

Another provider (Gupshup, Twilio, Interakt, or an SMS gateway) is one more class implementing
`Notifier` in `apps/api/src/notify/provider.ts`.
