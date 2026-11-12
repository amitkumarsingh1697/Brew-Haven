import { useEffect, useState } from "react";
import { formatInr } from "@brew-haven/domain";
import { API_URL, ApiError } from "./api";

/**
 * Brew Haven's own team: every business on the platform, with totals only. Separate from café
 * sign-in: email and password, its own token, and nothing here opens a café's screens.
 */
type Business = {
  id: string;
  slug: string;
  name: string;
  plan: "starter" | "growth" | "multi";
  planName: string;
  monthlyPaise: number;
  billing: { state: "trial" | "trial_over" | "paid" | "overdue" | "not_billed"; until: string | null; daysLeft: number | null };
  suspended: boolean;
  demo: boolean;
  createdAt: string;
  contact: { email?: string; phone?: string };
  cafes: Array<{ name: string; isOpen: boolean }>;
  team: number;
  ordersLast30Days: number;
  salesLast30DaysPaise: number;
  lastOrderAt: string | null;
};
type Who = { token: string; name: string; email: string };
const KEY = "bh:platform";
const PLANS: Array<[Business["plan"], string]> = [
  ["starter", "Starter"],
  ["growth", "Growth"],
  ["multi", "Multi-café"],
];

async function request<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}) },
    });
  } catch {
    throw new ApiError(0, "Can't reach the server.");
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, body?.error?.message ?? "Something went wrong");
  return body as T;
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "Never");

const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
/** A date in India, as YYYY-MM-DD. */
const istDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);
/** One month on from the later of today and the current paid or trial end: the usual next "paid until". */
const nextMonth = (b: Business) => {
  const base = b.billing.until && new Date(b.billing.until) > new Date() ? new Date(b.billing.until) : new Date();
  const d = new Date(base);
  d.setMonth(d.getMonth() + 1);
  return istDay(d);
};
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function BillingCell({ b, onChange }: { b: Business; onChange: (body: { paidUntil?: string; trialEndsOn?: string }) => void }) {
  const { state, until, daysLeft } = b.billing;
  const ask = (question: string, suggested: string, key: "paidUntil" | "trialEndsOn") => {
    const v = window.prompt(question, suggested)?.trim();
    if (!v) return;
    if (!DAY.test(v)) return window.alert("Use a date like 2026-12-31.");
    onChange({ [key]: v });
  };
  const label =
    state === "trial" ? `Trial, ${daysLeft} ${daysLeft === 1 ? "day" : "days"} left` : state === "paid" ? `Paid to ${shortDate(until!)}` : state === "trial_over" ? `Trial ended ${shortDate(until!)}` : state === "overdue" ? `Due since ${shortDate(until!)}` : "Not billed";
  const tone = state === "paid" || state === "trial" ? "pill ok" : state === "not_billed" ? "pill none" : "pill warn";
  return (
    <div className="billing-cell">
      <span className={tone}>{label}</span>
      <span className="muted small">{formatInr(b.monthlyPaise)} a month</span>
      <button className="link-btn small" onClick={() => ask(`Paid until (YYYY-MM-DD) for ${b.name}:`, nextMonth(b), "paidUntil")} aria-label={`Record a payment for ${b.name}`}>
        Record payment
      </button>
      {state !== "paid" && (
        <button className="link-btn small" onClick={() => ask(`Free trial ends on (YYYY-MM-DD) for ${b.name}:`, nextMonth(b), "trialEndsOn")} aria-label={`Change the free trial for ${b.name}`}>
          Change trial
        </button>
      )}
    </div>
  );
}

export function Platform() {
  const [who, setWho] = useState<Who | null>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(KEY) ?? "null");
    } catch {
      return null;
    }
  });
  const signOut = () => {
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    setWho(null);
  };
  if (!who)
    return (
      <PlatformLogin
        onIn={(w) => {
          try {
            sessionStorage.setItem(KEY, JSON.stringify(w));
          } catch {
            /* ignore */
          }
          setWho(w);
        }}
      />
    );
  return <Businesses who={who} onSignOut={signOut} />;
}

function PlatformLogin({ onIn }: { onIn: (w: Who) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <main className="login">
      <form
        className="login-card platform-login"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            onIn(await request<Who>("/v1/platform/login", { method: "POST", body: JSON.stringify({ email, password }) }));
          } catch (err) {
            setError((err as ApiError).message);
            setBusy(false);
          }
        }}
      >
        <span className="brand">Brew Haven</span>
        <h1>Team sign-in</h1>
        <p className="muted small">For the Brew Haven team. Café owners and staff sign in on the main page.</p>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="btn btn-primary" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}

