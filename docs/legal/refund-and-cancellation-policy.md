# Refund and cancellation policy: 400 Coffee Cafe on Brew Haven

*Draft for review by the café owner, their CA and a lawyer. Prepared 13 Nov 2026. Placeholders are in [square brackets].*

This document has three parts:

1. **The policy**, written so it can be shown to customers in the app.
2. **Edge cases**: what happens in every awkward situation we could find, and who acts.
3. **Research and sources**: the Indian law, payment rules and industry practice behind each rule, and the gaps in the current build.

Each rule is marked:

- **Agreed**: decided with Amit before (D-09, D-10, D-11, Q-R3-04, Q-R3-05 in `docs/decisions/DECISION_LOG.md` and `docs/adr/0004-order-and-payment-lifecycle.md`). Unchanged here.
- **New**: added after this research. These are recommended defaults; the café owner can change any number in brackets.

---

## Part 1. The policy (customer-facing text)

### 1. How ordering and payment work
- Every order, whether you place it on your phone or the cashier places it for you at the counter, is recorded in the 400 Coffee app.
- If you order on your phone, you pay online by UPI, debit card, credit card or netbanking. Your order goes to the kitchen only after the payment is confirmed.
- If the cashier places your order, you can pay by scanning the counter QR, by card, or in cash. For cash, the cashier marks the order as paid, and you get the same receipt.
- All prices on the menu are final prices. GST is applied to the whole bill as required by Indian tax law and is shown on your bill. There is no service charge. Any tip or contribution is optional and never added by default.

### 2. Cancelling your order
| When | Can you cancel? | Refund |
|---|---|---|
| Before your payment completes | Yes, just leave the payment screen. Unpaid orders lapse after 15 minutes. | Nothing was charged. If money left your account anyway, it comes back automatically (see section 5). **Agreed** |
| After payment, before the kitchen starts making it | Yes, with **Cancel order** on the tracking screen. | Full refund, no charge. **New** |
| After the kitchen has started | No, because your food or drink is already being made for you. | No refund, unless one of the cases in section 3 applies. **New** |
| Your order is late by more than [15] minutes beyond the time shown in the app | Yes, until it is marked ready. | Full refund. **New** |

We never charge a cancellation fee.

### 3. When we cancel or change your order
| What happens | What you get |
|---|---|
| We cannot make your order at all (for example, an ingredient ran out, a machine broke, or the café has to close) | We cancel it, tell you why, and refund everything. **Agreed** |
| One item is unavailable after you paid | You choose: **replace** it (if the new item costs less, we refund the difference; if more, you pay only the difference), **remove** it (that item is refunded), or **cancel** the whole order (full refund). If you don't choose within 5 minutes, the item is removed and refunded. If a top-up for a replacement isn't paid within 5 minutes, the item is removed and refunded. **Agreed** |
| Every item ends up removed | The order is cancelled and fully refunded. **Agreed** |

### 4. Problems with your order
Please tell the cashier before you leave the counter, or use **Report a problem** in the app within [24 hours].

| Problem | What we do |
|---|---|
| Wrong item, wrong size or wrong customisation (for example dairy milk instead of oat milk) | We remake it straight away, free. If you'd rather not wait, we refund that item. **New** |
| Missing item | We make it now, or refund it. **New** |
| Quality problem (cold, spilled, tastes wrong) | We remake it, or refund that item. **New** |
| Something that should not be in the food, a veg/non-veg mix-up, or an allergen that wasn't on the menu | Full refund of the order, the manager is told, and we record and look into it. If you feel unwell, please get medical help first and tell us. **New** |
| Somebody else collected your order | We make it again for you at no cost. **New** |

