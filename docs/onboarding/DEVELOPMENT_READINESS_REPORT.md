# 400 Coffee — Development Readiness Report

Prepared 07 November 2026. No development has been started, and none is recommended until Amit authorises it.

## 1. Overall assessment

**Not ready to start feature development (Sprint 1 / CX-1). Ready to start a decision-focused Sprint 0**, which the package itself plans [04 S0; 04 CX-S0; 05 CX-0].

The documentation is unusually strong on **principles and invariants**: payment truth, server authority, idempotency, tenant isolation, fallback, accessibility. Those parts can be implemented as written. What is missing is the **inputs and decisions** that features depend on. None of the 10 pre-development sign-off items is approved. Two foundational models (payment and phone capture) conflict between the baseline and the v1.1 addendum. The customer build has no backend, repository or owner to integrate with. And the commercial basis is explicitly invalid for the v1.1 scope.

No readiness percentage is given, as instructed. The assessment rests on the criteria below.

## 2. Assessment criteria

| # | Criterion | What "ready" means | Finding | Result |
|---|---|---|---|---|
| 1 | Scope boundary is clear and agreed | One agreed statement of what the first build includes | "Customer side only" [12] conflicts with end-to-end acceptance that needs backend and cashier [01 §1.5; C-12]; base R1 against CX scope unreconciled | **Not met** |
| 2 | Functional requirements complete and testable | Every in-scope FR has acceptance criteria and a test | 30 FRs are well formed; 8 coverage gaps; about 15 missing FRs (refund-on-reject, expiry, cancellation, receipts, …) | Partially met |
| 3 | NFRs measurable | Numeric targets for in-scope surfaces | Backend p95 targets exist; customer and 3D budgets and the device matrix are absent | Partially met |
| 4 | Conflicts resolved | No open contradictions in scope-critical areas | 21 conflicts logged; C-01, C-02, C-03/04, C-11, C-12, C-14 affect design | **Not met** |
| 5 | Architecture decisions made | ADRs for stack, hosting, identity, integration | Core ADRs sound; 7 needed ADRs missing (framework, 3D, realtime, cloud, IdP, state machines, theming) | Partially met |
| 6 | External dependencies initiated | Provider accounts, sandboxes, templates in progress | Payment provider, BSP, hosting, IdP not selected | **Not met** |
| 7 | Content and assets available | Menu, prices, tax, brand, fonts, 3D, photos | Placeholders only | **Not met** |
| 8 | UX baseline approved | Signed journey and complete screen set | 6 of 11 concepts, with defects; no sign-off record | **Not met** |
| 9 | Delivery plan coherent | One integrated sprint plan with owners | Four inconsistent CX plans; base and CX not integrated; no team named | **Not met** |
| 10 | Commercial and legal basis | Signed or at least re-estimated scope and price; counsel engaged | Figures invalid for v1.1 [08 §8.1]; legal pack is a checklist | **Not met** |
| 11 | Engineering environment | Repo, CI, environments | No repository linked | **Not met** |
| 12 | Quality gates defined | DoR/DoD, severity, go/no-go | Well defined [04 §4; 06 §5; 14] | **Met** |

## 3. Critical blockers (must clear before feature development)

| ID | Blocker | Clears when | Owner |
|---|---|---|---|
| CB-1 | Scope of the first build and backend ownership (C-12) | Written scope statement naming who builds backend and minimal staff acceptance | Amit / business |
| CB-2 | Payment model for launch (C-01) | ADR-002a approved | Business + tech lead |
| CB-3 | Canonical order and payment state machines (C-03, C-04) | ADR published and agreed | Tech lead |
| CB-4 | GST, pricing, refund and cancellation rules (SO-6) | Rules sheet approved by owner and tax adviser | 400 Coffee |
| CB-5 | Repository and environments | Repo created, CI baseline, hosting ADR (SO-10) | Tech lead |
| CB-6 | Commercial re-estimate and engagement type (C-09, C-10, BR-01) | Revised estimate accepted | Business |

## 4. High-priority gaps (resolve in Sprint 0; some can overlap early sprints)

