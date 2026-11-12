import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { tenants } from "../src/db/schema.js";
import { setup, teardown, type TestEnv } from "./helpers.js";

let env: TestEnv;
beforeAll(async () => {
  env = await setup();
});
afterAll(async () => teardown(env));

const newBusiness = async () => {
  const r = await env.app.inject({
    method: "POST",
    url: "/v1/signup",
    payload: { businessName: "Small Cup", cafeName: "Main", ownerName: "Ana", pin: "1357", email: "ana@example.com", phone: "9845012345", acceptTerms: true, sampleMenu: false },
  });
  return { authorization: `Bearer ${r.json().session.token}` };
};

describe("plan limits", () => {
  it("a new business starts on Starter: one café, five active team members", async () => {
    const auth = await newBusiness();
    const setupView = (await env.app.inject({ method: "GET", url: "/v1/admin/setup", headers: auth })).json();
    expect(setupView.tenant.plan).toEqual({ id: "starter", name: "Starter", maxCafes: 1, maxStaff: 5, cafes: 1, staff: 1 });
    const outletId = setupView.outlets[0].id;

    const second = await env.app.inject({ method: "POST", url: "/v1/admin/outlets", headers: auth, payload: { name: "Second", pickupPrefix: "S" } });
    expect(second.statusCode).toBe(403);
    expect(second.json().error).toMatchObject({ code: "PLAN_LIMIT", message: "The Starter plan allows 1 café. Contact us to move to a bigger plan." });

    const add = (n: number) => env.app.inject({ method: "POST", url: "/v1/admin/staff", headers: auth, payload: { name: `Barista ${n}`, role: "CASHIER", pin: "2468", outletIds: [outletId] } });
    const ids: string[] = [];
    for (let n = 1; n <= 4; n++) {
      const r = await add(n);
      expect(r.statusCode).toBe(201);
      ids.push(r.json().id);
    }
    expect((await add(5)).json().error.code).toBe("PLAN_LIMIT");

    // Removing someone frees a place; giving them access back counts again.
    await env.app.inject({ method: "PATCH", url: `/v1/admin/staff/${ids[0]}`, headers: auth, payload: { active: false } });
    expect((await add(6)).statusCode).toBe(201);
    expect((await env.app.inject({ method: "PATCH", url: `/v1/admin/staff/${ids[0]}`, headers: auth, payload: { active: true } })).json().error.code).toBe("PLAN_LIMIT");

    // Moving to Growth lifts the café limit.
    await env.db.update(tenants).set({ plan: "growth" }).where(eq(tenants.slug, "small-cup"));
    expect((await env.app.inject({ method: "POST", url: "/v1/admin/outlets", headers: auth, payload: { name: "Second", pickupPrefix: "S" } })).statusCode).toBe(201);
  });

  it("the pilot business has no limits", async () => {
    const setupView = (await env.app.inject({ method: "GET", url: "/v1/admin/setup", headers: { authorization: `Bearer ${env.admin.token}` } })).json();
    expect(setupView.tenant.plan).toMatchObject({ id: "multi", maxCafes: null, maxStaff: null });
  });
});