### 5. How refunds are paid
- **Online payments** are refunded to the same UPI account, card or bank account you paid from. We start the refund as soon as the order is cancelled. Banks usually show it within 5–7 working days; UPI is often faster. **Agreed** (source refund) / **New** (timeline text)
- **Cash** is handed back at the counter straight away, and your receipt shows the refund. **Agreed**
- **Counter card or counter UPI** payments are refunded to the same card or UPI account. **New**
- We do not refund to a different account, card or person, and we do not swap an online refund for cash, because that is how refund fraud happens. If a refund to your original method fails (for example, your card was closed), we contact you and refund by another method only after we have checked it is you. **New**
- If money left your account but the order did not go through, your bank or payment app reverses it automatically. RBI requires a failed UPI merchant payment to be reversed within 5 days of the transaction (T+5), or your bank pays you ₹100 for each day of delay. If our gateway did receive the money, we refund it ourselves without you needing to ask. **New**
- If you were charged twice for one order, the extra payment is refunded automatically. **New**
- Your refund includes the GST you paid on the refunded items. **New**

### 6. Collecting your order
- Please collect your order within [30 minutes] of it being ready. After that, drinks may not be at their best, and we can't promise to keep food past closing time.
- Orders that are not collected are not refunded, because they were made for you. If you can't come, tell the café and they will do what they can. **New**

### 7. Complaints
- Grievance officer: [name, designation, phone, email]. We acknowledge every complaint within 48 hours and resolve it within [7 days], and never later than one month. You get a complaint number. **New**
- If you are not satisfied, you can contact the National Consumer Helpline (1915 or consumerhelpline.gov.in), or for payment problems your bank and the RBI Integrated Ombudsman.

---

## Part 2. Edge cases

Actor key: **Sys** = Brew Haven does it automatically; **Csh** = cashier; **Adm** = owner/admin; **Cust** = customer. "Built" means the current code already does it; "Gap" items are listed in Part 3.3.

### 2.1 Payment edge cases
| # | Situation | Rule | Actor | Status |
|---|---|---|---|---|
| P1 | Money debited, gateway shows failed or pending | Order stays AWAITING_PAYMENT, then EXPIRED. Bank reverses (RBI T+5). Customer sees "If money left your account, it will come back within 5 days" and a link to the transaction reference. | Sys | Built (expiry); Gap (message) |
| P2 | Payment captured **after** the 15-minute expiry (late webhook) | Do not place a stale order. Refund it in full automatically and tell the customer. | Sys | Gap: today it appears in Payment checks as "paid not served"; make the refund automatic |
| P3 | Two successful payments for one order (double tap, retry from two apps) | Keep the first capture, refund every extra capture in full automatically. | Sys | Gap: confirm webhook handler refunds the extra capture, not just ignores it |
| P4 | Captured amount differs from the order total | Do not place the order. Refund the captured amount in full; log it for the owner. | Sys | Built (invariant 1); Gap (auto-refund) |
| P5 | Customer closes the app during payment | On reopening, the tracking link shows the true state from the server. Never mark paid from the client. | Sys | Built |
| P6 | Top-up payment (for a dearer replacement) fails or is abandoned | After 5 min the line falls back to "remove" and is refunded. | Sys | Built |
| P7 | Refund fails at the gateway | Shows in Payment checks; admin refunds by hand, with proof, and marks it done. | Adm | Built |
| P8 | Refund pending for more than 30 minutes | Shows in Payment checks; admin checks with the gateway. | Adm | Built |
| P9 | Refund requested more than 6 months after payment | Gateway will not process it (Razorpay limit). Admin refunds by bank transfer/UPI after verifying the customer. | Adm | Gap: show the reason instead of a generic failure |
| P10 | Customer's card or account is closed | Bank returns the refund to the gateway; admin contacts the customer and refunds another way after checking identity. | Adm | Process only |
| P11 | Gateway balance too low to fund a refund (Razorpay deducts refunds from settlements) | Refund fails; it appears in Payment checks. Owner keeps a refund float in the gateway account. | Adm | Process only; add to owner training |
| P12 | Customer raises a chargeback or UPI dispute after we already refunded | Reply to the dispute with the refund reference within the gateway's deadline. Never refund twice. | Adm | Gap: export of refund proof per order |
| P13 | Chargeback for an order that was collected | Submit the order record, pickup event and receipt as evidence. | Adm | Gap: same export |
| P14 | Customer asks to receive the refund to a different UPI ID, card or in cash | Refuse; refund to source only. Exception only for P9/P10, decided by admin and logged. | Csh/Adm | Policy; Gap: block cash refunds against online payments in the till |
| P15 | Partial refunds on a discounted order | Refund what the customer actually paid for that line (pro-rata after discount), never the list price. Total refunds never exceed total captured. | Sys | Built (cap); Gap (pro-rata if coupons are added) |
| P16 | Rounding when a line is refunded | Round each refund in paise in the customer's favour; the cap stops over-refunding. | Sys | Built (integer paise) |

