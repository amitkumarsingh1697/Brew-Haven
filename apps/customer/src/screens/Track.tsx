import { useEffect, useState } from "react";
import { Link } from "wouter";
import type { CheckoutInfo, MenuItemDto, OrderView } from "@brew-haven/contracts";
import { ApiError, api } from "../api";
import { ErrorNote, Rs, Spinner } from "../components/ui";
import { useMenu, useNow, useOrder } from "../hooks";
import { openGatewayCheckout } from "../payment";
import { ItemSheet } from "./Menu";

const STEPS: Array<{ state: OrderView["state"]; label: string }> = [
  { state: "PLACED", label: "Order received" },
  { state: "PREPARING", label: "Being made" },
  { state: "READY", label: "Ready to collect" },
  { state: "COLLECTED", label: "Collected" },
];

export function Track({ token }: { token: string }) {
  const { order, setOrder, error, refresh } = useOrder(token);
  const payParam = new URLSearchParams(window.location.search).get("pay");

  if (error && !order) return <main className="page"><ErrorNote message={error} onRetry={refresh} /></main>;
  if (!order) return <main className="page"><Spinner label="Finding your order" /></main>;

  return (
    <main className="page track-page">
      <header className="simple-header">
        <Link href={`/${order.outlet.tenantSlug}/${order.outlet.slug}`} className="back" aria-label="Back to the café">
          ‹
        </Link>
        <h1>{order.outlet.cafeName}</h1>
        <span className="sub">{order.outlet.name} · Takeaway</span>
      </header>

      {order.state === "AWAITING_PAYMENT" && <PaymentPanel order={order} token={token} initialPaymentId={payParam} onPaid={setOrder} />}
      {order.state === "EXPIRED" && (
        <section className="card notice">
          <h2>This order wasn't paid</h2>
          <p>The payment wasn't completed in time, so nothing was sent to the kitchen. {order.refundedPaise > 0 && <>Any amount taken has been refunded.</>}</p>
          <Link className="btn btn-primary" href={`/${order.outlet.tenantSlug}/${order.outlet.slug}/menu`}>
            Start a new order
          </Link>
        </section>
      )}
      {order.state === "CANCELLED" && (
        <section className="card notice notice-danger">
          <h2>Order cancelled</h2>
          {order.cancelReason && <p className="reason">{order.cancelReason}</p>}
          <RefundSummary order={order} />
          <Link className="btn btn-primary" href={`/${order.outlet.tenantSlug}/${order.outlet.slug}/menu`}>
            Order something else
          </Link>
        </section>
      )}

      {["PLACED", "PREPARING", "ACTION_REQUIRED", "READY", "COLLECTED"].includes(order.state) && (
        <>
          <section className={`card pickup ${order.state === "READY" ? "pickup-ready" : ""}`} aria-live="polite">
            <span className="pickup-label">{order.state === "READY" ? "Ready! Show this at the counter" : "Your pickup number"}</span>
            <span className="pickup-code">{order.pickupCode}</span>
            <ol className="steps">
              {STEPS.map((s, i) => {
                const current = order.state === "ACTION_REQUIRED" ? 0 : STEPS.findIndex((x) => x.state === order.state);
                return (
                  <li key={s.state} className={i < current ? "done" : i === current ? "now" : ""}>
                    {s.label}
                  </li>
                );
              })}
            </ol>
          </section>
          {order.state === "ACTION_REQUIRED" && <AdjustmentPanel order={order} token={token} onChange={setOrder} />}
        </>
      )}

      <section className="card">
        <h2>Items</h2>
        <ul className="order-lines">
          {order.lines
            .filter((l) => l.status !== "PENDING_TOPUP")
            .map((l) => (
              <li key={l.id} className={`line-${l.status.toLowerCase()}`}>
                <span>
                  {l.quantity} × {l.name}
                  {l.modifiers.length > 0 && <small>{l.modifiers.map((m) => m.name).join(" · ")}</small>}
                  {l.status === "UNAVAILABLE" && <em>Ran out</em>}
                  {l.status === "REMOVED" && <em>Removed</em>}
                  {l.status === "REPLACED" && <em>Swapped</em>}
                </span>
                <Rs paise={l.lineTotalPaise} />
              </li>
            ))}
        </ul>
        <div className="row total">
          <span>Total</span>
          <Rs paise={order.totalPaise} />
        </div>
        <div className="row small">
          <span>Paid</span>
          <Rs paise={order.paidPaise} />
        </div>
        {order.state !== "CANCELLED" && <RefundSummary order={order} />}
        {order.pickupCode && (
          <Link className="link-btn receipt-link" href={`/order/${token}/receipt`}>
            View receipt
          </Link>
        )}
      </section>
    </main>
  );
}

