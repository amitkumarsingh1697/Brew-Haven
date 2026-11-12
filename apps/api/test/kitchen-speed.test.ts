import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, and } from "drizzle-orm";
import type { StaffSession } from "@brew-haven/contracts";
import { orderEvents } from "../src/db/schema.js";
import { setup, teardown, type TestEnv } from "./helpers.js";

let env: TestEnv;
beforeAll(async () => {
  env = await setup();
});
afterAll(async () => teardown(env));

const as = (s: StaffSession) => ({ authorization: `Bearer ${s.token}` });
const act = (id: string, action: string, who: StaffSession) => env.app.inject({ method: "POST", url: `/v1/staff/orders/${id}/actions`, headers: as(who), payload: { action } });
/** Moves an order's history so it was paid `placed` minutes ago and reached each state after the given minutes. */
async function timeline(orderId: string, mins: { start: number; ready: number; collected?: number }) {
  const base = Date.now() - 60 * 60_000;
  const set = (state: string, m: number) => env.db.update(orderEvents).set({ at: new Date(base + m * 60_000) }).where(and(eq(orderEvents.orderId, orderId), eq(orderEvents.toState, state)));
  await set("PLACED", 0);
  await set("PREPARING", mins.start);
  await set("READY", mins.ready);
  if (mins.collected !== undefined) await set("COLLECTED", mins.collected);
}
type Spread = { medianSec: number | null; p90Sec: number | null };
type Speed = { targetMinutes: number; stillOpen: number; totals: { orders: number; late: number; latePct: number; ticket: Spread; waitToStart: Spread; making: Spread; waitForPickup: Spread }; slowest: Array<{ code: string; ticketSec: number }>; byHour: unknown[] };

describe("kitchen speed", () => {
  it("measures wait, making and pickup times and flags late orders", async () => {
    const quick = await env.placeOrder([env.line("Americano")]);
    const slow = await env.placeOrder([env.line("Cappuccino", 2)]);
    await env.placeOrder([env.line("Veg Puff")]); // still waiting
    for (const o of [quick, slow]) {
      await act(o.orderId, "START", env.kitchenA);
      await act(o.orderId, "MARK_READY", env.kitchenA);
    }
    await act(quick.orderId, "HAND_OVER", env.cashierA);
    await timeline(quick.orderId, { start: 1, ready: 5, collected: 7 });
    await timeline(slow.orderId, { start: 4, ready: 16 });

    expect((await env.app.inject({ method: "GET", url: "/v1/admin/kitchen-speed", headers: as(env.cashierA) })).statusCode).toBe(403);
    const r = (await env.app.inject({ method: "GET", url: "/v1/admin/kitchen-speed", headers: as(env.admin) })).json() as Speed;
    expect(r.targetMinutes).toBe(10);
    expect(r.stillOpen).toBe(1);
    expect(r.totals).toMatchObject({ orders: 2, late: 1, latePct: 50 });
    expect(r.totals.ticket).toEqual({ medianSec: 300, p90Sec: 960 });
    expect(r.totals.waitToStart).toEqual({ medianSec: 60, p90Sec: 240 });
    expect(r.totals.making.p90Sec).toBe(720);
    expect(r.totals.waitForPickup).toEqual({ medianSec: 120, p90Sec: 120 });
    expect(r.slowest).toHaveLength(1);
    expect(r.slowest[0]!.ticketSec).toBe(960);
    expect(r.byHour.length).toBeGreaterThan(0);

    // A looser target: nothing late.
    const loose = (await env.app.inject({ method: "GET", url: "/v1/admin/kitchen-speed?targetMinutes=20", headers: as(env.admin) })).json() as Speed;
    expect(loose.totals.late).toBe(0);
    expect((await env.app.inject({ method: "GET", url: "/v1/admin/kitchen-speed?targetMinutes=0", headers: as(env.admin) })).statusCode).toBe(400);
  });
});
