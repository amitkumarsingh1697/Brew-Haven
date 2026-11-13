import { useDialog } from "@brew-haven/ui-react";
import { useEffect, useMemo, useState } from "react";
import type { DaySummary, MenuItemDto, MenuResponse, OrderView, StaffRole } from "@brew-haven/contracts";
import { billTotals, formatInr } from "@brew-haven/domain";
import QRCode from "qrcode";
import { IngredientStockPanel } from "./Inventory";
import { ApiError, api, type DayClose, type StockRow } from "./api";
import { ReceiptModal } from "./ReceiptModal";
import { OrderCard } from "./OrderCard";
import { discard, dismissNote, enqueue, isOffline, newClientRef, retry, useCounterQueue } from "./counterQueue";

type Live = { orders: OrderView[]; upsert: (o: OrderView) => void };

const COLUMNS: Array<{ state: OrderView["state"]; title: string }> = [
  { state: "PLACED", title: "New" },
  { state: "PREPARING", title: "Preparing" },
  { state: "ACTION_REQUIRED", title: "Waiting on customer" },
  { state: "READY", title: "Ready for pickup" },
];

const byPlaced = (a: OrderView, b: OrderView) => Date.parse(a.placedAt ?? a.createdAt) - Date.parse(b.placedAt ?? b.createdAt);

export function Board({ live, role, now }: { live: Live; role: StaffRole; now: number }) {
  return (
    <div className="board">
      {COLUMNS.map((c) => {
        const list = live.orders.filter((o) => o.state === c.state).sort(byPlaced);
        return (
          <section key={c.state} className={`col col-${c.state.toLowerCase()}`} aria-label={c.title}>
            <h2>
              {c.title} <span className="count">{list.length}</span>
            </h2>
            {list.length === 0 && <p className="muted empty-col">Nothing here</p>}
            {list.map((o) => (
              <OrderCard key={o.id} order={o} role={role} now={now} onChange={live.upsert} />
            ))}
          </section>
        );
      })}
    </div>
  );
}


/** Kitchen display: big tickets, oldest first, optionally filtered to one station. */
export function Kitchen({ live, role, now, menu, stations }: { live: Live; role: StaffRole; now: number; menu: MenuResponse | null; stations: Array<{ key: string; name: string }> }) {
  const STATIONS = [{ key: "", name: "Everything" }, ...stations];
  const [stored, setStation] = useState(() => {
    try {
      return localStorage.getItem("bh:station") ?? "";
    } catch {
      return "";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("bh:station", stored);
    } catch {
      /* ignore */
    }
  }, [stored]);
  const station = STATIONS.some((s) => s.key === stored) ? stored : "";
  const stationOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of menu?.categories ?? []) for (const i of c.items) m.set(i.id, i.stationKey);
    return m;
  }, [menu]);
  const tickets = live.orders
    .filter((o) => o.state === "PLACED" || o.state === "PREPARING")
    .map((o) => (station ? { ...o, lines: o.lines.filter((l) => stationOf.get(l.itemId) === station) } : o))
    .filter((o) => o.lines.some((l) => l.status === "ACTIVE" || l.status === "UNAVAILABLE"))
    .sort(byPlaced);
  return (
    <div>
      <div className="station-bar" role="tablist" aria-label="Station">
        {STATIONS.map((s) => (
          <button key={s.key} role="tab" aria-selected={station === s.key} className={station === s.key ? "chip chip-on" : "chip"} onClick={() => setStation(s.key)}>
            {s.name}
          </button>
        ))}
      </div>
      {tickets.length === 0 ? (
        <p className="muted big-empty">No tickets. New paid orders appear here instantly.</p>
      ) : (
        <div className="kds">
          {tickets.map((o) => (
            <OrderCard key={o.id} order={o} role={role} now={now} big onChange={live.upsert} />
          ))}
        </div>
      )}
    </div>
  );
}

type PosLine = { key: string; item: MenuItemDto; modifierIds: string[]; quantity: number; unit: number; label: string };
type CounterMethod = "CASH" | "CARD_COUNTER" | "UPI_COUNTER";
/** Extra details the cashier types when marking an order paid. */
type PaidDetails = { tenderedPaise?: number; cardReference?: string; upiReference?: string };

