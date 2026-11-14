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
| Accessibility pass: WCAG 2.2 AA audit clean on 18 screens, keyboard support for pop-ups. See ACCESSIBILITY.md | Merged (#11) |
| Load-test script: 100 customers and 8 staff screens, about 41 orders a second with p95 under 0.6 s and no errors (local). See LOAD_TEST.md | Merged (#12) |

## Sprint 3: billing, payment checks, production readiness, inventory

| Item | Status |
|---|---|
| Receipts and GST tax invoices: per-café numbering per financial year, CGST/SGST split, GSTIN, legal name and FSSAI licence in Café settings, customer receipt page, counter print (80 mm or A4) | Merged (#13) |
| Counter UPI reference check (blocks a reused UTR across all cafés; optional for now, can be made required) and owner "Payment checks": failed or stuck refunds, paid-but-not-served, UPI without reference | Merged (#14) |
| Production readiness: `/health/ready`, chat-webhook alerts for server errors and failed jobs, request references, backup script and restore drill. See OPERATIONS.md | Merged (#15) |
| Inventory: ingredients, recipes (with choices such as oat milk), automatic use on every order, deliveries, waste and shelf counts at the café, low-stock levels and an owner overview. See INVENTORY.md | Merged (#16) |

## Sprint 4: reports, exports, self-serve sign-up, plans

| Item | Status |
|---|---|
| Stock report per café: opening, received, used by sales, wasted, count difference (variance) and closing, with CSV download. See INVENTORY.md | Merged (#17) |
| CSV exports for the accountant: orders, items sold, payments and refunds, day closes, stock movements. See EXPORTS.md | Merged (#18) |
| Self-serve sign-up: a new business creates its account, first café, owner PIN and an optional sample menu at `/signup` on the staff app, then gets a short "what next" guide. Staff devices switch business with "Different business?". See SIGNUP.md | Merged (#19) |
| Plans and limits: Starter (1 café, 5 team), Growth (3, 20), Multi-café (no limits) as placeholders; new businesses start on Starter, the pilot is on Multi-café; owner sees plan and usage in Café settings; we change plans with `pnpm --filter @brew-haven/api plan`. See PLANS.md | Merged (#20) |

## Sprint 5: GST, kitchen speed, offline counter

| Item | Status |
|---|---|
| GST summary in Reports (by rate, by café, invoice numbers issued and cancelled) and a GST invoices CSV for the accountant. See EXPORTS.md | Merged (#21) |
| Brew Haven team view at `/platform`: every business with plan, cafés, team, 30-day orders and sales and last order (totals only); change plan, pause or resume, each recorded in the business's own activity log. Separate email-and-password sign-in. See PLATFORM.md | Merged (#22) |
| Kitchen speed in Reports: paid-to-ready, waiting to start, making and waiting for pickup (typical and slowest 1 in 10), late orders against the owner's target, by café and by hour, slowest late orders. See KITCHEN_SPEED.md | Merged (#23) |
| Counter orders keep working offline: the till keeps the last menu, saves orders it can't send as OFF-1, OFF-2… and sends them when the connection is back, never twice; price changes and refusals are shown to the cashier. See OFFLINE.md | Merged (#24) |

## Sprint 6: pilot readiness

| Item | Status |
|---|---|
| Terms of service (with data processing terms) and privacy policy pages at `/legal/terms` and `/legal/privacy` on the customer app, marked as a draft until the lawyer signs off; linked from sign-up and checkout. Text in `docs/legal` | Merged (#25) |
| Staff training guides for cashier, kitchen and owner (`docs/training`), opened from a Help button in the staff app; the owner can read all three to train staff | Merged (#26) |
| Online ordering funnel in Reports: visits that opened, browsed, added, reached checkout and started paying, and paid orders, from anonymous visit steps with no personal data. See ANALYTICS.md | Merged (#27) |
| Security review: dependency upgrades (drizzle-orm, zod) clearing `pnpm audit`, order links and tokens kept out of logs, PIN and team sign-in limits across addresses. See SECURITY_REVIEW.md | Merged (#28) |

## Sprint 7: plans, WhatsApp, 3D polish

| Item | Status |
|---|---|
| Plan prices (Starter ₹999, Growth ₹1,999, Multi-café ₹3,999 a month; a year for ten months), a 30-day free trial at sign-up, billing status for the owner, and payments recorded by the team. See PLANS.md | Merged (#29) |
| WhatsApp Cloud API made ready to switch on: templates reworded to pass Meta's rules, a script that submits them for approval and shows their status, signed delivery updates (Delivered, Read, Not delivered) in the owner's message log, and no pointless retries for numbers not on WhatsApp. See WHATSAPP_SETUP.md | Merged (#30) |
| 3D café polish without an artist: limewashed plaster wall and a tiled band behind the counter, warm pools of lamplight on the counter, dust drifting in the light (still with reduced motion), a rim light on the barista and a soft vignette. 82 draw calls, inside the 100 budget. See ADR-0003 | Merged (#31) |
| Filmed barista: the café's own barista on video behind the 3D counter, green screen removed in the browser, wave on tap, drawn barista as fallback. Filming guide, clip tool and switch command. See BARISTA_VIDEO.md | In review |
| 400 Coffee Cafe logo: the seal Amit chose, as SVG (main, light, one-colour, icon), shown on the customer welcome screen through the tenant's logo setting. See docs/brand/400_COFFEE_LOGO.md | In review |

## Waiting on Amit

| Item | What's needed |
|---|---|
| Deploy the demo (ADR-0002) | Cloudflare, Render and Neon accounts connected, or their API tokens shared securely |
| Live payments | The café owner's choice of gateway and merchant KYC (Razorpay adapter is ready) |
| Real WhatsApp messages | Steps 1 to 5 of WHATSAPP_SETUP.md: Meta Business verification, a WhatsApp number, a payment method and a system-user token. We do the rest |
| Terms of service and privacy policy | Lawyer review of the draft shared on 12 Nov. The pages are live with a "Draft" notice; once approved, update `docs/legal` and build with `VITE_LEGAL_FINAL=true` |
| Filmed barista | Film the café's barista (with their written consent) following BARISTA_VIDEO.md and share the original files |
