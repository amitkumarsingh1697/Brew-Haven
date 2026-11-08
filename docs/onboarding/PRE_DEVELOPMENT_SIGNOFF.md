# 400 Coffee — Pre-Development Sign-off Validation

Prepared 07 November 2026.

**Rule applied:** an item is marked *Approved* only where an explicit approval exists, with approver, date and artefact. **The package contains no sign-off records, approver names or dated approvals for any item.** Several documents call the Virtual Café direction "approved" [MANIFEST; 01 §1.1], but doc 15 slide 12 still lists "approve the screen journey and asset direction" as the proposed next action. That is not evidence of approval.

**Status scale:** *Not started* (nothing supplied) · *Placeholder only* (illustrative or sample content exists) · *Partially defined* (requirements written, decision or asset missing) · *Approved* (explicit evidence; not used anywhere below).

| # | Item | Status |
|---|---|---|
| SO-1 | Final café menu, prices, product images | Placeholder only |
| SO-2 | Logo, brand identity, fonts, visual references | Partially defined |
| SO-3 | 3D manager and café assets | Not started |
| SO-4 | Payment provider and merchant account readiness | Not started |
| SO-5 | WhatsApp Business setup and templates | Not started |
| SO-6 | GST, invoice, refund, cancellation rules | Not started |
| SO-7 | Dine-in, takeaway, table-number workflows | Partially defined (conflicting) |
| SO-8 | Minimum supported phones and browsers | Not started |
| SO-9 | Customer journey and six UI concept screens | Partially defined |
| SO-10 | Hosting, domain, analytics, monitoring | Not started |

**None of the 10 items is approved.**

---

## SO-1 Final café menu, prices and product images

* **Evidence:** suggested categories (Coffee, Hot Beverages, Cold Beverages, Fresh Juices, Sandwiches, Snacks, Desserts) [01 §1.2; 12]. Sample items and prices appear in concept images only (Classic Cappuccino ₹160, Café Latte ₹170, Grilled Veg Sandwich ₹180, French Fries ₹120, Fresh Lemonade ₹110, modifiers +₹35/+₹20/+₹50), explicitly illustrative [MANIFEST; 01 §1.6]. Governance rules exist [01 §1.6].
* **Status:** Placeholder only.
* **Missing:** the full product list, descriptions, prices (GST inclusive or exclusive?), sizes/variants, modifier groups with constraints, allergen and veg/non-veg markers, availability windows, station routing per item, tax class per item, licensed photography (or a photo-shoot plan).
* **Responsible:** 400 Coffee owner (supply and approve) [01 §1.6; 08 §8.2]. The supplier formats it into a catalog import.
* **Implementation impact:** blocks real catalog data, the quote engine, station routing, photography-dependent UI, visual QA, and AT-13/AT-23. Development can start with a clearly labelled demo seed [12].
* **Next action:** send the owner a menu-capture template (one row per product, variant and modifier, with tax class and station), plus a photography brief. Target receipt by the end of Sprint 0.

## SO-2 Logo, brand identity, fonts and visual references

