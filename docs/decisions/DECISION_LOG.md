# Decision Log

Record each resolved question or conflict here. IDs refer to [`../onboarding/OPEN_QUESTIONS.md`](../onboarding/OPEN_QUESTIONS.md).

| Date | ID | Decision | Decided by | Evidence / notes |
|---|---|---|---|---|
| 2026-11-08 | BRAND-01 | Project name is **Brew Haven**; tagline "SANCTUARY FOR COFFEE LOVERS"; supporting line "Where Every Sip Feels Like Home."; pillars "COFFEE · COMFORT · CONNECTION" | Amit | Thread message, 08 Nov 2026. Scope of the rename to confirm (see `../brand/BRAND.md`) |
| 2026-11-08 | C-22 / DB-01 | **PostgreSQL** confirmed as the database (as in ADR / doc 02) | Amit | Thread message, 08 Nov 2026 |
| 2026-11-08 | C-22 / COST-01 | **Doc 08 is the cost basis** for estimates. Doc 11 is used as the template for recording vendor quotes. | Amit | Thread message, 08 Nov 2026. Doc 08 §8.1 still says its figures need re-estimating for the immersive 3D scope; that remains open under C-09 / BR-01 |
| 2026-11-08 | C-12 / D-01 | **First build is the whole café system**: customer Virtual Café, backend, cashier POS, kitchen display and owner screens. Claude builds all of it. | Amit | Thread, 08 Nov 2026 |
| 2026-11-08 | C-01 / D-02 | **Pay-now is mandatory when the customer places an order** in the Virtual Café. The order is accepted only after the payment is verified successfully. There is no pay-at-counter path in the customer app. | Amit | Thread, 08 Nov 2026. Supersedes ADR-002 (static UPI plus manual check) for customer orders. Follow-ups are in Round 2, Q-R2-01 to Q-R2-04 |
| 2026-11-08 | C-02 / D-03 | **Mobile number is mandatory for every order**, used for order updates and offers. | Amit | Thread, 08 Nov 2026. Offers are marketing messages, so they need a separate opt-in that is not pre-ticked [07 §7.1]. See Q-R2-07 |
| 2026-11-08 | C-14 / D-04 | **Takeaway only.** 400 Coffee has no seating; customers collect at the counter and eat in the office lobby or waiting area. There are no table QR codes and no dine-in flow. | Amit | Thread, 08 Nov 2026 |
| 2026-11-08 | C-11 / BRAND-02 | **Brew Haven is the product name; 400 Coffee is the café (first customer/tenant).** The 3D Virtual Café must be reusable for other cafés, so per-tenant branding (name, greeting, apron logo, menu) is configuration, not hard-coded. | Amit | Thread, 08 Nov 2026 |
| 2026-11-08 | D-05 | **Inferra Software owns the product.** 400 Coffee is the first café customer. | Amit | Thread, 08 Nov 2026 |
| 2026-11-08 | C-09 / D-06 | **Re-estimate costs for the 3D scope.** Final pricing will be negotiated with the café owner after the pitch and a working demo. | Amit | Thread, 08 Nov 2026. Replaces COST-01 "doc 08 is the cost basis" for quoting; doc 08 stays the internal model |
| 2026-11-08 | SO-1 / D-07 | **Use a dummy menu for development** until the owner supplies the real menu. | Amit | Thread, 08 Nov 2026. It will be an illustrative Indian-café menu, clearly marked as demo data and not copied from any one real café |
| 2026-11-08 | SO-2 / D-08 | **Brand board supplied** (`docs/brand/assets/brew-haven-logo-and-brand-board.png`). Fonts and colours: use those in the docs where given; otherwise Claude chooses, aiming for a café, coffee and refreshing feel. | Amit | Thread, 08 Nov 2026 |
| 2026-11-08 | SO-6 | GST, tax-inclusive pricing, bill format and refund/cancellation rules are **pending confirmation with the café owner**. | Amit | Open |
| 2026-11-08 | OD-07 | The testing team will be named later; **final sign-off is by the café owner**. | Amit | Thread, 08 Nov 2026 |

## Pending (from the onboarding review)

C-03/C-04 state machines (to be drafted in Sprint 0) · SO-3 3D assets · SO-4 payment provider · SO-5 WhatsApp · SO-6 tax and refund rules · SO-8 devices · SO-9 screens · SO-10 hosting · Round 2 questions in `../onboarding/OPEN_QUESTIONS.md` §5.
