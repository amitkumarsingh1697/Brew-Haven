#!/usr/bin/env node
/**
 * Load test for the ordering path, with the kitchen screens listening.
 *
 * Each virtual customer loops: open the menu, get a price quote, place an order, pay (simulated
 * gateway), then check the tracking page. Meanwhile a number of staff screens hold the live order
 * stream open, and the script times how long a paid order takes to appear on them.
 *
 * Run it against a local or staging API with simulated payments and rate limits off:
 *   RATE_LIMIT=off pnpm --filter @brew-haven/api dev
 *   node tools/load-test.mjs --customers 50 --duration 60 --screens 6
 *
 * Options (all optional):
 *   --api URL          API base (default http://localhost:8080)
 *   --cafe T/O         tenant/outlet slugs (default 400-coffee/tower-a)
 *   --customers N      concurrent customers (default 20)
 *   --duration S       seconds to run (default 30)
 *   --screens N        staff screens on the live stream (default 4)
 *   --pin PIN          owner PIN for the staff screens (default 1111, the demo seed)
 *   --think MS         pause between a customer's steps (default 300)
 *
 * Never point this at production: it creates real orders. It refuses unless payments are simulated.
 * Exits non-zero if the error rate is above 1% or the p95 order time is above 1.5 s.
 */
import { performance } from "node:perf_hooks";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const API = (args.api ?? "http://localhost:8080").replace(/\/$/, "");
const [TENANT, OUTLET] = (args.cafe ?? "400-coffee/tower-a").split("/");
const CUSTOMERS = Number(args.customers ?? 20);
const DURATION = Number(args.duration ?? 30) * 1000;
const SCREENS = Number(args.screens ?? 4);
const PIN = String(args.pin ?? "1111");
const THINK = Number(args.think ?? 300);
const LIMITS = { errorRate: 0.01, orderP95: 1500 };

const timings = new Map(); // step -> number[]
const errors = new Map(); // step -> { count, sample }
const payStarted = new Map(); // orderId -> when the customer tapped Pay
const seenOnScreen = []; // ms from tapping Pay to the order appearing on a staff screen
let ordersPaid = 0;

const record = (step, ms) => (timings.get(step) ?? timings.set(step, []).get(step)).push(ms);
const fail = (step, msg) => {
  const e = errors.get(step) ?? { count: 0, sample: msg };
  e.count++;
  errors.set(step, e);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

async function call(step, path, init = {}) {
  const t0 = performance.now();
  let res;
  try {
    res = await fetch(API + path, {
      ...init,
      headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers ?? {}) },
    });
  } catch (e) {
    fail(step, `network: ${e.cause?.code ?? e.message}`);
    return null;
  }
  const body = await res.json().catch(() => null);
  const ms = performance.now() - t0;
  if (!res.ok) {
    fail(step, `${res.status} ${body?.error?.code ?? ""} ${body?.error?.message ?? ""}`.trim());
    return null;
  }
  record(step, ms);
  return body;
}

/** A random, valid basket from the menu: 1 to 3 in-stock items, first option for required choices. */
function basketFrom(menu) {
  const items = menu.categories.flatMap((c) => c.items).filter((i) => i.available);
  const lines = [];
  for (let n = 1 + Math.floor(Math.random() * 3); n > 0; n--) {
    const item = pick(items);
    const modifierIds = item.modifierGroups.filter((g) => g.minSelect > 0).flatMap((g) => g.options.slice(0, g.minSelect).map((o) => o.id));
    lines.push({ itemId: item.id, quantity: 1 + Math.floor(Math.random() * 2), modifierIds });
  }
  return lines;
}

