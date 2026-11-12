/**
 * Adds a Brew Haven team member who can see every business at /platform on the staff app, or
 * resets their password:
 *   pnpm --filter @brew-haven/api platform-admin <email> "<name>"
 * The password is asked for (it is not taken on the command line, so it stays out of shell history).
 */
import { createInterface } from "node:readline/promises";
import { hashPin } from "../auth.js";
import { loadConfig } from "../config.js";
import { createDb } from "../db/client.js";
import { platformAdmins } from "../db/schema.js";

const [rawEmail, name] = process.argv.slice(2);
const email = rawEmail?.trim().toLowerCase();
if (!email || !email.includes("@") || !name) {
  console.error('Usage: pnpm --filter @brew-haven/api platform-admin <email> "<name>"');
  process.exit(1);
}
const password = process.env.PLATFORM_ADMIN_PASSWORD ?? (await createInterface({ input: process.stdin, output: process.stdout }).question("Password (at least 12 characters): "));
if (password.length < 12) {
  console.error("Use at least 12 characters.");
  process.exit(1);
}
const { db, pool } = createDb(loadConfig().databaseUrl);
const passwordHash = await hashPin(password);
await db.insert(platformAdmins).values({ email, name, passwordHash }).onConflictDoUpdate({ target: platformAdmins.email, set: { name, passwordHash, active: true } });
await pool.end();
console.log(`${name} <${email}> can now sign in at /platform on the staff app.`);
