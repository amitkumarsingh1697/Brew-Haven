# 400 Coffee — Claude Code Master Build Prompt (v1.1)

Paste this complete prompt into Claude Code after opening the actual application repository. The authoritative detailed version is also supplied as DOCX and PDF.

## Role and delivery standard
Act as a senior product engineering team: principal frontend engineer, 3D web experience engineer, backend integration engineer, accessibility specialist, QA lead and release engineer. Build the 400 Coffee customer-facing Virtual Café. Approved direction: interactive experience, 3D manager, cinematic camera. Do not reinterpret it as a conventional dashboard, generic e-commerce site, plain QR menu or static mockup.

## Scope boundary
Build customer side only. Do not redesign or implement cashier POS, kitchen display, owner dashboard or platform admin in this task. Implement typed API contracts, mocks and adapters only where needed. Never claim backend, payment, WhatsApp or restaurant synchronization is live unless credentials, endpoints and successful end-to-end tests prove it.

## Mandatory working method — no one-shot code dump
1. Inspect the complete repository first: file tree, package manifests, framework, routes, design system, backend contracts, environment variables, tests, lint/typecheck/build scripts and deployment assumptions.
2. Produce an implementation plan, dependency map, file-change plan and risk register. Identify unknowns; never invent endpoints, credentials, provider capabilities or menu content.
3. Create a recoverable checkpoint before major changes. Do not delete working code to make a clean rewrite.
4. Implement small vertical slices. After each slice, run typecheck, lint, unit tests and production build; fix regressions before continuing.
5. Use browser testing (Playwright or the repository's existing framework) at 360×800, 390×844, 768×1024 and 1440×900. Capture screenshots at journey milestones.
6. Continue build → run → inspect → fix → retest until every applicable acceptance criterion passes. Do not stop at the first plausible screen.
7. If integration credentials are absent, build a clearly labelled sandbox/mock adapter and contract tests. Mark integration BLOCKED / NOT CONNECTED; never simulate real success in production mode.
8. Report changed files, commands run, test results, screenshots, limitations, configuration and exact local run instructions. Do not claim tests passed unless executed.

## Full customer journey
1. Entry: customer scans outlet QR or opens the PWA. Show cinematic camera push/dolly into a warm café: walnut counter, espresso machine, shelves, brass details, amber lighting, subtle steam and depth. A 3D manager stands behind the counter and says: “Welcome to 400 Coffee. How can I help you today?” Show “View menu & place order” and “Pay bill”. Include “Skip intro”. Camera settles before interaction. No mandatory login/app installation.
2. Menu: selecting menu opens a vintage leather-bound café diary with tactile page transition. Categories are configurable; suggested categories: Coffee, Hot Beverages, Cold Beverages, Fresh Juices, Sandwiches, Snacks and Desserts. Display approved product images, names, descriptions, availability and live prices. Menu and price data come from backend; sample menu is demo-only.
3. Customization: select size/variant where supported, add-ons, quantity and preparation/cooking instructions (e.g. less spicy, extra toasted, no ice). Show price deltas and line total. Respect backend modifier constraints.
4. Basket: show editable items, variants, extras, notes, quantity, line totals, taxes/fees/discounts and server-calculated grand total. Preserve state through navigation and recoverable refresh.
5. Identity: guest checkout by default. Ask name and mobile with clear purpose. Validate Indian mobile number on client and server. Obtain transactional WhatsApp consent where required; marketing consent is separate and unchecked by default. Do not log raw phone numbers.
6. Review: show full basket, customer details, fulfilment context and price breakdown. Manager asks “Does everything look right?” Back/edit preserves state.
7. Payment choice: “Pay now” or “Pay at takeaway counter”. Pay-later creates an unpaid/due order, never paid. If dine-in is enabled, show only configured fulfilment choices.
8. Pay now: show only configured UPI, QR, credit and debit options. Create payment intent server-side. Use provider-hosted checkout, dynamic QR, deep link or terminal as supported. Never collect/store PAN/CVV. Never trust browser return, screenshot or customer declaration. Show PAID only after verified server-side webhook/status API or authorized merchant verification. Match amount/currency/order reference. Handle pending, failed, expired and retry.
9. Confirmation: show unique order reference, item summary, total, fulfilment instructions and accurate order/payment states. Distinguish submitted/awaiting cashier acceptance, accepted, preparing, ready and completed. WhatsApp transactional message is queued only after durable order creation and consent; payment confirmation only after verified payment. Provider failure does not lose order and must not be reported as sent.
10. Restaurant handoff: submit to shared backend. Customer sees submitted/awaiting acceptance versus accepted/preparing. Backend applies configured cashier acceptance/release policy. Restaurant POS/KDS are not part of this customer-side UI build; use mock adapter or contract tests if backend is unavailable.
11. Pay bill: collect bill/order reference and phone verification factor. Server returns outstanding balance. Never allow arbitrary amount entry in production. Prevent bill enumeration and verify payment server-side.

## Visual system — do not deviate
- Premium cinematic café, warm, tactile, intimate, editorial.
- Espresso #120D0A; walnut #241810; roasted brown #57331F; brass/amber #D9AD70; parchment #F1E4CC; muted warm grey #B8A48B.
- Aged leather, walnut, brushed brass, ceramic, glass and paper. Warm practical lights, subtle volumetric glow and steam.
- Editorial serif for hero/menu titles; legible sans-serif for controls, prices and status.
- No generic SaaS dashboard cards, neon cyberpunk, excessive glassmorphism, emoji as final product art, random gradients, loud animation or tiny controls.
- Use licensed/merchant-supplied product imagery and fonts. No broken remote hotlinks.
- 3D manager/environment must be coherent and polished. Use optimized glTF, baked lighting and low-cost fallback.
- Six supplied UI concept screenshots are direction references, not production assets or proof of implementation. Preserve hierarchy, palette and composition while adapting responsively.
- Design loading, empty, unavailable, validation, network, payment pending/failure, awaiting acceptance and confirmation states.

## Character and camera
Use a warm, welcoming café manager in a dark apron with 400 Coffee branding. Subtle idle breathing/blinking/posture and a short greeting gesture; avoid uncanny exaggerated lip-sync. One optional 1.5–3 second dolly-in; settle before dialogue; visible skip. Never animate camera during typing, product choice, checkout or payment. No autoplay sound. Respect reduced-motion. If WebGL/GPU fails, show a complete 2D fallback with the same functionality.

## Technical requirements
Respect repository stack. If none exists, recommend React + TypeScript PWA; use Three.js/React Three Fiber only after mobile performance feasibility is demonstrated. Separate scene/presentation state from order/payment domain state. Modules: customer shell/session, café scene, manager dialogue, diary menu, catalog client, customizer, basket, identity/consent, review, checkout/payment adapter, bill lookup, confirmation/status and telemetry. Typed API client, schema validation, error boundaries, safe retries, idempotency keys. Server owns menu price, tax, availability, totals, order lifecycle and payment state. Tenant/outlet scope must come from signed/validated QR/session context; never trust browser-supplied tenant_id. Public API rate limits, anti-enumeration, validation, CSRF/CORS/session protections and secure headers. Exclude PII from analytics/error logs. Respect keyboard, focus, labels, contrast, screen readers and reduced motion. Lazy-load optimized scene assets; pause animation when tab hidden; adaptive quality; menu/checkout usable before 3D finishes. Provide feature flags and `.env.example` without secrets.

## Proposed API contracts — inspect first; do not assume they exist
- GET `/public/outlets/{slug}/experience-config`
- GET `/public/outlets/{slug}/menu`
- POST `/customer/sessions`
- POST `/customer/orders/quote`
- POST `/customer/orders` (idempotency key)
- GET `/customer/orders/{publicRef}`
- POST `/customer/orders/{publicRef}/payment-intents`
- GET `/customer/payment-attempts/{id}`
- POST `/customer/bills/lookup`
- POST `/customer/bills/{publicRef}/payment-intents`
If absent, write OpenAPI/spec and a mock adapter; clearly mark backend integration pending.

## State and payment invariants
- Order and payment are separate state machines.
- Submitted ≠ accepted; accepted ≠ paid; payment intent ≠ paid; browser redirect ≠ paid; static UPI QR scan ≠ paid; WhatsApp sent ≠ order accepted.
- Mutations are idempotent where retries are possible. Critical transitions are server-authoritative and audited.
- Parent order may generate separate kitchen station tickets; customer sees one consistent order status.

## Required tests
Test pay-later and provider-sandbox pay-now journeys; bill lookup; menu API slow/failed; item unavailable after add; price changes before submit; invalid mobile/consent; duplicate taps/network loss; WebGL failure/low GPU/reduced motion; payment pending/delayed/duplicate/invalid webhook/amount mismatch/expiry/failure/refund; WhatsApp outage/retry; restaurant sync delay/duplicate/reconnect; keyboard/screen reader; responsive breakpoints; tenant isolation; bill lookup enumeration; XSS/input injection; rate limits; PII logging; visual regression screenshots.

## Final release gate
Do not declare production-ready until all P0/P1 tests pass, real payment and WhatsApp integrations are verified, fake payment success is impossible, 3D fallback works, order sync recovery is tested, legal copy and menu content are approved, and merchant sign-off is recorded. If a dependency is missing, label the release “prototype / integration pending” and list the exact blocker.
