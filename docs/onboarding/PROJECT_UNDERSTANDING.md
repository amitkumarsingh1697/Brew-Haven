# 400 Coffee — Project Understanding

Prepared 07 November 2026. Every statement below cites its source document as [01]–[16], [README] or [MANIFEST]. **Gap** marks something the package does not specify. **Conflict** marks a disagreement between documents, logged in `OPEN_QUESTIONS.md`.

## 1. Business objective

* **Supplier objective:** build a **repeatable multi-tenant café operations SaaS**, "not a one-off billing application". 400 Coffee is the first operational pilot and design partner [01 §1]. The supplier is assumed to be Inferra Software [07 §1, 08 §8], but this is unconfirmed.
* **Pilot objective for 400 Coffee:** replace largely manual operations with a connected system. The PRD's goals are less order-entry friction, fewer missed or delayed kitchen tickets, better payment traceability, a reliable owner view of sales against collections, and repeatable onboarding [01 §2].
* **v1.1 objective:** give 400 Coffee a distinctive, premium, cinematic customer-ordering front door, the "Virtual Café" [01 §1.1; 15].
* **Success measures** [01 §2; 09 slide 9]: order-capture accuracy, order-to-kitchen latency, complete station tickets, reconciliation exceptions, end-of-day variance, staff task time, staff adoption and customer QR completion. **Gap:** no numeric targets and no baseline. Doc 09 says the baseline should be captured before the pilot.
* **Operating context** [01 §3]: one outlet, about 200–500 orders/day, dine-in and takeaway, beverage and food stations, UPI-dominant payments, a static UPI QR, and a cashier-led workflow.
* **Commercial relationship:** open. It is unclear whether 400 Coffee is a paid pilot, a design partner or an internal demonstration [01 §10; 08 §8].

## 2. Product vision

> "One connected operating system for independent cafés: cashier ordering, customer self-service, split kitchen execution, payment reconciliation and owner visibility." [01 §2]

v1.1 adds a customer-facing layer: "400 Coffee — The Virtual Café", an immersive, cinematic, coffee-and-food themed ordering journey with a 3D manager character and camera choreography [01 §1.1]. Staff POS, KDS, owner and platform-admin interfaces "remain separate workstreams and are not redesigned" [every v1.1 addendum].

**Conflict C-11:** the SaaS principle in [01 §1] requires a repeatable product, but the v1.1 experience is branded specifically for 400 Coffee ("dark apron with 400 Coffee branding" [12, 13]). The package never says whether the Virtual Café is a tenant-configurable product feature or a bespoke build for 400 Coffee.

## 3. Target users and personas [01 §4; 02 §2]

| Persona | Responsibilities | Primary surface | In v1.1 build scope? |
|---|---|---|---|
| Customer (guest) | Browse via QR, customise, submit, pay now or at the counter, track status, pay a bill | Customer PWA (Virtual Café) | **Yes, the only surface in scope** [12] |
| Cashier | Create and edit orders, choose dine-in or takeaway, accept QR orders, record cash or verified UPI, handle permitted cancellations, print or share bills | Staff POS PWA (tablet) | No. A separate workstream, but the customer journey depends on it |
| Kitchen staff (beverage and food stations) | Work station tickets, start, mark ready, see modifiers and notes | KDS PWA | No, but notes must reach station tickets [01 §1.5] |
| Owner / manager | Monitor sales, flow, exceptions, shifts, menu performance; configure | Owner web app (Next.js) | No |
| SaaS platform operator | Onboard tenants, plans and entitlements, health, audited support | Platform admin | No |

**Gaps:** no customer personas or segments (regulars, tourists, office takeaway, and so on); no accessibility personas; no language preferences; no staff headcount or shift model.

## 4. Customer experience (v1.1, approved direction per [01 §1.1], approval evidence absent; see the sign-off report)

* **Feel:** premium cinematic café: walnut, brass, leather, warm amber light, steam. Editorial serif with a sans-serif. Not a dashboard or a generic store [03 §3.1; 12].
* **Character:** a stylised 3D café manager behind the counter, with scripted, state-driven dialogue. It is not an AI [ADR-CX-02; FR-CX-003].
* **Camera:** an optional 1.5–3 s dolly-in that settles before the dialogue appears. There is no camera motion during typing, choosing or paying [03 §3.3; 13].
* **Resilience:** a mandatory 2D fallback with identical functionality, "Skip intro", reduced-motion support, and checkout usable before the 3D scene finishes loading [FR-CX-002; ADR-CX-05; CX-T23].
* **Accessibility:** mobile-first; screen-reader labels, keyboard support, contrast, 44 px targets [FR-CX-014; 13].
* **Microcopy** is defined and must be configurable [03 §3.5; 13 "Proposed dialogue"].

