import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { financialYear, planOf } from "@brew-haven/domain";
import { hashPin } from "../src/auth.js";
import { platformAdmins, tenants } from "../src/db/schema.js";
import { periodEnd, subscriptionTax } from "../src/services/subscriptions.js";
import { setup, teardown, type TestEnv } from "./helpers.js";

describe("subscription periods and GST", () => {
  it("runs a month or a year from the start day, clamping at month ends", () => {
    expect(periodEnd("2026-11-15", "MONTH")).toBe("2026-12-14");
    expect(periodEnd("2026-12-20", "MONTH")).toBe("2027-01-19");
    expect(periodEnd("2027-01-31", "MONTH")).toBe("2027-02-28");
    expect(periodEnd("2026-11-15", "YEAR")).toBe("2027-11-14");
  });
  it("splits 18% GST by state, and charges none without Brew Haven's GSTIN", () => {
    expect(subscriptionTax(99_900, "29ABCDE1234F1Z5", "29PQRSX6789K1Z2")).toEqual({ cgstPaise: 8991, sgstPaise: 8991, igstPaise: 0 });
    expect(subscriptionTax(99_900, "29ABCDE1234F1Z5", null)).toEqual({ cgstPaise: 8991, sgstPaise: 8991, igstPaise: 0 });
    expect(subscriptionTax(99_900, "29ABCDE1234F1Z5", "27PQRSX6789K1Z2")).toEqual({ cgstPaise: 0, sgstPaise: 0, igstPaise: 17_982 });
    expect(subscriptionTax(99_900, null, "27PQRSX6789K1Z2")).toEqual({ cgstPaise: 0, sgstPaise: 0, igstPaise: 0 });
  });
});

describe("Brew Haven's invoices to cafés", () => {
  const fy = financialYear(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()));
  let env: TestEnv;
  let token = "";
  let tenantId = "";
  beforeAll(async () => {
    env = await setup({ config: { brewHaven: { legalName: "Inferra Technologies Pvt Ltd", gstin: "29ABCDE1234F1Z5", address: "Bengaluru", email: "billing@brewhaven.example" } } });
    await env.db.insert(platformAdmins).values({ email: "team@brewhaven.example", name: "Asha", passwordHash: await hashPin("correct horse battery") });
    token = (await env.app.inject({ method: "POST", url: "/v1/platform/login", payload: { email: "team@brewhaven.example", password: "correct horse battery" } })).json().token;
    tenantId = (await env.db.select({ id: tenants.id }).from(tenants))[0]!.id;
  });
  afterAll(async () => teardown(env));

  const pay = (body: object, t = token) => env.app.inject({ method: "POST", url: `/v1/platform/businesses/${tenantId}/payments`, headers: { authorization: `Bearer ${t}` }, payload: body });

  it("recording a monthly payment issues a numbered tax invoice and moves the paid date on", async () => {
    const [t] = await env.db.select().from(tenants);
    const plan = planOf(t!.plan);
    const r = await pay({ period: "MONTH", method: "UPI", reference: "UTR 4455" });
    expect(r.statusCode).toBe(200);
    const inv = r.json();
    expect(inv.number).toBe(`BH${fy}-00001`);
    expect(inv.kind).toBe("TAX_INVOICE");
    expect(inv.taxablePaise).toBe(plan.monthlyPaise);
    expect(inv.cgstPaise + inv.sgstPaise + inv.igstPaise).toBe(Math.round(plan.monthlyPaise * 0.18));
    expect(inv.totalPaise).toBe(inv.taxablePaise + inv.cgstPaise + inv.sgstPaise + inv.igstPaise);
    expect(inv.seller).toMatchObject({ legalName: "Inferra Technologies Pvt Ltd", gstin: "29ABCDE1234F1Z5", stateCode: "29" });
    expect(inv.payment).toMatchObject({ method: "UPI", reference: "UTR 4455" });
    expect(periodEnd(inv.periodFrom, "MONTH")).toBe(inv.periodTo);

    const [after] = await env.db.select().from(tenants);
    expect(after!.paidUntil!.toISOString()).toBe(new Date(`${inv.periodTo}T23:59:59.999+05:30`).toISOString());
  });

  it("a yearly payment carries on from the end of the paid period", async () => {
    const before = (await env.app.inject({ method: "GET", url: `/v1/platform/businesses/${tenantId}/invoices`, headers: { authorization: `Bearer ${token}` } })).json().invoices[0];
    const r = (await pay({ period: "YEAR", method: "BANK" })).json();
    expect(r.number).toBe(`BH${fy}-00002`);
    expect(r.periodFrom > before.periodTo).toBe(true);
    expect(r.taxablePaise).toBe(planOf((await env.db.select().from(tenants))[0]!.plan).yearlyPaise);
  });

  it("the owner sees their invoices; staff and café tokens can't record payments", async () => {
    const own = await env.app.inject({ method: "GET", url: "/v1/admin/subscription-invoices", headers: env.auth(env.admin) });
    expect(own.json().invoices.map((i: { number: string }) => i.number)).toEqual([`BH${fy}-00002`, `BH${fy}-00001`]);
    expect((await env.app.inject({ method: "GET", url: "/v1/admin/subscription-invoices", headers: env.auth(env.cashierA) })).statusCode).toBe(403);
    expect((await pay({ period: "MONTH", method: "UPI" }, env.admin.token)).statusCode).toBe(401);
    expect((await pay({ period: "WEEK", method: "UPI" })).statusCode).toBe(400);
    const log = JSON.stringify((await env.app.inject({ method: "GET", url: "/v1/admin/activity", headers: env.auth(env.admin) })).json());
    expect(log).toMatch(new RegExp(`invoice BH${fy}-00001`));
  });
});
