# 400 Coffee — Open Questions, Conflicts & Gaps

Prepared 07 November 2026. This file holds the **conflict log** (nothing in it has been silently resolved; each entry gives the original sources and a recommended resolution), the **gap analysis**, and the **question list** for Amit and the team.

Decision owner: **B** = business (400 Coffee / commercial), **P** = product owner, **T** = technical lead, **L** = legal/tax.

## 1. Conflict log

| ID | Conflict | Source A | Source B | Recommended resolution | Owner |
|---|---|---|---|---|---|
| C-01 | **Pilot payment model.** A: static UPI plus manual verification; gateway integration deferred to R2 and out of pilot scope. B: pay-now via provider-hosted UPI, QR and cards with webhooks in the first customer increment. | 01 §3, §5; ADR-002; 08 §1; 09 slide 5 | 01 §1.2 steps 7–8; FR-CX-009; 02 §2.5; ADR-CX-06; 12 §H; 13; 14; 15 slide 7 | Amend ADR-002 (proposed ADR-002a): launch pay-at-counter with manual verification, with provider pay-now behind a feature flag enabled once merchant onboarding and sandbox tests pass | B + T |
| C-02 | **Customer phone number.** A: optional unless an approved operational need exists; minimal data; QR checkout shows "contact optionality". B: name and mobile are collected for every order. | 01 §7 Privacy; 02 §8; 03 QR-04 | 01 §1.2 step 5; FR-CX-007; 03 CX-06; 12 §E; 13 CX-06 | Business and counsel decide. Option: make mobile mandatory only for WhatsApp updates and bill lookup, and record the "operational need" formally | B + L |
| C-03 | **Payment state enumeration.** A: 10 states. B: 13 states (adds PENDING, CUSTOMER_ACTION_REQUIRED, EXPIRED) plus "DUE" in prose. | 02 §5 | 02 §2.3; 12 | One canonical payment state machine ADR; represent "due at counter" as NOT_STARTED plus a payment-method intent, or add DUE explicitly | T |
| C-04 | **Order lifecycle.** The baseline has no defined states but uses events (accepted, released, cancelled). The addendum list is "illustrative". Doc 14 adds "completed" as a customer-visible state; base QR-05 uses "held". | 02 §6; 03 QR-05 | 02 §2.3; 14 #9 | Canonical order state ADR including reject, expire and cancel branches, with actor and reason | T + P |
| C-05 | **Customer colour palette.** A: olive accent, no roasted brown or grey. B: #57331F roasted brown and #B8A48B muted warm grey. The staff palette is a third set. | 03 §3.1 | 12 Visual system | Use doc 12 (the most specific) for the customer surface; confirm olive versus grey; keep the doc 03 §1 palette for staff surfaces | P (design) |
| C-06 | **Typography.** A: one modern sans-serif. B: editorial serif plus sans-serif. No font is named in either. | 03 §1 (staff) | 03 §3.1; 12 (customer) | Split by surface; name licensed fonts (SO-2) | P (design) |
| C-07 | **CX screen inventory.** A: CX-01–CX-11, with CX-11 "Order status". B: CX-01–CX-10, with status merged into CX-10. Base QR-01–07 status is unclear (superseded?). | 03 §3.2 | 13 | Adopt the doc 03 numbering (11 screens); mark QR-01–07 superseded for UX but keep their states (closed outlet, expired token, changed price) as requirements | P |
| C-08 | **CX sprint plan.** A: 12 slices CX-S0–CX-S11. B: 9 slices CX-0–CX-8. C: 4 phases. D: README order (payments only after contracts and sandbox). None is integrated with base S0–S11. | 04 §4.1 | 05 §5.1; 15 slide 11; README | One integrated plan; see `RECOMMENDED_EXECUTION_PLAN.md` | P + T |
| C-09 | **Commercial scope basis.** Pricing is stated as "Pilot Release 1", but the cost basis is the 12-sprint baseline, which includes S9 (R2 hardening) and S10–S11 (R3 inventory). Milestones A–D cover R1 only. | 08 §1, §7 | 08 §2; 04 §2; 10 | Re-estimate per release; price R1 + CX separately | B |
| C-10 | **Effort against team model.** 1,250 h over 12 two-week sprints is about 52 h/week (about 1.3 FTE), against a 6-role team. | 08 §2 | 04 §1 | Bottom-up estimate | B + T |
| C-11 | **SaaS repeatability against a bespoke brand.** "Build a repeatable SaaS product, not a one-off", but the manager is branded "400 Coffee" and the scene is café-specific. The Virtual Café is in no subscription tier. | 01 §1; 08 §4 | 01 §1.1; 12; 13 | Decide: tenant-themeable product feature (asset slots, config) or 400 Coffee custom deliverable (separate IP/licence) | B |
| C-12 | **"Customer side only" against end-to-end acceptance.** The build excludes POS/KDS, yet acceptance needs "cashier workflow receives it", station tickets carrying notes, and a cashier accepting orders. | 01 §1.1; 12; README | 01 §1.5; CX-T06; CX-T12; ADR-003 | Include the minimal backend plus staff acceptance/verification in pilot scope, or accept mock-only verification for those gates explicitly | B + P |
| C-13 | **Reduced-motion behaviour.** A: avoid forced camera movement and keep a static character/environment (3D still allowed). B: reduced motion leads to the 2D scene. | 01 §1.5; 13 Motion | 12 DOCX §A; 14 #12 | Reduced motion means no camera or ambient motion; the renderer stays 3D or 2D by capability. Clarify AT-12 | P |
| C-14 | **Dine-in and tables.** A: outlet/table QR, dine-in with table metadata. B: payment choice only "pay at takeaway counter"; dine-in "if enabled"; "do not invent table numbers". | 01 FR-003/005; 03 QR-01; TC-004 | 01 §1.2 step 7; 12 §F | Owner decision (SO-7); recommend takeaway-first pilot, dine-in configurable | B |
| C-15 | **Two pitch decks.** Doc 09 (v1.0 ops platform, 4 experiences) and doc 15 (v1.1 customer experience only), both labelled v1.1 in PDF. | 09 | 15; 16 | Mark 09 as the platform narrative or archive it; use 15 for the client CX pitch | B |
| C-16 | **Version labels.** DOCX covers and PRD document control say 1.0; PDF covers, footers and MANIFEST say 1.1. | 01–09 DOCX | 01–09 PDF; MANIFEST | Re-issue with one version and a change log | Package author |
| C-17 | **Concept images against spec.** Copy, categories, emoji art, totals (₹500 against ₹765), missing pay-at-counter and status, sequential-looking reference. | 15 images | 03 §3.2–3.5; 12; 13 | Correct and complete the concepts before treating them as the visual QA baseline | P (design) |
| C-18 | **"Approved" against "please approve".** | MANIFEST; 01 §1.1; 03 §3.1 | 15 slide 12; 16 #12 | Treat as proposed until a dated sign-off exists | B |
| C-19 | **Diary transition timing.** "< 500 ms" against "250–450 ms". | 03 §3.3 | 13 | Compatible; adopt 250–450 ms | P |
| C-20 | **Customer endpoint path parameter.** `{ref}` against `{publicRef}`; `/api/v1` prefix absent from customer paths. | 02 §2.4; 02 §6 | 12 | Finalise in OpenAPI | T |
| C-22 | **RESOLVED 08 Nov 2026 (Amit): PostgreSQL confirmed; doc 08 is the cost basis.** **Recurring-cost basis.** Doc 08 gives illustrative figures (for example managed support ₹35,000–₹60,000/month). Doc 11 leaves every recurring cost "To be confirmed" and lists "database technology" as an open input, although ADR [02] already selects PostgreSQL. | 08 §5–6; 02 §1 | 11 §4, §8 | Treat doc 11 as the costing template and doc 08 figures as placeholders; pre-fill doc 11 with the decided stack (PostgreSQL) once hosting is chosen (SO-10) | B + T |
| C-21 | **12 MD/CLAUDE.md omits requirements** that the DOCX contains. | 12 MD; CLAUDE.md | 12 DOCX/PDF | Regenerate the MD from the DOCX or point to the DOCX | Package author |