### 2.2 Counter (cashier-placed) orders
| # | Situation | Rule | Actor | Status |
|---|---|---|---|---|
| C1 | Cash order rejected or an item can't be made | Hand the cash back immediately; Brew Haven records a manual refund against that order. | Csh | Built |
| C2 | Cashier marks an order "paid by cash" by mistake, or the customer walks away without paying | Admin voids it with a reason; it shows on the day close as a cash difference. | Adm | Gap: void-with-reason for a mistaken cash mark |
| C3 | Counter UPI paid to the static QR, but the money is not seen | Do not mark paid until the UPI reference is seen and entered. Orders without a reference appear in Payment checks. | Csh | Built |
| C4 | Counter card refund | Same day: void on the card machine. Later: refund on the machine. Record the machine's reference in Brew Haven. | Csh | Gap: reference field on manual refunds |
| C5 | Cashier gives a refund the customer is not entitled to, or a large refund | Cashier can refund up to ₹[500] per order alone; above that, admin approval (PIN). Every refund needs a reason. | Csh/Adm | Gap (Q-R3-08 left this open) |
| C6 | Offline till order (OFF-1…) not accepted when the connection returns | Cashier either retries or removes it; only remove after the customer is refunded or the order is re-entered. | Csh | Built |
| C7 | Customer has no phone or the battery died while an item-unavailable choice is open | Cashier makes the choice at the counter with the customer's say-so; the event log records "chosen by cashier for customer". | Csh | Gap: let the cashier answer the adjustment |
| C8 | Cashier places an order for the customer and the customer then changes their mind before it starts | Same as self-cancel: free before the kitchen starts. | Csh | Gap (follows customer self-cancel) |

### 2.3 Order and kitchen edge cases
| # | Situation | Rule | Actor | Status |
|---|---|---|---|---|
| K1 | Customer wants to cancel while PLACED | Free cancel and full refund. | Cust | Gap: customer cancel is not built (only from ACTION_REQUIRED) |
| K2 | Kitchen starts the order a second after the customer taps Cancel | Whichever reaches the server first wins; the loser sees a clear message. | Sys | Gap: handle the race in the transition |
| K3 | Customer wants to cancel while PREPARING | Not allowed, unless the order is late (K4) or the café is at fault. Admin may still refund as goodwill. | Cust/Adm | Policy |
| K4 | Order late beyond the promised time + [15] min and not READY | Customer may cancel for a full refund. | Cust | Gap: needs a promised time per order |
| K5 | Customer ordered at the wrong café (two towers) | Before the kitchen starts: free cancel, re-order at the right café. After: the cashier may cancel and refund at their discretion. | Cust/Csh | Gap: show the café name loudly at checkout |
| K6 | Same order placed twice by mistake (same items within [2] minutes) | Warn before payment ("You ordered this 1 minute ago"); if paid twice anyway, free cancel of either before the kitchen starts. | Sys/Cust | Gap |
| K7 | Price changed on the menu while the customer was paying | The price shown when they paid is the price. Never charge more after payment. | Sys | Built (order totals are fixed at creation) |
| K8 | Outlet closes, power cut, machine breaks with paid orders in the queue | Admin cancels the affected orders with a reason; all refunded. | Adm | Built (reject); Gap: bulk "cancel all open orders" |
| K9 | Café rejects because of a customer's behaviour | Still a full refund; a rejection reason is required. | Csh/Adm | Built |
| K10 | Order READY but never collected | Hold for [30] minutes; at day close it becomes "not collected", with no refund. | Sys | Gap: no state for this; READY orders stay open |
| K11 | Customer collects someone else's order | Check the pickup code at handover; remake for the rightful customer at no cost; log it. | Csh | Built (pickup code); Gap (log reason "wrong handover") |
| K12 | Wrong item or customisation served | Remake free, or refund the line. | Csh | Gap: line-level refund after COLLECTED |
| K13 | Foreign object, allergen not declared, veg/non-veg mix-up | Full refund, incident record, owner told immediately. | Csh/Adm | Gap: incident record and post-collection refund |
| K14 | Quality complaint after the customer has left | Accept in-app reports for [24 h]; admin reviews and refunds the line or the order. | Adm | Gap: "Report a problem" |
| K15 | Every line removed by item-unavailable choices | Cancel and full refund. | Sys | Built |
| K16 | Customer never answers the item-unavailable choice | Remove and refund after 5 min; order resumes. | Sys | Built |

