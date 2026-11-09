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
| Audit trail of staff and owner actions, owner "Activity" view, security headers, per-IP rate limits | Merged (#7) |
| Customer WhatsApp messages with a pluggable sender (previews only until a provider is chosen); owner "Customer messages" view | Merged (#8) |
| Shift close with cash count and variance (cashier, Today tab); owner Reports tab with sales by day, by café, payment methods, top items, busiest hours, day closes and CSV download | Merged (#9) |
| Installable apps (customer and staff) and offline handling: app shell works offline, saved menu, ordering paused offline, staff warning banner. See OFFLINE.md | Merged (#10) |
| Accessibility pass: WCAG 2.2 AA audit clean on 18 screens, keyboard support for pop-ups. See ACCESSIBILITY.md | In review |
| Load-test script | Planned |

## Waiting on Amit

| Item | What's needed |
|---|---|
| Deploy the demo (ADR-0002) | Cloudflare, Render and Neon accounts connected, or their API tokens shared securely |
| Live payments | The café owner's choice of gateway and merchant KYC (Razorpay adapter is ready) |
| Real WhatsApp messages | Choice of WhatsApp provider (BSP) and approved message templates |
| Saleable 3D polish | A 3D artist for the barista and room models (SOW line) |
