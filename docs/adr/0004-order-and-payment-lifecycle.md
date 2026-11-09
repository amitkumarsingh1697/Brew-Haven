# ADR-0004: Order, payment and adjustment state machines

**Status:** Accepted, 09 Nov 2026. Closes C-03 and C-04. It implements D-02 (pay-now), D-09 (straight to kitchen, staff can reject), D-10 (item unavailable after payment) and D-11 (walk-in counter orders).
**Code:** `packages/domain/src/order-machine.ts`, `packages/domain/src/adjustments.ts`. The code and this document must agree; tests enforce the transition table.

## Order states

| State | Meaning | Who sees it |
|---|---|---|
| `AWAITING_PAYMENT` | Customer order created, payment not yet verified | Customer only |
| `PLACED` | Paid (or a walk-in order recorded), waiting in the queue | Kitchen, cashier, admin, customer |
| `PREPARING` | Kitchen has started | All |
| `ACTION_REQUIRED` | Staff flagged one or more items as unavailable; the customer must choose | All |
| `READY` | Ready for pickup at the counter | All |
| `COLLECTED` | Handed over (terminal) | All |
| `CANCELLED` | Cancelled with a reason; any captured money is refunded (terminal) | All |
| `EXPIRED` | Payment never completed within 15 minutes (terminal) | Customer only |

## Transitions

| From | To | Trigger | Actor |
|---|---|---|---|
| AWAITING_PAYMENT | PLACED | Payment verified by server (webhook or status API, never the client) | System |
| AWAITING_PAYMENT | EXPIRED | Payment failed or 15 min timeout | System |
| PLACED | PREPARING | Start | Kitchen |
| PLACED, PREPARING | ACTION_REQUIRED | Mark item(s) unavailable | Cashier, admin, kitchen |
| ACTION_REQUIRED | PLACED or PREPARING (whichever it came from) | Every flagged item resolved | Customer, or the timeout |
| PLACED, PREPARING, ACTION_REQUIRED | CANCELLED | Reject whole order (reason required) | Cashier, admin |
| ACTION_REQUIRED | CANCELLED | Customer cancels the order, or every line was removed | Customer, or system |
| PREPARING | READY | Mark ready | Kitchen |
| READY | COLLECTED | Hand over | Cashier |

Every transition writes an `order_events` row (who, when, from, to, reason) and an outbox message (customer notification, SSE fan-out).

## Item unavailable after payment (D-10)

Staff flag a line as unavailable, and an **adjustment** opens for that line. The customer chooses one option:

| Choice | Money |
|---|---|
| **Replace** with another available item | If it costs less, the difference is refunded. If it costs more, the customer pays only the balance (a top-up payment). If equal, no money moves. |
| **Remove** the item | That line is refunded |
| **Cancel** the whole order | Everything captured is refunded, and the order is CANCELLED |

* While a top-up is unpaid, the adjustment is `AWAITING_TOPUP`. If the top-up is not paid in 5 minutes, the adjustment falls back to **remove** (Q-R3-05 default).
* If the customer does not choose in 5 minutes, the line is removed and refunded (Q-R3-04 default).
* If every line ends up removed, the order is CANCELLED with a full refund.

## Payments and refunds

* `payments`: one row per attempt (`CREATED` → `CAPTURED` | `FAILED`), with kind `ORDER` or `TOPUP` and method `ONLINE`, `CASH`, `UPI_COUNTER` or `CARD_COUNTER`.
* `refunds`: one row per refund (`PENDING` → `PROCESSED` | `FAILED`), linked to the payment it returns money from, with a reason. Refunds are idempotent on `(order, reason, line)`.
* Invariants (checked in code and tests):
  1. An order is PLACED only after a server-verified capture whose amount equals the order total.
  2. The total refunded never exceeds the total captured for an order.
  3. The webhook signature is verified, and duplicate webhooks have no effect.
  4. Walk-in counter payments are recorded by the cashier and never go through the gateway. A refund of a counter payment is a cash/manual refund, recorded as such.

## Money and tax

* All amounts are integer paise.
* Menu prices are **tax-inclusive** (the norm in Indian cafés). GST is extracted for the bill using a per-tenant rate, defaulting to **5%** (restaurant service without ITC). This is a placeholder until SO-6 is confirmed with the owner, and it is config, not code.