## 2. Duplicated requirements (consolidate, no conflict)

* **Payment-truth invariants** appear in 01 §1.2/§1.5, 02 §5, 02 §2.5, 04 §4.2, 06 §6.3, 12, 13, 14 and 15. Keep one canonical list (02 §5 plus §2.5) and reference it everywhere else.
* **The customer journey** is described in 01 §1.2, 03 §3.2, 12 §A–J, 13, 15 and 10 ("CX v1.1 Scope Notes"). Make doc 13 canonical.
* **Customer test lists:** CX-T01–T24 [06], AT-1–25 [14] and the doc 12 "Required tests". Merge into one catalogue.
* **Breakpoints** (360×800, 390×844, 768×1024, 1440×900) appear in 03, 06, 12 and 13. They are consistent.
* **API contract list** appears in 02 §2.4 and 12. It is consistent apart from C-20.

## 3. Gap analysis

### 3.1 Missing functional requirements
1. Customer refund flow when a pay-now order is rejected or an item is unavailable after payment.
2. Order expiry when it is never accepted, plus a customer rejection message.
3. Whether customers can cancel, and until which state.
4. Outlet open/closed and out-of-hours handling in the CX (present only in base QR-07).
5. Customer receipt or GST invoice delivery (view, download, WhatsApp).
6. WhatsApp template catalogue and trigger events (accepted? ready?).
7. Bill-lookup verification factor (OTP or phone match) and where "bills" come from (POS-created dine-in tabs?).
8. Table/QR code generation, signing and management.
9. Admin UI for experience-config (copy, enabled methods, scene on/off).
10. Discount, coupon or service-charge rules (fields exist but no rules).
11. Role/permission matrix (referenced by TC-018).
12. Metric formulas for the owner dashboard (required by EPIC F, not written).
13. Bill numbering and invoice format.
14. Language and localisation decision.
15. Customer-visible preparation-time estimate rules.

