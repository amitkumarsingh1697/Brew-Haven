import cors from "@fastify/cors";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";
import { ZodError, type ZodTypeAny, type z } from "zod";
import {
  CreateOrderRequest,
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
import { orderView } from "./services/orders.js";
import { daySummary, listOutletOrders, listStaffUsers, login, stockList, updateStock } from "./services/staff.js";

declare module "fastify" {
  interface FastifyRequest {
    rawBody?: string;
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

export interface AppDeps {
  config: Config;
  db: Db;
  provider?: PaymentProvider;
  bus?: EventBus;
}

export async function buildApp(deps: AppDeps) {
  const app = Fastify({
    logger: process.env.NODE_ENV === "test" ? false : { level: process.env.LOG_LEVEL ?? "info", redact: ["req.headers.authorization"] },
    trustProxy: true,
    bodyLimit: 64 * 1024,
  });
  const bus = deps.bus ?? new EventBus();
  const provider = deps.provider ?? createProvider(deps.config);
  const ctx: Ctx = { db: deps.db, bus, provider, log: app.log };
  const tokens = new StaffTokens(deps.config.staffTokenSecret);
  const limiter = new AttemptLimiter();
  const origins = new Set(deps.config.corsOrigins);

  await app.register(cors, { origin: [...origins], allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key"] });

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
    if (status && status < 500) return reply.status(status).send({ error: { code: "BAD_REQUEST", message: (err as Error).message } });
    req.log.error({ err }, "unhandled error");
    return reply.status(500).send({ error: { code: "INTERNAL", message: "Something went wrong on our side. Please try again." } });
  });

  async function staff(req: FastifyRequest, opts: { allowQueryToken?: boolean } = {}): Promise<StaffClaims> {
    const h = req.headers.authorization;
    const q = opts.allowQueryToken ? (req.query as { token?: string }).token : undefined;
    const token = h?.startsWith("Bearer ") ? h.slice(7) : q;
    if (!token) throw new AppError("UNAUTHORIZED", "Please sign in");
    return tokens.verify(token);
  }

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
  app.get("/health", async () => {
    await deps.db.execute("select 1");
    return { ok: true, provider: provider.name };
  });

  // ---------- Customer ----------
  app.get<{ Params: { tenant: string; outlet: string } }>("/v1/cafes/:tenant/:outlet/menu", async (req, reply) => {
    reply.header("Cache-Control", "public, max-age=15");
    return getMenu(deps.db, req.params.tenant, req.params.outlet);
  });

  app.post<{ Params: { tenant: string; outlet: string } }>("/v1/cafes/:tenant/:outlet/quote", async (req) => {
    const body = parse(QuoteRequest, req.body);
    const { tenant, outlet } = await loadTenantOutlet(deps.db, req.params.tenant, req.params.outlet);
    const lines = await resolveLines(deps.db, tenant.id, outlet.id, body.lines, { requireAvailable: true });
    const q = quote(lines, tenant.taxRateBps);
    return { ...q, lines: q.lines.map((l, i) => ({ itemId: l.itemId, name: l.name, quantity: l.quantity, modifiers: l.modifiers, unitTotalPaise: l.unitTotalPaise, lineTotalPaise: l.lineTotalPaise, ...(lines[i]?.note ? { note: lines[i]!.note } : {}) })) };
  });

  app.post<{ Params: { tenant: string; outlet: string } }>("/v1/cafes/:tenant/:outlet/orders", async (req, reply) => {
    const body = parse(CreateOrderRequest, req.body);
    const key = String(req.headers["idempotency-key"] ?? "");
    const res = await createOnlineOrder(ctx, req.params.tenant, req.params.outlet, body, key);
    return reply.status(201).send(res);
  });

  app.get<{ Params: { token: string } }>("/v1/track/:token", async (req) => {
    const [o] = await deps.db.select({ id: orders.id }).from(orders).where(eq(orders.trackingToken, req.params.token));
    if (!o) throw notFound("Order");
    return deps.db.transaction((tx) => orderView(tx, o.id));
  });

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

  app.post<{ Params: { token: string } }>("/v1/track/:token/pay", async (req) => retryPayment(ctx, req.params.token));

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

  app.post("/v1/staff/login", async (req) => login(deps.db, tokens, limiter, parse(StaffLoginRequest, req.body), req.ip));

  app.get<{ Querystring: { outletId: string; scope?: "live" | "today" } }>("/v1/staff/orders", async (req) =>
    listOutletOrders(deps.db, await staff(req), req.query.outletId, req.query.scope === "today" ? "today" : "live"),
  );

  app.get<{ Querystring: { outletId: string } }>("/v1/staff/stream", async (req, reply) => {
    const s = await staff(req, { allowQueryToken: true });
    if (!s.outletIds.includes(req.query.outletId)) throw new AppError("FORBIDDEN", "You are not assigned to this café");
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

  return { app, ctx };
}
