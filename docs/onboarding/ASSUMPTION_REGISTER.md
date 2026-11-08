# 400 Coffee — Assumption Register

Prepared 07 November 2026. The register has two parts:
* **A. Documented assumptions:** assumptions the package itself makes, with their source.
* **B. Review assumptions:** assumptions made in this onboarding review, flagged so the team can confirm or correct them.

Validation status: *Unvalidated* · *Partially validated* · *Validated* (no assumption currently has validation evidence).

## A. Assumptions stated in the package

| ID | Assumption | Source | Impact if wrong | Validation method | Owner (if known) | Status |
|---|---|---|---|---|---|---|
| A-01 | Volume is about 200–500 orders/day | 01 §3; 05 §5; ADR-001 | Load targets and architecture sizing | Two weeks of POS or manual counts, including peak orders/minute | 400 Coffee | Unvalidated |
| A-02 | One outlet for the pilot | 01 §3 | Tenant/outlet modelling, pricing | Owner confirmation | 400 Coffee | Unvalidated |
| A-03 | Separate beverage and food stations | 01 §3; 05 §5 | KDS routing design | Floor observation | 400 Coffee | Unvalidated |
| A-04 | Payments are predominantly UPI through a static merchant QR | 01 §3 | Payment model | Merchant statement review | 400 Coffee | Unvalidated |
| A-05 | Cashier-led workflow; cashier accepts QR orders by default | 01 §3; ADR-003 | Customer status flow and latency | Owner decision | 400 Coffee | Unvalidated |
| A-06 | Service includes dine-in and takeaway | 01 §3 | Fulfilment model (SO-7) | Owner decision | 400 Coffee | Unvalidated; v1.1 leans to takeaway |
| A-07 | Hardware selection is flexible; PWA on tablets works with printers | 01 §3; ADR-007 | Device procurement, printing | Device qualification tests [03 §8] | Supplier | Unvalidated |
| A-08 | Supplier is Inferra Software; customer is 400 Coffee | 07 §1; 08 §8 | Contract validity | Verify legal entities | Both parties | Unvalidated |
| A-09 | 1,250 person-hours at a ₹1,200/h blended rate over a 12-sprint baseline | 08 §2; 10 | Price, margin, feasibility | Bottom-up estimate after Sprint 0 | Supplier | Unvalidated; **likely low** (see risk BR-03) |
| A-10 | SaaS tiers ₹999 / ₹1,999 / ₹3,999 per outlet per month | 08 §4 | SaaS business model | Willingness-to-pay interviews | Supplier | Unvalidated hypothesis |
| A-11 | Sprints are 2 weeks; plan at 70–80 % capacity | 05 §1 | Timeline | Observed velocity | Delivery lead | Unvalidated |
| A-12 | p95 and availability targets (500 ms, 1 s, 2 s; 99.5 %; RPO 15 min / RTO 4 h) are achievable | 01 §7; 06 §3 | NFR acceptance, SLA | Load test and restore drill | Supplier | Proposed, not contractual |
| A-13 | A mid-range Android phone can run the 3D scene acceptably | 02 §2.1, §2.7 (conditional) | Whether 3D ships | Feasibility spike | Supplier | Unvalidated, **explicitly conditional** |
| A-14 | Customers will provide name and mobile, and consent to WhatsApp | 01 §1.2 step 5 | Conversion, privacy | Pilot funnel metrics; counsel | 400 Coffee / counsel | Unvalidated; conflicts with 01 §7 |
| A-15 | A payment provider with UPI, dynamic QR, cards and webhooks is obtainable for this merchant | 01 §1.2 step 8; 02 §2.5 | Pay-now feasibility | Provider onboarding | 400 Coffee | Unvalidated |
| A-16 | WhatsApp Business account and templates will be approved | 02 §2.6 | Notifications | BSP onboarding | 400 Coffee | Unvalidated |
| A-17 | Static QR cannot reconcile a specific order | 01 §3; ADR-002 | Payment design | — | — | Accepted fact; consistent across all documents |
| A-18 | Restaurant-side POS/KDS/owner apps are "a separate workstream" that will exist | 01 §1.1; 12 | Customer orders cannot be accepted or fulfilled otherwise | Delivery plan | **Unassigned** | Unvalidated: no plan links the two |
| A-19 | The six concept screenshots represent approved direction | 03 §3.6; 06 §6.2 | Visual QA basis | Client sign-off | 400 Coffee | Unvalidated; defects found |
| A-20 | Commercial values are indicative and need re-estimating | 08 §8.1; MANIFEST | Contract | Re-estimate | Supplier | Acknowledged |

## B. Assumptions made in this review

| ID | Assumption | Reason | How to confirm |
|---|---|---|---|
| RA-01 | The 16 uploads plus the files in `/mnt/project-files/` are the whole package | No ZIP found; MANIFEST otherwise reconciles | Amit confirms. Doc 11 and the six screenshots were supplied on 08 Nov 2026 |
| RA-02 | For customer-facing UX the v1.1 addendum takes precedence over the v1.0 body; for everything else the baseline stands until amended | The addendum says it supersedes "customer-facing UX description" only | Product owner confirmation |
| RA-03 | The DOCX is the editable source and the PDF a rendering; where they differ only in format, content is equal | Word-level diffs are identical apart from covers, markers and footers | — |
| RA-04 | The 12 DOCX is authoritative over the 12 MD / CLAUDE.md | The MD says so itself | — |
| RA-05 | No application repository exists yet | No repo is linked; the master prompt says to "inspect the repository" | Amit confirms |
| RA-06 | The six images in the doc 15 PPTX (image1–6) correspond to UI_Welcome, Menu, Customize, Checkout, Payment and Confirmation in that order | Slide order and content match the doc 13 inventory | Designer confirms |
| RA-07 | The supplier team will build both the backend and the customer front end | No other team is named | Amit confirms team model and staffing |
| RA-08 | India is the operating jurisdiction (INR, UPI, GST, Indian mobile validation) | Consistent across docs | — |
| RA-09 | The pilot launch would be takeaway-first if SO-7 stays unresolved | v1.1 copy centres on the takeaway counter | Owner decision |
| RA-10 | Timeline estimates in this review assume a 5–6 person cross-functional team | No team size is documented | Confirm staffing |
