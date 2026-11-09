import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type After = (fn: () => void) => void;

export function createDb(databaseUrl: string): { db: Db; pool: pg.Pool } {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
  return { db: drizzle(pool, { schema }), pool };
}

/**
 * Runs work in a transaction and calls `after` hooks only once it commits,
 * so SSE pushes never announce a change that was rolled back.
 */
export async function withTx<T>(db: Db, work: (tx: Tx, after: After) => Promise<T>): Promise<T> {
  const hooks: Array<() => void> = [];
  const result = await db.transaction((tx) => work(tx, (fn) => hooks.push(fn)));
  for (const fn of hooks) {
    try {
      fn();
    } catch {
      // after-commit hooks are best effort (e.g. SSE fan-out)
    }
  }
  return result;
}
