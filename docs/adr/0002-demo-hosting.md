# ADR-0002: Free-tier demo hosting

**Status:** Accepted for the pitch demo (D-14). Production hosting is costed in the SOW after the deal.
**Research date:** 09 Nov 2026. Free tiers change often; recheck before relying on them.

## Recommendation

| Need | Provider (free tier) | Why | Catch |
|---|---|---|---|
| Customer and staff apps (static) | **Cloudflare Pages** | Unlimited static bandwidth, no card, commercial use allowed, global CDN | 25 MiB per file |
| 3D models and textures | **Cloudflare R2** | 10 GB storage and zero egress fees | Needs a Cloudflare account; may ask for a card for R2 |
| API | **Render** free web service | No card; Docker or Node; 512 MB | Sleeps after 15 min idle and takes about 1 min to wake. For a demo, open the app a minute early or ping it on a schedule |
| PostgreSQL | **Neon** free | 0.5 GB per project, no card, does not expire, branching | Compute scales to zero; first query after idle takes about 0.5–1 s |
| Payments | **Razorpay test mode** (or the built-in simulated provider) | Free sandbox; refunds and webhooks work in test mode | Live mode needs the café's KYC (Q-R2-01) |
| Source and CI | **GitHub** + GitHub Actions | Already in use | — |

**Avoid for this project:** Vercel Hobby (personal, non-commercial use only); Fly.io (no free allowance now); Supabase free (pauses after a week of inactivity); Render free Postgres (deleted after 30 days); Oracle Always Free (capacity problems and idle reclaim).

## Accounts Amit needs to create (all free)

1. Cloudflare (Pages + R2)
2. Render
3. Neon
4. Razorpay (test mode), when the gateway is confirmed

Claude cannot create accounts or enter payment details. Everything is set up so that, once the accounts exist, deployment is a few environment variables and a connect-the-repo step.

## Production (for the SOW, not now)

The likely production setup is a small always-on instance (Render Starter, Railway or a Koyeb paid instance), Neon Launch, R2, a WhatsApp BSP, and error tracking (Sentry). The hidden costs to include in the SOW are listed in `docs/onboarding/OPEN_QUESTIONS.md` and will be expanded in the cost workstream.

## Sources

* Flavio Copes, "Every hosting provider's free tier, side by side" (checked Sep 2026): https://flaviocopes.com/hosting-free-tiers/
* SnapDeploy, "State of Free Hosting 2026": https://snapdeploy.dev/state-of-free-hosting
* Neon, "Neon vs Supabase free plan": https://neon.com/guides/neon-vs-supabase-free-plan
