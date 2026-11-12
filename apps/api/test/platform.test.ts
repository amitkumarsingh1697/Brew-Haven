import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { StaffSession } from "@brew-haven/contracts";
import { hashPin } from "../src/auth.js";
import { platformAdmins } from "../src/db/schema.js";
import { setup, teardown, type TestEnv } from "./helpers.js";

let env: TestEnv;
beforeAll(async () => {
  env = await setup();
  await env.db.insert(platformAdmins).values({ email: "team@inferra.example", name: "Asha", passwordHash: await hashPin("correct horse battery") });
});
afterAll(async () => teardown(env));

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const signIn = (password: string, email = "Team@Inferra.example") => env.app.inject({ method: "POST", url: "/v1/platform/login", payload: { email, password } });
type Biz = { id: string; slug: string; plan: string; suspended: boolean; cafes: Array<{ name: string }>; team: number; ordersLast30Days: number; salesLast30DaysPaise: number };

describe("Brew Haven's own view of every business", () => {
  let token: string;

  it("signs in with email and password only", async () => {
    expect((await signIn("wrong")).statusCode).toBe(401);
    const ok = await signIn("correct horse battery");
    expect(ok.statusCode).toBe(200);
    token = ok.json().token;
  });

  it("is closed to café staff, even the café owner", async () => {
    const owner = env.admin as StaffSession;
    expect((await env.app.inject({ method: "GET", url: "/v1/platform/businesses", headers: bearer(owner.token) })).statusCode).toBe(401);
    expect((await env.app.inject({ method: "GET", url: "/v1/platform/businesses" })).statusCode).toBe(401);
    // And a platform token opens nothing on the café side.
    expect((await env.app.inject({ method: "GET", url: "/v1/admin/setup", headers: bearer(token) })).statusCode).toBe(401);
  });

  it("lists every business with totals", async () => {
    await env.placeOrder([env.line("Americano")]);
    const list = (await env.app.inject({ method: "GET", url: "/v1/platform/businesses", headers: bearer(token) })).json().businesses as Biz[];
    const pilot = list.find((b) => b.slug === "400-coffee")!;
    expect(pilot.cafes.map((c) => c.name)).toEqual(expect.arrayContaining(["Tower A", "Tower B"]));
    expect(pilot.team).toBeGreaterThan(0);
    expect(pilot.ordersLast30Days).toBeGreaterThan(0);
    expect(pilot.salesLast30DaysPaise).toBeGreaterThan(0);
  });

  it("changes the plan and pauses or resumes, and the owner sees it in their activity log", async () => {
    const list = (await env.app.inject({ method: "GET", url: "/v1/platform/businesses", headers: bearer(token) })).json().businesses as Biz[];
    const pilot = list.find((b) => b.slug === "400-coffee")!;
    const patch = (payload: object) => env.app.inject({ method: "PATCH", url: `/v1/platform/businesses/${pilot.id}`, headers: bearer(token), payload });
    expect((await patch({ plan: "gold" })).statusCode).toBe(400);
    expect((await patch({ plan: "growth" })).json()).toMatchObject({ changed: true });

    expect((await patch({ suspended: true })).statusCode).toBe(200);
    // Paused: no new orders online or at the counter, but the owner can still sign in and look.
    const walk = await env.app.inject({ method: "POST", url: "/v1/staff/orders/walk-in", headers: bearer(env.cashierA.token), payload: { outletId: env.outletA, method: "CASH", lines: [env.line("Cappuccino")] } });
    expect(walk.statusCode).toBe(403);
    await expect(env.placeOrder([env.line("Americano")])).rejects.toThrow();
    expect((await env.app.inject({ method: "GET", url: "/v1/admin/setup", headers: bearer(env.admin.token) })).statusCode).toBe(200);

    await patch({ suspended: false, plan: "multi" });
    expect((await env.app.inject({ method: "POST", url: "/v1/staff/orders/walk-in", headers: bearer(env.cashierA.token), payload: { outletId: env.outletA, method: "CASH", lines: [env.line("Cappuccino")] } })).statusCode).toBe(201);

    const log = (await env.app.inject({ method: "GET", url: "/v1/admin/activity", headers: bearer(env.admin.token) })).json() as { entries: Array<{ summary: string; actor?: string; actorName?: string }> };
    const s = log.entries.map((e) => e.summary);
    expect(s).toContain("Brew Haven moved the business to the Growth plan");
    expect(s).toContain("Brew Haven paused the account: no new orders until it is resumed");
    expect(s).toContain("Brew Haven resumed the account");
  });
});