* SO-1 menu data (a demo seed allows early UI work).
* SO-2 brand, fonts and final palette (C-05/C-06).
* SO-7 fulfilment model (C-14).
* SO-8 device and browser matrix, plus numeric performance budgets.
* SO-9 corrected and complete concept set with sign-off.
* C-02 phone-capture rule and consent wording (counsel).
* C-11 tenant theming decision.
* 3D feasibility spike result (A-13).
* Payment provider and WhatsApp BSP selection, with onboarding started (long lead).
* Role/permission matrix; metric formulas.

## 5. Items that can be resolved during development

* Microcopy and dialogue finalisation (configurable by design).
* Diary transition timing (C-19); endpoint naming (C-20).
* Search on the menu (optional).
* Final 3D assets: build 2D-first and swap in the scene when assets land (CX-S2 later).
* WhatsApp template wording: the outbox and adapter can be built against a mock.
* Pay-now provider adapter: pay-at-counter ships first.
* Observability vendor specifics (logging conventions decided now, vendor later).
* Merging duplicated test catalogues (do it in Sprint 0–1).
* PDF and version hygiene of the package (DP-01–DP-10).

## 6. Items requiring business approval

1. First-build scope and team/ownership (CB-1).
2. Payment model (C-01) and pay-before or after acceptance.
3. Mandatory mobile number (C-02), with counsel.
4. Takeaway or dine-in (C-14) and default QR release policy.
5. GST, invoice, refund and cancellation policy (SO-6).
6. Menu, prices, images, brand assets (SO-1, SO-2).
7. 3D asset producer and budget (SO-3).
8. Tenant theming and IP ownership of custom assets (C-11; 07).
9. Commercial re-estimate, engagement type, contracting entity (C-09).
10. UX journey and concept sign-off (SO-9).
11. Hosting cost owner and domain (SO-10).
12. Which pitch deck is current (C-15).

## 7. Recommended implementation sequence (summary)

1. **Sprint 0, decisions and spikes:** clear CB-1 to CB-6; start provider, BSP and asset lead-time items; 3D spike; OpenAPI and state ADR; threat model.
2. **Foundations:** repo, CI, environments, tenant/identity, design tokens, customer shell with the **2D path as default**.
3. **Catalog → quote → order** vertical slice, backend and customer together, against real APIs (not long-lived mocks).
4. **Minimal staff acceptance and manual payment verification**, so the pilot loop closes.
5. **Pay-at-counter end to end**, then KDS station tickets (notes reach the kitchen).
6. **3D scene** as progressive enhancement once assets and spike results allow.
7. **Provider pay-now, then bill lookup, then WhatsApp**, each gated on sandbox readiness.
8. **Hardening, device lab, accessibility, load, security, pilot.**

Detail is in `RECOMMENDED_EXECUTION_PLAN.md`.

## 8. Recommended sprint structure

Two-week sprints [05 §1], with two coordinated tracks after Sprint 0: **Platform** (backend plus minimal staff UI) and **Customer** (Virtual Café). They share a contract-first API, a single backlog, a single sprint goal and a joint demo. A fixed 15–20 % capacity reserve is kept for integration and defects [05 §1 plans 70–80 %].

## 9. Estimated timeline and major dependencies

These are **estimates made in this review**, not documented commitments. They assume a 5–6 person cross-functional team (RA-10) and that the Sprint 0 decisions land on time.

| Milestone | Indicative timing from Sprint 0 start | Key dependencies |
|---|---|---|
| Sprint 0 complete (decisions, spike, ADRs) | Week 3 | Owner availability; business decisions |
| Pay-at-counter order loop works end to end in staging (customer → backend → cashier accepts → KDS) | About week 13 | Backend ownership; menu data; tax rules |
| 3D scene integrated (if the spike passes) | About week 15–17 | 3D assets delivered by about week 11 |
| Provider pay-now and bill lookup in sandbox | About week 17–19 | Merchant onboarding; provider sandbox |
| WhatsApp transactional messages | About week 17–19 | BSP and template approval |
| Pilot release candidate (hardening, device lab, UAT) | About week 21–25 | Legal copy; staff training; sign-offs |

For comparison, the package's own base plan reaches the owner dashboard at S8 (about 18 weeks) without the immersive layer. Its CX plans add 9–12 slices, which only fit inside this window if they run in parallel with the platform work.

**Major dependencies on the critical path:** backend ownership, then menu and tax rules, then the order loop; and separately 3D assets, then the scene. Merchant KYC gates pay-now, and BSP approval gates WhatsApp.
