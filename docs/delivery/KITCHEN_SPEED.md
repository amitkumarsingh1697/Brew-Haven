# Kitchen speed report

Setup → Reports shows **Kitchen speed** for the chosen dates and café (`GET /v1/admin/kitchen-speed`,
owner only). It is worked out from each order's own history, so it needs no extra taps from staff.

| Measure | From | To |
|---|---|---|
| Paid to ready (the ticket time) | Payment confirmed (online) or counter order rung up | Kitchen taps Ready |
| Waiting to start | Payment | Kitchen taps Start |
| Making | Start | Ready |
| Waiting for pickup | Ready | Cashier hands it over |

- **Typical** is the middle order (median). **Slowest 1 in 10** is the 90th percentile.
- An order is **late** when paid-to-ready is over the owner's target. The target defaults to 10
  minutes; the owner changes it on the card (1 to 120 minutes) and that device remembers it.
- **By café** and **by hour of the day** (India time), with hours over the target shown in red, to
  help plan staff for rush hours.
- **Slowest late orders**: the 20 slowest, with café, time paid, number of items, and whether an
  item ran out mid-order (those take longer for a reason).
- Orders not yet ready, cancelled or expired aren't counted. Times are per order, not per kitchen
  station, because Ready is marked for the whole order.
