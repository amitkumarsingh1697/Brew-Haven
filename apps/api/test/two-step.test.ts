import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPin } from "../src/auth.js";
import { platformAdmins } from "../src/db/schema.js";
import { base32Decode, base32Encode, hotp, openSecret, sealSecret, totpAt, verifyTotp } from "../src/totp.js";
import { setup, teardown, type TestEnv } from "./helpers.js";

describe("one-time codes (RFC 6238)", () => {
  // The RFC's SHA-1 test key, "12345678901234567890".
  const key = base32Encode(Buffer.from("12345678901234567890"));
  it("matches the published test values", () => {
    expect(key).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(totpAt(key, 59_000, 8)).toBe("94287082");
    expect(totpAt(key, 1_111_111_109_000, 8)).toBe("07081804");
    expect(totpAt(key, 1_234_567_890_000, 8)).toBe("89005924");
    expect(hotp(base32Decode(key), 0)).toBe("755224"); // RFC 4226
  });
  it("allows one step of clock drift and never the same step twice", () => {
    const now = 1_800_000_000_000;
    const code = totpAt(key, now);
    const step = verifyTotp(key, code, now + 25_000, null);
    expect(step).not.toBeNull();
    expect(verifyTotp(key, code, now, step)).toBeNull();
    expect(verifyTotp(key, totpAt(key, now - 120_000), now, null)).toBeNull();
    expect(verifyTotp(key, "12345", now, null)).toBeNull();
  });
  it("keeps secrets encrypted, and a changed one fails to open", () => {
    const sealed = sealSecret(key, "server-secret");
    expect(sealed).not.toContain(key);
    expect(openSecret(sealed, "server-secret")).toBe(key);
    expect(() => openSecret(sealed, "other-secret")).toThrow();
  });
});

describe("two-step sign-in for the Brew Haven team", () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await setup({ config: { platformRequireTwoStep: true } });
    await env.db.insert(platformAdmins).values({ email: "team@brewhaven.example", name: "Asha", passwordHash: await hashPin("correct horse battery") });
  });
  afterAll(async () => teardown(env));

  const post = (url: string, payload: object, token?: string) => env.app.inject({ method: "POST", url, payload, headers: token ? { authorization: `Bearer ${token}` } : {} });
  const businesses = (token: string) => env.app.inject({ method: "GET", url: "/v1/platform/businesses", headers: { authorization: `Bearer ${token}` } });
  const signIn = () => post("/v1/platform/login", { email: "team@brewhaven.example", password: "correct horse battery" });
  let secret = "";
  let recovery: string[] = [];

  it("before it is on, the password opens only the set-up", async () => {
    const r = (await signIn()).json();
    expect(r).toMatchObject({ step: "DONE", twoStep: false });
    const b = await businesses(r.token);
    expect(b.statusCode).toBe(403);
    expect(b.json().error.message).toMatch(/Turn on two-step sign-in/);

    const s = (await post("/v1/platform/two-step/setup", {}, r.token)).json();
    secret = s.secret;
    expect(s.otpauthUrl).toMatch(/^otpauth:\/\/totp\/Brew%20Haven%3Ateam%40brewhaven\.example\?secret=[A-Z2-7]+&issuer=Brew%20Haven/);
    expect((await post("/v1/platform/two-step/confirm", { code: "000000" }, r.token)).statusCode).toBe(400);
    const ok = await post("/v1/platform/two-step/confirm", { code: totpAt(secret, Date.now()) }, r.token);
    expect(ok.statusCode).toBe(200);
    recovery = ok.json().recoveryCodes;
    expect(recovery).toHaveLength(8);
    expect(recovery[0]).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}$/);
    expect((await businesses(ok.json().token)).statusCode).toBe(200);
    // The secret is stored encrypted.
    const [row] = await env.db.select().from(platformAdmins);
    expect(row!.totpSecret).not.toContain(secret);
  });

  it("once on, the password gives only a short ticket, and the code finishes signing in", async () => {
    const first = (await signIn()).json();
    expect(first.step).toBe("CODE");
    expect(first.token).toBeUndefined();
    // The ticket opens nothing by itself.
    expect((await businesses(first.ticket)).statusCode).toBe(401);
    expect((await post("/v1/platform/login/code", { ticket: first.ticket, code: "123456" })).statusCode).toBe(401);
    // The code used to turn it on was already spent; the next one works.
    expect((await post("/v1/platform/login/code", { ticket: first.ticket, code: totpAt(secret, Date.now()) })).statusCode).toBe(401);
    const ok = await post("/v1/platform/login/code", { ticket: first.ticket, code: totpAt(secret, Date.now() + 30_000) });
    expect(ok.statusCode).toBe(200);
    expect((await businesses(ok.json().token)).statusCode).toBe(200);
  });

  it("a recovery code works once, and a code-checked session can move to a new phone", async () => {
    const t = (await signIn()).json().ticket;
    const ok = await post("/v1/platform/login/code", { ticket: t, code: recovery[0]!.toUpperCase() });
    expect(ok.statusCode).toBe(200);
    const t2 = (await signIn()).json().ticket;
    expect((await post("/v1/platform/login/code", { ticket: t2, code: recovery[0]! })).statusCode).toBe(401);
    expect((await post("/v1/platform/login/code", { ticket: t2, code: recovery[1]! })).statusCode).toBe(200);
    // With a code-checked session the team member can move to a new phone.
    expect((await post("/v1/platform/two-step/setup", {}, ok.json().token)).statusCode).toBe(200);
  });
});
