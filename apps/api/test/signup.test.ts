import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { setup, teardown, testConfig, type TestEnv } from "./helpers.js";

let env: TestEnv;
beforeAll(async () => {
  env = await setup();
});
afterAll(async () => teardown(env));

const form = (over: Record<string, unknown> = {}) => ({
  businessName: "Blue Door Café",
  cafeName: "Koramangala",
  ownerName: "Meera",
  pin: "4826",
  email: "Meera@Example.com",
  phone: "98450 12345",
  acceptTerms: true,
  ...over,
});
const signup = (payload: Record<string, unknown>) => env.app.inject({ method: "POST", url: "/v1/signup", payload });

describe("self-serve sign-up", () => {
  it("creates the business, its first café and the owner, and signs the owner in", async () => {
    const r = await signup(form());
    expect(r.statusCode).toBe(201);
    const body = r.json();
    expect(body).toMatchObject({ tenantSlug: "blue-door-cafe", outletSlug: "koramangala", session: { user: { name: "Meera", role: "ADMIN" }, tenant: { slug: "blue-door-cafe", name: "Blue Door Café" } } });
    expect(body.session.outlets).toHaveLength(1);
    const auth = { authorization: `Bearer ${body.session.token}` };

    // The sample menu is there, and customers can see it straight away.
    const menu = (await env.app.inject({ method: "GET", url: "/v1/cafes/blue-door-cafe/koramangala/menu" })).json();
    expect(menu.categories.map((c: { name: string }) => c.name)).toEqual(["Coffee", "Tea"]);
    expect(menu.outlet.name).toBe("Koramangala");

    // The owner sees only their own business, not the demo café.
    const setupView = (await env.app.inject({ method: "GET", url: "/v1/admin/setup", headers: auth })).json();
    expect(setupView.outlets.map((o: { name: string }) => o.name)).toEqual(["Koramangala"]);
    expect(setupView.outlets[0].pickupPrefix).toBe("K");
    // A new business starts on Starter with a 30-day free trial.
    expect(setupView.tenant.plan).toMatchObject({ id: "starter", monthlyPaise: 99_900, billing: { state: "trial" } });
    expect(setupView.tenant.plan.billing.daysLeft).toBe(30);
    const users = (await env.app.inject({ method: "GET", url: "/v1/staff/blue-door-cafe/users" })).json();
    expect(users.users).toHaveLength(1);
    // The sign-up is in the activity log.
    const log = (await env.app.inject({ method: "GET", url: "/v1/admin/activity", headers: auth })).json();
    expect(log.entries[0].summary).toBe("Created Blue Door Café with café Koramangala");
  });

  it("gives a second business with the same name its own link, and can skip the sample menu", async () => {
    const r = await signup(form({ cafeName: "Indiranagar", pickupPrefix: "in", sampleMenu: false, email: "b@example.com" }));
    expect(r.statusCode).toBe(201);
    expect(r.json().tenantSlug).toBe("blue-door-cafe-2");
    const menu = (await env.app.inject({ method: "GET", url: "/v1/cafes/blue-door-cafe-2/indiranagar/menu" })).json();
    expect(menu.categories).toEqual([]);
    const s = (await env.app.inject({ method: "GET", url: "/v1/admin/setup", headers: { authorization: `Bearer ${r.json().session.token}` } })).json();
    expect(s.outlets[0].pickupPrefix).toBe("IN");
    // Reserved words don't become links.
    expect((await signup(form({ businessName: "Admin", email: "c@example.com" }))).json().tenantSlug).toBe("admin-cafe");
  });

  it("checks the form", async () => {
    expect((await signup(form({ acceptTerms: false }))).statusCode).toBe(400);
    expect((await signup(form({ pin: "12" }))).statusCode).toBe(400);
    expect((await signup(form({ phone: "12345" }))).statusCode).toBe(400);
    expect((await signup(form({ email: "nope" }))).statusCode).toBe(400);
  });

  it("is closed when switched off", async () => {
    const { app } = await buildApp({ config: { ...testConfig, signupEnabled: false }, db: env.db });
    expect((await app.inject({ method: "GET", url: "/v1/signup" })).json()).toEqual({ open: false });
    expect((await app.inject({ method: "POST", url: "/v1/signup", payload: form({ email: "d@example.com" }) })).statusCode).toBe(403);
    await app.close();
  });
});
