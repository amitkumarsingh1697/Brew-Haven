# Plans, prices and the free trial

Prices were set on 12 Nov 2026 (Amit asked us to go ahead with our recommendation). They are in
`packages/domain/src/plans.ts`; change a price or limit there and it applies on the next deploy.

| Plan | Per month | Per year (two months free) | Cafés | Active team members (owner included) |
|---|---|---|---|---|
| Starter | ₹999 | ₹9,990 | 1 | 5 |
| Growth | ₹1,999 | ₹19,990 | 3 | 20 |
| Multi-café | ₹3,999 | ₹39,990 | no limit | no limit |

Prices are before GST (18% on software subscriptions; Brew Haven's own invoice adds it).

## Free trial

- A business that signs up starts on **Starter** with a **30-day free trial** (`TRIAL_DAYS`).
- The owner sees the plan, its price and where they stand at the top of Setup → Café settings:
  "Free trial, 12 days left", "Paid until 31 December 2026", or a "Payment due" note once the trial
  or paid period has ended.
- **Nothing stops automatically.** When a trial ends unpaid, the business keeps working and the
  owner sees "Payment due". Brew Haven decides whether to pause the account from the team page
  (Terms of service, section 4). This avoids a café losing its counter mid-service over a payment
  that is on its way.
- Businesses that existed before plans (the 400 Coffee pilot) have no trial and show as
  **Not billed** to the team; the owner sees no billing note.

## Taking payment

Live payment collection for subscriptions is not built yet (it comes with the payment gateway).
Until then the owner pays by UPI or bank transfer, and the Brew Haven team records it on the team
page (`/platform`):

- **Record payment** asks for a month or a year, how they paid (UPI, bank transfer, card, cash) and
  an optional reference. The paid period runs on from the later of today and the current end date,
  and Brew Haven's invoice is issued for it (numbered `BH2627-00001`, one series per financial year).
  The owner sees every invoice under Café settings → Your plan, and can print it or save it as a PDF.
- **Fix date** corrects the paid-until date without issuing an invoice.

### Brew Haven's invoices

- Seller details come from the API's environment: `BREW_HAVEN_LEGAL_NAME`, `BREW_HAVEN_GSTIN`,
  `BREW_HAVEN_ADDRESS`, `BREW_HAVEN_EMAIL`. **Action required (Amit):** the company's registered name,
  address and GSTIN.
- With a GSTIN set, it is a tax invoice with 18% GST (SAC 998314): CGST + SGST when the café's GSTIN
  is in the same state (or the café has none), IGST when it is in another state. Without Brew Haven's
  GSTIN it is a plain invoice with no GST.
- The buyer's name, GSTIN and address (the first café's) are copied in when the invoice is issued,
  so later edits never change it.
- **Change trial** extends or ends a free trial.

Both are written to the business's own Activity log ("Brew Haven recorded a payment: paid until
12 Dec 2026 (Starter, ₹999.00 a month)"). Dates are whole days in India: paid until 31 Dec means
the business is paid up to midnight at the end of 31 Dec IST.

## Limits

- Adding a café or a team member, or giving a removed team member access back, is refused past the
  limit with "The Starter plan allows 1 café. Contact us to move to a bigger plan." The check locks
  the business while it counts, so two additions at once can't both slip through.
- Features are not gated by plan. Inventory, exports and reports work on every plan.
- "Add a new café" is greyed out at the limit.

## Changing a business's plan

From the team page, or from a terminal:

```sh
pnpm --filter @brew-haven/api plan <business-link> <starter|growth|multi>
```