function RefundSummary({ order }: { order: OrderView }) {
  if (order.refunds.length === 0) return null;
  return (
    <ul className="refunds">
      {order.refunds.map((r) => (
        <li key={r.id}>
          <span>
            Refund · {r.reason}
            <small>{r.status === "PROCESSED" ? "Sent back to your payment method. Banks can take 5–7 working days." : r.status === "PENDING" ? "Processing" : "Failed. The café will contact you."}</small>
          </span>
          <Rs paise={r.amountPaise} />
        </li>
      ))}
    </ul>
  );
}

function readCheckout(token: string): CheckoutInfo | null {
  try {
    return JSON.parse(sessionStorage.getItem(`bh:checkout:${token}`) ?? "null");
  } catch {
    return null;
  }
}

function PaymentPanel({ order, token, initialPaymentId, onPaid }: { order: OrderView; token: string; initialPaymentId: string | null; onPaid: (o: OrderView) => void }) {
  const [checkout, setCheckout] = useState<CheckoutInfo | null>(() => {
    const c = readCheckout(token);
    return c && (!initialPaymentId || c.paymentId === initialPaymentId) ? c : null;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fresh = async () => {
    try {
      const c = await api.retryPayment(token);
      sessionStorage.setItem(`bh:checkout:${token}`, JSON.stringify(c));
      setCheckout(c);
      return c;
    } catch (e) {
      setError((e as ApiError).message);
      return null;
    }
  };

  useEffect(() => {
    if (!checkout) void fresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const simulate = async (outcome: "SUCCESS" | "FAILURE") => {
    if (!checkout) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.simulatePayment(checkout.paymentId, outcome);
      if (outcome === "FAILURE") {
        setError("The payment didn't go through. No money was taken. You can try again.");
        sessionStorage.removeItem(`bh:checkout:${token}`);
        setCheckout(null);
        await fresh();
      }
      onPaid(r.order);
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  const gateway = async () => {
    if (!checkout) return;
    setBusy(true);
    setError(null);
    try {
      await openGatewayCheckout(checkout, { name: order.outlet.cafeName, description: `Order at ${order.outlet.name}` });
      // The server confirms the payment from the gateway's webhook; the live status updates this page.
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card pay-panel">
      <h2>Complete your payment</h2>
      <p>
        <Rs paise={order.totalPaise} /> · your order goes to the kitchen the moment the payment is confirmed.
      </p>
      {error && <ErrorNote message={error} />}
      {!checkout ? (
        <Spinner label="Preparing payment" />
      ) : checkout.provider === "simulated" ? (
        <div className="demo-gateway">
          <span className="demo-badge">Demo payment</span>
          <p>No real money moves in the demo. Choose what happens:</p>
          <button className="btn btn-primary btn-block" onClick={() => simulate("SUCCESS")} disabled={busy}>
            Pay <Rs paise={checkout.amountPaise} /> (demo)
          </button>
          <button className="btn btn-ghost btn-block" onClick={() => simulate("FAILURE")} disabled={busy}>
            Simulate a failed payment
          </button>
        </div>
      ) : (
        <button className="btn btn-primary btn-block btn-lg" onClick={gateway} disabled={busy}>
          Pay <Rs paise={checkout.amountPaise} />
        </button>
      )}
    </section>
  );
}

function AdjustmentPanel({ order, token, onChange }: { order: OrderView; token: string; onChange: (o: OrderView) => void }) {
  const now = useNow();
  const { menu } = useMenu(order.outlet.tenantSlug, order.outlet.slug);
  const [picking, setPicking] = useState<string | null>(null);
  const [sheet, setSheet] = useState<{ adjId: string; item: MenuItemDto; category: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = order.adjustments.filter((a) => a.status !== "RESOLVED");
  const run = async (fn: () => Promise<OrderView>) => {
    setBusy(true);
    setError(null);
    try {
      onChange(await fn());
      setPicking(null);
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card adjust" aria-live="assertive">
      <h2>We need your choice</h2>
      {error && <ErrorNote message={error} />}
      {open.map((a) => {
        const line = order.lines.find((l) => l.id === a.lineId)!;
        const secondsLeft = Math.max(0, Math.round((Date.parse(a.expiresAt) - now) / 1000));
        const timer = `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}`;
        if (a.status === "AWAITING_TOPUP" && a.topUpCheckout) {
          return (
            <div key={a.id} className="adjust-item">
              <p>
                Your swap costs <Rs paise={a.topUpPaise} /> more. Pay the difference to confirm it.
              </p>
              <TopUp checkout={a.topUpCheckout} onDone={onChange} cafeName={order.outlet.cafeName} />
              <p className="fine">If it isn't paid in {timer}, we'll remove the item and refund it.</p>
            </div>
          );
        }
        const candidates = (menu?.categories ?? []).map((c) => ({ ...c, items: c.items.filter((i) => i.available && i.id !== line.itemId) })).filter((c) => c.items.length);
        return (
          <div key={a.id} className="adjust-item">
            <p>
              Sorry, <strong>{line.name}</strong> just ran out{a.note ? ` (${a.note})` : ""}. What would you like to do?
            </p>
            {picking === a.id ? (
              <div className="swap-picker">
                {candidates.map((c) => (
                  <div key={c.id}>
                    <h3>{c.name}</h3>
                    {c.items.map((i) => (
                      <button key={i.id} className="swap-option" onClick={() => setSheet({ adjId: a.id, item: i, category: c.name })} disabled={busy}>
                        <span>{i.name}</span>
                        <Rs paise={i.pricePaise} />
                      </button>
                    ))}
                  </div>
                ))}
                <button className="btn btn-ghost" onClick={() => setPicking(null)}>
                  Back
                </button>
              </div>
            ) : (
              <div className="adjust-actions">
                <button className="btn btn-primary" onClick={() => setPicking(a.id)} disabled={busy}>
                  Swap for something else
                </button>
                <button className="btn btn-ghost" onClick={() => run(() => api.resolve(token, a.id, { kind: "REMOVE" }))} disabled={busy}>
                  Remove it · refund <Rs paise={line.lineTotalPaise} />
                </button>
                <button className="btn btn-danger-ghost" onClick={() => run(() => api.resolve(token, a.id, { kind: "CANCEL_ORDER" }))} disabled={busy}>
                  Cancel the whole order (full refund)
                </button>
              </div>
            )}
            <p className="fine">If we don't hear from you in {timer}, we'll remove this item and refund it.</p>
          </div>
        );
      })}
      {sheet && (
        <ItemSheet
          item={sheet.item}
          category={sheet.category}
          confirmLabel="Swap"
          onClose={() => setSheet(null)}
          onConfirm={(modifierIds, quantity, note) =>
            void run(() => api.resolve(token, sheet.adjId, { kind: "REPLACE", replacement: { itemId: sheet.item.id, quantity, modifierIds, ...(note ? { note } : {}) } }))
          }
        />
      )}
    </section>
  );
}

function TopUp({ checkout, onDone, cafeName }: { checkout: CheckoutInfo; onDone: (o: OrderView) => void; cafeName: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pay = async () => {
    setBusy(true);
    setError(null);
    try {
      if (checkout.provider === "simulated") onDone((await api.simulatePayment(checkout.paymentId, "SUCCESS")).order);
      else await openGatewayCheckout(checkout, { name: cafeName, description: "Difference for your swap" });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {error && <ErrorNote message={error} />}
      <button className="btn btn-primary btn-block" onClick={pay} disabled={busy}>
        Pay <Rs paise={checkout.amountPaise} />
        {checkout.provider === "simulated" ? " (demo)" : ""}
      </button>
    </>
  );
}
