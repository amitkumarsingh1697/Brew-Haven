import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDb } from "./db/client.js";
import { migrate } from "./db/migrate.js";
import { drainOutbox, runSweeps } from "./services/flows.js";

const config = loadConfig();
const { db, pool } = createDb(config.databaseUrl);
if (process.env.MIGRATE_ON_START !== "false") await migrate(db);
const { app, ctx } = await buildApp({ config, db });

const timers: NodeJS.Timeout[] = [];
if (config.runWorker) {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await drainOutbox(ctx);
    } catch (e) {
      app.log.error({ err: e }, "outbox tick failed");
    } finally {
      busy = false;
    }
  };
  timers.push(setInterval(tick, 1000));
  timers.push(setInterval(() => void runSweeps(ctx).catch((e) => app.log.error({ err: e }, "sweep failed")), 30_000));
}

const shutdown = async () => {
  timers.forEach(clearInterval);
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

await app.listen({ port: config.port, host: config.host });
