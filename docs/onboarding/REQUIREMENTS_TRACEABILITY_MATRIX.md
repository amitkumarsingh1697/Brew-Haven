# 400 Coffee — Requirements Traceability Matrix (consolidated)

Prepared 07 November 2026. Analysis only: this file does not replace the starter RTM in `10_RTM_Sprint_Commercial_Workbook.xlsx`; it extends and corrects it.

**Conventions**
* **Priority:** for FR-001–016 this comes from the XLSX RTM sheet (Critical/High/Medium). For FR-CX it is *derived* from the doc 14 tier that covers the requirement (P0 = Critical, P1 = High, P2 = Medium) and is marked "(derived)". NFR priorities are this reviewer's proposal, marked "(proposed)".
* **Acceptance criteria:** quoted or condensed from the source. "None" means no testable criterion exists.
* **Test coverage:** TC-xxx [06 §2], CX-Txx [06 §6.1], AT-nn = doc 14 case number (P0 1–10, P1 11–20, P2 21–25), EPIC = [04 §3].
* **Status:** nothing has been built or tested. Every row is "Specified, not approved, not started" unless noted. **Blocked** means a pre-development decision is needed first.
* Sprint: S = base sprint [04/05/10]; CX-S = customer sprint [04 §4.1].

## 1. Baseline functional requirements (doc 01 §6)

| Req ID | Requirement | Source | Priority | Feature / module | Technical area | Dependencies | Acceptance criteria | Test coverage | Status |
|---|---|---|---|---|---|---|---|---|---|
| FR-001 | Tenant and outlet isolation; audited, purpose-limited platform support | 01 §6; 02 §4, ADR-006 | Critical | Identity & tenant | Backend authz, DB constraints | Identity provider (open) | EPIC A: every tenant-owned API scoped by membership; negative tests on reads, writes, exports, events, public tokens | TC-001; TC-008; TC-018 | Not started |
| FR-002 | Catalog management; prices and taxes versioned and snapshotted per order | 01 §6; 02 §4 | High | Catalog | Backend, DB | Approved menu (SO-1); GST rules (SO-6) | Server total matches config; historical snapshot unchanged after edit | TC-002; CX-T08 | **Blocked** on SO-1/SO-6 for real data |
| FR-003 | POS order creation (dine-in/takeaway, modifiers, notes, server totals, readable order number) | 01 §6 | Critical | POS | POS PWA + API | FR-002 | EPIC B; idempotent create | TC-003; TC-004 | Not started (outside v1.1 build scope) |
| FR-004 | Server-authoritative, audited order lifecycle; idempotency; role-based cancel/edit | 01 §6 | Critical | Ordering | Backend state machine | Canonical order states (C-04); role matrix (G-11) | EPIC B: invalid transitions rejected | TC-016 (cancel); **no explicit invalid-transition TC** | **Blocked**: states and roles undefined |
| FR-005 | Customer QR: secure outlet/table QR, no install, guest submit, secure tracking token | 01 §6 | High | Customer | Customer PWA, public API | Superseded in UX by FR-CX-*; table model (SO-7) | EPIC E | TC-008; CX-T18 | Not started |
| FR-006 | Configurable QR release policy, snapshotted per order | 01 §6; ADR-003 | High | Ordering | Backend config | Owner settings UI (out of v1.1 scope) | Hold and auto-release behave as configured | TC-007; CX-T12 | Not started |
| FR-007 | Split beverage/food tickets; parent readiness aggregated | 01 §6; ADR-004 | Critical | Kitchen | Backend, KDS | Station routing in catalog | EPIC C | TC-005; TC-006 (TC-006 **unmapped in XLSX**) | Not started |
| FR-008 | KDS realtime execution and reconnect recovery | 01 §6; ADR-005 | Critical | Kitchen | KDS PWA, SSE/WS (undecided) | Realtime transport decision (AQ-05) | Queue recovered after reconnect | TC-015 | Not started |
| FR-009 | Payment attempts and ledger separate from order; cash, declaration, verification, partial, overpay, refund, reconciliation | 01 §6; 02 §5 | Critical | Payments | Backend ledger | Payment model decision (C-01) | EPIC D | TC-010; TC-012; TC-013 (TC-012/013 **unmapped in XLSX**) | **Blocked** on C-01 |
| FR-010 | UPI declaration never marks paid; staff verification; duplicate references blocked | 01 §6; ADR-002 | Critical | Payments | Backend, POS | Merchant UPI access (SO-4) | Declaration remains unverified | TC-009; TC-010; TC-011 | Not started |
| FR-011 | Bills/receipts, cashier shifts, reconciliation | 01 §6 | High | Billing | Backend, POS | Invoice format and bill numbering (SO-6) | Shift close stored and auditable | TC-014; **no TC for bill/receipt content** | **Blocked** on SO-6 |
| FR-012 | Owner dashboard metrics, clearly defined | 01 §6 | Critical | Reporting | Owner app, queries | Metric formulas (not written) | EPIC F; reconciles to ledger | TC-017 | Not started; formulas missing |
| FR-013 | Role notifications, in-app first; external configurable | 01 §6 | Medium | Notifications | Outbox, adapter | — | None specific | **XLSX maps to TC-015 (KDS reconnect), which is a mapping error.** No TC covers notifications | **Gap**: no test |
| FR-014 | Audit of critical actions (actor, scope, time, before/after, reason, correlation ID) | 01 §6 | High | Audit | Backend | — | Audit captures actor and reason (EPIC B) | TC-010/016 (indirect); **no dedicated audit-completeness TC** | Partial coverage |
| FR-015 | Staff offline resilience; customer submit online-only | 01 §6 | High | Offline sync | PWA storage | Device model (open) | No acknowledged order lost | TC-019 | Not started |
| FR-016 | SaaS administration with least privilege | 01 §6 | Critical | Platform | Admin app | Plans/entitlements definition | None specific | TC-001; TC-018 (indirect) | Partial coverage |

