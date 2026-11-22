# Brew Haven

**SANCTUARY FOR COFFEE LOVERS** · *Where every sip feels like home.*

Brew Haven is an ordering system for cafés. Customers scan a QR code, order and pay on their phone, and follow their order live. The counter and kitchen work from one shared board. The owner sets up the menu, staff, stock and reports. The Brew Haven team runs the businesses, their plans and their billing from one console.

**400 Coffee Cafe** is the first café, with two outlets: Tower A and Tower B. Brew Haven is owned by Inferra Software.

**Live demo** (free hosting on Render, payments simulated; the first visit after 15 quiet minutes takes about a minute while the server wakes):
- Customer app: https://brew-haven-order.onrender.com/400-coffee/tower-a
- Staff app: https://brew-haven-staff.onrender.com (demo PINs below)
- Brew Haven console: https://brew-haven-staff.onrender.com/platform

| App | Who uses it | Local address |
|---|---|---|
| Customer app (`apps/customer`) | People ordering coffee | http://localhost:5173/400-coffee/tower-a |
| Staff app (`apps/staff`) | Owner, cashiers, kitchen | http://localhost:5174 |
| Brew Haven console (in the staff app) | The Brew Haven team | http://localhost:5174/platform |
| API (`apps/api`) | Everything above | http://localhost:8080 |

---

