import { useEffect, useState } from "react";
import { Link } from "wouter";
import type { ReceiptView } from "@brew-haven/contracts";
import { Receipt } from "@brew-haven/ui-react";
import "@brew-haven/ui-react/receipt.css";
import { type ApiError, api } from "../api";
import { ErrorNote, Spinner } from "../components/ui";

/** The order's receipt, to keep, share or save as a PDF from the browser's print menu. */
export function ReceiptPage({ token }: { token: string }) {
  const [r, setR] = useState<ReceiptView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => {
    setError(null);
    api.receipt(token).then(setR, (e: ApiError) => setError(e.message));
  };
  useEffect(load, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <main className="page receipt-page">
      <header className="simple-header no-print">
        <Link href={`/order/${token}`} className="back" aria-label="Back to your order">
          ‹
        </Link>
        <h1>Receipt</h1>
      </header>
      {error && <ErrorNote message={error} onRetry={load} />}
      {!r && !error && <Spinner label="Getting your receipt" />}
      {r && (
        <>
          <div className="print-receipt">
            <Receipt r={r} />
          </div>
          <button className="btn btn-ghost btn-block no-print" onClick={() => window.print()}>
            Print or save as PDF
          </button>
        </>
      )}
    </main>
  );
}
