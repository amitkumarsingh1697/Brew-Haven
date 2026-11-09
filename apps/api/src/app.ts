import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { randomBytes } from "node:crypto";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";
import { ZodError, type ZodTypeAny, type z } from "zod";
import {
  AdminSettingsRequest,
  CloseDayRequest,
  CategoryRequest,
  CreateOrderRequest,
  CreateOutletRequest,
  ItemRequest,
  ListingRequest,
  StaffUserRequest,
  StationInput,
  UpdateItemRequest,
  UpdateOutletRequest,
  UpdateStaffUserRequest,
  FlagUnavailableRequest,
  QuoteRequest,
  RejectRequest,
  ResolveAdjustmentRequest,
  SimulatePaymentRequest,
  StaffActionRequest,
  StaffLoginRequest,
  StockUpdateRequest,
  WalkInOrderRequest,
} from "@brew-haven/contracts";
import { quote } from "@brew-haven/domain";
import { createAlerter, type Alerter } from "./alerts.js";
import { AttemptLimiter, StaffTokens, type StaffClaims } from "./auth.js";
import type { Config } from "./config.js";
import type { Db } from "./db/client.js";
import { orders, payments } from "./db/schema.js";
import { AppError, notFound } from "./errors.js";
import { EventBus } from "./events.js";
import { InvalidSignatureError, type PaymentProvider } from "./payments/provider.js";
import { RazorpayProvider } from "./payments/razorpay.js";
import { SimulatedProvider } from "./payments/simulated.js";
import { getMenu, loadTenantOutlet, resolveLines } from "./services/catalog.js";
import {
  createOnlineOrder,
  createWalkInOrder,
  flagUnavailable,
  handleWebhook,
  rejectOrder,
  resolveCustomerAdjustment,
  retryPayment,
  staffAction,
  type Ctx,
} from "./services/flows.js";
import { listPaymentExceptions } from "./services/exceptions.js";
import { readiness } from "./services/health.js";
import { orderView } from "./services/orders.js";
import { receiptByToken, receiptForStaff } from "./services/receipts.js";
import { assertStaffOutlet, daySummary, listOutletOrders, listStaffUsers, login, stockList, updateStock } from "./services/staff.js";
import * as admin from "./services/admin.js";
import * as audit from "./services/audit.js";
import { listNotifications } from "./services/notifications.js";
import { closeDay, getClose, salesReport } from "./services/reports.js";
import { LogNotifier, MetaWhatsAppNotifier, type Notifier } from "./notify/provider.js";

declare module "fastify" {
  interface FastifyRequest {
    rawBody?: string;
    /** Set once a staff token has been verified, for the audit trail. */
    staffClaims?: StaffClaims;
  }
}

function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.output<S> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const issue = r.error.issues[0];
    throw new AppError("VALIDATION", issue ? `${issue.path.join(".") || "request"}: ${issue.message}` : "Invalid request");
  }
  return r.data;
}

export function createProvider(config: Config): PaymentProvider {
  if (config.payments.provider === "razorpay") {
    const r = config.payments.razorpay!;
    return new RazorpayProvider(r.keyId, r.keySecret, r.webhookSecret);
  }
  return new SimulatedProvider(config.payments.simulatedWebhookSecret);
}

export function createNotifier(config: Config): Notifier {
  const n = config.notifications;
  if (n?.provider === "meta" && n.meta) return new MetaWhatsAppNotifier(n.meta.token, n.meta.phoneNumberId, n.meta.language);
  return new LogNotifier();
}

export interface AppDeps {
  config: Config;
  db: Db;
  provider?: PaymentProvider;
  bus?: EventBus;
  notifier?: Notifier;
  alerter?: Alerter;
  /** Per-IP limits on public endpoints. On by default; the test suite turns it off except where it tests it. */
  rateLimit?: boolean;
}

