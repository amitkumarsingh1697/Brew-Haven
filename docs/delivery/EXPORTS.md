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

The summary CSV next to the report is unchanged.

## Safety

- Owner only (`GET /v1/admin/exports/:kind?from&to&outletId`).
- Text that a spreadsheet would treat as a formula (starting `=`, `+`, `-`, `@`) gets a leading
  apostrophe, because customer names and notes are typed by the public. Plain numbers are untouched.
- Files start with a UTF-8 byte-order mark so Excel shows ₹ and accented names correctly.
