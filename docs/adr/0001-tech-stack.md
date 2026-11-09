# ADR-0001: TypeScript end to end

**Status:** Accepted, 09 Nov 2026. Amit delegated the choice (D-15). Criteria: easy to maintain, easy to host, high-performing, easy to scale.
**Supersedes:** the Java 21 + Spring Boot backend in source doc 02. PostgreSQL (DB-01) is kept.

## Decision

| Layer | Choice |
|---|---|
| Language | TypeScript (strict) everywhere |
| Monorepo | pnpm workspaces |
| API | Node.js 22 + Fastify 5, modular monolith (modules: catalog, ordering, payments, staff, notifications) |
| Validation and contract | Zod schemas in `packages/contracts`, shared by the API and every app; OpenAPI generated from them |
| Database | PostgreSQL 16 via Drizzle ORM and SQL migrations |
| Domain logic | `packages/domain`: pure functions for pricing, state machines and refund maths, with no I/O |
| Realtime | Server-Sent Events, with REST authoritative (source ADR-005 kept) |
| Async work | Transactional outbox table in Postgres, drained by an in-process worker (no Redis needed at pilot scale) |
| Customer app | React 19 + Vite PWA; React Three Fiber for the 3D café with a full 2D path |
| Staff app | React + Vite: POS, kitchen display and admin in one app, with screens gated by role |
| Tests | Vitest (unit and API integration against a real Postgres), Playwright (end to end) |

## Why not Java + Spring Boot

* **Two languages, two toolchains.** With TypeScript, the order, money and validation rules are written once and shared by the API, POS and customer app. That is the biggest maintenance win for a small team.
* **Free hosting.** Free tiers give about 512 MB RAM and 0.1 CPU, and they sleep when idle. A Spring Boot JVM is tight in 512 MB and slow to cold-start after sleep. A Fastify process idles at around 60–80 MB and starts in under a second.
* **Performance is not the constraint.** Two cafés produce single-digit orders per second at peak. Fastify handles thousands of requests per second per core. Scaling is horizontal: the API is stateless, and SSE fan-out moves to Postgres LISTEN/NOTIFY (then Redis) when there is more than one instance.

## Consequences

* Money is integer paise everywhere (never floats), enforced by the shared schema types.
* One `pnpm test` runs every check. CI runs it against a Postgres service container.
* If a future team must use Java, the OpenAPI contract and the Postgres schema are the boundary that a rewrite has to honour.
