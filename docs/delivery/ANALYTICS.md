# Pilot analytics: online ordering funnel

Setup → Reports shows **Online ordering** for the chosen dates and café (`GET /v1/admin/funnel`,
owner only): how many visits opened the café page, looked at the menu, added something, went to
checkout and started paying, and how many online orders were paid. The percentage is paid orders
out of visits that opened the café.

## What is recorded

The customer app sends one event per step per visit to `POST /v1/cafes/:tenant/:outlet/events`
(`{ visit, kind }`), rate-limited per IP. A visit is a random id kept in that browser tab's session
storage. Each step is stored once per visit (`visit_events`: business, café, visit id, step, time).

Not recorded: names, phone numbers, IP addresses, browser or device details, location, or anything
that links a visit to an order or a person. Browsers with "Do not track" turned on send nothing.
The privacy policy lists this in "What we hold".

Paid orders come from the orders table (online orders placed in the period), not from events.

## Limits

- A customer who opens the link in two tabs counts as two visits; one who closes and comes back
  later is a new visit.
- Counter orders aren't part of the funnel; they're in the sales report.
- Keep 13 months of events at most (a clean-up job is to do once deployed).
