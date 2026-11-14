import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ReceiptView } from "@brew-haven/contracts";
import { setup, teardown, type TestEnv } from "./helpers.js";

// The owner's logo: upload in Settings, shown on the welcome screen, receipts and QR posters.
let env: TestEnv;
beforeAll(async () => {
  env = await setup();
});
afterAll(async () => teardown(env));

// A 1×1 transparent PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const dataUrl = (bytes: Buffer, type = "image/png") => `data:${type};base64,${bytes.toString("base64")}`;
const upload = (body: unknown, who = env.admin) => env.app.inject({ method: "PUT", url: "/v1/admin/logo", headers: env.auth(who), payload: body as object });
const menuLogo = async () => (await env.app.inject({ method: "GET", url: "/v1/cafes/400-coffee/tower-a/menu" })).json().tenant.branding.logoUrl as string | null;

describe("café logo", () => {
  it("starts with the seeded logo as a full link to the customer app", async () => {
    expect(await menuLogo()).toBe("http://localhost:5173/brands/400-coffee/logo.svg");
  });

  it("only the owner uploads, and only real PNG, JPG or WebP images under 300 KB", async () => {
    expect((await upload({ dataUrl: dataUrl(PNG) }, env.cashierA)).statusCode).toBe(403);
    const svg = await upload({ dataUrl: dataUrl(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), "image/png") });
    expect(svg.statusCode).toBe(400);
    expect(svg.json().error.message).toMatch(/PNG, JPG or WebP/);
    const huge = Buffer.concat([PNG, Buffer.alloc(301 * 1024)]);
    expect((await upload({ dataUrl: dataUrl(huge) })).statusCode).toBeGreaterThanOrEqual(400);
  });

  it("is served from the API and shows on the menu, setup and receipts, then can be removed", async () => {
    const r = await upload({ dataUrl: dataUrl(PNG) });
    expect(r.statusCode).toBe(200);
    const url = r.json().logoUrl as string;
    expect(url).toMatch(/^http:\/\/localhost:\d+\/v1\/cafes\/400-coffee\/logo\?v=[0-9a-f]{16}$/);

    const img = await env.app.inject({ method: "GET", url: url.replace(/^http:\/\/localhost:\d+/, "") });
    expect(img.statusCode).toBe(200);
    expect(img.headers["content-type"]).toBe("image/png");
    expect(img.headers["cache-control"]).toMatch(/immutable/);
    expect(img.rawPayload.equals(PNG)).toBe(true);
    const again = await env.app.inject({ method: "GET", url: "/v1/cafes/400-coffee/logo", headers: { "if-none-match": img.headers.etag as string } });
    expect(again.statusCode).toBe(304);

    expect(await menuLogo()).toBe(url);
    const setupRes = await env.app.inject({ method: "GET", url: "/v1/admin/setup", headers: env.auth(env.admin) });
    expect(setupRes.json().tenant.branding.logoUrl).toBe(url);
    const o = await env.placeOrder([env.line("Veg Puff")]);
    const receipt = (await env.app.inject({ method: "GET", url: `/v1/track/${o.trackingToken}/receipt` })).json() as ReceiptView;
    expect(receipt.seller.logoUrl).toBe(url);

    // The audit trail notes the upload but never stores the image.
    const log = JSON.stringify((await env.app.inject({ method: "GET", url: "/v1/admin/activity", headers: env.auth(env.admin) })).json());
    expect(log).toMatch(/Uploaded a new café logo/);
    expect(log).not.toContain(PNG.toString("base64"));

    const gone = await env.app.inject({ method: "DELETE", url: "/v1/admin/logo", headers: env.auth(env.admin) });
    expect(gone.statusCode).toBe(200);
    expect(gone.json().logoUrl).toBeNull();
    expect(await menuLogo()).toBeNull();
    expect((await env.app.inject({ method: "GET", url: "/v1/cafes/400-coffee/logo" })).statusCode).toBe(404);
  });
});