## 2. Customer experience requirements (doc 01 §1.3, v1.1)

| Req ID | Requirement | Source | Priority | Feature / module | Technical area | Dependencies | Acceptance criteria | Test coverage | Status |
|---|---|---|---|---|---|---|---|---|---|
| FR-CX-001 | Cinematic entry: camera, greeting, ambient motion, two CTAs; reduced motion; skip | 01 §1.3; 03 CX-01; 13 | High (derived) | café-scene, manager-dialogue | 3D (R3F or hybrid, undecided) | 3D assets (SO-3); brand (SO-2); feasibility spike | 01 §1.5; AT-11 | CX-T01; CX-T02; AT-11 | **Blocked** on SO-2/SO-3 |
| FR-CX-002 | High-quality 2D fallback with identical functionality | 01 §1.3; ADR-CX-05 | High (derived) | café-scene | Capability detection | 2D artwork (SO-3) | "3D failure does not prevent ordering" | CX-T03; AT-12 | Blocked on artwork |
| FR-CX-003 | State-driven manager dialogue; never blocks controls; no simulated AI | 01 §1.3; ADR-CX-02 | Medium (derived) | manager-dialogue | Content config | Approved copy | None measurable | AT-22 (gesture subtlety only). **No test that dialogue never blocks controls** | **Gap**: no test |
| FR-CX-004 | Diary menu keeps category, scroll and basket state; keyboard and touch | 01 §1.3; 03 CX-03 | High (derived) | diary-menu | Frontend state | — | AT-16 | CX-T04; AT-16 | Not started |
| FR-CX-005 | Catalog, price, modifier, availability, tax and routing from backend; server recalculates | 01 §1.3; ADR-CX-04 | Critical (derived) | catalog-client, basket | Public API | Backend catalog/quote API (does not exist); SO-1 | AT-2; AT-13 | CX-T08; AT-2; AT-13; AT-15 | **Blocked** on backend + SO-1 |
| FR-CX-006 | Basket: quantity, variants, modifiers, preparation notes, edit/remove, server validation | 01 §1.3; 03 CX-04/05 | High (derived) | product-customizer, basket | Frontend + quote API | Modifier schema | AT-14; AT-15 | CX-T05; CX-T06; CX-T07; AT-14; AT-15 | Not started |
| FR-CX-007 | Guest identity: name and mobile; validate; transactional consent | 01 §1.3; 03 CX-06 | High (derived) | customer-identity | Frontend + API; consent store | **Conflict C-02** (phone optional vs required); consent wording (legal) | AT-17 | CX-T09; AT-17 | **Blocked** on C-02 and consent text |
| FR-CX-008 | Explicit final confirmation; idempotent submit; loading and error states | 01 §1.3; 03 CX-07 | Critical (derived) | order-review | Idempotency-Key | Backend order API | AT-1; AT-3 | CX-T10; CX-T11; AT-1; AT-3; AT-16 | Not started |
| FR-CX-009 | Show only enabled methods; payment separate from order; server-authoritative | 01 §1.3; ADR-CX-06 | Critical (derived) | checkout/payment-adapter | Provider adapter, webhook | **C-01**; provider (SO-4) | AT-5; AT-6; AT-7 | CX-T13; CX-T14; CX-T15; CX-T16; AT-5–7 | **Blocked** on SO-4 |
| FR-CX-010 | Pay at counter: unpaid/due; do not hold the customer | 01 §1.3 | Critical (derived) | checkout | Order API | Cashier receives the order (POS, out of scope) | AT-4 | CX-T12; AT-4 | Partially blocked (no POS to receive) |
| FR-CX-011 | WhatsApp after order/payment events through an approved provider; persist status; safe retry | 01 §1.3; 02 §2.6 | Critical (derived) | notification-status | Outbox, BSP adapter | BSP + templates (SO-5) | AT-8 | CX-T17; AT-8 | **Blocked** on SO-5 |
| FR-CX-012 | Publish order events; recover missed updates by polling or reconnect | 01 §1.3 | Critical (derived) | order-confirmation/status | Events, polling | Backend; realtime decision (AQ-05) | AT-9; AT-18 | CX-T18; AT-9; AT-18 | Not started |
| FR-CX-013 | Bill payment: lookup by reference plus phone verification; outstanding balance only | 01 §1.3; 02 §2.9 | Critical (derived) | bill-lookup | Public API, anti-enumeration | Bills come from POS (out of scope); verification factor undefined (OQ) | AT-10 | CX-T19; CX-T20; AT-10 | **Blocked**: factor and bill source undefined |
| FR-CX-014 | Accessibility and performance: mobile-first, screen reader, keyboard, contrast, reduced motion, skeletons, 2D fallback | 01 §1.3 | High (derived) | all | Frontend | Device/browser matrix (SO-8); numeric budgets (missing) | AT-19; AT-20 | CX-T02; CX-T21; CX-T22; CX-T23; AT-19; AT-20 | Partially testable (no numeric budget) |

