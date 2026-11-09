import { fileURLToPath } from "node:url";
import { migrate as drizzleMigrate } from "drizzle-orm/node-postgres/migrator";
import type { Db } from "./client.js";

export const MIGRATIONS_DIR = fileURLToPath(new URL("../../drizzle", import.meta.url));

export async function migrate(db: Db) {
  await db.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto");
  await drizzleMigrate(db, { migrationsFolder: MIGRATIONS_DIR });
}
