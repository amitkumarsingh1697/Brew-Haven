/**
 * Moves a business to another plan (there is no billing yet, so plans are changed by us):
 *   pnpm --filter @brew-haven/api plan <business-link> <starter|growth|multi>
 */
import { eq } from "drizzle-orm";
import { PLANS, type PlanId } from "@brew-haven/domain";
import { loadConfig } from "../config.js";
import { createDb } from "../db/client.js";
import { tenants } from "../db/schema.js";

const [slug, plan] = process.argv.slice(2);
if (!slug || !plan || !(plan in PLANS)) {
  console.error(`Usage: pnpm --filter @brew-haven/api plan <business-link> <${Object.keys(PLANS).join("|")}>`);
  process.exit(1);
}
const { db, pool } = createDb(loadConfig().databaseUrl);
const [row] = await db.update(tenants).set({ plan: plan as PlanId }).where(eq(tenants.slug, slug)).returning({ name: tenants.name });
await pool.end();
if (!row) {
  console.error(`No business with the link "${slug}"`);
  process.exit(1);
}
console.log(`${row.name} is now on the ${PLANS[plan as PlanId].name} plan.`);
