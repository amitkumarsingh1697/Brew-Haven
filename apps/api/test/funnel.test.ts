import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { StaffSession } from "@brew-haven/contracts";
import { visitEvents } from "../src/db/schema.js";
import { setup, teardown, type TestEnv } from "./helpers.js";

let env: TestEnv;
beforeAll(async () => {
  env = await setup();
});
afterAll(async () => teardown(env));

const as = (s: StaffSession) => ({ authorization: `Bearer ${s.token}` });
const step = (visit: string, kind: string, outlet = "tower-a") => env.app.inject({ method: "POST", url: `/v1/cafes/400-coffee/${outlet}/events`, payload: { visit, kind } });
type Funnel = { steps: Array<{ step: string; visits: number }>; conversionPct: number | null };

describe("online ordering funnel", () => {
  it("counts each visit once per step and stores nothing personal", async () => {
    for (const k of ["open", "menu", "add", "checkout", "pay"]) expect((await step("visit-aaaaaaaa", k)).statusCode).toBe(204);
    await step("visit-aaaaaaaa", "menu"); // repeat: ignored
    await step("visit-bbbbbbbb", "menu");
    await step("visit-cccccccc", "open");
    expect((await step("visit-dddddddd", "hack")).statusCode).toBe(400);
    expect((await step("x", "menu")).statusCode).toBe(400);
    expect((await step("visit-eeeeeeee", "menu", "nowhere")).statusCode).toBe(404);
    await env.placeOrder([env.line("Americano")]);

    const cols = Object.keys((await env.db.select().from(visitEvents).limit(1))[0]!);
    expect(cols.sort()).toEqual(["at", "id", "kind", "outletId", "tenantId", "visit"]);

    expect((await env.app.inject({ method: "GET", url: "/v1/admin/funnel", headers: as(env.cashierA) })).statusCode).toBe(403);
    const f = (await env.app.inject({ method: "GET", url: "/v1/admin/funnel", headers: as(env.admin) })).json() as Funnel;
    const n = Object.fromEntries(f.steps.map((s) => [s.step, s.visits]));
    expect(n).toMatchObject({ open: 3, menu: 2, add: 1, checkout: 1, pay: 1, paid: 1 });
    expect(f.conversionPct).toBe(33.3);
    const other = (await env.app.inject({ method: "GET", url: `/v1/admin/funnel?outletId=${env.outletB}`, headers: as(env.admin) })).json() as Funnel;
    expect(other.steps.every((s) => s.visits === 0)).toBe(true);
  });
});
