# 400 Coffee — Architecture Review

Prepared 07 November 2026. Each area is split into **Documented** (what the package decides, with its source), **Recommendation** (this reviewer's suggestion; nothing here replaces an approved decision) and **Unresolved**. No GitHub repository is linked yet, so no existing code was inspected.

## 0. Summary

The baseline architecture [02] is coherent and conservative: a modular monolith, PostgreSQL, REST as the source of truth, realtime as advisory, a transactional outbox, a separate payment ledger, and tenant scope derived on the server. The v1.1 addendum layers the customer PWA on top without changing the backend shape. These decisions are sound for one outlet at 200–500 orders/day, and **this review recommends no change to them.**

The main architectural weaknesses are **unmade decisions**, not wrong ones: cloud and region, identity provider, observability, realtime transport, customer framework, 3D approach, payment provider, WhatsApp BSP, and the payment model. Behind those sits one structural dependency: **the customer-side build has no backend to talk to yet.**

## 1. Technology stack

| Layer | Documented | Source | Status |
|---|---|---|---|
| Backend | Java 21, Spring Boot, REST, modular monolith | 02 §1; ADR-001 | Decided (baseline) |
| Database | PostgreSQL, managed | 02 §1 | Decided |
| Cache/queue | Redis "only where justified" | 02 §1 | Deferred |
| Staff clients | React + TypeScript PWAs (POS, KDS) | 02 §1 | Decided |
| Owner/admin | Next.js + TypeScript | 02 §1 | Decided |
| Customer client | React + TypeScript PWA (baseline). v1.1: "React + TypeScript PWA (or Next.js shell)" | 02 §1; 02 §2.1 | **Unresolved** (two options) |
| 3D | Three.js / React Three Fiber **only if** mobile performance and accessibility gates are met; otherwise a pre-rendered or CSS/WebGL hybrid | 02 §2.1; 12 | **Unresolved**, needs a feasibility spike |
| Realtime | "Server-sent events or WebSockets" | 02 §1 | **Unresolved** |
| Infrastructure | Containers, managed PostgreSQL, object storage, logs/metrics/traces, secrets manager, CI/CD | 02 §1 | Pattern decided; provider not chosen |

**Recommendations**
* Choose **React + TypeScript (Vite) PWA** for the customer app, consistent with the staff PWAs and the baseline [02 §1]. Use Next.js only if server rendering is needed for SEO or link previews, which a QR-entry app rarely needs. This keeps a single frontend toolchain across POS, KDS and customer.
* Use a **monorepo** (shared OpenAPI-generated types and a shared design-token package) so the contract-first approach in [02 §6] is enforced mechanically.
* Run a **2-week 3D feasibility spike** in Sprint 0 on a named mid-range Android device before committing to R3F. Exit criteria are proposed in `RECOMMENDED_EXECUTION_PLAN.md`.

## 2. Frontend architecture

**Documented:** customer modules: customer-shell, café-scene, manager-dialogue, diary-menu, catalog-client, product-customizer, basket, customer-identity, order-review, checkout/payment-adapter, bill-lookup, order-confirmation/status, notification-status, telemetry/feature-flags [02 §2.2; 12]. Scene state is separated from domain state, and the server state machine is authoritative [02 §2.1]. Also documented: feature flags for scene, payment methods, WhatsApp and tracking [12]; copy must be configurable [03 §3.5]; typed client, schema validation, error boundaries and idempotency keys [12].

**Recommendations:** treat café-scene as a lazily loaded, optional island over a fully functional 2D DOM app, so the 2D path is the default implementation and 3D is progressive enhancement. That makes FR-CX-002 and CX-T23 true by construction. Keep basket and session state in a single store with persistence in session storage; the "recoverable refresh" rule [01 step 4] needs a TTL decision.

**Unresolved:** the state library, the i18n approach (copy must be configurable, but no language decision exists), the service-worker/offline policy for the customer PWA (customer ordering is online-only [01 FR-015]), and the analytics SDK.

## 3. Backend architecture

**Documented:** domain modules for identity, tenant/subscription, catalog, ordering, kitchen, payments/billing, notifications/analytics and offline sync [02 §3]. A transactional outbox and worker [02 §2]. Commands validate transitions and return authoritative representations [02 §6].

**Gaps:** the package has no canonical **order state machine**; the baseline defines none, and the addendum is "illustrative" [02 §2.3]. The **payment state list** is inconsistent (conflict C-03). Customer-side commands (quote, submit, payment intent, bill lookup) assume a backend that does not yet exist, and no document assigns who builds it or when relative to the customer work.

**Recommendation:** in Sprint 0, publish one ADR with the canonical order and payment state machines, including transitions, actors and terminal states, and generate both server enums and client types from OpenAPI.

## 4. Database architecture

**Documented:** `tenant_id` on every tenant row and `outlet_id` on outlet rows, with composite constraints [02 §4]. Immutable order snapshots of price, tax and modifiers. Parent order with child station tickets. PaymentAttempt, PaymentLedgerEntry and PaymentVerification kept separate. Append-only audit. Versioned expand/contract migrations [02 §9]. Customer data contracts for product, quote, order, payment and consent [13].

**Gaps:** no ERD or physical schema; no customer entity or PII table design (where name and phone live, encryption, retention); no consent table schema beyond fields [13]; no notification/delivery-attempt schema beyond fields [02 §2.6]; no quote persistence or expiry design (`quoteVersion`, `expiresAt` [13]); no bill entity definition for pay-bill.

**Recommendations:** consider PostgreSQL row-level security as defence in depth for ADR-006, as a recommendation only, since ADR-006 already decides service-level enforcement. Encrypt phone numbers at column level or tokenise them, and keep a hash for lookup, so bill lookup and anti-enumeration do not require plaintext search.

## 5. API design

**Documented:** `/api/v1`, JSON, UUIDs, ISO-8601 UTC, decimal strings for money, `Idempotency-Key`, `X-Request-Id`, stable error codes, no cross-tenant existence leaks, OpenAPI, generated types, consumer/provider contract tests [02 §6]. Customer endpoints, illustrative [02 §2.4; 12]:
`GET /public/outlets/{slug}/experience-config`, `GET /public/outlets/{slug}/menu`, `POST /customer/sessions`, `POST /customer/orders/quote`, `POST /customer/orders`, `GET /customer/orders/{publicRef}`, `POST /customer/orders/{publicRef}/payment-intents`, `GET /customer/payment-attempts/{id}`, `POST /customer/bills/lookup`, `POST /customer/bills/{ref}/payment-intents`.

**Findings**
* The customer paths (`/public/…`, `/customer/…`) do not show the `/api/v1` base path required by [02 §6]. Confirm the prefix.
* The path parameter differs: `{ref}` in [02 §2.4] and `{publicRef}` in [12].
* Missing endpoints: webhook receiver(s) (`/webhooks/{provider}`), customer order event stream or poll interval, consent capture (or does it travel inside the order?), outlet open/closed status, and order cancellation by the customer, if that is allowed.
* `GET /customer/payment-attempts/{id}` exposes an internal attempt ID publicly. It needs the same opaque-reference rule applied to orders.

## 6. Authentication and authorisation

**Documented:** staff use authenticated principals, RBAC, MFA for privileged roles "where feasible", and secure cookies with token rotation [02 §8]. Public: QR identifier resolves outlet/table without privileges; random, high-entropy, revocable tracking token; short-lived session tokens; signed outlet/table context [02 §4, §2.9]. Tenant scope is never taken from the client.

**Unresolved:** the identity provider [01 §10]; the role/permission matrix (referenced by TC-018 but not written); the session token format and lifetime; the QR signing scheme (static signed URL against a rotating one); and the bill-lookup "verification factor" (OTP via SMS or WhatsApp, or a match against the phone stored on the order). An OTP would add an external dependency and a cost.

## 7. Payment integrations

**Documented:**
* **Baseline pilot:** static UPI QR with manual verification [ADR-002].
* **v1.1:** a provider-hosted checkout, dynamic QR or deep link; a server payment intent storing provider, intent ID, amount, currency, reference, idempotency key and expiry; signature-verified idempotent webhooks storing immutable events; return-page polling; PCI-compliant hosted card flow and no PAN/CVV [02 §2.5; ADR-CX-06].

**Conflict C-01:** the pilot payment model (ADR-002) and the v1.1 pay-now model are both "decided", in different documents, and ADR-002 has not been formally amended. **Recommendation:** raise ADR-002a, "Payment model for the customer increment", with these options:
* (a) Pay-at-counter only, plus manual static-UPI verification at the counter. Lowest dependency.
* (b) (a) plus provider-hosted pay-now behind a feature flag, enabled when merchant onboarding and sandbox tests pass. **Recommended.**
* (c) Pay-now required from launch.

**Unresolved:** the provider (none named), merchant KYC status, the "terminal flow" mentioned in [01 step 8] (a physical card terminal is not a customer-PWA concern; clarify), refund API usage, settlement reconciliation, MDR, and the policy for paying before acceptance (see the lifecycle gap in `PROJECT_UNDERSTANDING.md` §5).

## 8. WhatsApp integration

**Documented:** WhatsApp Business Platform or an approved BSP; transactional templates only; stored template, consent, destination, message ID, status and retries; outbox-driven; never blocks orders [02 §2.6; ADR-CX-07].
**Unresolved:** the BSP, the business account and display-name approval, the template catalogue and wording, languages, opt-out handling, the delivery-status webhook endpoint, retry and back-off limits, and cost per conversation [08 §6]. **Template approval is outside the team's control, so it should start in Sprint 0.**

## 9. 3D rendering and asset integration

**Documented:** low-poly optimised glTF, KTX2/Basis textures, meshopt/Draco, atlases, lazy environment, baked lighting, adaptive quality, bounded draw calls and texture memory, pause when hidden, 2D fallback, poster, skip, reduced motion [02 §2.7]. Character: stylised and human-like, dark apron with branding, subtle idle and greeting [13]. No lip-sync exaggeration and no autoplay sound [03 §3.3].
**Unresolved:** **no asset exists.** There is no character design, model, rig, animation set, environment, 2D fallback artwork, asset pipeline, polygon or texture budgets, or owner of asset production (in-house versus a vendor). There is no CDN or asset-hosting decision and no asset versioning or cache-busting strategy. Rights in any human likeness need consent [07 §7.2].
**Recommendation:** define numeric budgets in Sprint 0 as proposals for approval. Examples: initial JS ≤ 200 KB gzip before the scene; first 3D frame ≤ 2.5 MB of assets; ≥ 30 fps on the reference device; LCP ≤ 2.5 s on simulated 4G. These numbers are suggestions, not documented decisions.

## 10. Hosting and deployment

**Documented:** local, integration, staging/UAT and production environments; CI/CD with build, tests, static analysis, dependency and container scanning, migration validation, approval and smoke tests; feature flags; backward-compatible migrations; no rollback by discarding orders or ledger entries [02 §9; 04 §6]. The customer PWA is separately deployable [02 §2.1].
**Unresolved:** the cloud provider and region (India data residency should be evaluated with counsel), the domain and subdomains, the CDN, container platform, managed DB tier, and cost [01 §10; 08 §6].

## 11. Monitoring and logging

**Documented:** structured logs with tenant-safe identifiers; metrics for order creation, ticket latency, payment exceptions, queue depth, sync failures, API latency and availability; traces across command-to-event flows; PII scrubbed from telemetry [02 §8; 04 §4.3].
**Unresolved:** the stack (OpenTelemetry plus a vendor, or a cloud-native option), alert thresholds, on-call model and support hours [07 C], frontend RUM and error tracking for the customer PWA, and 3D fallback-rate telemetry.

## 12. Backup and disaster recovery

**Documented:** RPO 15 min and RTO 4 h as planning targets; tested restore and point-in-time recovery; queue rebuild; device reconnect; backup encryption; restore drill at S9 [01 §7; 02 §8; 05 S9].
**Unresolved:** backup retention, cross-region copies, an asset/CDN recovery plan, and **café fallback operation when the platform is down** (paper process or static menu). This last item is operationally critical for a live café and is not documented.

## 13. Security and privacy

**Documented:** an extensive control list [02 §8, §2.9]; legal templates A–L [07]; separate unticked marketing consent; no PII in analytics; retention and deletion to be defined before production.
**Gaps:** the threat model (planned for S0, not done); rate-limit and bot-control numbers; CSP policy; the secret store; the data map; the retention schedule (template K is empty); India data-protection review (the pack defers to counsel); the payment-provider and BSP subprocessor list; and a security test plan beyond the "security review" and pen test at the production gate.

## 14. Scalability and performance

**Documented:** a modular monolith; 3× measured peak load; p95 targets; separate measurement of cold start, reconnect storm, ticket fan-out and report queries [01 §7; 02 §8; 06 §3].
**Gap:** peak orders per minute and concurrent device counts have **not been measured**, and [06] explicitly forbids deriving them from daily volume. Customer-side concurrency (simultaneous 3D sessions) does not affect the backend much, but CDN egress and asset cost scale with it.
**Assessment:** the documented architecture comfortably exceeds the stated volume. No scalability change is recommended.

## 15. ADR status register

| ADR | Decision | Status in package | Review note |
|---|---|---|---|
| ADR-001 | Modular monolith | Decided | Sound |
| ADR-002 | Static UPI QR + manual verification | Decided | **Contradicted by v1.1 pay-now (C-01). Needs an amendment ADR.** |
| ADR-003 | Cashier-led release, configurable auto-release | Decided | Requires a POS acceptance UI, which is out of v1.1 scope |
| ADR-004 | Split kitchen tickets | Decided | Sound |
| ADR-005 | REST authoritative, realtime advisory | Decided | Sound; transport choice still open |
| ADR-006 | Tenant isolation at service/repository + DB constraints | Decided | Sound; consider RLS later |
| ADR-007 | PWA-first hardware | Decided | Printer and device not chosen |
| ADR-CX-01 | Immersive journey over a conventional storefront | Stated as "approved"; **no approval record** (deck 15 slide 12 still asks for approval) | Treat as proposed until signed |
| ADR-CX-02 | Scripted manager, not AI | Decided | Sound |
| ADR-CX-03 | PWA, no mandatory install | Decided | Sound |
| ADR-CX-04 | Server owns prices, totals, lifecycle and payment | Decided | Sound |
| ADR-CX-05 | Mandatory 2D fallback | Decided | Sound |
| ADR-CX-06 | Hosted/approved payment provider, no card storage | Decided | Provider not chosen |
| ADR-CX-07 | WhatsApp asynchronous, not a prerequisite | Decided | Sound |
| — | Customer framework (React PWA or Next.js) | **Missing ADR** | Recommend React PWA |
| — | 3D technology (R3F or hybrid) | **Missing ADR** | Spike first |
| — | Realtime transport (SSE or WS); customer status (poll or SSE) | **Missing ADR** | Recommend SSE plus polling fallback |
| — | Cloud, region, IdP, observability | **Missing ADR** | Open decisions [01 §10] |
| — | Canonical order/payment state machines | **Missing ADR** | Needed before Sprint 1 |
| — | Tenant theming of the Virtual Café | **Missing ADR** | Needed (C-11) |
