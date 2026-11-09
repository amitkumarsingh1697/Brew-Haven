import { loadConfig } from "../config.js";
import { createDb } from "../db/client.js";
import { migrate } from "../db/migrate.js";
import { DEMO_PINS, seedDemo } from "../db/seed-data.js";

const { db, pool } = createDb(loadConfig().databaseUrl);
await migrate(db);
const r = await seedDemo(db);
await pool.end();
console.log(r.created ? "Demo café seeded." : "Demo café already present.");
console.log("Demo staff PINs (demo only):", DEMO_PINS);
