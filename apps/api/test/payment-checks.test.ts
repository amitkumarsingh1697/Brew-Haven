import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { StaffSession } from "@brew-haven/contracts";
import { refunds } from "../src/db/schema.js";
import { setup, teardown, type TestEnv } from "./helpers.js";

let env: TestEnv;
beforeAll(async () => {
  env = await setup();
});
afterAll(async () => teardown(env));

const as = (s: StaffSession) => ({ authorization: `Bearer ${s.token}` });
const walkIn = (payload: Record<string, unknown>, who = env.cashierA) =>
  env.app.inject({ method: "POST", url: "/v1/staff/orders/walk-in", headers: as(who), payload: { outletId: env.outletA, lines: [env.line("Americano")], ...payload } });

describe("UPI reference at the counter", () => {
  it("records the reference and blocks it from paying for a second order", async () => {
    const first = await walkIn({ method: "UPI_COUNTER", upiReference: "412345678901" });
    expect(first.statusCode).toBe(201);
    const again = await walkIn({ method: "UPI_COUNTER", upiReference: "412345678901" });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.message).toMatch(/already used for order A-\d{3} at Tower A/);
    // Other cafés of the same business share one bank account, so it's blocked there too.
    const otherCafe = await env.app.inject({
      method: "POST",
      url: "/v1/staff/orders/walk-in",
      headers: as(env.cashierB),
      payload: { outletId: env.outletB, method: "UPI_COUNTER", upiReference: "412345678901", lines: [env.line("Americano")] },
    });
    expect(otherCafe.statusCode).toBe(409);
  });

  it("checks the format and only accepts a reference with UPI", async () => {
    expect((await walkIn({ method: "UPI_COUNTER", upiReference: "1234" })).statusCode).toBe(400);
    expect((await walkIn({ method: "CASH", upiReference: "412345678902" })).statusCode).toBe(400);
    expect((await walkIn({ method: "UPI_COUNTER" })).statusCode).toBe(201); // still optional
  });
});

describe("payment checks for the owner", () => {
  it("lists money taken but not served, failed refunds, and UPI without a reference", async () => {
    // A paid online order that the cashier rejects gets refunded automatically: not an exception...
    const ok = await env.placeOrder([env.line("Cappuccino")]);
    await env.app.inject({ method: "POST", url: `/v1/staff/orders/${ok.orderId}/reject`, headers: as(env.cashierA), payload: { reason: "Machine broke down" } });
    // ...unless the refund fails.
    const bad = await env.placeOrder([env.line("Café Latte")]);
    await env.app.inject({ method: "POST", url: `/v1/staff/orders/${bad.orderId}/reject`, headers: as(env.cashierA), payload: { reason: "Machine broke down" } });
    await env.db.update(refunds).set({ status: "FAILED" }).where(eq(refunds.orderId, bad.orderId));

    expect((await env.app.inject({ method: "GET", url: "/v1/admin/payment-checks", headers: as(env.cashierA) })).statusCode).toBe(403);
    const { items } = (await env.app.inject({ method: "GET", url: "/v1/admin/payment-checks", headers: as(env.admin) })).json() as { items: Array<{ kind: string; severity: string; orderId: string; amountPaise: number }> };

    const forBad = items.filter((i) => i.orderId === bad.orderId).map((i) => i.kind).sort();
    expect(forBad).toEqual(["PAID_NOT_SERVED", "REFUND_FAILED"]);
    expect(items.find((i) => i.kind === "PAID_NOT_SERVED")).toMatchObject({ severity: "act", amountPaise: 19000 });
    expect(items.some((i) => i.orderId === ok.orderId)).toBe(false);
    // The UPI walk-in without a reference from the test above.
    expect(items.filter((i) => i.kind === "UPI_NO_REFERENCE")).toHaveLength(1);
    // Things to act on come first.
    expect(items[0]!.severity).toBe("act");
  });
});
