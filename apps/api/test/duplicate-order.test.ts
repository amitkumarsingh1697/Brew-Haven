import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { orders } from "../src/db/schema.js";
import { setup, teardown, type TestEnv } from "./helpers.js";

// Refund policy K6: warn before paying when the same basket was ordered from the same phone a moment ago.
let env: TestEnv;
beforeAll(async () => (env = await setup()));
afterAll(async () => teardown(env));

const order = (lines: object[], extra: object = {}, phone = "91234 56780") =>
  env.app.inject({
    method: "POST",
    url: "/v1/cafes/400-coffee/tower-a/orders",
    headers: { "idempotency-key": randomUUID() },
    payload: { lines, customer: { name: "Ravi", phone }, consent: { orderUpdates: true, offers: false }, ...extra },
  });

describe("duplicate order warning (K6)", () => {
  it("asks before taking the same basket again, and goes ahead once confirmed", async () => {
    const lines = [env.line("Veg Puff", 2)];
    const first = await order(lines);
    expect(first.statusCode).toBe(201);

    const again = await order(lines);
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe("DUPLICATE_ORDER");
    expect(again.json().error.message).toMatch(/a minute ago/);

    expect((await order(lines, { allowDuplicate: true })).statusCode).toBe(201);
  });

  it("lets a different basket, another phone, a cancelled order or an older order through", async () => {
    const lines = [env.line("Veg Puff")];
    const first = await order(lines, {}, "90000 11111");
    expect(first.statusCode).toBe(201);
    expect((await order([env.line("Veg Puff", 3)], {}, "90000 11111")).statusCode).toBe(201);
    expect((await order(lines, {}, "90000 22222")).statusCode).toBe(201);

    await env.db.update(orders).set({ state: "CANCELLED" }).where(eq(orders.id, first.json().orderId));
    const second = await order(lines, {}, "90000 11111");
    expect(second.statusCode).toBe(201);

    await env.db.update(orders).set({ createdAt: new Date(Date.now() - 5 * 60_000) }).where(eq(orders.id, second.json().orderId));
    expect((await order(lines, {}, "90000 11111")).statusCode).toBe(201);
  });
});
