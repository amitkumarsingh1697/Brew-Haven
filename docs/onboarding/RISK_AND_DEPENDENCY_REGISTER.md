# 400 Coffee — Risk & Dependency Register

Prepared 07 November 2026.

**Scoring:** Probability (P) and Impact (I) are each 1–5, and Score = P × I. Bands: **High ≥ 15**, Medium 8–14, Low ≤ 7. Registers are sorted by score. Scores are this reviewer's judgement from the documents; the team should re-score them in Sprint 0.

## 1. Technical risks

| ID | Risk | Source / evidence | P | I | Score | Mitigation |
|---|---|---|---|---|---|---|
| TR-01 | The customer build starts without a backend, so mocks drift from the eventual APIs and integration is late and expensive | 12 says "mock if absent"; backend sprints S1–S6 are not sequenced against CX; no repo | 4 | 5 | **20** | Contract-first OpenAPI owned by the backend lead; consumer contract tests; build the backend catalog/quote/order slice first or in parallel |
| TR-02 | 3D scene fails performance targets on mid-range Android (jank, memory crash, slow LCP) | 02 §2.1 makes R3F conditional; no budgets | 4 | 4 | **16** | Feasibility spike in Sprint 0; 2D-first architecture; adaptive quality; numeric budgets |
| TR-03 | No canonical order or payment state machine, so client and server disagree | C-03, C-04 | 4 | 4 | **16** | One state-machine ADR before Sprint 1 |
| TR-04 | Cashier acceptance (ADR-003) has no UI in scope, so customer orders sit at "awaiting acceptance" during the pilot | 01 §1.1 excludes POS; ADR-003 | 4 | 4 | **16** | Include a minimal staff acceptance/verification screen in the pilot or default to auto-release |
| TR-05 | In-app browsers (WhatsApp, Instagram, camera-app QR webviews) block WebGL or storage, breaking basket persistence | No browser matrix (SO-8) | 3 | 4 | 12 | Include webviews in the device matrix; 2D fallback; server-side basket option |
| TR-06 | Realtime transport undecided; KDS/customer status latency targets missed | 02 §1 | 2 | 3 | 6 | SSE with polling fallback (ADR-005 already makes REST authoritative) |
| TR-07 | Reconnect storm or KDS stale queue | 02 §8 | 2 | 4 | 8 | TC-015; reconnect backoff with jitter |

## 2. Business risks

| ID | Risk | Source / evidence | P | I | Score | Mitigation |
|---|---|---|---|---|---|---|
| BR-01 | Contract signed on figures that exclude the v1.1 immersive scope (3D, photography, payment and WhatsApp integration) | 08 §8.1 says the figures are invalid for v1.1 | 4 | 5 | **20** | Re-estimate before any binding quote; separate 3D/asset line items |
| BR-02 | "Approved" direction is not actually signed; rework after client review | MANIFEST/01 say "approved"; 15 slide 12 asks for approval | 4 | 4 | **16** | Formal sign-off record (SO-9) |
| BR-03 | Effort baseline is unrealistic: 1,250 h over 24 weeks is about 1.3 FTE against a 6-role team, and the 12-sprint baseline already includes R2/R3 work (S9–S11) while the price covers R1 only | 04 §1–2; 08 §1–2; 10 | 4 | 4 | **16** | Bottom-up re-estimate by release |
| BR-04 | Virtual Café is branded to 400 Coffee, so it is not reusable for other tenants, which undermines the SaaS thesis and creates IP ambiguity | 01 §1 against 13 | 3 | 4 | 12 | Decide theming strategy (SO-15); IP clause [07] |
| BR-05 | Commercial relationship undefined (paid pilot, design partner or demo) | 01 §10; 08 §8 | 3 | 4 | 12 | Commercial decision before Sprint 1 |
| BR-06 | Staff resist the new steps (verification, acceptance) | 04 §7 | 3 | 3 | 9 | Floor observation, training, minimal taps |
| BR-07 | Customers abandon at the identity or WhatsApp-consent step or the long cinematic intro | Inference | 3 | 3 | 9 | Skip intro; funnel analytics; phone-optional option |

## 3. Integration risks

| ID | Risk | Source / evidence | P | I | Score | Mitigation |
|---|---|---|---|---|---|---|
| IR-01 | Payment provider onboarding (KYC, sandbox, webhook access) not ready in time for CX-S7 | SO-4 not started | 4 | 4 | **16** | Start onboarding in Sprint 0; feature-flag pay-now; pay-at-counter fallback |
| IR-02 | WhatsApp templates rejected or delayed | SO-5 | 3 | 3 | 9 | Submit early; asynchronous design already prevents order impact |
| IR-03 | Pay-now before acceptance creates refunds when the café rejects an order; no refund integration or policy | Lifecycle gap | 3 | 4 | 12 | Decide policy (SO-6); option to pay only after acceptance |
| IR-04 | Bill-lookup verification factor requires OTP (SMS/WhatsApp), an unplanned dependency | FR-CX-013 | 3 | 3 | 9 | Decide factor; consider order-stored phone match plus rate limiting |
| IR-05 | Webhook endpoint unreachable or misconfigured, so payments are stuck as pending | 02 §2.5 | 2 | 4 | 8 | Status-API reconciliation job; alerting |

## 4. Security risks

