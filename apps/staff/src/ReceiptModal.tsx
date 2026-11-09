import { useEffect, useState } from "react";
import type { ReceiptView } from "@brew-haven/contracts";
import { Receipt, useDialog } from "@brew-haven/ui-react";
import "@brew-haven/ui-react/receipt.css";
import { type ApiError, api } from "./api";

/** Shows an order's receipt with a Print button (80 mm thermal or A4, whatever the counter has). */
export function ReceiptModal({ orderId, onClose, autoPrint }: { orderId: string; onClose: () => void; autoPrint?: boolean }) {
  const [r, setR] = useState<ReceiptView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useDialog<HTMLDivElement>(onClose);
  useEffect(() => {
    api.receipt(orderId).then(
      (x) => {
        setR(x);
        if (autoPrint) window.setTimeout(() => window.print(), 150);
      },
      (e: ApiError) => setError(e.message),
    );
  }, [orderId, autoPrint]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div ref={ref} className="modal receipt-modal" role="dialog" aria-modal="true" aria-label="Receipt" onClick={(e) => e.stopPropagation()}>
        {error && <p className="error">{error}</p>}
        {!r && !error && <p className="muted">Loading receipt…</p>}
        {r && (
          <div className="print-receipt">
            <Receipt r={r} />
          </div>
        )}
        <div className="row-btns no-print">
          <button className="btn btn-primary" disabled={!r} onClick={() => window.print()}>
            Print
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
