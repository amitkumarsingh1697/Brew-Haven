# Load test

`tools/load-test.mjs` drives the whole ordering path while staff screens listen. Each virtual
customer opens the menu, gets a price quote, places an order, pays through the simulated gateway
and checks the tracking page, in a loop. Staff screens hold the live order stream open, and the
script times how long a paid order takes to appear on them.

## Running it

Use a separate database so the demo data stays clean, and turn per-IP limits off (every virtual
customer comes from one IP). The API refuses `RATE_LIMIT=off` in production, and the script
refuses to run unless payments are simulated.

```sh
createdb brewhaven_load
DATABASE_URL=postgres://…/brewhaven_load pnpm --filter @brew-haven/api db:migrate
DATABASE_URL=postgres://…/brewhaven_load pnpm --filter @brew-haven/api db:seed
DATABASE_URL=postgres://…/brewhaven_load PORT=8090 RATE_LIMIT=off pnpm --filter @brew-haven/api dev
node tools/load-test.mjs --api http://localhost:8090 --customers 100 --duration 30 --screens 8
```

It passes when errors are at or under 1% and 95% of orders are placed within 1.5 seconds.

## Results (9 Nov 2026, dev container: 4 CPUs, one API process, local Postgres 16)

100 customers for 30 seconds, with 8 staff screens on the live stream:

| Step | Requests | p50 | p95 | p99 | Errors |
|---|---|---|---|---|---|
| Menu | 1,363 | 80 ms | 427 ms | 555 ms | 0 |
| Price quote | 1,363 | 270 ms | 524 ms | 616 ms | 0 |
| Place order | 1,363 | 310 ms | 547 ms | 639 ms | 0 |
| Pay (simulated) | 1,363 | 302 ms | 530 ms | 650 ms | 0 |
| Tracking page | 1,363 | 110 ms | 421 ms | 538 ms | 0 |

- 1,363 orders paid: about 41 per second, or 2,450 per minute.
- All 10,904 order arrivals reached the staff screens: p50 295 ms and p95 522 ms from tapping Pay.

For scale, both cafés together at a busy peak might see a few hundred orders an hour, which is
well under 1% of this load.

## Caveats

- This is one machine with the database next to the API. On the planned hosting (Render for the
  API, Neon for Postgres; ADR-0002) every query crosses a network, so expect higher latencies.
  Re-run this against staging once it's deployed, with `--api` pointing there.
- Live updates go through one API process (in-memory fan-out). Running more than one API
  instance would need a shared channel (for example Postgres LISTEN/NOTIFY) first; see ADR-0001.
- WhatsApp sends were in preview mode, so no provider latency is included.
