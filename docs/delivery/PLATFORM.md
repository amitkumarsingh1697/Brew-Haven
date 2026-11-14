# Brew Haven team view (all businesses)

Inferra, which runs Brew Haven, sees every business on the platform at **`/platform`** on the staff
app. Café owners and staff never see this page or any other business: each business only ever sees
its own cafés, staff, menu and orders (checked by `test/tenancy.test.ts`).

## Who can sign in

Team members sign in with **email and password**, which are separate from every café's PIN sign-in.
A team token can't open any café screen, and a café token (even the owner's) can't open the team
pages. Sign-in is rate-limited per minute and per email and IP.

Add a team member, or reset their password:

```
pnpm --filter @brew-haven/api platform-admin team@inferra.example "Asha"
```

The script asks for the password (at least 12 characters), so it stays out of shell history. For
automation, `PLATFORM_ADMIN_PASSWORD` can supply it instead.

### Two-step sign-in

After the password, the console asks for a 6-digit code from an authenticator app (Google
Authenticator, Microsoft Authenticator, 1Password and others). In production it is required
(`PLATFORM_REQUIRE_TWO_STEP`, on by default when `NODE_ENV=production`). Until it is on, a
password-only sign-in opens only the set-up card: scan the QR code, enter the first code, and keep
the 8 recovery codes shown (each works once, instead of a code).

- The secret is stored encrypted with a key derived from `STAFF_TOKEN_SECRET`. Changing that secret
  means everyone sets two-step sign-in up again.
- A code is accepted for its 30-second window and one either side, and never twice.
- Lost phone and recovery codes: `pnpm --filter @brew-haven/api platform-admin <email> --reset-two-step`,
  then they set it up again after signing in with their password.

## What the page shows

For each business: name, link, when it joined, owner's email and phone from sign-up, cafés, active
team members, orders and sales in the last 30 days, last order, plan and status. Tiles at the top
add up businesses, cafés, orders and sales across active businesses.

**Totals only.** Customer names, phone numbers and orders are not shown, because each café is the
data fiduciary for its customers and Brew Haven only processes that data for them (see the terms
and privacy draft).

## What the team can change

- **Plan:** Starter, Growth or Multi-café (see PLANS.md). Replaces running the `plan` script.
- **Billing:** each business shows its price and whether it is on a free trial, paid up, or due.
  "Record payment" sets the paid-until date when a UPI or bank payment arrives; "Change trial"
  extends or ends a trial. The "Paying each month" tile adds up businesses that are paid up.
- **Pause / resume:** a paused business can't take new orders, online or at the counter. Customers
  see "not taking orders right now". The owner and staff can still sign in, see reports and download
  exports, and nothing is deleted. Use it for unpaid accounts (Terms of service, section 4).

Every change is written to that business's own **Activity** log ("Brew Haven moved the business to
the Growth plan", "Brew Haven paused the account…"), so the owner can see what changed and when.

## API

- `POST /v1/platform/login` `{ email, password }` → `{ step: "DONE", token, name, email, twoStep: false }` (8-hour token), or `{ step: "CODE", ticket }` once two-step sign-in is on
- `POST /v1/platform/login/code` `{ ticket, code }` → `{ step: "DONE", token, … }` (code or recovery code; the ticket lasts 5 minutes)
- `POST /v1/platform/two-step/setup` → `{ secret, otpauthUrl }`; `POST /v1/platform/two-step/confirm` `{ code }` → `{ recoveryCodes, token }`
- `GET /v1/platform/businesses`
- `PATCH /v1/platform/businesses/:id` `{ plan?, suspended?, paidUntil?: "YYYY-MM-DD" | null, trialEndsOn?: "YYYY-MM-DD" | null }`
