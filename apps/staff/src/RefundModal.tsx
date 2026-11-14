import { useEffect, useMemo, useState } from "react";
import type { OrderView, StaffRefundPreview } from "@brew-haven/contracts";
import { formatInr } from "@brew-haven/domain";
import { useDialog } from "@brew-haven/ui-react";
import { ApiError, api } from "./api";

const CATEGORIES: Array<[string, string]> = [
  ["WRONG_ITEM", "Wrong item or customisation"],
  ["QUALITY", "Quality complaint"],
  ["MISSING", "Item missing"],
  ["SAFETY", "Food safety (foreign object, allergen, veg/non-veg)"],
  ["GOODWILL", "Goodwill"],
  ["OTHER", "Other"],
];

/**
 * Refund policy K12-K14, C4, C5: refund some items, or the whole order, after it was served. The
 * money always goes back the way the customer paid. Over the café's limit, the owner enters their PIN.
 */
export function RefundModal({ order, onClose, onDone }: { order: OrderView; onClose: () => void; onDone: (o: OrderView) => void }) {
  const ref = useDialog<HTMLDivElement>(onClose);
  const lines = order.lines.filter((l) => l.status === "ACTIVE" || l.status === "UNAVAILABLE");
  const [qty, setQty] = useState<Record<string, number>>({});
  const [whole, setWhole] = useState(false);
  const [category, setCategory] = useState("WRONG_ITEM");
  const [note, setNote] = useState("");
  const [reference, setReference] = useState("");
  const [owners, setOwners] = useState<Array<{ id: string; name: string }>>([]);
  const [ownerId, setOwnerId] = useState("");
  const [pin, setPin] = useState("");
  const [preview, setPreview] = useState<StaffRefundPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsReference = order.payments.some((p) => p.method === "CARD_COUNTER" || p.method === "UPI_COUNTER");

  const body = useMemo(
    () => ({
      lines: whole ? [] : Object.entries(qty).filter(([, n]) => n > 0).map(([lineId, quantity]) => ({ lineId, quantity })),
      wholeOrder: whole,
      category: category as "WRONG_ITEM",
    }),
    [qty, whole, category],
  );
  const chosen = whole || body.lines.length > 0;

  useEffect(() => {
    if (!chosen) return setPreview(null);
    let live = true;
    api
      .refund(order.id, { ...body, preview: true })
      .then((r) => live && (setPreview(r.preview), setError(null)))
      .catch((e: ApiError) => live && (setPreview(null), setError(e.message)));
    return () => {
      live = false;
    };
  }, [order.id, body, chosen]);

  useEffect(() => {
    if (!preview?.needsApproval || owners.length) return;
    api.users().then((u) => {
      const admins = u.users.filter((x) => x.role === "ADMIN");
      setOwners(admins);
      setOwnerId(admins[0]?.id ?? "");
    }, () => undefined);
  }, [preview?.needsApproval, owners.length]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.refund(order.id, {
        ...body,
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(reference.trim() ? { reference: reference.trim() } : {}),
        ...(preview?.needsApproval ? { approver: { staffUserId: ownerId, pin } } : {}),
      });
      if (r.order) onDone(r.order);
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  const ready = chosen && preview && !busy && (!needsReference || reference.trim().length >= 3) && (!preview.needsApproval || (ownerId && /^\d{4,6}$/.test(pin)));
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div ref={ref} className="modal refund-modal" role="dialog" aria-modal="true" aria-label={`Refund order ${order.pickupCode}`} onClick={(e) => e.stopPropagation()}>
        <h2>Refund order {order.pickupCode}</h2>
        <fieldset>
          <legend>What to refund</legend>
          {lines.map((l) => (
            <label key={l.id} className="refund-line">
              <span>
                {l.name}
                {l.modifiers.length > 0 && <small> · {l.modifiers.map((m) => m.name).join(", ")}</small>}
              </span>
              <select disabled={whole} value={qty[l.id] ?? 0} onChange={(e) => setQty({ ...qty, [l.id]: Number(e.target.value) })} aria-label={`How many ${l.name}`}>
                {Array.from({ length: l.quantity + 1 }, (_, n) => (
                  <option key={n} value={n}>
                    {n === 0 ? "None" : `${n} of ${l.quantity}`}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <label className="check">
            <input type="checkbox" checked={whole} onChange={(e) => setWhole(e.target.checked)} /> Refund everything still paid ({formatInr(order.paidPaise - order.refundedPaise)})
          </label>
        </fieldset>
        <label>
          Reason
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          Details (optional)
          <input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Ordered oat milk, got dairy" />
        </label>
        {category === "SAFETY" && <p className="warn small">Tell the owner straight away, and keep the item if you can.</p>}
        {needsReference && (
          <label>
            Refund reference from the card machine or UPI app
            <input value={reference} maxLength={40} onChange={(e) => setReference(e.target.value)} placeholder="Do the refund on the machine first" />
          </label>
        )}
        {preview && (
          <p className="refund-total">
            Refund <strong>{formatInr(preview.amountPaise)}</strong> to {preview.toOriginalPayment}.{preview.creditNote && " A GST credit note will be issued."}
          </p>
        )}
        {preview?.needsApproval && (
          <fieldset>
            <legend>Over {formatInr(preview.limitPaise)}: the owner approves</legend>
            {owners.length > 1 && (
              <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} aria-label="Owner">
                {owners.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            )}
            <input type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} placeholder="Owner PIN" aria-label="Owner PIN" />
          </fieldset>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        <div className="row-btns">
          <button className="btn btn-danger" disabled={!ready} onClick={submit}>
            {busy ? "Refunding…" : preview ? `Refund ${formatInr(preview.amountPaise)}` : "Refund"}
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
