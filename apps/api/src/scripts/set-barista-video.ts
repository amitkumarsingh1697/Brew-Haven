/**
 * Switches a café's 3D welcome scene to its filmed barista, or back to the drawn one:
 *   pnpm --filter @brew-haven/api barista-video <business-link> <idle-clip-url> [wave-clip-url] [--key=#00b140]
 *   pnpm --filter @brew-haven/api barista-video <business-link> --off
 * Clip URLs can be paths on the customer app (e.g. /baristas/400-coffee/idle.mp4) or full https
 * URLs on a host that allows cross-origin video. See docs/delivery/BARISTA_VIDEO.md.
 */
import { eq } from "drizzle-orm";
import { loadConfig } from "../config.js";
import { createDb } from "../db/client.js";
import { tenants } from "../db/schema.js";

const args = process.argv.slice(2);
const [slug, idle, maybeWave] = args.filter((a) => !a.startsWith("--key="));
const key = args.find((a) => a.startsWith("--key="))?.slice(6);
const ok = (u?: string) => !!u && (u.startsWith("/") || u.startsWith("https://"));
if (!slug || !(idle === "--off" || ok(idle)) || (maybeWave && !ok(maybeWave)) || (key && !/^#[0-9a-f]{6}$/i.test(key))) {
  console.error("Usage: pnpm --filter @brew-haven/api barista-video <business-link> <idle-clip-url> [wave-clip-url] [--key=#00b140]\n       pnpm --filter @brew-haven/api barista-video <business-link> --off");
  process.exit(1);
}
const { db, pool } = createDb(loadConfig().databaseUrl);
const [t] = await db.select({ branding: tenants.branding, name: tenants.name }).from(tenants).where(eq(tenants.slug, slug));
if (!t) {
  await pool.end();
  console.error(`No business with the link "${slug}"`);
  process.exit(1);
}
const { baristaVideo: _old, ...rest } = t.branding as Record<string, unknown>;
const branding = idle === "--off" ? rest : { ...rest, baristaVideo: { idle, ...(maybeWave ? { wave: maybeWave } : {}), ...(key ? { keyColor: key } : {}) } };
await db.update(tenants).set({ branding }).where(eq(tenants.slug, slug));
await pool.end();
console.log(idle === "--off" ? `${t.name} is back to the drawn barista.` : `${t.name} now shows the filmed barista.`);
