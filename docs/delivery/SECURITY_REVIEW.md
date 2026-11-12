# Security review (pilot readiness, 12 Nov 2026)

A pass over the code before the pilot. Fixed items are in the same PR; the rest are checked and
noted. Re-run before each release: `pnpm audit --prod`, the API tests and `node tools/a11y-audit.cjs`.

## Fixed

| Finding | Fix |
|---|---|
| `pnpm audit`: drizzle-orm < 0.45.2 (SQL injection through escaped identifiers; we never pass user input as identifiers, but upgraded anyway) and zod < 4.6.6 (memory use on oversized collections; bodies are capped at 64 KB) | drizzle-orm 0.45.2, zod 4.6.6. `pnpm audit --prod` now reports none |
| The server log recorded full request URLs, which include customer order links (`/v1/track/…`) and the live-board token in the query | Log serializer hides both (`safeUrl`, tested) |
| A 4-digit PIN was limited per person *and* address (5 tries / 5 min), so many addresses could keep guessing | Also 20 wrong PINs an hour per person across all addresses; the same for team sign-in per email |

## Checked, no change needed

- **Isolation:** every query is scoped to the signed-in business (`tenancy.test.ts`); café staff are
  limited to their cafés; team (`/platform`) and café tokens use different audiences and neither
  opens the other's routes (`platform.test.ts`).
- **Passwords and PINs:** scrypt with a random salt; constant-time compare. Team passwords at least
  12 characters, set from the command line, never sent by email.
- **Tokens:** HS256 with a 32+ character secret required in production; staff 14 h, team 8 h.
  Stored in the tab's session storage, so they end when the tab closes.
- **Customer order links:** 18 random bytes (144 bits); rate-limited.
- **Payments:** gateway webhooks are signature-checked before anything changes; UPI references
  can't be reused; card and UPI credentials never reach Brew Haven.
- **Input:** every body is validated (zod); 64 KB body limit; per-IP limits on public endpoints
  (orders, sign-up 5 an hour, sign-in, events).
- **Output:** React escapes text; CSV exports neutralise spreadsheet formulas.
- **Headers:** API sets helmet headers; both apps set a strict CSP, HSTS, `nosniff`,
  `frame-ancestors 'none'`. The staff app is `noindex`.
- **Personal data in analytics:** visit steps carry only a random per-tab id (see ANALYTICS.md).
- **Secrets:** none in the repository (searched for keys and passwords).

## For later

- A separate signing secret for team tokens (today they share the staff secret, kept apart by audience).
- Two-step sign-in for the team page once more than one person uses it.
- An outside penetration test before taking payments for many businesses.