## Contents
1. [Screenshots](#screenshots)
2. [Run it on your computer](#run-it-on-your-computer)
3. [Put it online](#put-it-online)
4. [Onboard a new café](#onboard-a-new-café)
5. [How to use it, by role](#how-to-use-it-by-role)
6. [Code and docs layout](#code-and-docs-layout)

---

## Screenshots

All 36 screens are in [`docs/screenshots`](docs/screenshots). They were captured on 22 Nov 2026 with the demo data. To capture them again, run `node tools/screenshots.cjs <folder>` while the apps are running.

### Customer (phone)

| Welcome | Menu | Item options | Checkout |
|---|---|---|---|
| ![Welcome](docs/screenshots/1-customer/01-welcome.webp) | ![Menu](docs/screenshots/1-customer/02-menu.webp) | ![Item options](docs/screenshots/1-customer/03-item-options.webp) | ![Checkout](docs/screenshots/1-customer/05-checkout.webp) |

| Pay | Order placed | Ready for pickup | Receipt |
|---|---|---|---|
| ![Pay](docs/screenshots/1-customer/06-payment-demo-gateway.webp) | ![Placed](docs/screenshots/1-customer/07-order-placed-live-tracking.webp) | ![Ready](docs/screenshots/1-customer/08-order-ready-for-pickup.webp) | ![Receipt](docs/screenshots/1-customer/09-receipt.webp) |

Also: [menu with basket](docs/screenshots/1-customer/04-menu-with-basket.webp), [terms of service](docs/screenshots/1-customer/10-terms-of-service.webp), [privacy policy](docs/screenshots/1-customer/11-privacy-policy.webp).

### Café owner and staff (laptop or tablet)

**Orders board:** every open order, with its status, and the actions for each.
![Orders board](docs/screenshots/2-cafe-owner-and-staff/07-orders-board-with-ready-order.webp)

**Kitchen display:** tickets by station, with Start, Ready, Item ran out and Reject.
![Kitchen display](docs/screenshots/2-cafe-owner-and-staff/06-kitchen-display-orders-in-progress.webp)

**New counter order:** the cashier orders for a walk-in customer, who then pays by cash, card, UPI or a scan-to-pay QR.
![New counter order](docs/screenshots/2-cafe-owner-and-staff/09-new-counter-order.webp)

**Reports:** sales, payments, top items, busy hours, kitchen speed, online ordering funnel and the GST summary.
![Reports](docs/screenshots/2-cafe-owner-and-staff/12-setup-reports.webp)

| Sign up | Staff sign-in | PIN | Today |
|---|---|---|---|
| ![Sign up](docs/screenshots/2-cafe-owner-and-staff/01-sign-up-a-new-cafe.webp) | ![Sign-in](docs/screenshots/2-cafe-owner-and-staff/02-staff-sign-in.webp) | ![PIN](docs/screenshots/2-cafe-owner-and-staff/03-pin-pad.webp) | ![Today](docs/screenshots/2-cafe-owner-and-staff/11-today.webp) |

| Menu setup | Staff | Café settings | Stock |
|---|---|---|---|
| ![Menu](docs/screenshots/2-cafe-owner-and-staff/16-setup-menu.webp) | ![Staff](docs/screenshots/2-cafe-owner-and-staff/17-setup-staff.webp) | ![Settings](docs/screenshots/2-cafe-owner-and-staff/18-setup-cafe-settings.webp) | ![Stock](docs/screenshots/2-cafe-owner-and-staff/10-stock.webp) |

Also: [payment checks](docs/screenshots/2-cafe-owner-and-staff/13-setup-payment-checks.webp), [inventory](docs/screenshots/2-cafe-owner-and-staff/14-setup-inventory.webp), [cafés and kitchens](docs/screenshots/2-cafe-owner-and-staff/15-setup-cafes-and-kitchens.webp), [customer messages](docs/screenshots/2-cafe-owner-and-staff/19-setup-customer-messages.webp), [activity log](docs/screenshots/2-cafe-owner-and-staff/20-setup-activity.webp), [help](docs/screenshots/2-cafe-owner-and-staff/08-help.webp), [what kitchen staff see](docs/screenshots/2-cafe-owner-and-staff/21-kitchen-staff-view.webp), [what cashiers see](docs/screenshots/2-cafe-owner-and-staff/22-cashier-view.webp).

### Brew Haven console (for the Brew Haven team)

![All businesses](docs/screenshots/3-brew-haven-console/02-all-businesses.webp)

Also: [team sign-in](docs/screenshots/3-brew-haven-console/01-team-sign-in.webp), [record a payment](docs/screenshots/3-brew-haven-console/03-record-a-payment.webp).

---

## Run it on your computer

You need Node 22, pnpm 10 and PostgreSQL 16 or newer.

```bash
pnpm install
cp apps/api/.env.example apps/api/.env       # local settings; never put real keys in git
createdb brewhaven                            # once
pnpm --filter @brew-haven/api db:migrate
pnpm --filter @brew-haven/api db:seed         # loads the demo café, 400 Coffee Cafe
pnpm dev:api                                  # http://localhost:8080
pnpm dev:customer                             # http://localhost:5173
pnpm dev:staff                                # http://localhost:5174
```

**Try it:**
1. Open http://localhost:5173/400-coffee/tower-a, add a coffee, check out, and tap **Pay with UPI**. Payments are simulated locally, so no money moves.
2. Open http://localhost:5174, choose **Owner (Admin)** and enter PIN `1111`. The order is on the board. Start it and mark it ready on **Kitchen display**, and the customer's phone updates.

**Demo PINs** (demo data only):

| Who | PIN |
|---|---|
| Owner (Admin) | 1111 |
| Cashier, Tower A | 2222 |
| Kitchen, Tower A | 3333 |
| Cashier, Tower B | 4444 |
| Kitchen, Tower B | 5555 |

**Brew Haven console:** create a team login, then sign in at http://localhost:5174/platform.

```bash
pnpm --filter @brew-haven/api platform-admin you@example.com "Your name"
```

**Tests:** run `createdb brewhaven_test`, then `pnpm test`. This runs the domain rules, the design-token contrast checks, and the API tests against a real database. `pnpm typecheck` checks every package.

---

## Put it online

The demo runs on free or low-cost services. The decision record is [ADR-0002](docs/adr/README.md).

| Part | Service | Where |
|---|---|---|
| Database | Neon (Postgres) | Singapore |
| API | Render web service, from [`render.yaml`](render.yaml) | Singapore |
| Customer and staff apps | Render static sites (rewrite `/*` to `/index.html`) | Worldwide |
| Own domain (later) | Cloudflare DNS, or the registrar's DNS, pointed at the Render sites | Worldwide |

The demo runs on Render's own addresses, so no domain is needed yet. The demo API's start command loads the demo café (it skips this if it's already there), and creates a console login when `PLATFORM_ADMIN_EMAIL` and `PLATFORM_ADMIN_PASSWORD` are set.

The step-by-step account setup is in [`docs/delivery/DEPLOY_RENDER_CLOUDFLARE.md`](docs/delivery/DEPLOY_RENDER_CLOUDFLARE.md). It covers what to click, which keys to create, and where they go. Keys go into the hosting settings, never into git or chat.

**Settings the API needs** (all listed in `render.yaml`):

| Setting | What it's for |
|---|---|
| `DATABASE_URL` | The Neon connection string |
| `STAFF_TOKEN_SECRET` | Signs staff sign-ins (a long random string) |
| `PAYMENT_PROVIDER` | `simulated` for the demo, `razorpay` for real payments |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | The café's own Razorpay account |
| `CORS_ORIGINS`, `CUSTOMER_APP_URL`, `PUBLIC_API_URL` | The live addresses of the apps and API |
| `NOTIFY_PROVIDER` and the `WHATSAPP_*` settings | WhatsApp order updates ([setup](docs/delivery/WHATSAPP_SETUP.md)) |
| `PLATFORM_REQUIRE_TWO_STEP` | Two-step sign-in for the console (on in production) |
| `BREW_HAVEN_*` | Brew Haven's details on subscription invoices |
| `SIGNUP_ENABLED` | Lets new cafés sign themselves up (off in production unless set) |
| `ALERT_WEBHOOK_URL` | Where alerts go when something breaks |

Backups, health checks, alerts and restore drills are covered in [`docs/delivery/OPERATIONS.md`](docs/delivery/OPERATIONS.md).

---

## Onboard a new café

There are two ways to add a café:
- **The owner signs up** at `/signup` on the staff app ([details](docs/delivery/SIGNUP.md)).
- **We set it up for them** and invite the owner.

After that, the owner works through this checklist in **Setup**:

1. **Café settings.** Enter:
   - the café name, welcome line and logo
   - the GST rate, and whether menu prices include GST
   - the receipt details: legal name, GSTIN, FSSAI licence number and a complaints contact (grievance officer)
2. **Cafés & kitchens.** Add each outlet with its address and pickup letter (A-001, B-001…), and its kitchen stations (for example Coffee bar and Kitchen).
3. **Menu.** Add categories, items and prices, choices (milk, size), veg/non-veg marks, and the station that makes each item.
4. **Staff.** Add each person as Cashier, Kitchen or Admin, choose their cafés, and set a 4-digit PIN.
5. **QR posters.** Print one per outlet from **Cafés & kitchens**. Customers scan it to order.
6. **Payments.** Open a Razorpay account in the café's own name and complete its KYC (PAN, bank account, GSTIN or proof of business, website). Then set the three `RAZORPAY_*` settings. Money settles straight to the café's bank.
7. **WhatsApp (optional).** Follow steps 1 to 5 of [`WHATSAPP_SETUP.md`](docs/delivery/WHATSAPP_SETUP.md). Customers then get "your order is ready" on WhatsApp.
8. **Train the team.** Each person needs about 20 minutes: two practice orders, one marked ready, handed over, a receipt printed and the day closed ([training guides](docs/training/README.md)).

On the Brew Haven side, the team then does three things in the console:
- picks the café's plan
- sets or ends its free trial (30 days)
- records each payment, which issues a numbered invoice ([details](docs/delivery/PLATFORM.md), [plans](docs/delivery/PLANS.md))

---

## How to use it, by role

### Customer
1. Scan the QR at the counter, or open the café's link.
2. Pick items and choices, then check out with a name and mobile number. Offers are a separate opt-in.
3. Pay by UPI or card. The order is placed only once the payment is confirmed.
4. Watch the order move from received to being made to ready. Show the order number at the counter.
5. Free cancellation until the kitchen starts. If an item runs out, choose to swap it, remove it (refunded) or cancel. The rules are in the [refund policy](docs/legal/refund-and-cancellation-policy.md).

### Cashier ([guide](docs/training/cashier.md))
- **Orders:** watch new orders arrive and hand over ready ones. Print receipts and refund items when a complaint is accepted on the same day.
- **New counter order:** take walk-in orders. Collect cash (the app shows the change), card, UPI, or show a scan-to-pay QR.
- **Today:** the day's takings, then close the day.

### Kitchen ([guide](docs/training/kitchen.md))
- **Kitchen display:** tap **Start**, then **Ready**. Filter by station.
- Tap **Item ran out** when something is finished, and the customer is asked what to do.
- A chime plays for each new order.

### Owner ([guide](docs/training/owner.md))
Owners can do everything a cashier and the kitchen can, plus:
- Setup
- Reports and CSV downloads for the accountant (orders, items, payments, GST invoices and credit notes)
- Payment checks
- Inventory
- Activity log
- Refunds above the cashier's limit
- Their own plan and invoices

### Brew Haven team ([guide](docs/delivery/PLATFORM.md))
Sign in at `/platform` with email, password and an authenticator code. From there you see:
- every business, with its cafés, team size, orders and sales (no customer details)
- its plan, billing state and paid-until date

You can record a payment, change a plan or trial, and pause or resume a business.

---

## Code and docs layout

| Folder | Contents |
|---|---|
| `apps/api` | Backend API (Fastify, PostgreSQL, Drizzle), migrations, payment and WhatsApp adapters, scripts |
| `apps/customer` | Customer ordering app (PWA) |
| `apps/staff` | Staff app: counter, kitchen, owner Setup and the Brew Haven console |
| `packages/domain` | Money, pricing, GST, order states, refund rules, plans (no I/O) |
| `packages/contracts` | Shared API schemas |
| `packages/ui-react`, `packages/ui-tokens` | Shared components (such as the receipt), colours and type |
| `tools` | Screenshots, accessibility audit, load test, backup and restore checks |
| `docs/delivery` | How each feature works, deployment, operations and the [sprint log](docs/delivery/SPRINT_LOG.md) |
| `docs/legal` | Terms, privacy policy, refund policy and the [legal review](docs/legal/LEGAL_REVIEW.md) |
| `docs/training` | Short guides for cashier, kitchen and owner (also shown under Help in the app) |
| `docs/adr`, `docs/decisions` | Architecture decisions and the decision log |
| `docs/onboarding`, `docs/source-package-v1.1` | The original brief and the pre-development review |
| `docs/screenshots` | The screens shown above |