## 5. Customer ordering lifecycle (end to end)

Sources: [01 §1.2; 13 journey map; 12 §A–J]

```
QR scan / PWA link
  └─► CX-01 Entrance (camera → manager greeting) ──► "View menu & place order" | "Pay bill"
        │                                                            │
        ▼                                                            ▼
  CX-03 Diary menu → CX-04 Customise (variant, add-ons,        CX-02 Bill lookup (reference + phone
        qty, prep notes) → add to basket                             verification) → server outstanding
        ▼                                                            balance → provider payment →
  CX-05 Basket (server quote, edit/remove)                           verified result / receipt
        ▼
  CX-06 Identity (name, Indian mobile, transactional WhatsApp consent; marketing consent separate, unticked)
        ▼
  CX-07 Review ("Does everything look right?"; explicit confirm; idempotent submit)
        ▼
  CX-08 Payment choice ──► Pay at takeaway counter ──► order created, payment DUE/NOT_STARTED ──┐
        │                                                                                       │
        └──► Pay now ──► CX-09 method (UPI/QR/card, if configured) ──► server payment intent ──►│
                         provider hosted checkout / dynamic QR / deep link ──► webhook verified │
                                                                                                ▼
  CX-10 Confirmation (public ref, items, total, "awaiting café acceptance" vs "accepted", paid / due,
        WhatsApp status shown accurately)
        ▼
  CX-11 Order status (accepted → preparing → ready → completed; refresh/reconnect recovery)
```

The order is created on the shared backend and enters the restaurant workflow under the outlet's **cashier-acceptance / auto-release policy**, snapshotted per order [FR-006; ADR-003; 01 §1.2 step 10].

**Gaps in the customer lifecycle**
* **The relationship between payment and acceptance is undefined.** Pay-now happens before cashier acceptance, so if the café rejects the order or an item is unavailable after payment, the customer must be refunded. No customer refund flow, refund timing or messaging is specified.
* There is no rule for expiring an order that is never accepted, and no rejection message for the customer.
* Customer-initiated cancellation is not specified (allowed or not, until when).
* There is no order-ready notification rule. The WhatsApp event list is not enumerated beyond "order/payment confirmation".
* Dine-in is undefined: table capture, table QR and a "pay at table" path are missing (**conflict C-14**).
* Closed-outlet and out-of-hours behaviour is mentioned only in base QR-07 [03] and is absent from the CX spec.
* Estimated preparation time is shown "only if supported" [03 QR-05], with no rule.
* GST receipt or invoice delivery to the customer (download, WhatsApp, print) is not specified.

## 6. Cashier workflows [01 §4, §8; 03 POS-01–08; 04 S3, S5, S7]

1. **Sign in and start shift** (POS-01): staff auth, device label, outlet, opening cash.
2. **Create order** (POS-02–04): order type (dine-in/takeaway), table or pickup reference, items and modifiers, server totals, submit. Station tickets are created.
3. **Accept QR orders** when the outlet policy holds them for the cashier [ADR-003].
4. **Collect payment** (POS-05): cash, or UPI using a static QR plus an amount-bound attempt. The customer declares; the cashier checks the merchant-side bank or UPI app and enters the verified amount and reference. The ledger records the verifier and time. Duplicate references are blocked [FR-010].
5. **Order detail** (POS-06): timeline, tickets, ledger, edit or cancel per role.
6. **Exceptions** (POS-08): unverified declarations, mismatches, duplicates, unpaid ready orders, delayed tickets, sync errors.
7. **Shift close** (POS-07): expected against counted cash, verified UPI, refunds, variance reason.

**Gaps:** no role/permission matrix (TC-018 refers to one, but none exists); no cancellation or edit rules after dispatch ("role-based rules", undefined); no receipt format or bill numbering; no printer model; no handling of pay-now orders from the Virtual Café that arrive already paid; no cashier UI for "pay at counter" orders arriving from the CX.

## 7. Kitchen workflows [01 FR-007/008; 02 §4; 03 KDS-01–05; ADR-004]

* Each accepted parent order is split into **beverage** and **food** station tickets, using the routing snapshot taken at acceptance.
* Each station sees only its items, modifiers and notes, in real time, with timers, start and ready actions, and delay cues.
* The parent order is **ready only when all required station tickets are ready**.
* On reconnect the KDS refetches its queue from REST; realtime messages are advisory only [ADR-005].
* **Gaps:** item-level status is "if enabled" with no decision; no SLA or threshold for a "delayed" ticket; no bump-bar or sound decision; no rule for an item that has no station.

