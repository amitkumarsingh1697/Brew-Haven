import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { StaffSession } from "@brew-haven/contracts";
import { setup, teardown, type TestEnv } from "./helpers.js";

let env: TestEnv;
beforeAll(async () => {
  env = await setup();
});
afterAll(async () => teardown(env));

const as = (s: StaffSession) => ({ authorization: `Bearer ${s.token}` });
type Sums = { invoices: number; taxablePaise: number; cgstPaise: number; sgstPaise: number; totalPaise: number };
type Summary = { gstin: string | null; sac: string; totals: Sums; byRate: Array<Sums & { rateBps: number }>; byCafe: Array<Sums & { outlet: string }>; documents: Array<{ series: string; first: string; last: string; issued: number; cancelled: number }> };
const summary = async (who = env.admin, q = "") => env.app.inject({ method: "GET", url: `/v1/admin/gst-summary${q}`, headers: as(who) });

describe("GST summary", () => {
  it("adds up issued invoices by rate and café, and lists the invoice series with cancellations", async () => {
    await env.app.inject({ method: "PUT", url: "/v1/admin/settings", headers: as(env.admin), payload: { displayName: "400 Coffee Cafe", taxRateBps: 500, billing: { legalName: "400 Coffee Pvt Ltd", gstin: "29ABCDE1234F1Z5" } } });
    await env.placeOrder([env.line("Americano", 2)]); // ₹300
    const walk = await env.app.inject({ method: "POST", url: "/v1/staff/orders/walk-in", headers: as(env.cashierA), payload: { outletId: env.outletA, method: "CASH", lines: [env.line("Cappuccino")] } });
    expect(walk.statusCode).toBe(201);
    const gone = await env.placeOrder([env.line("Veg Puff")]);
    await env.app.inject({ method: "POST", url: `/v1/staff/orders/${gone.orderId}/reject`, headers: as(env.cashierA), payload: { reason: "Oven down" } });

    expect((await summary(env.cashierA)).statusCode).toBe(403);
    const r = (await summary()).json() as Summary;
    expect(r).toMatchObject({ gstin: "29ABCDE1234F1Z5", sac: "996331" });
    // Two issued invoices; the cancelled one carries no value.
    expect(r.totals.invoices).toBe(2);
    expect(r.totals.taxablePaise + r.totals.cgstPaise + r.totals.sgstPaise).toBe(r.totals.totalPaise);
    expect(r.totals.totalPaise).toBe(30000 + walk.json().totalPaise);
    expect(r.byRate).toEqual([expect.objectContaining({ rateBps: 500, invoices: 2 })]);
    expect(r.byCafe.find((c) => c.outlet === "Tower A")).toMatchObject({ invoices: 2 });
    const doc = r.documents[0]!;
    expect(doc).toMatchObject({ issued: 3, cancelled: 1 });
    expect(doc.first < doc.last).toBe(true);

    // Another café alone has nothing yet; a reversed range is refused.
    expect(((await summary(env.admin, `?outletId=${env.outletB}`)).json() as Summary).totals.invoices).toBe(0);
    expect((await summary(env.admin, "?from=2026-03-01&to=2026-01-01")).statusCode).toBe(400);
  });

  it("downloads invoice by invoice for the accountant", async () => {
    const res = await env.app.inject({ method: "GET", url: "/v1/admin/exports/gst", headers: as(env.admin) });
    expect(res.statusCode).toBe(200);
    const rows = res.body.replace(/^﻿/, "").trim().split("\r\n").map((l) => l.split(","));
    expect(rows[0]![0]).toBe("Invoice no");
    expect(rows).toHaveLength(4);
    expect(rows.filter((r) => r[3] === "Cancelled")).toHaveLength(1);
    expect(rows.find((r) => r[3] === "Cancelled")![8]).toBe("0.00");
    expect(rows.some((r) => r[3] === "Issued" && r[8] === "300.00" && r[4] === "5.00")).toBe(true);
  });
});