## 3. Non-functional requirements

| Req ID | Requirement | Source | Priority | Area | Acceptance criteria | Test coverage | Status / gap |
|---|---|---|---|---|---|---|---|
| NFR-01 | p95 reads < 500 ms; p95 order submit < 1 s; kitchen update < 2 s; load at 3× measured peak | 01 §7; 06 §3 | Critical (proposed) | Performance | Stated | TC-020 | Peak orders/minute and concurrency **not measured**; targets "proposed" |
| NFR-02 | 99.5 % monthly availability; RPO 15 min; RTO 4 h | 01 §7; 06 §3 | High (proposed) | Availability/DR | Restore drill | Integration "backup restore" [04 §5]; no TC ID | Planning targets only; hosting undecided |
| NFR-03 | Security controls (TLS, RBAC, secrets, rate limit, validation, scanning, encryption, MFA for privileged roles) | 01 §7; 02 §8, §2.9 | Critical (proposed) | Security | Pen test at production gate [04 §6] | TC-001; TC-008; 12 "Security" tests | No threat model yet (planned S0); no rate-limit values |
| NFR-04 | Privacy: minimal data, retention, deletion, processor roles, PII out of logs | 01 §7; 02 §8; 07 | Critical (proposed) | Privacy | CX-T24; AT-25 | CX-T24; AT-25 | Retention periods undefined; DPDP review pending (07) |
| NFR-05 | Staff usability (tablet-first, large targets, minimal typing) | 01 §7; 03 §8–9 | High (proposed) | UX | 03 §9 exit criteria | Usability tasks [03 §9] | Out of v1.1 scope |
| NFR-06 | Modular monolith, tenant-aware, avoid microservices | 01 §7; ADR-001 | High (proposed) | Architecture | Architecture review | None | Decided |
| NFR-07 | Customer 3D performance: fast first content, lazy load, adaptive quality, checkout usable before 3D | 02 §2.7; 04 §4.3; 13 | Critical (proposed) | Performance/3D | CX-T23; "mid-range Android" | CX-T23; AT-11 | **No numeric budget** (LCP, TTI, JS/asset MB, FPS, memory); reference device not named |
| NFR-08 | Responsive at 360×800, 390×844, 768×1024, 1440×900; no horizontal scroll | 03 §3.4; 06 §6.2 | High (proposed) | UX | CX-T21; AT-19 | CX-T21; AT-19 | Defined |
| NFR-09 | Motion timings (entrance 1.5–3 s; diary 250–450 ms; checkout < 250 ms) | 03 §3.3; 13 | Medium (proposed) | UX/motion | AT-21 | AT-21 | Diary timing differs: "< 500 ms" [03] vs "250–450 ms" [13]; compatible but should be unified |
| NFR-10 | Accessibility (WCAG-informed contrast, focus, 44 px, reduced motion) | 03 §1; FR-CX-014 | High (proposed) | A11y | AT-20 | CX-T22; AT-20 | No conformance level (for example WCAG 2.1 AA) stated |
| NFR-11 | Observability: structured logs, metrics, traces | 02 §8 | High (proposed) | Ops | None | None | Stack undecided; **no test** |
| NFR-12 | Browser/device support | 01 §1.5 "common Android/iOS…" | Critical (proposed) | Compatibility | None measurable | CX-T21 (layout only) | **Undefined** (SO-8) |
| NFR-13 | Localisation (language) | Not specified | — | — | — | — | **Missing**: no decision on English-only versus Hindi or other languages |