### 2.4 Tax, records and reporting
| # | Situation | Rule | Actor | Status |
|---|---|---|---|---|
| T1 | Partial refund on an order that already has a tax invoice | Issue a **credit note** (Section 34 CGST Act) for the refunded value and its GST, linked to the original invoice, and report it in GSTR-1. Do not edit the original invoice. | Sys | Gap: no credit notes today |
| T2 | Whole order cancelled and refunded | Mark the invoice cancelled only if it has not been reported in GSTR-1 yet; otherwise issue a full credit note. Confirm the café's approach with their CA. | Sys/Adm | Partly built (invoice cancelled flag) |
| T3 | Refund on a later day than the sale | The sale stays on its day; the refund and credit note sit on the refund day. Day close and reports must show both. | Sys | Check reports |
| T4 | Credit-note deadline | Credit notes for a financial year must be issued by 30 November of the next year (or the annual return, if earlier). Late refunds still go to the customer, but without a GST reduction. | Adm | Policy |
| T5 | Optional tip added and the order is cancelled | Refund the tip in full. Tips are never mandatory or pre-selected. | Sys | No tips today |

### 2.5 Fraud and abuse
| # | Situation | Rule | Actor | Status |
|---|---|---|---|---|
| F1 | One customer repeatedly cancels or reports problems | Admin can see refund history by phone number and may turn off self-cancel for that number. Legal rights (refunds for café faults) are kept. | Adm | Gap |
| F2 | Staff refunds to themselves or a friend | Refund to source only; cashier limits; every refund logged with staff name; owner report of refunds by staff. | Sys/Adm | Partly built (audit log) |
| F3 | Stolen card used, chargeback months later | Accept; card-not-present fraud losses sit with the merchant. Evidence export helps only for genuine orders. | Adm | Process |

---

## Part 3. Research and reasons

### 3.1 What the law and the payment rules require