* **Evidence:** the customer palette is specified in [03 §3.1] and [12], but **inconsistently** (olive [03] against muted warm grey #B8A48B and roasted brown #57331F [12]). The staff palette is in [03 §1]. The type pairing is described (editorial serif plus sans-serif) but **no font is named**. The concepts use a "400 COFFEE" serif wordmark, a placeholder. Materials and mood are described [03 §3.1; 13].
* **Status:** Partially defined.
* **Missing:** an official logo (vector), wordmark usage rules, named and licensed fonts (web licence), the final palette with contrast-checked token values, iconography, photography style guide, and the brand owner's approval.
* **Responsible:** 400 Coffee (brand owner); the supplier's UX designer for tokens.
* **Implementation impact:** blocks the design-token package (CX-S1), the character apron branding, and visual regression baselines.
* **Next action:** request brand assets, then produce a token sheet with WCAG contrast results for sign-off, resolving the olive/grey conflict.

## SO-3 3D manager and café assets

* **Evidence:** written direction only: a stylised, non-uncanny manager in a dark branded apron, idle and greeting animations, walnut counter, espresso machine, brass, shelves, amber pendants, steam [13; 12]. Technical asset guidance [02 §2.7]. Rights requirements [07 §7.2]. The concept image is a flat 2D placeholder.
* **Status:** Not started.
* **Missing:** character concept art, a model, rig and animation list; environment model; 2D fallback artwork and poster; polygon, texture and size budgets; asset producer (in-house or vendor); licences; likeness consent if based on a real person; asset cost (excluded from current commercials [08 §8.1]).
* **Responsible:** not assigned. The client approves the design [15 slide 12]; the producer is undecided.
* **Implementation impact:** blocks CX-S2 (scene) and FR-CX-001/002 acceptance. This has the longest lead time of any item. The 2D-first build lets ordering proceed without it.
* **Next action:** decide the asset producer and budget; commission concept art; run the feasibility spike with a placeholder rig.

## SO-4 Payment provider and merchant account readiness

* **Evidence:** the baseline is a static UPI QR with manual verification [ADR-002]. v1.1 requires provider-hosted UPI, QR and card flows with webhooks [02 §2.5]. No provider is named. The merchant UPI account exists by implication ("payments are digital through UPI" [01 §3]), but its provider or bank and API availability are unknown [01 §10].
* **Status:** Not started.
* **Missing:** a decision between the payment models (conflict C-01); provider selection; merchant KYC and onboarding; sandbox credentials; MDR and commercial terms; webhook and refund API capability; settlement reconciliation process; manual-verification evidence rules [01 §10].
* **Responsible:** 400 Coffee (merchant account owner) [08 §8.2]; the supplier for technical evaluation.
* **Implementation impact:** blocks FR-CX-009, CX-S7, AT-5–7, CX-T13–T16 and the doc 12 release gate ("real payment verified"). Pay-at-counter can proceed without it.
* **Next action:** decide ADR-002a (see the architecture review) and shortlist providers; start merchant onboarding in Sprint 0 because KYC is outside the team's control.

## SO-5 WhatsApp Business setup and message templates

* **Evidence:** architecture and consent rules [02 §2.6; 07 §7.1]. Message content is not drafted. No BSP is named.
* **Status:** Not started.
* **Missing:** the business account and verified display name; BSP choice; template list and wording (order received, accepted, ready, payment received, payment due, refund?); languages; opt-in and opt-out wording; legal review; cost per conversation.
* **Responsible:** 400 Coffee (account owner) [08 §8.2]; the supplier drafts templates; counsel reviews [07 §7.1].
* **Implementation impact:** blocks FR-CX-011, CX-S9 and AT-8 in production. The outbox and a mock adapter can be built first.
* **Next action:** draft the template catalogue in Sprint 0 and submit for approval as early as possible.

## SO-6 GST, invoice, refund and cancellation rules

* **Evidence:** listed as open in [01 §3, §10]; counsel/tax review is required [07 §3]; quote data contract supports taxes, fees and discounts [13]. No rule values are supplied.
* **Status:** Not started.
* **Missing:** GST rate(s) and whether menu prices include tax; service charge (yes or no); invoice/bill format and mandatory fields; bill numbering series; rounding rules; discounts; refund policy (who, when, how, how long); cancellation windows by order state; café-rejection-after-payment handling; customer-facing policy text.
* **Responsible:** 400 Coffee with its accountant/tax adviser; counsel for consumer-facing terms [07].
* **Implementation impact:** **blocks correct pricing (FR-002, FR-CX-005), billing (FR-011), refunds (FR-009) and legal copy.** This is a critical blocker for production but not for building scaffolding.
* **Next action:** run a structured workshop with the owner and accountant; record the decisions as a rules sheet.

## SO-7 Dine-in, takeaway and table-number workflows

* **Evidence:** the baseline supports both, with outlet/table QR and table/pickup metadata [01 FR-003/005; 03 QR-01, POS-02; TC-004]. v1.1 offers "Pay at takeaway counter" and says to show dine-in only "if enabled" and "do not invent table numbers" [12]. **Conflict C-14.**
* **Status:** Partially defined and conflicting.
* **Missing:** whether dine-in customers order through the Virtual Café; the table QR model (one QR per table or one per outlet plus table entry); how dine-in customers pay (at table, at counter, bill lookup); serve-to-table against collect-at-counter; the table list.
* **Responsible:** 400 Coffee operations; the product owner.
* **Implementation impact:** affects the QR signing scheme, fulfilment field, CX-07/CX-10 copy, pay-bill path and POS display.
* **Next action:** observe service and get a decision from the owner. Recommend launching the pilot as takeaway-first, with dine-in table capture behind configuration.

## SO-8 Minimum supported phone and browser specifications

* **Evidence:** "common Android/iOS mobile browsers and desktop browsers" [01 §1.5]; "representative mid-range Android hardware" [04 §4.3]; four test viewports [03 §3.4]. **No devices, OS versions, browser versions or WebGL capability baseline are listed.**
* **Status:** Not started.
* **Missing:** the minimum Android and iOS versions; browsers (Chrome, Safari, Samsung Internet, in-app WhatsApp/Instagram browsers, which matter for QR and link entry); a named reference device for performance; low-end fallback triggers; customer device analytics, if any exist.
* **Responsible:** supplier proposes; product owner approves.
* **Implementation impact:** blocks a measurable NFR-07/NFR-12 and the QA device lab (CX-S10).
* **Next action:** propose a matrix (for example, the last 2 major versions of iOS Safari and Android Chrome, plus Samsung Internet and in-app webviews), name one reference mid-range Android, and get approval.

## SO-9 Customer journey and all six UI concept screens

* **Evidence:** the journey is fully written [01 §1.2; 13]. The six concept images (supplied 08 Nov 2026, identical to those in doc 15) exist. The concepts cover 6 of the 11 CX screens and contain defects: clipped greeting, wrong copy, emoji or missing-glyph product art, a ₹500 confirmation total against a ₹765 basket, no pay-at-counter option, no status on confirmation, a sequential-looking reference. See `DOCUMENTATION_INVENTORY.md` §6.
* **Status:** Partially defined.
* **Missing:** concepts for CX-02, 06, 07, 08 and 11; corrected concepts; an interactive prototype; client approval of the journey and visual direction (still requested in doc 15 slide 12).
* **Responsible:** the supplier's UX designer; 400 Coffee approves.
* **Implementation impact:** visual QA gates [06 §6.2] compare against "approved concept screenshots", which do not exist in approved form.
* **Next action:** correct and complete the screen set, review it with the client, and record the sign-off.

## SO-10 Hosting, domain, analytics and monitoring approach

* **Evidence:** the pattern only (containers, managed PostgreSQL, CI/CD, observability goals) [02]; doc 11 gives a cost-category framework and blank worksheet for hosting, CDN, monitoring, domain and analytics, with no providers or figures; region, provider, IdP and observability are listed as open [01 §10]. No domain or analytics tool is named.
* **Status:** Not started.
* **Missing:** cloud provider and region (data residency); domain/subdomain and DNS ownership; CDN for 3D assets; observability and error-tracking vendor; product analytics tool with PII rules; uptime monitoring; cost estimate; who pays (pass-through or included [08 §5]).
* **Responsible:** supplier proposes; 400 Coffee owns the domain; commercial approval by both.
* **Implementation impact:** blocks staging and production environments (S1/CX-S1) beyond local development.
* **Next action:** write a hosting ADR with a cost estimate in Sprint 0.

---

## Additional sign-off items recommended (not in the list of 10)

| ID | Item | Why |
|---|---|---|
| SO-11 | Payment model decision (C-01) | Two contradictory "decided" models |
| SO-12 | Customer phone capture rule (C-02) | Privacy baseline against v1.1 conflict |
| SO-13 | Commercial re-estimate and contract entity | 08 §8.1 says current figures are invalid for the v1.1 scope |
| SO-14 | Backend/POS delivery ownership and sequencing | The customer side cannot function end to end without it |
| SO-15 | Tenant theming of the Virtual Café (C-11) | Affects architecture, IP and pricing |
| SO-16 | Legal: privacy notice, consent wording, customer terms | Required before production [07 §7.1] |
