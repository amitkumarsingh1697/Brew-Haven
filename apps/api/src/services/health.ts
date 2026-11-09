import { and, count, isNotNull, isNull, min, gte, sql } from "drizzle-orm";
import { outbox } from "../db/schema.js";
import type { Ctx } from "./flows.js";

/** Background jobs waiting longer than this are worth a look (a provider may be down). */
const BACKLOG_LIMIT_MS = 5 * 60_000;
/** The worker ticks every second; a minute of silence means it has stopped. */
const WORKER_SILENT_MS = 60_000;

export interface Readiness {
  ok: boolean;
  checks: {
    database: { ok: boolean; ms?: number; error?: string };
    jobs: { ok: boolean; waiting: number; oldestWaitingSeconds: number | null; gaveUpLastDay: number };
    worker: { ok: boolean; lastTickSecondsAgo: number | null; running: boolean };
  };
}

export async function readiness(ctx: Ctx, opts: { workerExpected: boolean; now?: number }): Promise<Readiness> {
  const now = opts.now ?? Date.now();
  const t0 = performance.now();
  let database: Readiness["checks"]["database"];
  try {
    await ctx.db.execute(sql`select 1`);
    database = { ok: true, ms: Math.round(performance.now() - t0) };
  } catch (e) {
    database = { ok: false, error: (e as Error).message.slice(0, 200) };
  }

  let jobs: Readiness["checks"]["jobs"] = { ok: false, waiting: 0, oldestWaitingSeconds: null, gaveUpLastDay: 0 };
  if (database.ok) {
    const [pending] = await ctx.db.select({ n: count(), oldest: min(outbox.createdAt) }).from(outbox).where(isNull(outbox.processedAt));
    const [parked] = await ctx.db
      .select({ n: count() })
      .from(outbox)
      .where(and(isNotNull(outbox.processedAt), isNotNull(outbox.lastError), gte(outbox.attempts, 8), gte(outbox.processedAt, new Date(now - 86_400_000))));
    const oldestMs = pending?.oldest ? now - new Date(pending.oldest).getTime() : null;
    jobs = {
      ok: oldestMs === null || oldestMs < BACKLOG_LIMIT_MS,
      waiting: Number(pending?.n ?? 0),
      oldestWaitingSeconds: oldestMs === null ? null : Math.round(oldestMs / 1000),
      gaveUpLastDay: Number(parked?.n ?? 0),
    };
  }

  const last = ctx.worker?.lastTickAt ?? null;
  const worker = {
    running: opts.workerExpected,
    lastTickSecondsAgo: last === null ? null : Math.round((now - last) / 1000),
    // A web-only instance (RUN_WORKER=false) leaves the worker to another process.
    ok: !opts.workerExpected || (last !== null && now - last < WORKER_SILENT_MS),
  };
  // Jobs backing up is reported but doesn't fail readiness: a WhatsApp or gateway outage would
  // otherwise make the host restart a healthy API. Parked jobs raise an alert instead.
  return { ok: database.ok && worker.ok, checks: { database, jobs, worker } };
}