### 3.2 Missing non-functional requirements
1. Numeric 3D and frontend performance budgets (LCP, JS size, asset MB, FPS, memory).
2. Device and browser support matrix, including in-app webviews.
3. Accessibility conformance level (for example WCAG 2.1 AA).
4. Rate-limit and bot-control thresholds.
5. Session, token and quote TTLs; basket persistence duration.
6. Data retention periods per data class (template K is empty).
7. Support hours and response SLAs.
8. Customer-path availability target and downtime fallback.
9. Measured peak orders per minute and concurrency.

### 3.3 Incomplete technical specifications
Canonical state machines; ERD/schema; OpenAPI; webhook endpoints; consent and customer PII storage design; quote persistence and expiry; asset pipeline and budgets; CDN; observability stack; CI/CD tooling; environments' hosting.

### 3.4 Unresolved architecture decisions
Customer framework (React PWA or Next.js); 3D technology; realtime transport; cloud and region; IdP; observability; tenant theming; repo structure. See `ARCHITECTURE_REVIEW.md` §15.

### 3.5 Missing third-party integration details
Payment provider, API capabilities, sandbox, MDR, refunds, settlement; WhatsApp BSP, templates, cost; OTP provider (if any); analytics vendor; CDN.

### 3.6 Incomplete UI/UX specifications
No concepts for CX-02, 06, 07, 08, 11; no defined error, empty or offline state designs; no 2D fallback design; no character design; no font names; no iconography; no dine-in variant; no Hindi or other language layouts; no prototype.

### 3.7 Missing test scenarios
Notification tests (FR-013); dialogue non-blocking (FR-CX-003); invalid order transitions (FR-004); bill/receipt content and GST (FR-011); audit completeness (FR-014); refund after café rejection; order expiry; closed-outlet ordering; in-app webview behaviour; QR signature tampering on table context; DR restore of the customer path; consent withdrawal.

### 3.8 Dependencies that could block implementation
Backend APIs (no repo or owner); SO-1 menu; SO-6 tax rules; SO-4 payment provider; SO-5 WhatsApp; SO-3 3D assets; the staff acceptance UI; hosting. See `RISK_AND_DEPENDENCY_REGISTER.md`.

## 4. Questions for Amit and the team

**Scope and commercial**
1. Is the first build the **customer Virtual Café only**, as docs 12 and README say, or the **Pilot R1 platform plus the Virtual Café**? Who builds the backend and the cashier acceptance screen, and when? (C-12)
2. Is 400 Coffee a paid pilot, design partner or demo? Who is the contracting entity? Is Inferra Software confirmed as supplier?
3. Should the Virtual Café be tenant-themeable SaaS, or bespoke to 400 Coffee? (C-11)
4. Will the commercial model be re-estimated before Sprint 1, and who is producing the 3D assets?
5. ~~Does a document 11 exist? Where is the `UI_Concept_Screenshots/` folder?~~ Answered 08 Nov 2026: both supplied. Doc 11 is the Maintenance Cost Analysis; the screenshots match the deck images.

**Product decisions**
6. Payment model for launch: pay-at-counter only, pay-now behind a flag, or pay-now required? (C-01)
7. Is a mobile number mandatory for every customer order? (C-02)
8. Takeaway only, or dine-in with table QR for the pilot? How do dine-in customers pay? (C-14)
9. Does pay-now happen before or after cashier acceptance? If before, what happens on rejection?
10. Default QR release policy for 400 Coffee: cashier-held or auto-release?
11. Which WhatsApp messages should customers receive?
12. Bill lookup: what verification factor is acceptable to the business (OTP or phone match)?
13. Languages: English only?

**Technical**
14. Is there an existing repository or codebase, even a prototype?
15. Any preferences or constraints for the cloud provider, region or domain?
16. Is a payment provider already in use or under consideration by 400 Coffee?
17. Is a 3D feasibility spike on a named reference device acceptable as the gate for the 3D scope?

**Assets and legal**
18. When can the owner supply the menu, prices, tax treatment, photos and brand assets?
19. Has counsel been engaged for the privacy notice, consent wording and customer terms?
20. Who are the nominated acceptance testers and sign-off authority at 400 Coffee?