const PAY_LABEL: Record<CounterMethod, string> = { CASH: "Cash", CARD_COUNTER: "Card machine", UPI_COUNTER: "Café's own UPI QR" };

/** Subtotal, GST, round-off and total, as the receipt will show them. */
function BillLines({ subtotalPaise, menu }: { subtotalPaise: number; menu: MenuResponse }) {
  const bill = billTotals(subtotalPaise, menu.tenant.taxRateBps, menu.tenant.pricesIncludeTax);
  const pct = `${menu.tenant.taxRateBps / 100}%`;
  return (
    <div className="bill-lines">
      {!menu.tenant.pricesIncludeTax && (
        <>
          <div>
            <span>Subtotal</span>
            <span>{formatInr(bill.subtotalPaise)}</span>
          </div>
          <div>
            <span>GST {pct} (CGST + SGST)</span>
            <span>{formatInr(bill.taxPaise)}</span>
          </div>
          {bill.roundOffPaise !== 0 && (
            <div className="muted">
              <span>Round-off</span>
              <span>
                {bill.roundOffPaise < 0 ? "−" : "+"}
                {formatInr(Math.abs(bill.roundOffPaise))}
              </span>
            </div>
          )}
        </>
      )}
      <div className="pos-total">
        <span>Total</span>
        <strong>{formatInr(bill.totalPaise)}</strong>
      </div>
      {menu.tenant.pricesIncludeTax && bill.taxPaise > 0 && <p className="muted small">Includes GST {formatInr(bill.taxPaise)}</p>}
    </div>
  );
}

/**
 * Counter ordering (D-11, Point 5). Every order goes through the app. The cashier rings the order
 * up, then either takes the money (cash, card machine or the café's own UPI QR) and marks it paid,
 * or shows a QR code the customer scans to pay by UPI or card on their own phone. Nothing goes to
 * the kitchen until it is paid.
 */