| Source | What it says | What it means for us |
|---|---|---|
| Consumer Protection (E-Commerce) Rules, 2020 | They apply to every e-commerce model, including a seller's own app. A seller must show cancellation procedures and fees, refund terms, payment methods and a price breakdown including taxes. **No cancellation charge** unless the seller bears a similar charge when it cancels. Refunds must be made "within a reasonable period". A grievance officer must be named, acknowledge complaints within **48 hours** and resolve them within **one month**. | Our app is covered. Show the policy before payment, never charge a cancellation fee, name a grievance officer, issue complaint numbers. |
| CCPA action on Zomato and Swiggy (probe from Oct 2024, reported May 2025) | Cancellation charges as high as 90% of the order value were under scrutiny. The regulator's view: when an order is **delayed beyond the promised time, customers should get a full refund**. | We charge no cancellation fee, and we allow a full-refund cancel for late orders (K4). |
| CCPA service charge guidelines (4 Jul 2022), upheld by the Delhi High Court (28 Mar 2025, NRAI v Union of India) | Service charge cannot be added automatically or by default; it is voluntary. CCPA guidelines are binding. | No service charge. Any tip is opt-in, never pre-selected, and refunded with the order. |
| CCPA Guidelines for Prevention and Regulation of Dark Patterns (30 Nov 2023) | 13 banned patterns, including drip pricing, basket sneaking, forced action, confirm shaming, false urgency and interface interference. | Show the full price including GST before payment; no pre-ticked add-ons; make Cancel as easy to find as Pay; no guilt-trip wording on cancel. |
| RBI circular on turnaround time for failed transactions (20 Sep 2019) | UPI payment to a merchant debited but not confirmed: auto-reversal by **T+5**, then **₹100 per day** compensation paid by the bank without a claim. Similar rules for card payments. | Tell customers this on failed-payment screens (P1). The obligation sits with banks, but customers will ask the café. |
| NPCI UPI chargeback rules (auto-accept/reject from 15 Feb 2025; good-faith acceptance from 15 Jul 2025) | Disputes are settled automatically in the next settlement cycle based on the merchant's bank response. | Refund proof must be ready quickly, per order (P12, P13). |
| Razorpay refund rules (the gateway built into Brew Haven) | Refunds go to the original payment method. Normal refunds take **5–7 working days**; instant refunds take minutes for a fee. Refunds fail for payments more than **6 months** old. Refunds come out of the merchant's balance. | Source-only refunds; 5–7 day promise; manual route after 6 months (P9); keep a refund float (P11). |
| CGST Act, Section 34 | Where the taxable value or tax charged on an invoice was too high (including services not given), the supplier issues a **credit note**, reported in GSTR-1, by **30 November** after the end of the financial year (or the annual return date, if earlier). | Partial refunds need credit notes (T1, T4). Confirm with the café's CA. |
| FSSAI Labelling and Display Regulations, 2020 (FSSAI FAQ) | Food service businesses with a central licence or **10+ outlets** must show calories, allergens and veg/non-veg on menus, including on online ordering platforms. | 400 Coffee (two cafés) is probably not covered yet, but showing allergens and veg/non-veg is good practice and protects the café in K13 cases. |

### 3.2 What other businesses do, and what we took from it
| Business type | Common practice | Taken into our policy |
|---|---|---|
| Food delivery apps (Zomato, Swiggy) | No cancellation after the restaurant confirms; a fee of up to the full order value; refunds in 5–7 days. Now under CCPA scrutiny for fees and late-order refunds. | Cancel window up to "kitchen started"; no fee; full refund for late orders. |
| Quick-service chains and café apps | Orders can't be changed once sent to the store; problems are fixed by remaking at the counter; refunds go to the original method. | Remake first, refund if the customer prefers (section 4). |
| Hotels (for example Lemon Tree) | Clear time windows (free until 72 hours before arrival), non-refundable promo rates stated up front, refunds only to the card used, and a published refund timeline. | Clear time windows, source-only refunds, a published timeline. If the café later takes advance or bulk orders (office meetings in the towers), use a similar tiered window for those. |

### 3.3 Gaps in the current build
In order of importance. None of these are built yet; each is small.

1. **Customer self-cancel before the kitchen starts** (K1, K2, C8): new transition PLACED → CANCELLED by the customer, with a race-safe check.
2. **Credit notes** for partial and post-reporting refunds (T1, T2), shown in the GST export.
3. **Automatic refund of late or duplicate captures** (P2, P3, P4) instead of only flagging them.
4. **Not-collected orders** (K10): a state or day-close step for READY orders nobody collected.
5. **Report a problem and post-collection refunds** (K12–K14), with an incident record for allergen and foreign-object cases.
6. **Cashier refund limit and admin approval** (C5), and a ban on cash refunds against online payments (P14).
7. **Late-order cancel** (K4): needs a promised ready time per order.
8. **Refund proof export** per order for disputes (P12, P13).
9. Smaller items: cashier answers an adjustment for the customer (C7), reference field on manual refunds (C4), bulk cancel on outage (K8), duplicate-order warning (K6), failed-payment message (P1), refund history per phone (F1).

