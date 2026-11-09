/**
 * Operational alerts: server errors, parked background jobs, a stalled worker. With
 * ALERT_WEBHOOK_URL set they are posted to a chat webhook (Slack, Google Chat and Discord all
 * accept this payload); otherwise they only go to the log. The same alert is sent at most once
 * every 10 minutes, so an outage doesn't flood the channel.
 */
export interface Alert {
  /** Groups repeats of the same problem, e.g. "500 POST /v1/staff/orders/walk-in". */
  key: string;
  title: string;
  detail?: string;
}

export interface Alerter {
  readonly name: string;
  send(alert: Alert): Promise<void>;
}

type Log = { error: (o: object, msg?: string) => void; warn: (o: object, msg?: string) => void };

const QUIET_MS = 10 * 60_000;

abstract class Throttled implements Alerter {
  abstract readonly name: string;
  private last = new Map<string, number>();
  constructor(
    protected log: Log,
    private now: () => number = Date.now,
  ) {}
  protected abstract deliver(alert: Alert): Promise<void>;
  async send(alert: Alert) {
    const t = this.now();
    const prev = this.last.get(alert.key);
    if (prev !== undefined && t - prev < QUIET_MS) return;
    this.last.set(alert.key, t);
    if (this.last.size > 500) this.last.delete(this.last.keys().next().value!);
    this.log.error({ alert: alert.key, detail: alert.detail }, `ALERT ${alert.title}`);
    try {
      await this.deliver(alert);
    } catch (e) {
      // An alert that can't be delivered must never break the request that raised it.
      this.log.warn({ err: String(e) }, "alert delivery failed");
    }
  }
}

export class LogAlerter extends Throttled {
  readonly name = "log";
  protected async deliver() {}
}

export class WebhookAlerter extends Throttled {
  readonly name = "webhook";
  constructor(
    private url: string,
    private env: string,
    log: Log,
    private fetchImpl: typeof fetch = fetch,
    now?: () => number,
  ) {
    super(log, now);
  }
  protected async deliver(alert: Alert) {
    const text = `⚠️ Brew Haven (${this.env}): ${alert.title}${alert.detail ? `\n${alert.detail.slice(0, 1500)}` : ""}`;
    const res = await this.fetchImpl(this.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, content: text.slice(0, 2000) }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`webhook answered ${res.status}`);
  }
}

export function createAlerter(url: string | undefined, env: string, log: Log): Alerter {
  return url ? new WebhookAlerter(url, env, log) : new LogAlerter(log);
}
