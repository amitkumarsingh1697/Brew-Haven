export interface Config {
  databaseUrl: string;
  port: number;
  host: string;
  /** Secret for signing staff session tokens. */
  staffTokenSecret: string;
  corsOrigins: string[];
  payments: {
    provider: "simulated" | "razorpay";
    simulatedWebhookSecret: string;
    razorpay?: { keyId: string; keySecret: string; webhookSecret: string };
  };
  /** Start the in-process outbox worker and timeout sweeps. */
  runWorker: boolean;
  notifications?: {
    /** "log" records messages without sending them; "meta" sends via the WhatsApp Cloud API. */
    provider: "log" | "meta";
    /** Base URL of the customer app, for tracking links in messages. */
    customerAppUrl: string;
    meta?: { token: string; phoneNumberId: string; language: string };
  };
}

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

export function loadConfig(): Config {
  const provider = (process.env.PAYMENT_PROVIDER ?? "simulated") as Config["payments"]["provider"];
  const isProd = process.env.NODE_ENV === "production";
  return {
    databaseUrl: required("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/brewhaven"),
    port: Number(process.env.PORT ?? 8080),
    host: process.env.HOST ?? "0.0.0.0",
    staffTokenSecret: required("STAFF_TOKEN_SECRET", isProd ? undefined : "dev-only-staff-secret-change-me-0123456789"),
    corsOrigins: (process.env.CORS_ORIGINS ?? "http://localhost:5173,http://localhost:5174").split(",").map((s) => s.trim()),
    payments: {
      provider,
      simulatedWebhookSecret: required("SIMULATED_WEBHOOK_SECRET", isProd ? undefined : "dev-simulated-webhook-secret"),
      razorpay:
        provider === "razorpay"
          ? {
              keyId: required("RAZORPAY_KEY_ID"),
              keySecret: required("RAZORPAY_KEY_SECRET"),
              webhookSecret: required("RAZORPAY_WEBHOOK_SECRET"),
            }
          : undefined,
    },
    runWorker: process.env.RUN_WORKER !== "false",
    notifications: {
      provider: (process.env.NOTIFY_PROVIDER ?? "log") as "log" | "meta",
      customerAppUrl: process.env.CUSTOMER_APP_URL ?? "http://localhost:5173",
      meta:
        process.env.NOTIFY_PROVIDER === "meta"
          ? { token: required("WHATSAPP_TOKEN"), phoneNumberId: required("WHATSAPP_PHONE_NUMBER_ID"), language: process.env.WHATSAPP_TEMPLATE_LANGUAGE ?? "en" }
          : undefined,
    },
  };
}