function Businesses({ who, onSignOut }: { who: Who; onSignOut: () => void }) {
  const [list, setList] = useState<Business[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const load = () =>
    request<{ businesses: Business[] }>("/v1/platform/businesses", { token: who.token }).then(
      (r) => setList(r.businesses),
      (e: ApiError) => (e.status === 401 ? onSignOut() : setError(e.message)),
    );
  useEffect(() => void load(), []);

  const change = async (b: Business, body: { plan?: string; suspended?: boolean; paidUntil?: string; trialEndsOn?: string }, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setError(null);
    try {
      await request(`/v1/platform/businesses/${b.id}`, { method: "PATCH", token: who.token, body: JSON.stringify(body) });
      await load();
    } catch (e) {
      setError((e as ApiError).message);
    }
  };

  const shown = (list ?? []).filter((b) => !filter || `${b.name} ${b.slug} ${b.contact.email ?? ""}`.toLowerCase().includes(filter.toLowerCase()));
  const active = (list ?? []).filter((b) => !b.suspended);
  return (
    <div className="shell platform">
      <header className="topbar">
        <span className="brand">Brew Haven</span>
        <h1 className="cafe">All businesses</h1>
        <span className="user">
          {who.name}
          <button className="link-btn" onClick={onSignOut}>
            Sign out
          </button>
        </span>
      </header>
      <main className="panel">
        {list && (
          <div className="stat-tiles">
            <div className="stat-tile">
              <span className="muted small">Businesses</span>
              <strong>{list.length}</strong>
              <span className="muted small">{list.filter((b) => b.suspended).length} paused</span>
            </div>
            <div className="stat-tile">
              <span className="muted small">Cafés</span>
              <strong>{active.reduce((n, b) => n + b.cafes.length, 0)}</strong>
              <span className="muted small">in active businesses</span>
            </div>
            <div className="stat-tile">
              <span className="muted small">Paying each month</span>
              <strong>{formatInr(active.filter((b) => b.billing.state === "paid").reduce((n, b) => n + b.monthlyPaise, 0))}</strong>
              <span className="muted small">
                {active.filter((b) => b.billing.state === "trial").length} on free trial · {active.filter((b) => b.billing.state === "trial_over" || b.billing.state === "overdue").length} payment due
              </span>
            </div>
            <div className="stat-tile">
              <span className="muted small">Orders, last 30 days</span>
              <strong>{active.reduce((n, b) => n + b.ordersLast30Days, 0)}</strong>
            </div>
            <div className="stat-tile">
              <span className="muted small">Sales through Brew Haven, 30 days</span>
              <strong>{formatInr(active.reduce((n, b) => n + b.salesLast30DaysPaise, 0))}</strong>
            </div>
          </div>
        )}
        <header className="items-head">
          <h2>Businesses</h2>
          <input type="search" placeholder="Find by name, link or email" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Find a business" />
        </header>
        <p className="muted small">Totals only. Each café owns its customers' details, so they aren't shown here.</p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {!list && !error && <p className="muted">Loading…</p>}
        {list && (
          <div className="table-scroll">
            <table className="items-table platform-table">
              <thead>
                <tr>
                  <th>Business</th>
                  <th>Owner contact</th>
                  <th>Cafés</th>
                  <th className="num">Team</th>
                  <th className="num">Orders (30 days)</th>
                  <th className="num">Sales (30 days)</th>
                  <th>Last order</th>
                  <th>Plan</th>
                  <th>Billing</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((b) => (
                  <tr key={b.id} className={b.suspended ? "paused" : undefined}>
                    <td>
                      <strong>{b.name}</strong>
                      <div className="muted small">
                        {b.slug} · joined {new Date(b.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                        {b.demo ? " · demo" : ""}
                      </div>
                    </td>
                    <td className="small">
                      {b.contact.email && <div>{b.contact.email}</div>}
                      {b.contact.phone && <div>{b.contact.phone}</div>}
                      {!b.contact.email && !b.contact.phone && <span className="muted">Not given</span>}
                    </td>
                    <td className="small">{b.cafes.map((c) => c.name).join(", ") || "None"}</td>
                    <td className="num">{b.team}</td>
                    <td className="num">{b.ordersLast30Days}</td>
                    <td className="num">{formatInr(b.salesLast30DaysPaise)}</td>
                    <td className="nowrap small">{when(b.lastOrderAt)}</td>
                    <td>
                      <select
                        value={b.plan}
                        aria-label={`Plan for ${b.name}`}
                        onChange={(e) => change(b, { plan: e.target.value }, `Move ${b.name} to the ${PLANS.find((p) => p[0] === e.target.value)?.[1]} plan? The owner will see this in their activity log.`)}
                      >
                        {PLANS.map(([id, label]) => (
                          <option key={id} value={id}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <BillingCell b={b} onChange={(body) => change(b, body)} />
                    </td>
                    <td>
                      <div className="status-cell">
                      <span className={b.suspended ? "pill warn" : "pill"}>{b.suspended ? "Paused" : "Active"}</span>
                      {b.suspended ? (
                        <button className="btn btn-ghost small" onClick={() => change(b, { suspended: false })} aria-label={`Resume ${b.name}`}>
                          Resume
                        </button>
                      ) : (
                        <button
                          className="btn btn-ghost small"
                          aria-label={`Pause ${b.name}`}
                          onClick={() => change(b, { suspended: true }, `Pause ${b.name}? Their cafés will stop taking new orders until you resume. Their data stays and they can still sign in.`)}
                        >
                          Pause
                        </button>
                      )}
                      </div>
                    </td>
                  </tr>
                ))}
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={10} className="muted">
                      No businesses match.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