const phone = () => `9${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;

async function customer(stopAt) {
  while (performance.now() < stopAt) {
    const menu = await call("menu", `/v1/cafes/${TENANT}/${OUTLET}/menu`);
    if (!menu) {
      await sleep(1000);
      continue;
    }
    await sleep(THINK);
    const lines = basketFrom(menu);
    if (!(await call("quote", `/v1/cafes/${TENANT}/${OUTLET}/quote`, { method: "POST", body: JSON.stringify({ lines }) }))) continue;
    await sleep(THINK);
    const order = await call("order", `/v1/cafes/${TENANT}/${OUTLET}/orders`, {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ lines, customer: { name: "Load test", phone: phone() }, consent: { orderUpdates: true, offers: false } }),
    });
    if (!order) continue;
    if (order.checkout.provider !== "simulated") {
      console.error("This API uses a real payment gateway. Stopping: the load test only runs with simulated payments.");
      process.exit(2);
    }
    payStarted.set(order.orderId, performance.now());
    const paid = await call("pay", `/v1/payments/simulate`, { method: "POST", body: JSON.stringify({ paymentId: order.checkout.paymentId, outcome: "SUCCESS" }) });
    if (!paid) continue;
    ordersPaid++;
    await sleep(THINK);
    await call("track", `/v1/track/${order.trackingToken}`);
  }
}

/** A staff screen on the live order stream, timing how fast paid orders show up. */
async function screen(token, outletId, signal) {
  try {
    const res = await fetch(`${API}/v1/staff/stream?outletId=${outletId}&token=${encodeURIComponent(token)}`, { signal });
    if (!res.ok || !res.body) return fail("stream", `stream ${res.status}`);
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = "";
    const seen = new Set();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buf += value;
      let cut;
      while ((cut = buf.indexOf("\n\n")) >= 0) {
        const frame = buf.slice(0, cut);
        buf = buf.slice(cut + 2);
        if (!frame.includes("event: order")) continue;
        const data = frame.split("\n").find((l) => l.startsWith("data:"));
        if (!data) continue;
        const o = JSON.parse(data.slice(5));
        const t = payStarted.get(o.id);
        if (o.state === "PLACED" && t !== undefined && !seen.has(o.id)) {
          seen.add(o.id);
          seenOnScreen.push(performance.now() - t);
        }
      }
    }
  } catch (e) {
    if (!signal.aborted) fail("stream", e.message);
  }
}

const pct = (xs, p) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const fmt = (n) => (Number.isNaN(n) ? "-" : `${Math.round(n)} ms`);

async function main() {
  const health = await fetch(`${API}/health`).then((r) => r.json()).catch(() => null);
  if (!health?.ok) throw new Error(`API not reachable at ${API}`);
  if (health.provider && health.provider !== "simulated") throw new Error("API is not using simulated payments; refusing to run.");

  const users = await call("login", `/v1/staff/${TENANT}/users`);
  const owner = users?.users.find((u) => u.role === "ADMIN");
  const session = owner && (await call("login", "/v1/staff/login", { method: "POST", body: JSON.stringify({ tenantSlug: TENANT, staffUserId: owner.id, pin: PIN }) }));
  if (!session) throw new Error("Couldn't sign in as the owner for the staff screens (check --pin).");
  const outlet = session.outlets.find((o) => o.slug === OUTLET);
  if (!outlet) throw new Error(`No café ${OUTLET} for this owner.`);

  console.log(`Load test: ${CUSTOMERS} customers for ${DURATION / 1000}s at ${TENANT}/${OUTLET}, ${SCREENS} staff screens, API ${API}`);
  const stop = new AbortController();
  const screens = Array.from({ length: SCREENS }, () => screen(session.token, outlet.id, stop.signal));
  await sleep(500);
  const started = performance.now();
  const stopAt = started + DURATION;
  const ticker = setInterval(() => console.log(`  ${Math.round((performance.now() - started) / 1000)}s: ${ordersPaid} orders paid`), 5000);
  await Promise.all(Array.from({ length: CUSTOMERS }, (_, i) => sleep(i * 50).then(() => customer(stopAt))));
  clearInterval(ticker);
  await sleep(1500); // let the last orders reach the screens
  stop.abort();
  await Promise.allSettled(screens);
  const secs = (performance.now() - started) / 1000;

  console.log("\nStep          count   p50       p95       p99       errors");
  for (const step of ["menu", "quote", "order", "pay", "track"]) {
    const xs = timings.get(step) ?? [];
    const e = errors.get(step)?.count ?? 0;
    console.log(`${step.padEnd(12)} ${String(xs.length).padStart(6)}   ${fmt(pct(xs, 50)).padEnd(9)} ${fmt(pct(xs, 95)).padEnd(9)} ${fmt(pct(xs, 99)).padEnd(9)} ${e}`);
  }
  const expected = ordersPaid * SCREENS;
  console.log(`\nOrders paid: ${ordersPaid} (${(ordersPaid / secs).toFixed(1)}/s, ${Math.round((ordersPaid / secs) * 60)}/min)`);
  console.log(`Kitchen screens: ${seenOnScreen.length} of ${expected} arrivals seen; p50 ${fmt(pct(seenOnScreen, 50))}, p95 ${fmt(pct(seenOnScreen, 95))} from tapping Pay to the order showing`);
  for (const [step, e] of errors) console.log(`  ${step}: ${e.count} errors, e.g. ${e.sample}`);

  const total = [...timings.values()].reduce((n, xs) => n + xs.length, 0);
  const errCount = [...errors.values()].reduce((n, e) => n + e.count, 0);
  const errorRate = errCount / Math.max(1, total + errCount);
  const orderP95 = pct(timings.get("order") ?? [], 95);
  const ok = errorRate <= LIMITS.errorRate && !(orderP95 > LIMITS.orderP95) && ordersPaid > 0;
  console.log(`\n${ok ? "PASS" : "FAIL"}: error rate ${(errorRate * 100).toFixed(2)}% (limit ${LIMITS.errorRate * 100}%), order p95 ${fmt(orderP95)} (limit ${LIMITS.orderP95} ms)`);
  process.exitCode = ok ? 0 : 1;
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