export function NewOrder({ outletId, menu, onCreated, live }: { outletId: string; menu: MenuResponse | null; onCreated: (o: OrderView) => void; live: OrderView[] }) {
  const [lines, setLines] = useState<PosLine[]>([]);
  const [cat, setCat] = useState<string | null>(null);
  const [picking, setPicking] = useState<MenuItemDto | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string; orderId?: string } | null>(null);
  const [printing, setPrinting] = useState<string | null>(null);
  /** Taking money for the basket (one step: placed and paid together), or for an order already waiting. */
  const [paying, setPaying] = useState<{ method: CounterMethod; order?: OrderView } | null>(null);
  const [qr, setQr] = useState<{ orderId: string; payUrl: string } | null>(null);
  if (!menu) return <p className="muted">Loading menu…</p>;
  const active = menu.categories.find((c) => c.id === cat) ?? menu.categories[0]!;
  const subtotal = lines.reduce((s, l) => s + l.unit * l.quantity, 0);
  const total = lines.length ? billTotals(subtotal, menu.tenant.taxRateBps, menu.tenant.pricesIncludeTax).totalPaise : 0;
  const waiting = live.filter((o) => o.state === "AWAITING_PAYMENT" && o.channel === "COUNTER");

  const add = (item: MenuItemDto, modifierIds: string[]) => {
    const opts = item.modifierGroups.flatMap((g) => g.options).filter((o) => modifierIds.includes(o.id));
    const key = `${item.id}|${[...modifierIds].sort().join(",")}`;
    setLines((cur) => {
      const ex = cur.find((l) => l.key === key);
      if (ex) return cur.map((l) => (l.key === key ? { ...l, quantity: l.quantity + 1 } : l));
      return [...cur, { key, item, modifierIds, quantity: 1, unit: item.pricePaise + opts.reduce((s, o) => s + o.pricePaise, 0), label: opts.map((o) => o.name).join(" · ") }];
    });
  };
  const tap = (item: MenuItemDto) => {
    if (!item.available) return;
    if (item.modifierGroups.length === 0) add(item, []);
    else setPicking(item);
  };
  const clear = () => {
    setLines([]);
    setName("");
  };
  const basket = () => lines.map((l) => ({ itemId: l.item.id, quantity: l.quantity, modifierIds: l.modifierIds }));
  const done = (o: OrderView) => {
    onCreated(o);
    const how = o.payments[0];
    const change = how?.tenderedPaise != null ? ` · give back ${formatInr(Math.max(0, how.tenderedPaise - how.amountPaise))} change` : "";
    setMsg({ kind: "ok", text: `Order ${o.pickupCode} placed and paid (${formatInr(o.paidPaise)}), sent to the kitchen${change}`, orderId: o.id });
  };

  /** Basket paid at the till: one step, and it still works offline (queued on this till). */
  const chargeBasket = async (method: CounterMethod, details: PaidDetails) => {
    const body = {
      outletId,
      method,
      lines: basket(),
      ...(name.trim() ? { customer: { name: name.trim() } } : {}),
      ...details,
    };
    const clientRef = newClientRef();
    try {
      const o = await api.walkIn({ ...body, clientRef });
      clear();
      done(o);
    } catch (e) {
      if (!isOffline(e)) throw e;
      const summary = lines.map((l) => `${l.quantity}× ${l.item.name}${l.label ? ` (${l.label})` : ""}`).join(", ");
      const q = enqueue({ clientRef, outletName: menu.outlet.name, body, totalPaise: total, summary });
      clear();
      setMsg({ kind: "ok", text: `No connection. Saved as ${q.ticket} (${formatInr(total)}). Tell the kitchen: ${summary}. It will be sent as soon as the connection is back.` });
    }
  };

  /** Basket paid on the customer's phone: place it now, show the QR, and wait for the gateway. */
  const startQr = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.counterOrder({ outletId, lines: basket(), ...(name.trim() ? { customer: { name: name.trim() } } : {}), clientRef: newClientRef() });
      onCreated(r.order);
      clear();
      setQr({ orderId: r.order.id, payUrl: r.payUrl });
    } catch (e) {
      setMsg({ kind: "err", text: isOffline(e) ? "Paying by QR needs an internet connection. Take cash or use the card machine instead." : (e as ApiError).message });
    } finally {
      setBusy(false);
    }
  };

  const showQr = async (o: OrderView) => {
    try {
      const link = await api.payLink(o.id);
      setQr({ orderId: o.id, payUrl: link.payUrl });
    } catch (e) {
      setMsg({ kind: "err", text: (e as ApiError).message });
    }
  };
  const cancelUnpaid = async (o: OrderView) => {
    const reason = window.prompt("Why is this order being cancelled?", "Customer left without paying");
    if (!reason?.trim()) return;
    try {
      onCreated(await api.voidUnpaid(o.id, reason.trim()));
      setQr(null);
      setMsg({ kind: "ok", text: "Unpaid order cancelled. Nothing was charged." });
    } catch (e) {
      setMsg({ kind: "err", text: (e as ApiError).message });
    }
  };

  return (
    <div className="pos">
      <div className="pos-menu">
        <div className="station-bar">
          {menu.categories.map((c) => (
            <button key={c.id} className={c.id === active.id ? "chip chip-on" : "chip"} onClick={() => setCat(c.id)}>
              {c.name}
            </button>
          ))}
        </div>
        <div className="pos-grid">
          {active.items.map((i) => (
            <button key={i.id} className="pos-item" disabled={!i.available} onClick={() => tap(i)}>
              <strong>{i.name}</strong>
              <span>{i.available ? formatInr(i.pricePaise) : "Sold out"}</span>
            </button>
          ))}
        </div>
        {!menu.tenant.pricesIncludeTax && <p className="muted small">Prices are before GST. GST is added on the whole bill.</p>}
      </div>
      <aside className="pos-cart">
        <h2>Counter order</h2>
        {lines.length === 0 && <p className="muted">Tap items to add them.</p>}
        <ul>
          {lines.map((l) => (
            <li key={l.key}>
              <span>
                {l.item.name}
                {l.label && <small>{l.label}</small>}
              </span>
              <span className="qty">
                <button aria-label="Less" onClick={() => setLines((cur) => cur.flatMap((x) => (x.key !== l.key ? [x] : x.quantity > 1 ? [{ ...x, quantity: x.quantity - 1 }] : [])))}>
                  −
                </button>
                {l.quantity}
                <button aria-label="More" onClick={() => setLines((cur) => cur.map((x) => (x.key === l.key ? { ...x, quantity: Math.min(20, x.quantity + 1) } : x)))}>
                  +
                </button>
              </span>
              <span>{formatInr(l.unit * l.quantity)}</span>
            </li>
          ))}
        </ul>
        <input aria-label="Customer name" placeholder="Customer name (optional)" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        {lines.length > 0 && <BillLines subtotalPaise={subtotal} menu={menu} />}
        <div className="pay-methods">
          <button className="btn btn-primary" disabled={busy || !lines.length} onClick={() => setPaying({ method: "CASH" })}>
            Cash
          </button>
          <button className="btn btn-primary" disabled={busy || !lines.length} onClick={() => setPaying({ method: "CARD_COUNTER" })}>
            Card machine
          </button>
          <button className="btn btn-primary" disabled={busy || !lines.length} onClick={() => void startQr()}>
            Scan to pay
          </button>
        </div>
        <p className="muted small">
          <strong>Cash or card machine:</strong> take the money, then mark it paid. <strong>Scan to pay:</strong> the customer scans the QR and pays by UPI or card on their phone; the order goes to the kitchen when the payment is confirmed.{" "}
          <button className="link-btn" disabled={busy || !lines.length} onClick={() => setPaying({ method: "UPI_COUNTER" })}>
            Paid to the café's own UPI QR?
          </button>
        </p>
        {waiting.length > 0 && (
          <section className="awaiting" aria-label="Waiting for payment">
            <h3 className="small">Waiting for the customer to pay ({waiting.length})</h3>
            <ul>
              {waiting.map((o) => (
                <li key={o.id}>
                  <span>
                    <strong>{formatInr(o.totalPaise)}</strong> · {o.lines.map((l) => `${l.quantity}× ${l.name}`).join(", ")}
                    {o.customerName ? ` · ${o.customerName}` : ""}
                  </span>
                  <span className="row-actions">
                    <button className="link-btn" onClick={() => void showQr(o)}>
                      Show QR
                    </button>
                    <button className="link-btn" onClick={() => setPaying({ method: "CASH", order: o })}>
                      Mark paid
                    </button>
                    <button className="link-btn danger" onClick={() => void cancelUnpaid(o)}>
                      Cancel
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
        <OfflineQueue onPrint={setPrinting} />
        {msg && (
          <p className={msg.kind === "ok" ? "ok" : "error"} role="status">
            {msg.text}
            {msg.orderId && (
              <>
                {" "}
                <button className="link-btn" onClick={() => setPrinting(msg.orderId!)}>
                  Print receipt
                </button>
              </>
            )}
          </p>
        )}
      </aside>
      {printing && <ReceiptModal orderId={printing} autoPrint onClose={() => setPrinting(null)} />}
      {picking && <ModifierPicker item={picking} onClose={() => setPicking(null)} onAdd={(ids) => (add(picking, ids), setPicking(null))} />}
      {paying && (
        <MarkPaidModal
          method={paying.method}
          totalPaise={paying.order ? paying.order.totalPaise : total}
          onMethod={(method) => setPaying({ ...paying, method })}
          onClose={() => setPaying(null)}
          onConfirm={async (details) => {
            if (paying.order) {
              const o = await api.markPaid(paying.order.id, { method: paying.method, ...details });
              setQr(null);
              done(o);
            } else {
              await chargeBasket(paying.method, details);
            }
            setPaying(null);
          }}
        />
      )}
      {qr && (
        <QrPayModal
          payUrl={qr.payUrl}
          order={live.find((o) => o.id === qr.orderId) ?? null}
          onClose={() => setQr(null)}
          onPrint={(id) => setPrinting(id)}
          onPaidOtherWay={(o) => (setQr(null), setPaying({ method: "CASH", order: o }))}
          onCancel={(o) => void cancelUnpaid(o)}
        />
      )}
    </div>
  );
}

/** Take the money at the till, then confirm: cash (with change), card machine, or the café's own UPI QR. */
function MarkPaidModal({
  method,
  totalPaise,
  onMethod,
  onClose,
  onConfirm,
}: {
  method: CounterMethod;
  totalPaise: number;
  onMethod: (m: CounterMethod) => void;
  onClose: () => void;
  onConfirm: (d: PaidDetails) => Promise<void>;
}) {
  const dialogRef = useDialog<HTMLDivElement>(onClose);
  const [cash, setCash] = useState("");
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tendered = cash.trim() ? Math.round(Number(cash) * 100) : null;
  const short = method === "CASH" && tendered !== null && (!Number.isFinite(tendered) || tendered < totalPaise);
  // Notes a customer is likely to hand over for this bill.
  const quick = [...new Set([totalPaise, ...[10_000, 20_000, 50_000, 200_000].filter((n) => n > totalPaise), Math.ceil(totalPaise / 5_000) * 5_000])].sort((a, b) => a - b).slice(0, 5);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const details: PaidDetails =
        method === "CASH"
          ? tendered !== null
            ? { tenderedPaise: tendered }
            : {}
          : method === "CARD_COUNTER"
            ? ref.trim()
              ? { cardReference: ref.trim() }
              : {}
            : ref.trim()
              ? { upiReference: ref.trim() }
              : {};
      await onConfirm(details);
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div ref={dialogRef} className="modal pay-modal" role="dialog" aria-modal="true" aria-label="Mark paid" onClick={(e) => e.stopPropagation()}>
        <h2>
          Take {formatInr(totalPaise)}
        </h2>
        <div className="station-bar" role="tablist" aria-label="How the customer paid">
          {(Object.keys(PAY_LABEL) as CounterMethod[]).map((m) => (
            <button key={m} role="tab" aria-selected={m === method} className={m === method ? "chip chip-on" : "chip"} onClick={() => (setRef(""), onMethod(m))}>
              {PAY_LABEL[m]}
            </button>
          ))}
        </div>
        {method === "CASH" && (
          <>
            <label>
              Cash received (₹)
              <input autoFocus inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value.replace(/[^\d.]/g, ""))} placeholder={(totalPaise / 100).toString()} />
            </label>
            <div className="opt-row">
              {quick.map((q) => (
                <button key={q} className="chip" onClick={() => setCash(String(q / 100))}>
                  {q === totalPaise ? "Exact" : formatInr(q)}
                </button>
              ))}
            </div>
            {tendered !== null && !short && (
              <p className="change-due">
                Give back <strong>{formatInr(tendered - totalPaise)}</strong>
              </p>
            )}
            {short && <p className="error">That's less than the bill.</p>}
          </>
        )}
        {method === "CARD_COUNTER" && (
          <label>
            Approval code or last 4 digits (optional)
            <input autoFocus value={ref} onChange={(e) => setRef(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12))} autoComplete="off" />
          </label>
        )}
        {method === "UPI_COUNTER" && (
          <label>
            UPI reference (UTR), 12 digits
            <input autoFocus inputMode="numeric" value={ref} onChange={(e) => setRef(e.target.value.replace(/\D/g, "").slice(0, 12))} autoComplete="off" />
            <small className="muted">Check the customer's payment screen shows {formatInr(totalPaise)} paid to the café.</small>
          </label>
        )}
        {error && <p className="error">{error}</p>}
        <button className="btn btn-primary btn-lg" disabled={busy || short} onClick={() => void submit()}>
          Mark paid · send to kitchen
        </button>
        <button className="btn btn-ghost" onClick={onClose}>
          Back
        </button>
      </div>
    </div>
  );
}

/** The QR the customer scans to pay on their phone. Closes itself into a "paid" note when the gateway confirms. */
function QrPayModal({
  payUrl,
  order,
  onClose,
  onPrint,
  onPaidOtherWay,
  onCancel,
}: {
  payUrl: string;
  order: OrderView | null;
  onClose: () => void;
  onPrint: (orderId: string) => void;
  onPaidOtherWay: (o: OrderView) => void;
  onCancel: (o: OrderView) => void;
}) {
  const dialogRef = useDialog<HTMLDivElement>(onClose);
  const [svg, setSvg] = useState("");
  useEffect(() => {
    void QRCode.toString(payUrl, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#120D0A", light: "#FFFFFF" } }).then(setSvg);
  }, [payUrl]);
  const paid = order && order.state !== "AWAITING_PAYMENT";
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div ref={dialogRef} className="modal qr-pay" role="dialog" aria-modal="true" aria-label="Scan to pay" onClick={(e) => e.stopPropagation()}>
        {!order ? (
          <>
            <h2>This order is no longer waiting</h2>
            <p className="muted">It was paid, cancelled or ran out of time. Check the orders board.</p>
          </>
        ) : paid ? (
          <>
            <h2>Paid ✓</h2>
            <p className="ok">
              Order <strong>{order.pickupCode}</strong> is paid ({formatInr(order.paidPaise)}
              {order.payments[0]?.instrument ? ` by ${order.payments[0].instrument === "upi" ? "UPI" : order.payments[0].instrument}` : ""}) and has gone to the kitchen.
            </p>
            <button className="btn btn-primary" onClick={() => onPrint(order.id)}>
              Print receipt
            </button>
          </>
        ) : (
          <>
            <h2>Scan to pay {formatInr(order.totalPaise)}</h2>
            <div className="qr-box" aria-label="Payment QR code" dangerouslySetInnerHTML={{ __html: svg }} />
            <p className="muted small">Pay by any UPI app or a debit or credit card. This screen updates as soon as the payment is confirmed. The order lapses after 20 minutes if it isn't paid.</p>
            <p className="waiting-pulse" role="status">
              Waiting for payment…
            </p>
            <div className="row-actions">
              <button className="btn btn-ghost" onClick={() => onPaidOtherWay(order)}>
                Customer paid another way
              </button>
              <button className="btn btn-ghost danger" onClick={() => onCancel(order)}>
                Cancel order
              </button>
            </div>
          </>
        )}
        <button className="btn btn-ghost" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

/** Counter orders saved while offline: waiting, failed (with what to do), and what they became once sent. */
function OfflineQueue({ onPrint }: { onPrint: (orderId: string) => void }) {
  const { queue, sent } = useCounterQueue();
  if (!queue.length && !sent.length) return null;
  return (
    <section className="offline-queue" aria-label="Orders saved offline">
      {queue.length > 0 && (
        <>
          <h3 className="small">Saved offline, not sent yet ({queue.length})</h3>
          <ul>
            {queue.map((q) => (
              <li key={q.clientRef} className={q.status === "failed" ? "failed" : undefined}>
                <strong>{q.ticket}</strong> {formatInr(q.totalPaise)} · {q.summary}
                {q.status === "failed" ? (
                  <div className="error small">
                    Not accepted: {q.error}{" "}
                    <button className="link-btn" onClick={() => retry(q.clientRef)}>
                      Try again
                    </button>{" "}
                    <button className="link-btn" onClick={() => window.confirm(`Remove ${q.ticket}? Only do this if you've refunded the customer or entered it again.`) && discard(q.clientRef)}>
                      Remove
                    </button>
                  </div>
                ) : (
                  <span className="muted small"> · waiting for connection</span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {sent.length > 0 && (
        <>
          <h3 className="small">Sent after being offline</h3>
          <ul>
            {sent.map((s) => (
              <li key={s.clientRef}>
                {s.ticket} is order <strong>{s.pickupCode}</strong>
                {s.recordedPaise !== undefined && (
                  <span className="warn small">
                    {" "}
                    · price changed: you took {formatInr(s.takenPaise ?? 0)}, recorded {formatInr(s.recordedPaise)}. Check the drawer.
                  </span>
                )}{" "}
                <button className="link-btn" onClick={() => onPrint(s.orderId)}>
                  Receipt
                </button>{" "}
                <button className="link-btn" onClick={() => dismissNote(s.clientRef)} aria-label={`Dismiss ${s.ticket}`}>
                  Dismiss
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function ModifierPicker({ item, onClose, onAdd }: { item: MenuItemDto; onClose: () => void; onAdd: (ids: string[]) => void }) {
  const [chosen, setChosen] = useState<Record<string, string[]>>(() => Object.fromEntries(item.modifierGroups.map((g) => [g.id, g.minSelect > 0 ? [g.options[0]!.id] : []])));
  const dialogRef = useDialog<HTMLDivElement>(onClose);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div ref={dialogRef} className="modal" role="dialog" aria-modal="true" aria-label={item.name} onClick={(e) => e.stopPropagation()}>
        <h2>{item.name}</h2>
        {item.modifierGroups.map((g) => (
          <fieldset key={g.id}>
            <legend>{g.name}</legend>
            <div className="opt-row">
              {g.options.map((o) => {
                const on = chosen[g.id]?.includes(o.id);
                return (
                  <button
                    key={o.id}
                    className={on ? "chip chip-on" : "chip"}
                    onClick={() =>
                      setChosen((c) => {
                        const cur = c[g.id] ?? [];
                        if (g.maxSelect === 1) return { ...c, [g.id]: [o.id] };
                        return { ...c, [g.id]: cur.includes(o.id) ? cur.filter((x) => x !== o.id) : cur.length < g.maxSelect ? [...cur, o.id] : cur };
                      })
                    }
                  >
                    {o.name}
                    {o.pricePaise > 0 && ` +${formatInr(o.pricePaise).replace(".00", "")}`}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ))}
        <div className="row-btns">
          <button className="btn btn-primary" onClick={() => onAdd(Object.values(chosen).flat())}>
            Add
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export function Stock({ outletId, role }: { outletId: string; role: StaffRole }) {
  const [rows, setRows] = useState<StockRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.stock(outletId).then(setRows).catch((e: ApiError) => setError(e.message));
  }, [outletId]);
  const update = async (row: StockRow, patch: Partial<StockRow>) => {
    const next = { ...row, ...patch };
    setRows((cur) => cur?.map((r) => (r.itemId === row.itemId ? next : r)) ?? null);
    try {
      await api.setStock({ outletId, itemId: row.itemId, available: next.available, ...(role !== "KITCHEN" && "stockCount" in patch ? { stockCount: next.stockCount } : {}) });
    } catch (e) {
      setError((e as ApiError).message);
      setRows((cur) => cur?.map((r) => (r.itemId === row.itemId ? row : r)) ?? null);
    }
  };
  if (!rows) return <p className="muted">{error ?? "Loading…"}</p>;
  return (
    <div className="stock">
      {error && <p className="error">{error}</p>}
      <p className="muted">Sold-out items disappear from ordering at this café straight away. Leave the count empty if you don't count an item.</p>
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th>On sale</th>
            {role !== "KITCHEN" && <th>Count left</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.itemId} className={r.available ? "" : "off"}>
              <td>{r.name}</td>
              <td>
                <button className={r.available ? "toggle on" : "toggle"} role="switch" aria-checked={r.available} onClick={() => update(r, { available: !r.available })}>
                  {r.available ? "Available" : "Sold out"}
                </button>
              </td>
              {role !== "KITCHEN" && (
                <td>
                  <input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    placeholder="—"
                    defaultValue={r.stockCount ?? ""}
                    aria-label={`Count left for ${r.name}`}
                    onBlur={(e) => {
                      const v = e.target.value === "" ? null : Math.max(0, Math.floor(Number(e.target.value)));
                      if (v !== r.stockCount) void update(r, { stockCount: v, available: v === null ? r.available : v > 0 });
                    }}
                  />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <IngredientStockPanel outletId={outletId} role={role} />
    </div>
  );
}

const METHOD_LABEL: Record<string, string> = { ONLINE: "Online (pay-now)", CASH: "Cash", UPI_COUNTER: "UPI at counter", CARD_COUNTER: "Card at counter" };

export function Today({ outletId }: { outletId: string }) {
  const [s, setS] = useState<DaySummary | null>(null);
  const [orders, setOrders] = useState<OrderView[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.summary(outletId).then(setS).catch((e: ApiError) => setError(e.message));
    api.orders(outletId, "today").then(setOrders).catch(() => undefined);
  }, [outletId]);
  if (error) return <p className="error">{error}</p>;
  if (!s) return <p className="muted">Loading…</p>;
  const manualRefunds = orders.flatMap((o) => o.refunds.map((r) => ({ ...r, code: o.pickupCode, channel: o.channel }))).filter((r) => r.channel === "COUNTER");
  return (
    <div className="today">
      <div className="stats">
        <div>
          <span>Orders</span>
          <strong>{s.orders.total}</strong>
          <small>
            {s.orders.collected} collected · {s.orders.open} open · {s.orders.cancelled} cancelled
          </small>
        </div>
        <div>
          <span>Taken</span>
          <strong>{formatInr(s.capturedPaise)}</strong>
        </div>
        <div>
          <span>Refunded</span>
          <strong>{formatInr(s.refundedPaise)}</strong>
        </div>
        <div className="net">
          <span>Net</span>
          <strong>{formatInr(s.netPaise)}</strong>
        </div>
      </div>
      <CloseDay outletId={outletId} />
      <h2>By payment method</h2>
      <table>
        <tbody>
          {Object.entries(s.capturedByMethod).map(([m, v]) => (
            <tr key={m}>
              <td>{METHOD_LABEL[m] ?? m}</td>
              <td className="num">{formatInr(v)}</td>
            </tr>
          ))}
          {Object.keys(s.capturedByMethod).length === 0 && (
            <tr>
              <td className="muted">No payments yet today</td>
            </tr>
          )}
        </tbody>
      </table>
      {manualRefunds.length > 0 && (
        <>
          <h2>Cash/counter refunds to hand back</h2>
          <table>
            <tbody>
              {manualRefunds.map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.code} · {r.reason}
                  </td>
                  <td className="num">{formatInr(r.amountPaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <h2>Today's orders</h2>
      <table>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id}>
              <td>{o.pickupCode ?? "—"}</td>
              <td>{o.customerName ?? "Walk-in"}</td>
              <td>{o.state.replace("_", " ").toLowerCase()}</td>
              <td className="num">{formatInr(o.paidPaise - o.refundedPaise)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const rupees = (s: string) => Math.round(Number(s.replace(/[^\d.]/g, "") || "0") * 100);

/** End-of-day cash count: what should be in the drawer vs what was counted. */
function CloseDay({ outletId }: { outletId: string }) {
  const [info, setInfo] = useState<Awaited<ReturnType<typeof api.closeInfo>> | null>(null);
  const [float, setFloat] = useState("");
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const load = () =>
    api.closeInfo(outletId).then((i) => {
      setInfo(i);
      if (i.close) setFloat(String(i.close.openingFloatPaise / 100));
    }, (e: ApiError) => setError(e.message));
  useEffect(() => void load(), [outletId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!info) return error ? <p className="error">{error}</p> : null;

  const expected = rupees(float) + info.cash.takenPaise - info.cash.refundedPaise;
  const variance = counted ? rupees(counted) - expected : null;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.closeDay({ outletId, openingFloatPaise: rupees(float), countedCashPaise: rupees(counted), ...(note.trim() ? { note: note.trim() } : {}) });
      setEditing(false);
      setCounted("");
      setNote("");
      await load();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  const c: DayClose | null = info.close;
  if (c && !editing)
    return (
      <section className="close-day done">
        <h2>Day closed</h2>
        <p>
          Closed by {c.closedBy} at {new Date(c.closedAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}. Counted {formatInr(c.countedCashPaise)} against{" "}
          {formatInr(c.expectedCashPaise)} expected: <Variance paise={c.variancePaise} />
        </p>
        {c.note && <p className="muted">Note: {c.note}</p>}
        <button className="btn btn-ghost" onClick={() => setEditing(true)}>
          Recount
        </button>
      </section>
    );
  return (
    <form className="close-day" onSubmit={submit}>
      <h2>Close the day</h2>
      {info.summary.orders.open > 0 && <p className="warn">{info.summary.orders.open} orders are still open. Finish or hand them over before closing if you can.</p>}
      <div className="close-grid">
        <label>
          Opening float (₹)
          <input inputMode="decimal" value={float} onChange={(e) => setFloat(e.target.value)} placeholder="e.g. 1000" required />
        </label>
        <div className="calc">
          <span>Cash taken</span>
          <b>+ {formatInr(info.cash.takenPaise)}</b>
          <span>Cash handed back</span>
          <b>− {formatInr(info.cash.refundedPaise)}</b>
          <span>Should be in the drawer</span>
          <b className="big">{formatInr(expected)}</b>
        </div>
        <label>
          Cash counted (₹)
          <input inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} placeholder="Count the drawer" required />
        </label>
        <div className="calc">{variance !== null && <Variance paise={variance} />}</div>
        <label className="span2">
          Note (optional)
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="e.g. ₹20 note taken out for milk" />
        </label>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="row-btns">
        <button className="btn btn-primary" disabled={busy || !float || !counted}>
          {busy ? "Saving…" : "Close the day"}
        </button>
        {editing && (
          <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function Variance({ paise }: { paise: number }) {
  if (paise === 0) return <span className="ok">cash matches</span>;
  return <span className={paise < 0 ? "error" : "warn"}>{paise < 0 ? `${formatInr(-paise)} short` : `${formatInr(paise)} over`}</span>;
}
