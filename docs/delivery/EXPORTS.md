# CSV exports

The owner downloads these from Setup → Reports, for the dates and café chosen there (up to a year
at a time). Times and business dates are India time. Amounts are rupees with two decimals.

| Export | One row per | Main columns |
|---|---|---|
| Orders | placed order | business date, café, order and receipt number, channel, state, customer, total, GST included, paid, refunded, payment methods, cancel reason |
| Items sold | order line still being served | order, item, choices, quantity, unit price, line total |
| Payments & refunds | captured payment or refund | time, order, payment or refund, method, amount (refunds negative), status, gateway or UPI reference, recorded by |
| Day closes | closed day | float, cash expected and counted, over or short, takings by method, net |
| Stock movements | ingredient movement | ingredient, received, sold, wasted or count difference, order, by, note |
| GST invoices | invoice number | invoice number, business date, café, issued or cancelled, GST rate, taxable value, CGST, SGST, invoice value |

The summary CSV next to the report is unchanged.

## Safety

- Owner only (`GET /v1/admin/exports/:kind?from&to&outletId`).
- Text that a spreadsheet would treat as a formula (starting `=`, `+`, `-`, `@`) gets a leading
  apostrophe, because customer names and notes are typed by the public. Plain numbers are untouched.
- Files start with a UTF-8 byte-order mark so Excel shows ₹ and accented names correctly.

## GST summary

Setup → Reports also shows a GST summary for the same dates and café (`GET /v1/admin/gst-summary`),
for the café's accountant to fill the GST return:

- **By rate:** invoices, taxable value, CGST, SGST and total. Prices include GST (ADR-0004), so the
  taxable value is the total less the GST in it. All sales are treated as within the state, so GST
  is split equally into CGST and SGST, the same way each receipt shows it.
- **By café:** invoices, taxable value and GST.
- **Invoice numbers issued:** each café's series for the financial year (for example `A2627`), with
  the first and last number, how many were issued and how many were cancelled. This is what the
  return's document summary asks for.
- Restaurant service, SAC 996331, and the GSTIN and legal name from Café settings.

What counts:

- An invoice is counted on its business date. When an item is removed or swapped after payment, the
  order's total and GST are recalculated, so the summary uses the final value.
- A cancelled order's invoice is listed as cancelled with no value.
- To be confirmed with the café's accountant: whether refunds after collection need credit notes,
  and whether any café supplies outside the state (both are rare for a counter café).