export async function buildApp(deps: AppDeps) {
  const app = Fastify({
    logger: process.env.NODE_ENV === "test" ? false : { level: process.env.LOG_LEVEL ?? "info", redact: ["req.headers.authorization"] },
    trustProxy: true,
    bodyLimit: 64 * 1024,
    // Short ids, echoed back as X-Request-Id, so a staff member can quote one from an error.
    requestIdHeader: "x-request-id",
    genReqId: () => randomBytes(6).toString("base64url"),
  });
  const bus = deps.bus ?? new EventBus();
  const provider = deps.provider ?? createProvider(deps.config);
  const notifier = deps.notifier ?? createNotifier(deps.config);
  const alerter = deps.alerter ?? createAlerter(deps.config.alertWebhookUrl, deps.config.appEnv ?? "dev", app.log);
  const ctx: Ctx = {
    db: deps.db,
    bus,
    provider,
    notifier,
    alerter,
    worker: { lastTickAt: null },
    customerAppUrl: deps.config.notifications?.customerAppUrl ?? "http://localhost:5173",
    log: app.log,
  };
  const tokens = new StaffTokens(deps.config.staffTokenSecret);
  const limiter = new AttemptLimiter();
  const origins = new Set(deps.config.corsOrigins);

  await app.register(helmet, {
    // JSON API: no pages to protect with CSP; the apps set their own CSP (see public/_headers).
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  });
  const limits = deps.rateLimit ?? process.env.NODE_ENV !== "test";
  if (limits) {
    await app.register(rateLimit, {
      global: false,
      errorResponseBuilder: (_req, ctx) => ({ statusCode: 429, error: "Too Many Requests", message: `Too many requests. Please wait ${Math.ceil(ctx.ttl / 1000)} seconds and try again.` }),
    });
  }
  /** Route option for a per-IP limit (ignored when limits are off). */
  const perMinute = (max: number) => (limits ? { config: { rateLimit: { max, timeWindow: "1 minute" } } } : {});

  await app.register(cors, { origin: [...origins], methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"], allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key"] });

  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    req.rawBody = body as string;
    try {
      done(null, body ? JSON.parse(body as string) : {});
    } catch {
      done(new AppError("VALIDATION", "Body is not valid JSON"), undefined);
    }
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) return reply.status(err.status).send({ error: { code: err.code, message: err.message } });
    if (err instanceof ZodError) return reply.status(400).send({ error: { code: "VALIDATION", message: err.issues[0]?.message ?? "Invalid" } });
    if (err instanceof RangeError) return reply.status(400).send({ error: { code: "VALIDATION", message: err.message } });
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 429) return reply.status(429).send({ error: { code: "RATE_LIMITED", message: (err as Error).message } });
    if (status && status < 500) return reply.status(status).send({ error: { code: "BAD_REQUEST", message: (err as Error).message } });
    req.log.error({ err }, "unhandled error");
    const route = req.routeOptions?.url ?? req.url.split("?")[0];
    void alerter.send({ key: `500 ${req.method} ${route}`, title: `Server error on ${req.method} ${route}`, detail: `${(err as Error).message} (ref ${req.id})` });
    return reply.status(500).send({ error: { code: "INTERNAL", message: `Something went wrong on our side. Please try again. If it keeps happening, quote ref ${req.id}.`, ref: req.id } });
  });

  async function staff(req: FastifyRequest, opts: { allowQueryToken?: boolean } = {}): Promise<StaffClaims> {
    const h = req.headers.authorization;
    const q = opts.allowQueryToken ? (req.query as { token?: string }).token : undefined;
    const token = h?.startsWith("Bearer ") ? h.slice(7) : q;
    if (!token) throw new AppError("UNAUTHORIZED", "Please sign in");
    const claims = await tokens.verify(token);
    req.staffClaims = claims;
    return claims;
  }

  // ---------- Audit trail: every successful staff or owner change ----------
  app.addHook("onSend", async (req, reply, payload) => {
    const s = req.staffClaims;
    if (!s || req.method === "GET" || reply.statusCode >= 400 || !req.routeOptions.url) return payload;
    try {
      const result = typeof payload === "string" ? JSON.parse(payload) : {};
      const d = await audit.describe(deps.db, s, req.method, req.routeOptions.url, (req.params ?? {}) as Record<string, unknown>, (req.body ?? {}) as Record<string, unknown>, result ?? {});
      if (d) await audit.recordAudit(deps.db, { ...d, meta: audit.scrub(req.body), tenantId: s.tenantId, actorId: s.sub, actorName: s.name, ip: req.ip });
    } catch (err) {
      req.log.error({ err }, "audit write failed"); // never fail the change because the log failed
    }
    return payload;
  });

  function openSse(req: FastifyRequest, reply: FastifyReply) {
    const origin = req.headers.origin;
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      ...(origin && origins.has(origin) ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}),
    });
    reply.raw.write("retry: 3000\n\n");
    const send = (event: string, data: unknown) => reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const ping = setInterval(() => reply.raw.write(": ping\n\n"), 25_000);
    return { send, onClose: (fn: () => void) => req.raw.on("close", () => (clearInterval(ping), fn())) };
  }

  // ---------- Health ----------
  app.addHook("onSend", async (req, reply) => {
    reply.header("x-request-id", req.id);
  });

  /** Liveness: the process is up and can reach the database. */
  app.get("/health", async () => {
    await deps.db.execute("select 1");
    return { ok: true, provider: provider.name, notifications: notifier.name };
  });

  /**
   * Readiness, for the host's health check and uptime monitors: database round trip, background
   * jobs not backing up, and the worker still ticking. 503 with the reasons when not ready.
   */
  app.get("/health/ready", async (_req, reply) => {
    const r = await readiness(ctx, { workerExpected: deps.config.runWorker });
    return reply.status(r.ok ? 200 : 503).send(r);
  });

  // ---------- Customer ----------
  app.get<{ Params: { tenant: string; outlet: string } }>("/v1/cafes/:tenant/:outlet/menu", async (req, reply) => {
    reply.header("Cache-Control", "public, max-age=15");
    return getMenu(deps.db, req.params.tenant, req.params.outlet);
  });

  app.post<{ Params: { tenant: string; outlet: string } }>("/v1/cafes/:tenant/:outlet/quote", perMinute(60), async (req) => {
    const body = parse(QuoteRequest, req.body);
    const { tenant, outlet } = await loadTenantOutlet(deps.db, req.params.tenant, req.params.outlet);
    const lines = await resolveLines(deps.db, tenant.id, outlet.id, body.lines, { requireAvailable: true });
    const q = quote(lines, tenant.taxRateBps);
    return { ...q, lines: q.lines.map((l, i) => ({ itemId: l.itemId, name: l.name, quantity: l.quantity, modifiers: l.modifiers, unitTotalPaise: l.unitTotalPaise, lineTotalPaise: l.lineTotalPaise, ...(lines[i]?.note ? { note: lines[i]!.note } : {}) })) };
  });

  app.post<{ Params: { tenant: string; outlet: string } }>("/v1/cafes/:tenant/:outlet/orders", perMinute(10), async (req, reply) => {
    const body = parse(CreateOrderRequest, req.body);
    const key = String(req.headers["idempotency-key"] ?? "");
    const res = await createOnlineOrder(ctx, req.params.tenant, req.params.outlet, body, key);
    return reply.status(201).send(res);
  });

  app.get<{ Params: { token: string } }>("/v1/track/:token", perMinute(120), async (req) => {
    const [o] = await deps.db.select({ id: orders.id }).from(orders).where(eq(orders.trackingToken, req.params.token));
    if (!o) throw notFound("Order");
    return deps.db.transaction((tx) => orderView(tx, o.id));
  });

  app.get<{ Params: { token: string } }>("/v1/track/:token/receipt", perMinute(60), async (req) => receiptByToken(deps.db, req.params.token));

  app.get<{ Params: { token: string } }>("/v1/track/:token/stream", async (req, reply) => {
    const [o] = await deps.db.select({ id: orders.id }).from(orders).where(eq(orders.trackingToken, req.params.token));
    if (!o) throw notFound("Order");
    const sse = openSse(req, reply);
    const push = async () => sse.send("order", await deps.db.transaction((tx) => orderView(tx, o.id)));
    await push();
    const off = bus.onOrder((e) => {
      if (e.orderId === o.id) void push().catch(() => undefined);
    });
    sse.onClose(off);
  });

  app.post<{ Params: { token: string } }>("/v1/track/:token/pay", perMinute(10), async (req) => retryPayment(ctx, req.params.token));

  app.post<{ Params: { token: string; id: string } }>("/v1/track/:token/adjustments/:id/resolve", async (req) =>
    resolveCustomerAdjustment(ctx, req.params.token, req.params.id, parse(ResolveAdjustmentRequest, req.body)),
  );

  // ---------- Payments ----------
  app.post<{ Params: { provider: string } }>("/v1/payments/webhook/:provider", async (req, reply) => {
    if (req.params.provider !== provider.name) throw notFound("Webhook");
    try {
      const event = provider.parseWebhook(req.rawBody ?? "", req.headers);
      const result = await handleWebhook(ctx, event);
      return { result };
    } catch (e) {
      if (e instanceof InvalidSignatureError) return reply.status(401).send({ error: { code: "UNAUTHORIZED", message: e.message } });
      throw e;
    }
  });

  if (provider instanceof SimulatedProvider) {
    // Demo checkout: stands in for the gateway's hosted page. Disabled when a real provider is configured.
    app.post("/v1/payments/simulate", async (req) => {
      const body = parse(SimulatePaymentRequest, req.body);
      const [pay] = await deps.db.select().from(payments).where(eq(payments.id, body.paymentId));
      if (!pay || pay.provider !== "simulated") throw notFound("Payment");
      const signed = provider.paymentEvent(body.outcome === "SUCCESS" ? "payment.captured" : "payment.failed", pay.providerOrderId!, pay.amountPaise);
      const result = await handleWebhook(ctx, provider.parseWebhook(signed.body, signed.headers));
      return { result, order: await deps.db.transaction((tx) => orderView(tx, pay.orderId)) };
    });
  }

  // ---------- Staff ----------
  app.get<{ Params: { tenant: string } }>("/v1/staff/:tenant/users", async (req) => listStaffUsers(deps.db, req.params.tenant));

  app.post("/v1/staff/login", perMinute(30), async (req) => {
    const session = await login(deps.db, tokens, limiter, parse(StaffLoginRequest, req.body), req.ip);
    const claims = await tokens.verify(session.token);
    await audit.recordAudit(deps.db, { tenantId: claims.tenantId, actorId: claims.sub, actorName: claims.name, action: "staff.sign_in", summary: "Signed in", ip: req.ip }).catch((err) => req.log.error({ err }, "audit write failed"));
    return session;
  });

  app.get<{ Querystring: { outletId: string; scope?: "live" | "today" } }>("/v1/staff/orders", async (req) =>
    listOutletOrders(deps.db, await staff(req), req.query.outletId, req.query.scope === "today" ? "today" : "live"),
  );

  app.get<{ Querystring: { outletId: string } }>("/v1/staff/stream", async (req, reply) => {
    const s = await staff(req, { allowQueryToken: true });
    await assertStaffOutlet(deps.db, s, req.query.outletId);
    const sse = openSse(req, reply);
    sse.send("hello", { outletId: req.query.outletId });
    const off = bus.onOrder((e) => {
      if (e.tenantId !== s.tenantId || e.outletId !== req.query.outletId) return;
      void deps.db
        .transaction((tx) => orderView(tx, e.orderId))
        .then((v) => v.state !== "AWAITING_PAYMENT" && sse.send("order", v))
        .catch(() => undefined);
    });
    sse.onClose(off);
  });

  app.get<{ Params: { id: string } }>("/v1/staff/orders/:id/receipt", async (req) => receiptForStaff(deps.db, await staff(req), req.params.id));
  app.post<{ Params: { id: string } }>("/v1/staff/orders/:id/actions", async (req) =>
    staffAction(ctx, await staff(req), req.params.id, parse(StaffActionRequest, req.body).action),
  );
  app.post<{ Params: { id: string } }>("/v1/staff/orders/:id/reject", async (req) =>
    rejectOrder(ctx, await staff(req), req.params.id, parse(RejectRequest, req.body).reason),
  );
  app.post<{ Params: { id: string } }>("/v1/staff/orders/:id/flag-unavailable", async (req) =>
    flagUnavailable(ctx, await staff(req), req.params.id, parse(FlagUnavailableRequest, req.body)),
  );
  app.post("/v1/staff/orders/walk-in", async (req, reply) =>
    reply.status(201).send(await createWalkInOrder(ctx, await staff(req), parse(WalkInOrderRequest, req.body))),
  );
  app.get<{ Querystring: { outletId: string } }>("/v1/staff/stock", async (req) => stockList(deps.db, await staff(req), req.query.outletId));
  app.put("/v1/staff/stock", async (req) => updateStock(deps.db, await staff(req), parse(StockUpdateRequest, req.body)));
  app.get<{ Querystring: { outletId: string; date?: string } }>("/v1/staff/summary", async (req) =>
    daySummary(deps.db, await staff(req), req.query.outletId, req.query.date),
  );

  app.get<{ Querystring: { outletId: string } }>("/v1/staff/close", async (req) => getClose(deps.db, await staff(req), req.query.outletId));
  app.post("/v1/staff/close", async (req) => closeDay(deps.db, await staff(req), parse(CloseDayRequest, req.body)));
  app.get("/v1/staff/outlets", async (req) => admin.accessibleOutlets(deps.db, await staff(req)));

  // ---------- Owner admin (D-17) ----------
  type IdParams = { Params: { id: string } };
  app.get("/v1/admin/setup", async (req) => admin.getSetup(deps.db, await staff(req)));
  app.get<{ Querystring: { outletId?: string } }>("/v1/admin/payment-checks", async (req) => listPaymentExceptions(deps.db, await staff(req), { outletId: req.query.outletId || undefined }));
  app.get<{ Querystring: { from?: string; to?: string; outletId?: string } }>("/v1/admin/reports", async (req) => salesReport(deps.db, await staff(req), req.query));
  app.get("/v1/admin/notifications", async (req) => ({ provider: notifier.name, delivers: notifier.delivers, messages: await listNotifications(deps.db, await staff(req)) }));
  app.get<{ Querystring: { limit?: string; before?: string; outletId?: string } }>("/v1/admin/activity", async (req) =>
    audit.listActivity(deps.db, await staff(req), { limit: Number(req.query.limit) || undefined, before: Number(req.query.before) || undefined, outletId: req.query.outletId }),
  );
  app.put("/v1/admin/settings", async (req) => admin.updateSettings(deps.db, await staff(req), parse(AdminSettingsRequest, req.body)));
  app.post("/v1/admin/outlets", async (req, reply) => reply.status(201).send(await admin.createOutlet(deps.db, await staff(req), parse(CreateOutletRequest, req.body))));
  app.patch<IdParams>("/v1/admin/outlets/:id", async (req) => admin.updateOutlet(deps.db, await staff(req), req.params.id, parse(UpdateOutletRequest, req.body)));
  app.post<IdParams>("/v1/admin/outlets/:id/stations", async (req, reply) =>
    reply.status(201).send(await admin.addStation(deps.db, await staff(req), req.params.id, parse(StationInput, req.body))),
  );
  app.patch<IdParams>("/v1/admin/stations/:id", async (req) => admin.renameStation(deps.db, await staff(req), req.params.id, parse(StationInput, req.body).name));
  app.delete<IdParams>("/v1/admin/stations/:id", async (req) => admin.removeStation(deps.db, await staff(req), req.params.id));
  app.post("/v1/admin/categories", async (req, reply) => reply.status(201).send(await admin.createCategory(deps.db, await staff(req), parse(CategoryRequest, req.body))));
  app.patch<IdParams>("/v1/admin/categories/:id", async (req) => admin.updateCategory(deps.db, await staff(req), req.params.id, parse(CategoryRequest, req.body)));
  app.post("/v1/admin/items", async (req, reply) => reply.status(201).send(await admin.createItem(deps.db, await staff(req), parse(ItemRequest, req.body))));
  app.patch<IdParams>("/v1/admin/items/:id", async (req) => admin.updateItem(deps.db, await staff(req), req.params.id, parse(UpdateItemRequest, req.body)));
  app.put("/v1/admin/listings", async (req) => admin.setListing(deps.db, await staff(req), parse(ListingRequest, req.body)));
  app.post("/v1/admin/staff", async (req, reply) => reply.status(201).send(await admin.createStaffUser(deps.db, await staff(req), parse(StaffUserRequest, req.body))));
  app.patch<IdParams>("/v1/admin/staff/:id", async (req) => admin.updateStaffUser(deps.db, await staff(req), req.params.id, parse(UpdateStaffUserRequest, req.body)));

  return { app, ctx };
}
