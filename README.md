# Brew Haven

**SANCTUARY FOR COFFEE LOVERS**

*Where Every Sip Feels Like Home.*

COFFEE · COMFORT · CONNECTION

---

## Status: Sprint 0 (development authorised 09 Nov 2026)

Brew Haven is the product (owned by Inferra Software). **400 Coffee Cafe** is the first café customer, with two outlets (Tower A and Tower B). Decisions are in [`docs/decisions/DECISION_LOG.md`](docs/decisions/DECISION_LOG.md); architecture choices are in [`docs/adr/`](docs/adr/README.md).

What works today:

* **Customer app** (`apps/customer`): 2D café welcome, menu with customisation and veg/non-veg marks, basket, checkout with mobile number and separate offers opt-in, pay-now (demo gateway or Razorpay), and live order tracking. If an item runs out after payment, the customer can swap it (paying or getting back the difference), remove it (refund) or cancel the order (full refund).
* **Staff app** (`apps/staff`): PIN sign-in by role; live order board; kitchen display with station filter and new-order chime; reject with reason and refund; "item ran out"; counter orders placed for the customer and paid by cash (with change), card machine, the café's UPI QR, or "Scan to pay" (a QR the customer pays on their phone), with the cashier's mark-paid recorded in the audit log; stock and sold-out toggles; today's takings.
* **GST** is charged on the whole bill at order time (CGST + SGST, rounded to the rupee), or taken out of tax-inclusive prices; a per-café setting (ADR-0004).
* **API** (`apps/api`): Fastify + PostgreSQL. Orders are placed only after a signed payment webhook is verified.

## Run it locally

Needs Node 22, pnpm 10 and PostgreSQL 16.

```bash
pnpm install
createdb brewhaven                      # once
pnpm --filter @brew-haven/api db:seed   # migrates and loads the demo café
pnpm dev:api                            # http://localhost:8080
pnpm dev:customer                       # http://localhost:5173
pnpm dev:staff                          # http://localhost:5174
```

Demo staff PINs (demo data only): Owner/Admin 1111, Cashier Tower A 2222, Kitchen Tower A 3333, Cashier Tower B 4444, Kitchen Tower B 5555.

Tests: `createdb brewhaven_test && pnpm test` (domain rules, design-token contrast, and API integration tests against a real database).

## Code layout

| Folder | Contents |
|---|---|
| `apps/api` | Backend API, database schema and migrations, payment adapters |
| `apps/customer` | Customer ordering web app (PWA) |
| `apps/staff` | Cashier, kitchen and admin web app |
| `packages/domain` | Money, pricing, order state machine, refund rules (no I/O) |
| `packages/contracts` | Shared API schemas used by the API and both apps |
| `packages/ui-tokens` | Colours, type and motion tokens, with contrast tests |

## Documentation layout

| Folder | Contents |
|---|---|
| `docs/source-package-v1.1/` | The original supplied documents, unmodified (byte-identical copies), grouped by area |
| `docs/onboarding/` | Documentation review and gap analysis: inventory, project understanding, RTM, architecture review, sign-off status, assumptions, risks, open questions, readiness report, execution plan |
| `docs/design/concept-screens/` | The six illustrative concept UI images, extracted from the client pitch deck (not production screens) |
| `docs/brand/` | Project name, tagline and brand notes |
| `docs/decisions/` | Decision log for resolving the open questions and conflicts |
| `docs/adr/` | Architecture decision records for the build |

## Where to start

1. [`docs/onboarding/DEVELOPMENT_READINESS_REPORT.md`](docs/onboarding/DEVELOPMENT_READINESS_REPORT.md): overall verdict and blockers
2. [`docs/onboarding/OPEN_QUESTIONS.md`](docs/onboarding/OPEN_QUESTIONS.md): conflict log and questions awaiting answers
3. [`docs/onboarding/PRE_DEVELOPMENT_SIGNOFF.md`](docs/onboarding/PRE_DEVELOPMENT_SIGNOFF.md): status of the 10 sign-off items
