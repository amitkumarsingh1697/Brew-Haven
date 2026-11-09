# Installable apps and offline behaviour

Both the customer app and the staff app can be installed on a phone or tablet ("Add to Home
Screen"), open full screen with the Brew Haven icon, and keep working sensibly when the
connection drops. The code is in `packages/pwa`.

## What happens with no connection

| | Customer app | Staff app |
|---|---|---|
| Opening the app | Opens from the saved copy | Opens from the saved copy |
| Menu | Shows the last menu this phone saw, with a note saying when it was saved | Not applicable |
| Ordering and paying | Paused. The Pay button reads "You're offline" | Changes can't be saved |
| Banner | "You're offline…" at the top | Red banner: new orders won't show up until it's back |
| Back online | Prices are checked again, Pay comes back, the order tracker refreshes | Live orders reconnect at once and the queue refreshes |

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