| ID | Risk | Source / evidence | P | I | Score | Mitigation |
|---|---|---|---|---|---|---|
| SR-01 | False "paid" state (client trust, replayed webhook, amount mismatch) | Critical defect class [06 §5] | 2 | 5 | 10 | Invariants already documented; webhook signature and idempotency tests CX-T15 |
| SR-02 | Bill and order enumeration via public references or lookup | 02 §2.9 | 3 | 4 | 12 | Opaque refs (concept image shows "400-1842", sequential-looking); rate limits; CX-T19 |
| SR-03 | Cross-tenant data exposure | ADR-006 | 2 | 5 | 10 | TC-001 negative tests; consider RLS |
| SR-04 | Phone numbers leak into logs or analytics | 12; CX-T24 | 3 | 4 | 12 | Scrubbing middleware; hashed identifiers |
| SR-05 | Abuse of the public order endpoint (spam orders) | 02 §2.9 | 3 | 3 | 9 | Rate limits, signed QR context, cashier acceptance |
| SR-06 | No threat model yet | 04 S0 planned | 4 | 3 | 12 | Complete in Sprint 0 |

## 5. Performance risks

| ID | Risk | Source / evidence | P | I | Score | Mitigation |
|---|---|---|---|---|---|---|
| PR-01 | Peak load is unknown because concurrency was never measured | 06 §3 forbids deriving it from daily volume | 4 | 3 | 12 | Measure peak; load test at 3× |
| PR-02 | 3D asset weight on mobile data | NFR-07 | 4 | 3 | 12 | Budgets; CDN; poster-first load |
| PR-03 | Café Wi-Fi is unreliable for staff devices | 04 §7 | 3 | 4 | 12 | Device qualification; local drafts (FR-015) |

## 6. Design and 3D asset dependencies

| ID | Dependency | Needed by | Owner | Status | Lead-time risk |
|---|---|---|---|---|---|
| DD-01 | Logo, brand guide, licensed fonts | CX-S1 tokens | 400 Coffee | Not supplied | Medium |
| DD-02 | Final palette (olive/grey conflict) and contrast-checked tokens | CX-S1 | UX designer | Conflicting | Low |
| DD-03 | Manager character concept, model, rig, animations | CX-S2 | Unassigned | Not started | **High** |
| DD-04 | Café environment model, baked lighting | CX-S2 | Unassigned | Not started | **High** |
| DD-05 | 2D fallback artwork and poster | CX-S2 (and the default path) | UX designer | Not started | Medium |
| DD-06 | Product photography (licensed) | CX-S3 | 400 Coffee | Not started | Medium |
| DD-07 | Corrected and complete concept screens (11) | Visual QA [06 §6.2] | UX designer | 6 of 11, with defects | Medium |
| DD-08 | Standalone `UI_Concept_Screenshots/` folder | Reference | Package author | **Supplied 08 Nov 2026** (identical to the deck images) | Closed |
| DD-09 | Approved microcopy and dialogue | CX-S2–S6 | 400 Coffee / UX | Draft exists [03 §3.5; 13] | Low |

## 7. External vendor dependencies

| ID | Vendor / provider | Needed for | Status | Notes |
|---|---|---|---|---|
| VD-01 | Payment gateway / UPI provider | Pay-now, refunds, bill payment | Not selected | Merchant KYC lead time |
| VD-02 | WhatsApp BSP / Meta Business | Notifications | Not selected | Template approval |
| VD-03 | Cloud provider, managed DB, CDN | All environments | Not selected | Region and residency |
| VD-04 | Identity provider (staff) | Staff auth | Not selected | [01 §10] |
| VD-05 | Observability and error tracking | Ops | Not selected | |
| VD-06 | 3D/animation studio (if outsourced) | Scene | Not selected | Cost excluded from current quote |
| VD-07 | Photographer | Menu imagery | Not selected | Client responsibility [08 §8.2] |
| VD-08 | OTP/SMS provider (if bill lookup uses OTP) | FR-CX-013 | Not decided | Conditional |
| VD-09 | Legal counsel and tax adviser | Templates, GST, consent | Not engaged | [07] |
| VD-10 | Thermal printer / tablet suppliers | POS/KDS | Not selected | Out of v1.1 scope |

## 8. Operational dependencies

| ID | Dependency | Why | Owner | Status |
|---|---|---|---|---|
| OD-01 | Cashier acceptance and payment-verification UI in the café | Customer orders must be accepted, and counter payments recorded | Supplier (POS workstream) | Out of v1.1 scope, unscheduled |
| OD-02 | Staff training and floor support | Adoption [04 §7] | Supplier + café | Planned in CX-S11 |
| OD-03 | Downtime fallback procedure (paper or static menu) | Café keeps trading if the platform fails | Café + supplier | **Not documented** |
| OD-04 | Support hours, SLA, incident contacts | Live operations [07 C] | Both | Not defined |
| OD-05 | Table QR printing and placement | Customer entry | Café | Not defined |
| OD-06 | Café Wi-Fi qualification | Staff devices | Café | Not done |
| OD-07 | Nominated acceptance testers | UAT [08 §8.2] | 400 Coffee | Not named |
| OD-08 | Runbooks (payment mismatch, KDS reconnect, restore, …) | Launch gate [01 §9] | Supplier | Listed [02 §9], not written |

## 9. Top risks (score 15 and above)

TR-01, BR-01 (both 20); TR-02, TR-03, TR-04, BR-02, BR-03, IR-01 (all 16).