## 8. Administrative workflows

* **Owner/manager** [03 OWN-01–07]: overview, sales, payments/ledger, operations, menu, team and shifts, settings (QR policy, hours, taxes, stations, receipts, devices).
* **Platform operator** [01 FR-016; 03 platform shell]: tenants, outlets, plans, entitlements, subscriptions, service status, audited support.
* **Gaps:** no menu-import process for the first tenant; no customer-experience configuration UI (dialogue copy, scene assets, enabled payment methods, WhatsApp templates). `experience-config` is an API [02 §2.4] with no admin surface. There is no table/QR-code generation workflow.

## 9. Payment lifecycle

* **Baseline (pilot):** static UPI QR, customer declaration, manual merchant-side verification by staff, ledger entry. Automatic UPI confirmation is out of scope for the pilot [01 §3, §5; ADR-002].
* **v1.1 customer side:** pay-now by UPI, QR, credit or debit card through a provider-hosted flow with a server payment intent and a signature-verified webhook. Pay-at-counter creates an unpaid order. A static QR is allowed only with manual verification [01 §1.2 steps 7–8; 02 §2.5; 12 §H].
* **Conflict C-01:** these two models differ. The baseline puts gateway integration in Release 2 [01 §5]; v1.1 puts it in the first customer increment.
* **States:** order and payment are separate state machines. Payment states are listed differently in [02 §5] (10 states) and [02 §2.3] (13 states plus "DUE" in prose); see **conflict C-03**.
* **Invariants** [02 §5; 06 §6.3; 12]: a declaration, screenshot, redirect or static scan never means PAID; refunds are separate ledger movements; amount, currency and reference must match; duplicates are idempotent or flagged.
* **Partial payment and overpayment** are supported "where enabled" [FR-009]. No rule says whether a customer can part-pay through bill lookup.

## 10. Notification lifecycle

* **Staff:** in-app events first (new order, payment exception, delayed ticket, status change); external channels are configurable [FR-013].
* **Customer (v1.1):** WhatsApp Business Platform or an approved BSP. Messages are queued through the transactional outbox **after** durable order creation and **after** verified payment. The system stores template name and version, consent, destination, provider message ID, status and retries. WhatsApp never blocks the order, and the UI never claims "sent" without a provider response [02 §2.6; FR-CX-011; ADR-CX-07].
* **Gaps:** no template list (order received, accepted, ready, payment received, payment due, refund?); no languages; no retry policy numbers; no customer opt-out handling; no SMS fallback; no BSP chosen.

## 11. Order cancellation and refund lifecycle

* **Documented:** cancellations and edits after kitchen dispatch follow role-based rules [FR-004]; cancellation propagates to station tickets and is audited [TC-016]; refunds are separate ledger movements [ADR invariant 4; TC-013]; refund authority must be defined [01 §3, §10]. Payment states include REFUND_PENDING and REFUNDED.
* **Not documented (critical gap):** the refund and cancellation **policy** itself (who may cancel, until which state, refund method and time, partial refunds, refunds for provider-paid orders, café-initiated rejection after pay-now, how the customer is told). Sign-off item 6 is open.

## 12. Reporting requirements [01 FR-012; 03 OWN-01–04; 04 EPIC F]

Orders, gross order value, confirmed collections, outstanding balances, refunds, net collections, payment mix, AOV, popular products, delayed orders, station throughput, ticket time, cancellations and peak periods. Metrics must be defined formally, reconcile to the ledger, use the outlet timezone and respect tenant scope on export.
**Gaps:** the formulas themselves are not yet written; no GST or tax reports; no customer-experience analytics (funnel drop-off, 3D fallback rate, pay-now share); no analytics tool chosen.

## 13. SaaS evolution strategy [01 §5; 04 §2; 09 slide 8]

| Release | Content |
|---|---|
| Pilot / R1 | POS, dine-in/takeaway, menu and modifiers, customer QR (**now the Virtual Café per v1.1**), release policy, split KDS, payment ledger with manual UPI verification, bills, shifts, owner dashboard, audit |
| R2 | Production SaaS hardening, self-service onboarding, subscriptions and entitlements, tenant admin, exports, offline recovery, monitoring, payment integration where supported |
| R3 | Inventory and recipes, stock consumption, wastage |
| R4 | Loyalty, engagement, advanced analytics, AI owner assistant, multi-outlet, delivery integrations |

Indicative pricing is ₹999, ₹1,999 or ₹3,999 per outlet per month; these are unvalidated hypotheses [08 §4]. **Gap:** the Virtual Café does not appear in any tier, and the package does not say how a second tenant would get its own scene, character and assets.
