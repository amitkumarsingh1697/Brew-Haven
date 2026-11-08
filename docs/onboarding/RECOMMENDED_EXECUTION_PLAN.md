# 400 Coffee — Recommended Execution Plan

Prepared 07 November 2026. **This is a proposal for Amit and the team to review. It authorises no development.** It reconciles the four inconsistent plans in the package: base S0–S11 [04/05/10], CX-S0–S11 [04 §4.1], CX-0–8 [05 §5.1], and the deck phases and README order [15; README]. It changes no approved product decision; where it proposes a decision, that proposal is labelled.

## 1. Planning principles

1. **Close the loop before adding polish.** A customer order that no one in the café can accept is not a pilot. So the order → acceptance → kitchen → payment loop comes before the 3D scene (consistent with README step 3 and 04 §4.2).
2. **2D-first, 3D as enhancement.** This satisfies ADR-CX-05 and CX-T23 by construction, and removes 3D assets from the critical path.
3. **Contract-first, short-lived mocks.** OpenAPI is owned by the backend; the customer track consumes generated types; mocks are labelled and retired as soon as the real endpoint exists [04 §4.2].
4. **Start long-lead external items in Sprint 0:** merchant KYC, WhatsApp BSP and templates, 3D asset production, photography, counsel.
5. **Every sprint exits on evidence, not screenshots** [05 §5.2].

## 2. Sprint 0: decisions and spikes (2–3 weeks)

| Workstream | Outputs | Exit evidence |
|---|---|---|
| Scope and commercial | Written first-build scope (CB-1); engagement type; revised estimate (C-09/C-10) | Signed scope note; revised estimate accepted |
| Product decisions | Decisions on C-01, C-02, C-11, C-14; release policy default; refund and cancellation policy draft | Decision log entries with owner and date |
| Business inputs | Menu capture template sent; tax/GST workshop; brand assets requested | Rules sheet v1; menu data received or a date committed |
| Architecture | ADRs: state machines, payment model (002a), customer framework, realtime, cloud and region, IdP, observability, theming, repo layout | ADRs merged |
| Contracts | OpenAPI v0 for catalog, quote, order, status, payment intent, webhook, bill lookup | Spec reviewed by both tracks |
| 3D feasibility spike | Placeholder café and rigged character on the reference device | Pass/fail against proposed budgets (for example ≥ 30 fps, first 3D frame ≤ 2.5 MB, no crash after 5 minutes, LCP ≤ 2.5 s with poster) |
| UX | Corrected 6 concepts plus 5 missing screens (CX-02, 06, 07, 08, 11); 2D fallback concept; token sheet with contrast | Client sign-off record (SO-9) |
| Vendors | Payment provider shortlist and onboarding started; BSP selected and templates drafted; 3D producer chosen | Onboarding tickets open |
| Quality | Merged customer test catalogue (CX-T + AT + doc 12) with stable IDs mapped to FR-CX; corrected XLSX RTM mappings; threat model; device and browser matrix | Catalogue and matrix approved |
| Legal | Counsel engaged for privacy notice, consent and customer terms | Engagement confirmed |

## 3. Delivery sprints (two tracks, 2 weeks each)

| Sprint | Platform track (backend + minimal staff) | Customer track (Virtual Café) | Joint exit evidence |
|---|---|---|---|
| 1 | Repo, CI/CD, environments; tenant/outlet, identity, RBAC; audit baseline; tenant isolation tests [base S1] | App shell, routing, session, design tokens, responsive and a11y baseline, feature flags, telemetry with PII scrubbing [CX-S1] | Isolation tests pass; shell deployed to staging at 4 breakpoints |
| 2 | Catalog, modifiers, station routing, tax/charge config, menu import [base S2] | Diary menu (2D) on the real catalog API; customiser [CX-S3, part CX-S4] | Real menu renders from the API; no hardcoded prices |
| 3 | Quote and order APIs, idempotency, order state machine, public tokens [base S3/S6 subset] | Basket, identity and consent, review, idempotent submit [CX-S4/S5] | AT-1–3, CX-T08–T11 pass against the real backend |
| 4 | **Minimal cashier acceptance plus manual payment verification screen**; ledger; release policy [base S5 subset; ADR-003] | Pay-at-counter path, confirmation, order status with polling or SSE recovery [CX-S6; part CX-S7] | **End-to-end pay-at-counter loop in staging** (AT-4, AT-9, CX-T12, CX-T18) |
| 5 | Split KDS station tickets, reconnect [base S4] | 2D fallback polish; error, empty and offline states; unavailable or price-change re-quote | Notes reach station tickets (CX-T06); KDS reconnect (TC-015) |
| 6 | Payment provider adapter, webhook, reconciliation job (sandbox) [CX-S7] | **3D scene** integration (if the spike passed and assets landed), camera, manager, reduced motion [CX-S2] | AT-11/12, CX-T01–T03, CX-T23; sandbox payment verified (AT-5–7) |
| 7 | Bill entity and lookup API; notification outbox plus BSP adapter [CX-S8/S9] | Pay-now UI, bill lookup UI, WhatsApp status display | AT-8, AT-10, CX-T15–T20 |
| 8 | Shift close, exceptions, refunds per policy [base S7 subset] | Visual QA, accessibility, device lab, performance budget run [CX-S10] | AT-19–25; budgets met on the reference device |
| 9 | Load (3× measured peak), security review, restore drill, runbooks, monitoring | Pilot analytics, staff training material, copy and legal text in place [CX-S11] | Go/no-go per 06 §5 and the doc 12 release gate |

**Deferred beyond the pilot (unchanged from the package):** owner dashboard depth (base S8; the pilot needs a minimal collections view), SaaS onboarding and subscriptions (S9/R2), inventory (S10–S11/R3), and R4 items.

**Contingency rule:** if the 3D spike fails or assets are late, Sprint 6 swaps scene work for hardening, and the pilot launches with the 2D café (functionally identical per FR-CX-002). That is a business decision to record, not a silent cut.

## 4. Team structure (proposal)

Product owner (café-side decision authority named), tech lead/backend, backend engineer, frontend engineer, 3D/creative frontend engineer, QA/automation, with part-time UX designer and DevOps/security. This matches the role model in [04 §1]. The current 1,250 h estimate does not support it (C-10).

## 5. Governance

* One backlog and one sprint goal per sprint across both tracks; a joint demo [05 §3].
* A decision log (ADR format [05 §5]) holds C-01–C-21 until closed.
* The steering review at the end of Sprint 0 is the go/no-go for development. **Amit's explicit authorisation is required before Sprint 1.**

## 6. Immediate next steps (non-development)

1. Amit reviews `OPEN_QUESTIONS.md` §4 and takes the business questions to the team and 400 Coffee.
2. ~~Confirm whether doc 11 and `UI_Concept_Screenshots/` exist.~~ Done: both supplied 08 Nov 2026.
3. Link or create the application repository when ready (needed for CB-5).
4. Schedule the menu/tax workshop with the owner and their accountant.
5. Ask the package author to fix DP-02 (₹ glyphs in the commercial PDF) before any external sharing.