### 3.4 Decisions for the café owner
These are the bracketed numbers above. The defaults are reasonable for an office-tower café:
- Late-order cancel threshold: [15] minutes past the promised time.
- Problem reports accepted for: [24 hours].
- Hold time for uncollected orders: [30] minutes.
- Cashier refund limit without admin: ₹[500].
- Grievance officer name and contact, and the resolution target: [7 days].

### 3.5 Sources
- Consumer Protection (E-Commerce) Rules, 2020: [SCC Online summary with rule text](https://www.scconline.com/blog/post/2020/07/24/consumer-protection-e-commerce-rules-2020-comes-into-force-no-cancellation-charges-on-consumers-cancelling-after-confirming-purchase-read-notification/), [IndiaLaw guide](https://www.indialaw.in/guides/civil/consumer-protection-e-commerce-rules/)
- CCPA and Zomato/Swiggy cancellation policies: [Business Standard, 21 May 2025](https://www.business-standard.com/industry/news/ccpa-zomato-swiggy-cancellation-refund-policy-update-directive-125052101628_1.html), [Inc42](https://inc42.com/buzz/zomato-cancellation-policy-cancelling-zomato-delivery-orders-could-prove-very-costly-for-users)
- Service charge: [LiveLaw on the Delhi High Court judgment, 28 Mar 2025](https://www.livelaw.in/amp/high-court/delhi-high-court/delhi-high-court-restaurant-service-charge-on-food-not-mandatory-287836)
- Dark patterns: [JSA summary of the CCPA guidelines, 2023](https://jsalaw.com/wp-content/uploads/2023/12/JSA-Prism-Consumer-Protection-Guidelines-for-Prevention-and-Regulation-of-Dark-Patterns-20233-Final.pdf)
- RBI failed-transaction turnaround times: [RBI circular, 20 Sep 2019](https://rbi.org.in/Scripts/NotificationUser.aspx?Id=11693)
- UPI chargebacks: [Business Standard, 12 Feb 2025](https://business-standard.com/finance/personal-finance/new-upi-rule-on-automatic-acceptance-rejection-of-chargebacks-from-feb-15-125021200820_1.html), [NPCI circular OC-213](https://npci.org.in/PDF/npci/upi/circular/2025/UPI-OC-No-213-FY-2024-25-Auto-Acceptance-Rejection-of-Chargeback.pdf), [Free Press Journal, Jun 2025](https://www.freepressjournal.in/business/relief-for-upi-users-sent-money-to-wrong-id-new-rule-ensures-quick-refund-from-july-15)
- Razorpay refunds: [Refunds](https://razorpay.com/docs/payments/refunds/), [Instant refunds](https://razorpay.com/docs/payments/refunds/instant/)
- GST credit notes: [Tally guide to Section 34](https://tallysolutions.com/gst/credit-note-under-gst/)
- FSSAI display rules: [FSSAI FAQ on display of information](https://fssai.gov.in/upload/uploadfiles/files/FAQ-%20Display%20of%20Information.pdf)
- Hotel practice: [Lemon Tree booking and cancellation policy](https://www.lemontreehotels.com/factsheet/Booking_and_Cancellation_Policy.pdf)

**Limits of this research.** Secondary summaries were used for the E-Commerce Rules and GST, not the gazette text. The RBI card-not-present row and the July 2025 UPI change were reported second-hand. This is not legal or tax advice: the policy should be checked by a lawyer and the café's CA before it is published.
