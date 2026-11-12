import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { StaffSession } from "@brew-haven/contracts";
import { toCsv } from "../src/services/exports.js";
import { setup, teardown, type TestEnv } from "./helpers.js";

let env: TestEnv;
beforeAll(async () => {
  env = await setup();
});
afterAll(async () => teardown(env));

const as = (s: StaffSession) => ({ authorization: `Bearer ${s.token}` });
const get = (kind: string, who = env.admin, q = "") => env.app.inject({ method: "GET", url: `/v1/admin/exports/${kind}${q}`, headers: as(who) });
const parse = (body: string) => body.replace(/^﻿/, "").trim().split("\r\n").map((l) => l.split(","));

describe("CSV exports", () => {
  it("escapes commas, quotes and spreadsheet formulas", () => {
    expect(toCsv(["a", "b"], [["=HYPERLINK(1)", 'say "hi", ok'], [-5, null], ["-12.50", "-1+1"]])).toBe('a,b\r\n\'=HYPERLINK(1),"say ""hi"", ok"\r\n-5,\r\n-12.50,\'-1+1\r\n');
  });

  it("downloads orders, items, payments and refunds, and day closes for the owner", async () => {
    const paid = await env.placeOrder([env.line("Americano", 2)]);
    const walk = await env.app.inject({ method: "POST", url: "/v1/staff/orders/walk-in", headers: as(env.cashierA), payload: { outletId: env.outletA, method: "CASH", lines: [env.line("Cappuccino")], customer: { name: "=cmd" } } });
    expect(walk.statusCode).toBe(201);
    await env.app.inject({ method: "POST", url: `/v1/staff/orders/${paid.orderId}/reject`, headers: as(env.cashierA), payload: { reason: "Machine broke down" } });
    await env.app.inject({ method: "POST", url: "/v1/staff/close", headers: as(env.cashierA), payload: { outletId: env.outletA, openingFloatPaise: 50000, countedCashPaise: 68000 } });

    expect((await get("orders", env.cashierA)).statusCode).toBe(403);
    expect((await get("nope")).statusCode).toBe(404);

    const orders = await get("orders");
    expect(orders.headers["content-type"]).toContain("text/csv");
    expect(orders.headers["content-disposition"]).toMatch(/attachment; filename="brew-haven-orders-\d{4}-\d{2}-\d{2}-to-/);
    const o = parse(orders.body);
    expect(o[0]![0]).toBe("Business date");
    expect(o.some((r) => r.includes("CANCELLED") && r.includes("Machine broke down"))).toBe(true);
    // A name typed as a formula can't run in Excel.
    expect(o.some((r) => r.includes("'=cmd") && r.includes("CASH"))).toBe(true);

    const items = parse((await get("items")).body);
    expect(items.some((r) => r.includes("Cappuccino"))).toBe(true);

    const pays = parse((await get("payments")).body);
    expect(pays.some((r) => r[3] === "Refund" && r.includes("-300.00"))).toBe(true);
    expect(pays.some((r) => r[3] === "Payment" && r.includes("ONLINE"))).toBe(true);

    const closes = parse((await get("closes")).body);
    expect(closes).toHaveLength(2);
    expect(closes[1]).toContain("680.00");

    // Another café only: Tower B has none of today's orders.
    expect(parse((await get("orders", env.admin, `?outletId=${env.outletB}`)).body)).toHaveLength(1);
    expect((await get("orders", env.admin, "?from=2026-03-01&to=2026-01-01")).statusCode).toBe(400);
  });
});
