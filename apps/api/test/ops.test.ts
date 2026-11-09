import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Alert, type Alerter, WebhookAlerter } from "../src/alerts.js";
import { buildApp } from "../src/app.js";
import { setup, teardown, testConfig, type TestEnv } from "./helpers.js";

let env: TestEnv;
beforeAll(async () => {
  env = await setup();
});
afterAll(async () => teardown(env));

const quietLog = { error: () => undefined, warn: () => undefined };

describe("alerts", () => {
  it("posts to the webhook, at most once per problem every 10 minutes", async () => {
    let clock = 0;
    const posted: string[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      posted.push(JSON.parse(String(init.body)).text);
      return new Response("ok");
    }) as typeof fetch;
    const a = new WebhookAlerter("https://hooks.example/x", "demo", quietLog, fetchImpl, () => clock);
    await a.send({ key: "500 GET /x", title: "Server error on GET /x", detail: "boom" });
    await a.send({ key: "500 GET /x", title: "Server error on GET /x" });
    await a.send({ key: "parked refund.process", title: "A job gave up" });
    clock += 11 * 60_000;
    await a.send({ key: "500 GET /x", title: "Server error on GET /x" });
    expect(posted).toHaveLength(3);
    expect(posted[0]).toBe("⚠️ Brew Haven (demo): Server error on GET /x\nboom");
  });

  it("never throws when the webhook is down", async () => {
    const a = new WebhookAlerter("https://hooks.example/x", "demo", quietLog, (async () => new Response("no", { status: 500 })) as typeof fetch);
    await expect(a.send({ key: "k", title: "t" })).resolves.toBeUndefined();
  });
});

describe("server errors", () => {
  it("answer with a reference the staff can quote, and raise an alert", async () => {
    const alerts: Alert[] = [];
    const alerter: Alerter = { name: "test", send: async (a) => void alerts.push(a) };
    const { app } = await buildApp({ config: testConfig, db: env.db, alerter });
    app.get("/boom", async () => {
      throw new Error("database exploded");
    });
    const r = await app.inject({ method: "GET", url: "/boom" });
    expect(r.statusCode).toBe(500);
    const ref = r.headers["x-request-id"];
    expect(ref).toBeTruthy();
    expect(r.json().error).toMatchObject({ code: "INTERNAL", ref });
    expect(r.json().error.message).toContain(String(ref));
    expect(alerts).toEqual([expect.objectContaining({ key: "500 GET /boom", detail: `database exploded (ref ${ref})` })]);
    await app.close();
  });

  it("don't alert for ordinary mistakes like a bad request", async () => {
    const alerts: Alert[] = [];
    const { app } = await buildApp({ config: testConfig, db: env.db, alerter: { name: "test", send: async (a) => void alerts.push(a) } });
    const r = await app.inject({ method: "GET", url: "/v1/track/nope" });
    expect(r.statusCode).toBe(404);
    expect(alerts).toHaveLength(0);
    await app.close();
  });
});

describe("readiness", () => {
  it("is ready once the database answers and the worker is ticking", async () => {
    const { app, ctx } = await buildApp({ config: { ...testConfig, runWorker: true }, db: env.db });
    const before = await app.inject({ method: "GET", url: "/health/ready" });
    expect(before.statusCode).toBe(503);
    expect(before.json().checks).toMatchObject({ database: { ok: true }, worker: { ok: false, running: true } });

    ctx.worker!.lastTickAt = Date.now();
    const after = await app.inject({ method: "GET", url: "/health/ready" });
    expect(after.statusCode).toBe(200);
    expect(after.json()).toMatchObject({ ok: true, checks: { jobs: { ok: true }, worker: { ok: true, lastTickSecondsAgo: 0 } } });
    await app.close();
  });

  it("doesn't wait for a worker on a web-only instance", async () => {
    const { app } = await buildApp({ config: { ...testConfig, runWorker: false }, db: env.db });
    expect((await app.inject({ method: "GET", url: "/health/ready" })).statusCode).toBe(200);
    await app.close();
  });
});
