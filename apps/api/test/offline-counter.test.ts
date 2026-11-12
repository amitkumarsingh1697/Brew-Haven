import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OrderView, StaffSession } from "@brew-haven/contracts";
import { setup, teardown, type TestEnv } from "./helpers.js";

let env: TestEnv;
beforeAll(async () => {
  env = await setup();
});
afterAll(async () => teardown(env));

const as = (s: StaffSession) => ({ authorization: `Bearer ${s.token}` });
const walkIn = (payload: Record<string, unknown>) =>
  env.app.inject({ method: "POST", url: "/v1/staff/orders/walk-in", headers: as(env.cashierA), payload: { outletId: env.outletA, method: "CASH", lines: [env.line("Cappuccino")], ...payload } });

describe("counter orders taken while offline", () => {
  it("sending the same order twice makes one order", async () => {
    const clientRef = randomUUID();
    const a = await walkIn({ clientRef });
    expect(a.statusCode).toBe(201);
    const b = await walkIn({ clientRef });
    expect(b.statusCode).toBe(201);
    expect((b.json() as OrderView).id).toBe((a.json() as OrderView).id);
    // Even at the same moment.
    const ref2 = randomUUID();
    const [c, d] = await Promise.all([walkIn({ clientRef: ref2 }), walkIn({ clientRef: ref2 })]);
    expect((c.json() as OrderView).id).toBe((d.json() as OrderView).id);
  });

  it("records the time it was taken, and goes through even if the item sold out since", async () => {
    const item = env.item("Cappuccino");
    await env.app.inject({ method: "PUT", url: "/v1/staff/stock", headers: as(env.cashierA), payload: { outletId: env.outletA, itemId: item.id, available: false } });
    expect((await walkIn({ clientRef: randomUUID() })).statusCode).not.toBe(201);

    const takenOfflineAt = new Date(Date.now() - 20 * 60_000).toISOString();
    const r = await walkIn({ clientRef: randomUUID(), takenOfflineAt });
    expect(r.statusCode).toBe(201);
    const pays = (await env.app.inject({ method: "GET", url: "/v1/admin/exports/payments", headers: as(env.admin) })).body;
    const at = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(takenOfflineAt));
    expect(pays).toContain(at);
    await env.app.inject({ method: "PUT", url: "/v1/staff/stock", headers: as(env.cashierA), payload: { outletId: env.outletA, itemId: item.id, available: true } });

    // Too old, or from the future: refused.
    expect((await walkIn({ clientRef: randomUUID(), takenOfflineAt: new Date(Date.now() - 30 * 3_600_000).toISOString() })).statusCode).toBe(400);
    expect((await walkIn({ clientRef: randomUUID(), takenOfflineAt: new Date(Date.now() + 3_600_000).toISOString() })).statusCode).toBe(400);
  });
});
