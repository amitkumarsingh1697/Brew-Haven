import { useState } from "react";
import type { OrderView, StaffRole } from "@brew-haven/contracts";
import { formatInr } from "@brew-haven/domain";
import { ApiError, api } from "./api";
import { minutesSince } from "./live";
import { ReceiptModal } from "./ReceiptModal";

const can = {
  start: (r: StaffRole) => r === "KITCHEN" || r === "ADMIN",
  ready: (r: StaffRole) => r === "KITCHEN" || r === "ADMIN",
  handOver: (r: StaffRole) => r === "CASHIER" || r === "ADMIN",
  reject: (r: StaffRole) => r === "CASHIER" || r === "ADMIN",
};

export function OrderCard({
  order,
  role,
  now,
  onChange,
  big,
  stationFilter,
}: {
  order: OrderView;
  role: StaffRole;
  now: number;
  onChange: (o: OrderView) => void;
  big?: boolean;
  stationFilter?: string;
}) {
  const [mode, setMode] = useState<"none" | "reject" | "flag">("none");
  const [receipt, setReceipt] = useState(false);
  const [reason, setReason] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const age = minutesSince(order.placedAt, now);
  const lines = order.lines.filter((l) => l.status === "ACTIVE" || l.status === "UNAVAILABLE");

  const run = async (fn: () => Promise<OrderView>) => {
    setBusy(true);
    setError(null);
    try {
      onChange(await fn());
      setMode("none");
      setReason("");
      setPicked([]);
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className={`ticket state-${order.state.toLowerCase()} ${big ? "ticket-big" : ""} ${age >= 10 && order.state !== "READY" ? "late" : ""}`}>
      <header>
        <strong className="code">{order.pickupCode}</strong>
        <span className="who">
          {order.customerName ?? "Walk-in"} · {order.channel === "COUNTER" ? "Counter" : "Online"}
        </span>
        <span className="age" title="Minutes since paid">
          {age}m
        </span>
      </header>
      <ul>
        {lines.map((l) => (
          <li key={l.id} className={l.status === "UNAVAILABLE" ? "unavail" : ""}>
            {mode === "flag" && l.status === "ACTIVE" ? (
              <label>
                <input type="checkbox" checked={picked.includes(l.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, l.id] : picked.filter((x) => x !== l.id))} />
                <span>
                  {l.quantity} × {l.name}
                </span>
              </label>
            ) : (
              <span>
                <b>{l.quantity} ×</b> {l.name}
                {l.status === "UNAVAILABLE" && <em> · waiting on customer</em>}
              </span>
            )}
            {l.modifiers.length > 0 && <small>{l.modifiers.map((m) => m.name).join(" · ")}</small>}
            {l.note && <small className="note">“{l.note}”</small>}
          </li>
        ))}
      </ul>
      {stationFilter && <p className="muted">Showing {stationFilter} items</p>}
      {order.state === "ACTION_REQUIRED" && <p className="waiting">Customer is choosing a replacement, removal or refund.</p>}
      {error && <p className="error">{error}</p>}

      {mode === "reject" ? (
        <div className="inline-form">
          <input autoFocus placeholder="Reason the customer will see (e.g. Oven is down)" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
          <div className="row-btns">
            <button className="btn btn-danger" disabled={busy || reason.trim().length < 3} onClick={() => run(() => api.reject(order.id, reason.trim()))}>
              Reject & refund {formatInr(order.paidPaise - order.refundedPaise)}
            </button>
            <button className="btn btn-ghost" onClick={() => setMode("none")}>
              Back
            </button>
          </div>
        </div>
      ) : mode === "flag" ? (
        <div className="inline-form">
          <input placeholder="Note for the customer (optional)" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
          <div className="row-btns">
            <button className="btn btn-warn" disabled={busy || picked.length === 0} onClick={() => run(() => api.flag(order.id, picked, reason.trim()))}>
              Ask customer ({picked.length})
            </button>
            <button className="btn btn-ghost" onClick={() => (setMode("none"), setPicked([]))}>
              Back
            </button>
          </div>
        </div>
      ) : (
        <footer>
          {order.state === "PLACED" && can.start(role) && (
            <button className="btn btn-primary" disabled={busy} onClick={() => run(() => api.action(order.id, "START"))}>
              Start
            </button>
          )}
          {order.state === "PREPARING" && can.ready(role) && (
            <button className="btn btn-go" disabled={busy} onClick={() => run(() => api.action(order.id, "MARK_READY"))}>
              Ready
            </button>
          )}
          {order.state === "READY" && can.handOver(role) && (
            <button className="btn btn-go" disabled={busy} onClick={() => run(() => api.action(order.id, "HAND_OVER"))}>
              Handed over
            </button>
          )}
          {(order.state === "PLACED" || order.state === "PREPARING") && order.channel === "ONLINE" && (
            <button className="btn btn-ghost" disabled={busy} onClick={() => setMode("flag")}>
              Item ran out
            </button>
          )}
          {order.state !== "READY" && can.reject(role) && (
            <button className="btn btn-ghost-danger" disabled={busy} onClick={() => setMode("reject")}>
              Reject
            </button>
          )}
          {!big && can.handOver(role) && order.pickupCode && (
            <button className="btn btn-ghost" onClick={() => setReceipt(true)}>
              Receipt
            </button>
          )}
        </footer>
      )}
      {receipt && <ReceiptModal orderId={order.id} onClose={() => setReceipt(false)} />}
    </article>
  );
}
