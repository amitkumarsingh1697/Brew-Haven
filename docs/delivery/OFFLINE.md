# Installable apps and offline behaviour

Both the customer app and the staff app can be installed on a phone or tablet ("Add to Home
Screen"), open full screen with the Brew Haven icon, and keep working sensibly when the
connection drops. The code is in `packages/pwa`.

## What happens with no connection

| | Customer app | Staff app |
|---|---|---|
| Opening the app | Opens from the saved copy | Opens from the saved copy |
| Menu | Shows the last menu this phone saw, with a note saying when it was saved | Not applicable |
| Ordering and paying | Paused. The Pay button reads "You're offline" | Counter orders are saved on the till and sent later (below); other changes can't be saved |
| Banner | "You're offline…" at the top | Red banner: new orders won't show up until it's back |
| Back online | Prices are checked again, Pay comes back, the order tracker refreshes | Live orders reconnect at once and the queue refreshes |

## Counter orders while offline

The cashier can keep selling at the counter when the connection drops:

1. The till keeps the last menu it loaded for each café, so the counter screen still opens.
2. The cashier rings up the order and takes the payment as usual (cash, UPI or card). With no
   connection, the order is saved on that till as an offline ticket, `OFF-1`, `OFF-2`…, and the
   screen says what to call through to the kitchen, because the kitchen screen can't see it yet.
3. A "Saved offline, not sent yet" list shows on the counter screen. When the connection is back
   (checked every 15 seconds and on reconnect) the till sends them oldest first. Each becomes a
   normal order with its pickup code, receipt and stock use, and the list shows "OFF-1 is order
   A-014".

Safeguards:

- Every counter order carries a reference made by the till, so a send that times out and is tried
  again, or two tills sending at once, never makes a second order.
- The payment is recorded at the time the order was actually taken.
- An item that sold out in the meantime still goes through, because the customer already paid.
- Brew Haven prices the order again when it arrives. If the price changed while the till was
  offline, the list says what was taken and what was recorded, so the cashier checks the drawer.
- If the server refuses an order (for example a UPI reference already used, or an order more than
  a day old), it stays in the list marked "Not accepted" with the reason, and the cashier can try
  again or remove it.
- The saved list lives in that browser's storage. Clearing the browser's site data loses unsent
  orders, so staff shouldn't do that while the list isn't empty.

## What is never cached

The service worker only saves the app itself (HTML, scripts, styles, icons and fonts). It never
saves API calls, payments or live order updates, so prices, stock and order status always come
from the server. A saved menu is only for browsing; the server re-prices every order.

## Updates

Each deploy produces a new service worker with its own cache, and old caches are deleted. Pages
are fetched network first, so a customer sees the new version on their next visit. `sw.js` is
served with `Cache-Control: no-cache` (see each app's `public/_headers`).

## Testing

- `packages/pwa/test`: which requests are cached, and that the generated worker parses.
- Browser check (production build): load the menu, go offline, reload. The app opens, shows the
  saved menu and the banner, and checkout is paused. Back online, the price check and Pay return.
  On staff, the banner shows and live orders reconnect when the connection returns.
- Note for local testing: Chromium's offline mode still lets pages reach `localhost`, so block
  the API port as well to see the offline state.
