import { randomUUID } from "node:crypto";
import pg from "pg";
import type { MenuResponse, OrderView, StaffSession } from "@brew-haven/contracts";
import { buildApp } from "../src/app.js";
import type { Config } from "../src/config.js";
import { createDb } from "../src/db/client.js";
import { migrate } from "../src/db/migrate.js";
import { DEMO_PINS, DEMO_TENANT_SLUG, seedDemo } from "../src/db/seed-data.js";
import { tenants } from "../src/db/schema.js";
import { eq } from "drizzle-orm";

export const TEST_DB = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/brewhaven_test";

export const testConfig: Config = {
  databaseUrl: TEST_DB,
  port: 0,
  host: "127.0.0.1",
  staffTokenSecret: "test-secret-test-secret-test-secret-123",
  corsOrigins: ["http://localhost:5173"],
  payments: { provider: "simulated", simulatedWebhookSecret: "test-webhook-secret" },
  runWorker: false,
  signupEnabled: true,
};

export async function resetDatabase() {
  const client = new pg.Client({ connectionString: TEST_DB });
  await client.connect();
  await client.query("DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;");
  await client.end();
}

/**
 * `pricesIncludeTax` defaults to true so the older suites keep checking the prices-include-GST
 * mode with round numbers. The demo café itself adds GST on the bill (SO-6); gst-on-bill.test.ts
 * and counter-payments.test.ts run in that mode.
 */
export async function setup(opts: { pricesIncludeTax?: boolean } = {}) {
  await resetDatabase();
  const { db, pool } = createDb(TEST_DB);
  await migrate(db);
  await seedDemo(db);
  await db.update(tenants).set({ pricesIncludeTax: opts.pricesIncludeTax ?? true }).where(eq(tenants.slug, DEMO_TENANT_SLUG));
  const { app, ctx } = await buildApp({ config: testConfig, db });
  await app.ready();

  const menu = (await app.inject({ method: "GET", url: `/v1/cafes/${DEMO_TENANT_SLUG}/tower-a/menu` }).then((r) => r.json())) as MenuResponse;
  const item = (name: string) => {
    for (const c of menu.categories) for (const i of c.items) if (i.name === name) return i;
    throw new Error(`no item ${name}`);
  };
  /** Picks the first option of every required modifier group. */
  const line = (name: string, quantity = 1, extra: string[] = []) => {
    const i = item(name);
    const modifierIds = i.modifierGroups.filter((g) => g.minSelect > 0).map((g) => g.options[0]!.id);
    for (const optName of extra) {
      const o = i.modifierGroups.flatMap((g) => g.options).find((x) => x.name === optName);
      if (!o) throw new Error(`no option ${optName}`);
      const group = i.modifierGroups.find((g) => g.options.includes(o))!;
      if (group.maxSelect === 1) {
        const idx = modifierIds.findIndex((id) => group.options.some((x) => x.id === id));
        if (idx >= 0) modifierIds.splice(idx, 1);
      }
      modifierIds.push(o.id);
    }
    return { itemId: i.id, quantity, modifierIds };
  };

  const users = (await app.inject({ method: "GET", url: `/v1/staff/${DEMO_TENANT_SLUG}/users` }).then((r) => r.json())) as { users: Array<{ id: string; name: string }> };
  const loginAs = async (name: string, pin: string) => {
    const u = users.users.find((x) => x.name === name)!;
    const r = await app.inject({ method: "POST", url: "/v1/staff/login", payload: { tenantSlug: DEMO_TENANT_SLUG, staffUserId: u.id, pin } });
    if (r.statusCode !== 200) throw new Error(`login failed: ${r.body}`);
    return r.json() as StaffSession;
  };
  const cashierA = await loginAs("Cashier · Tower A", DEMO_PINS.cashierA);
  const kitchenA = await loginAs("Kitchen · Tower A", DEMO_PINS.kitchenA);
  const cashierB = await loginAs("Cashier · Tower B", DEMO_PINS.cashierB);
  const admin = await loginAs("Owner (Admin)", DEMO_PINS.admin);
  const outletA = cashierA.outlets[0]!.id;
  const outletB = cashierB.outlets[0]!.id;

  const auth = (s: StaffSession) => ({ authorization: `Bearer ${s.token}` });

  async function placeOrder(lines: ReturnType<typeof line>[], opts: { pay?: boolean; outlet?: string; key?: string } = {}) {
    const r = await app.inject({
      method: "POST",
      url: `/v1/cafes/${DEMO_TENANT_SLUG}/${opts.outlet ?? "tower-a"}/orders`,
      headers: { "idempotency-key": opts.key ?? randomUUID() },
      payload: { lines, customer: { name: "Priya", phone: "98765 43210" }, consent: { orderUpdates: true, offers: false } },
    });
    if (r.statusCode !== 201) throw new Error(`create failed ${r.statusCode}: ${r.body}`);
    const created = r.json() as { orderId: string; trackingToken: string; totalPaise: number; checkout: { paymentId: string; amountPaise: number } };
    if (opts.pay !== false) await pay(created.checkout.paymentId);
    return created;
  }

  async function pay(paymentId: string, outcome: "SUCCESS" | "FAILURE" = "SUCCESS") {
    const r = await app.inject({ method: "POST", url: "/v1/payments/simulate", payload: { paymentId, outcome } });
    if (r.statusCode !== 200) throw new Error(`pay failed: ${r.body}`);
    return r.json() as { result: string; order: OrderView };
  }

  const track = async (token: string) => (await app.inject({ method: "GET", url: `/v1/track/${token}` })).json() as OrderView;

  return { app, ctx, db, pool, menu, item, line, cashierA, kitchenA, cashierB, admin, outletA, outletB, auth, placeOrder, pay, track, loginAs, users };
}

export type TestEnv = Awaited<ReturnType<typeof setup>>;

export async function teardown(env: TestEnv) {
  await env.app.close();
  await env.pool.end();
}
