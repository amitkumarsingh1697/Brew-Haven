import { formatInr } from "@brew-haven/domain";
import { useDialog } from "@brew-haven/ui-react";
import "@brew-haven/ui-react/receipt.css";

/** Brew Haven's invoice to a café for its plan, as the API returns it. */
export interface SubscriptionInvoice {
  id: string;
  number: string;
  issuedOn: string;
  kind: "TAX_INVOICE" | "INVOICE";
  plan: string;
  period: "MONTH" | "YEAR";
  periodFrom: string;
  periodTo: string;
  taxablePaise: number;
  taxRateBps: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
  seller: { legalName: string; gstin: string | null; address: string | null; email: string | null; stateCode: string | null };
  buyer: { name: string; legalName: string | null; gstin: string | null; address: string | null; email: string | null };
  payment: { method: string; reference: string | null; paidOn: string };
}

export const dayLabel = (day: string) => new Date(`${day}T12:00:00+05:30`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
const pct = (bps: number) => `${(bps / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}%`;

/** A printable A4 invoice. */
export function SubscriptionInvoiceSheet({ inv }: { inv: SubscriptionInvoice }) {
  return (
    <article className="sub-invoice" aria-label={`Invoice ${inv.number}`}>
      <header>
        <div>
          <h2>{inv.seller.legalName}</h2>
          {inv.seller.address && <p>{inv.seller.address}</p>}
          {inv.seller.gstin && <p>GSTIN {inv.seller.gstin}</p>}
          {inv.seller.email && <p>{inv.seller.email}</p>}
        </div>
        <div className="sub-invoice-title">
          <strong>{inv.kind === "TAX_INVOICE" ? "Tax invoice" : "Invoice"}</strong>
          <p>No. {inv.number}</p>
          <p>Date {dayLabel(inv.issuedOn)}</p>
        </div>
      </header>
      <section className="sub-invoice-to">
        <span className="muted small">Billed to</span>
        <strong>{inv.buyer.legalName ?? inv.buyer.name}</strong>
        {inv.buyer.legalName && inv.buyer.legalName !== inv.buyer.name && <span>{inv.buyer.name}</span>}
        {inv.buyer.address && <span>{inv.buyer.address}</span>}
        {inv.buyer.gstin && <span>GSTIN {inv.buyer.gstin}</span>}
      </section>
      <table>
        <thead>
          <tr>
            <th>Description</th>
            <th>SAC</th>
            <th className="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              Brew Haven {inv.plan} plan, {inv.period === "YEAR" ? "yearly" : "monthly"}
              <div className="muted small">
                {dayLabel(inv.periodFrom)} to {dayLabel(inv.periodTo)}
              </div>
            </td>
            <td>998314</td>
            <td className="num">{formatInr(inv.taxablePaise)}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2}>Taxable value</td>
            <td className="num">{formatInr(inv.taxablePaise)}</td>
          </tr>
          {inv.cgstPaise > 0 && (
            <tr>
              <td colSpan={2}>CGST {pct(inv.taxRateBps / 2)}</td>
              <td className="num">{formatInr(inv.cgstPaise)}</td>
            </tr>
          )}
          {inv.sgstPaise > 0 && (
            <tr>
              <td colSpan={2}>SGST {pct(inv.taxRateBps / 2)}</td>
              <td className="num">{formatInr(inv.sgstPaise)}</td>
            </tr>
          )}
          {inv.igstPaise > 0 && (
            <tr>
              <td colSpan={2}>IGST {pct(inv.taxRateBps)}</td>
              <td className="num">{formatInr(inv.igstPaise)}</td>
            </tr>
          )}
          <tr className="total">
            <td colSpan={2}>Total</td>
            <td className="num">{formatInr(inv.totalPaise)}</td>
          </tr>
        </tfoot>
      </table>
      <p className="small">
        Paid by {inv.payment.method} on {dayLabel(inv.payment.paidOn)}
        {inv.payment.reference ? ` (ref ${inv.payment.reference})` : ""}. Thank you.
      </p>
      {inv.kind === "INVOICE" && <p className="muted small">Not a tax invoice: no GST charged.</p>}
    </article>
  );
}

export function SubscriptionInvoiceModal({ inv, onClose }: { inv: SubscriptionInvoice; onClose: () => void }) {
  const ref = useDialog<HTMLDivElement>(onClose);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div ref={ref} className="modal sub-invoice-modal" role="dialog" aria-modal="true" aria-label={`Invoice ${inv.number}`} onClick={(e) => e.stopPropagation()}>
        <div className="print-receipt">
          <SubscriptionInvoiceSheet inv={inv} />
        </div>
        <div className="row-btns no-print">
          <button className="btn btn-primary" onClick={() => window.print()}>
            Print or save as PDF
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
