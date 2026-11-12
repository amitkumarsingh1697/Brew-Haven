# Self-serve sign-up

A new café business opens its own account at `/signup` on the staff app (also linked from the
sign-in screen as "New here? Create a café account").

## What the owner enters

Business name, first café or branch, optional address, their name, email, mobile number and a
4-digit PIN (twice), whether to start with a sample menu, and acceptance of the terms.

## What gets created

- The business, with its own link (`blue-door-cafe`; `-2`, `-3`… if the name is taken, and never a
  reserved word such as `admin` or `signup`).
- The first café, with one kitchen called "Kitchen" and an order letter from its name (K → K-001).
- The owner's sign-in (role Owner), signed in straight away.
- If chosen, a sample menu to edit: Coffee (Espresso, Cappuccino and Café Latte with a milk choice)
  and Tea (Masala Chai), at placeholder prices.
- An Activity log entry. The email and mobile number are stored for us to reach the owner and are
  never shown to customers.

The owner lands in Setup with a short guide: check the menu and prices, add the team, print the QR
code. Customers can order from the menu link right away.

## Staff devices

A device remembers which business it signs in to. "Different business?" on the sign-in screen
switches it by business link, and a `?business=<link>` address does the same, so an owner can share
one link with their team.

## Switching it on and off

`SIGNUP_ENABLED=true|false`. It defaults to on in development and **off in production** unless set,
so a live deploy never opens sign-up by accident. When off, the sign-up page says to get in touch.
Sign-up is limited to 5 per hour from one address.

## Not yet

- Plans and limits (next item), payment for a plan, and email or phone verification.
- Terms of service and privacy policy pages to link from the checkbox.
