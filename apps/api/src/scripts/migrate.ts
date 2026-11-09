import { loadConfig } from "../config.js";
import { createDb } from "../db/client.js";
import { migrate } from "../db/migrate.js";

const { db, pool } = createDb(loadConfig().databaseUrl);
await migrate(db);
await pool.end();
console.log("migrations applied");
