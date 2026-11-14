/**
 * Adds a Brew Haven team member who can see every business at /platform on the staff app, or
 * resets their password:
 *   pnpm --filter @brew-haven/api platform-admin <email> "<name>"
 * The password is asked for (it is not taken on the command line, so it stays out of shell history).
 *
 * Lost phone and recovery codes: turn their two-step sign-in off so they can set it up again
 * after signing in with their password:
 *   pnpm --filter @brew-haven/api platform-admin <email> --reset-two-step
 */
import { createInterface } from "node:readline/promises";
import { eq } from "drizzle-orm";
import { hashPin } from "../auth.js";
import { loadConfig } from "../config.js";
import { createDb } from "../db/client.js";
import { platformAdmins } from "../db/schema.js";

const [rawEmail, name] = process.argv.slice(2);
const email = rawEmail?.trim().toLowerCase();
if (email && name === "--reset-two-step") {
  const { db, pool } = createDb(loadConfig().databaseUrl);
  const done = await db
    .update(platformAdmins)
    .set({ totpSecret: null, totpPendingSecret: null, totpEnabledAt: null, totpLastStep: null, recoveryCodeHashes: [] })
    .where(eq(platformAdmins.email, email))
    .returning({ id: platformAdmins.id });
  await pool.end();
  console.log(done.length ? `Two-step sign-in is off for ${email}. They set it up again after their next sign-in.` : `No team member with the email ${email}.`);
  process.exit(done.length ? 0 : 1);
}
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
