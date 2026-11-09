# Sprint log

How the build is being delivered under D-18: one PR per item, merged once CI is green. Items that need Amit's input are listed separately and don't block the rest.

## Done

| Sprint | Item | PR |
|---|---|---|
| 0–1 | Platform, ordering, payments (simulated + Razorpay adapter), staff POS, kitchen display, stock, day summary | #3, #4 |
| 1 | Owner admin panel: cafés, kitchens, menu, staff, settings, QR posters (D-17) | #5 |
| 1 | 3D café welcome scene with 2D fallback (ADR-0003 first cut) | #6 |

## Sprint 2: hardening and owner tools

| Item | Status |
|---|---|
| Audit trail of staff and owner actions, owner "Activity" view, security headers, per-IP rate limits | In review |
| Customer notifications outbox with a pluggable WhatsApp/SMS sender (logs only until a provider is chosen) | Next |
| Shift close with cash count and variance; owner reports across cafés | Planned |
| Installable app and offline handling (PWA) | Planned |
| Accessibility pass; load-test script | Planned |

## Waiting on Amit

| Item | What's needed |
|---|---|
| Deploy the demo (ADR-0002) | Cloudflare, Render and Neon accounts connected, or their API tokens shared securely |
| Live payments | The café owner's choice of gateway and merchant KYC (Razorpay adapter is ready) |
| Real WhatsApp messages | Choice of WhatsApp provider (BSP) and approved message templates |
| Saleable 3D polish | A 3D artist for the barista and room models (SOW line) |