## 4. Launch gates traced

| Gate | Source | Covered by |
|---|---|---|
| No lost acknowledged orders / duplicate fulfilment / false paid | 01 §9; 04 §6 | TC-003, TC-009, TC-015, CX-T11, AT-1–7 |
| Tenant isolation | 01 §9 | TC-001 |
| Peak-hour simulation, staff sign-off, runbooks | 01 §9 | TC-020; **no TC for runbooks or staff sign-off** (process gates) |
| CX gates (no account, prices match, notes persist, no duplicates, unpaid stays unpaid, WhatsApp failure safe, 3D failure safe, reduced motion, common browsers) | 01 §1.5 | AT-1–20; CX-T01–T24 |
| CX release gate: P0/P1 pass, real payment and WhatsApp verified, legal copy and menu approved, merchant sign-off | 12 Final release gate | AT P0/P1; **no artefact template for merchant sign-off** |

## 5. Coverage findings

**Requirements without testable acceptance criteria or with no test**
1. **FR-013 Notifications:** the XLSX maps it to TC-015 (KDS reconnect), which is wrong. There is no notification test.
2. **FR-CX-003 Character dialogue:** no test that dialogue never blocks controls and is not presented as AI.
3. **FR-004 Order lifecycle:** no explicit invalid-transition test, and no canonical state list to test against.
4. **FR-011 Billing:** no test of bill or receipt content, GST fields or numbering.
5. **FR-014 Audit:** no dedicated audit-completeness test.
6. **FR-016 SaaS admin:** only indirect coverage.
7. **NFR-07, NFR-12, NFR-13:** no numeric or defined criteria.
8. **NFR-11 Observability:** no test.

**Tests not traced to any requirement in the XLSX:** TC-004 (dine-in/takeaway, which belongs to FR-003), TC-006 (parent readiness, FR-007), TC-012 (partial/overpayment, FR-009), TC-013 (refund, FR-009), TC-020 (load, NFR-01). **CX-T01–T24 and AT-1–25 are absent from the XLSX entirely.** The workbook has no FR-CX rows.

**Duplicated test definitions:** CX-T01–T24 [06] and AT-1–25 [14] overlap heavily, with different numbering and no cross-reference. For example, CX-T11 is the same check as AT-3, and CX-T19/T20 cover AT-10. Doc 12 adds a third list ("Required tests"). Recommendation: one canonical customer test catalogue with stable IDs, cross-referenced to FR-CX.

**Requirements missing entirely (no FR exists):** customer-facing cancellation and refund after pay-now and café rejection; order expiry when never accepted; outlet open/closed handling in the CX; customer GST receipt delivery; WhatsApp template catalogue; table/QR code generation and management; experience-config administration; OTP or verification for bill lookup; language support. See `OPEN_QUESTIONS.md`.
