import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { safeUrl } from "../src/app.js";
import { setup, teardown, type TestEnv } from "./helpers.js";

let env: TestEnv;
beforeAll(async () => {
  env = await setup();
});
afterAll(async () => teardown(env));

describe("security", () => {
  it("keeps order links and tokens out of logs", () => {
    expect(safeUrl("/v1/track/AbC123_-xyz/receipt")).toBe("/v1/track/[link]/receipt");
    expect(safeUrl("/v1/staff/stream?outletId=1&token=eyJhbGciOi.x.y")).toBe("/v1/staff/stream?outletId=1&token=[hidden]");
    expect(safeUrl("/v1/admin/reports?from=2026-01-01")).toBe("/v1/admin/reports?from=2026-01-01");
  });

  it("locks a person's PIN after 20 wrong tries an hour, whatever address they come from", async () => {
    const u = (await env.app.inject({ method: "POST", url: "/v1/admin/staff", headers: { authorization: `Bearer ${env.admin.token}` }, payload: { name: "Pin Target", role: "KITCHEN", pin: "4321", outletIds: [env.outletA] } })).json() as { id: string };
    const tryPin = (pin: string, ip: string) => env.app.inject({ method: "POST", url: "/v1/staff/login", remoteAddress: ip, payload: { tenantSlug: "400-coffee", staffUserId: u.id, pin } });
    // 4 wrong tries from each of 5 addresses stays under the per-address limit of 5.
    for (let a = 0; a < 5; a++) for (let i = 0; i < 4; i++) expect((await tryPin("0000", `10.0.0.${a}`)).statusCode).toBe(401);
    // The 21st try is refused even with the right PIN from a new address.
    expect((await tryPin("4321", "10.0.9.9")).statusCode).toBe(429);
  });
});
