import { useDialog } from "@brew-haven/ui-react";
import { useEffect, useMemo, useState } from "react";
import type { DaySummary, MenuItemDto, MenuResponse, OrderView, StaffRole } from "@brew-haven/contracts";
import { formatInr } from "@brew-haven/domain";
import { ApiError, api, type DayClose, type StockRow } from "./api";
import { OrderCard } from "./OrderCard";

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

/** Counter ordering for walk-ins (D-11). */
export function NewOrder({ outletId, menu, onCreated }: { outletId: string; menu: MenuResponse | null; onCreated: (o: OrderView) => void }) {
  const [lines, setLines] = useState<PosLine[]>([]);
  const [cat, setCat] = useState<string | null>(null);
  const [picking, setPicking] = useState<MenuItemDto | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  if (!menu) return <p className="muted">Loading menu…</p>;
  const active = menu.categories.find((c) => c.id === cat) ?? menu.categories[0]!;
  const total = lines.reduce((s, l) => s + l.unit * l.quantity, 0);

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
  const charge = async (method: "CASH" | "UPI_COUNTER" | "CARD_COUNTER") => {
    setBusy(true);
    setMsg(null);
    try {
      const o = await api.walkIn({
        outletId,
        method,
        lines: lines.map((l) => ({ itemId: l.item.id, quantity: l.quantity, modifierIds: l.modifierIds })),
        ...(name.trim() ? { customer: { name: name.trim() } } : {}),
      });
      onCreated(o);
      setLines([]);
      setName("");
      setMsg({ kind: "ok", text: `Order ${o.pickupCode} sent to the kitchen · ${formatInr(o.paidPaise)} recorded` });
    } catch (e) {
      setMsg({ kind: "err", text: (e as ApiError).message });
    } finally {
      setBusy(false);
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
        <input placeholder="Customer name (optional)" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        <div className="pos-total">
          <span>Total</span>
          <strong>{formatInr(total)}</strong>
        </div>
        <div className="pay-methods">
          <button className="btn btn-primary" disabled={busy || !lines.length} onClick={() => charge("CASH")}>
            Cash
          </button>
          <button className="btn btn-primary" disabled={busy || !lines.length} onClick={() => charge("UPI_COUNTER")}>
            UPI
          </button>
          <button className="btn btn-primary" disabled={busy || !lines.length} onClick={() => charge("CARD_COUNTER")}>
            Card
          </button>
        </div>
        <p className="muted small">Take the payment first, then tap how the customer paid.</p>
        {msg && <p className={msg.kind === "ok" ? "ok" : "error"}>{msg.text}</p>}
      </aside>
      {picking && <ModifierPicker item={picking} onClose={() => setPicking(null)} onAdd={(ids) => (add(picking, ids), setPicking(null))} />}
    </div>
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
