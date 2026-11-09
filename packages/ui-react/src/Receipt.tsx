import type { ReceiptView } from "@brew-haven/contracts";
import { formatInr } from "@brew-haven/domain";

const METHOD: Record<string, string> = { ONLINE: "Paid online", CASH: "Cash", UPI_COUNTER: "UPI at counter", CARD_COUNTER: "Card at counter" };
const pct = (bps: number) => `${(bps / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}%`;

/**
 * A receipt laid out like a till slip, readable on a phone and printable on an 80 mm thermal
 * printer or A4. Styles live in receipt.css; wrap it in `.print-receipt` to print only the slip.
 */
export function Receipt({ r }: { r: ReceiptView }) {
  const issued = new Date(r.issuedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
  const half = r.totals.taxRateBps / 2;
  return (
    <article className="bh-receipt" aria-label={r.kind === "TAX_INVOICE" ? `Tax invoice ${r.number}` : `Receipt ${r.number}`}>
      <header>
        <h2>{r.seller.name}</h2>
        {r.seller.legalName && r.seller.legalName !== r.seller.name && <p>{r.seller.legalName}</p>}
        <p>
          {r.seller.outlet}
          {r.seller.address ? `, ${r.seller.address}` : ""}
        </p>
        {r.seller.gstin && <p>GSTIN {r.seller.gstin}</p>}
        {r.seller.fssaiLicence && <p>FSSAI Lic. No. {r.seller.fssaiLicence}</p>}
      </header>
      <p className="bh-receipt-kind">{r.kind === "TAX_INVOICE" ? "Tax invoice" : "Receipt"}</p>
      <dl className="bh-receipt-meta">
        <div>
          <dt>No.</dt>
          <dd>{r.number}</dd>
        </div>
        <div>
          <dt>Date</dt>
          <dd>{issued}</dd>
        </div>
        {r.pickupCode && (
          <div>
            <dt>Order</dt>
            <dd>
              {r.pickupCode} · {r.channel === "ONLINE" ? "Online" : "Counter"}
            </dd>
          </div>
        )}
        {r.customerName && (
          <div>
            <dt>Name</dt>
            <dd>{r.customerName}</dd>
          </div>
        )}
      </dl>
      <table className="bh-receipt-lines">
        <thead>
          <tr>
            <th scope="col">Item</th>
            <th scope="col" className="n">
              Qty
            </th>
            <th scope="col" className="n">
              Amount
            </th>
          </tr>
        </thead>
        <tbody>
          {r.lines.map((l, i) => (
            <tr key={i}>
              <td>
                {l.name}
                {l.options.length > 0 && <small>{l.options.join(", ")}</small>}
              </td>
              <td className="n">{l.quantity}</td>
              <td className="n">{formatInr(l.amountPaise)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="bh-receipt-totals">
        <div>
          <dt>Taxable value</dt>
          <dd>{formatInr(r.totals.taxablePaise)}</dd>
        </div>
        {r.kind === "TAX_INVOICE" ? (
          <>
            <div>
              <dt>CGST {pct(half)}</dt>
              <dd>{formatInr(r.totals.cgstPaise)}</dd>
            </div>
            <div>
              <dt>SGST {pct(half)}</dt>
              <dd>{formatInr(r.totals.sgstPaise)}</dd>
            </div>
          </>
        ) : (
          <div>
            <dt>GST {pct(r.totals.taxRateBps)} included</dt>
            <dd>{formatInr(r.totals.cgstPaise + r.totals.sgstPaise)}</dd>
          </div>
        )}
        <div className="grand">
          <dt>Total</dt>
          <dd>{formatInr(r.totals.totalPaise)}</dd>
        </div>
        {r.payments.map((p, i) => (
          <div key={i}>
            <dt>{METHOD[p.method] ?? p.method}</dt>
            <dd>{formatInr(p.amountPaise)}</dd>
          </div>
        ))}
        {r.refundedPaise > 0 && (
          <div>
            <dt>Refunded</dt>
            <dd>−{formatInr(r.refundedPaise)}</dd>
          </div>
        )}
      </dl>
      <footer>
        <p>Prices include GST.</p>
        {r.footer && <p>{r.footer}</p>}
      </footer>
    </article>
  );
}
