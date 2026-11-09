# ADR-0005: Tenants, outlets and stations

**Status:** Accepted, 09 Nov 2026. Implements BRAND-02 (reusable for other cafés) and D-12 (400 Coffee has two cafés in two towers).

* **Tenant** = a café business (400 Coffee Cafe), with its branding, tax settings and menu.
* **Outlet** = one physical café (Tower A, Tower B). It has its own availability and stock, order queue, order numbers, kitchen display and cash drawer.
* **Station** = a preparation point inside an outlet (for example, Bar and Kitchen). Each menu item routes to a station. Default: one station per outlet until Q-R3-01 is answered.
* The menu (categories, items, prices, modifiers) is per tenant. Availability and stock count are per outlet.
* Every table that holds tenant data has a `tenant_id`. Every query is scoped by the authenticated tenant, and tests check that one tenant cannot see another's data (source ADR-006, TC-001).
* Customer entry is a link or QR per outlet, `/{tenantSlug}/{outletSlug}`.
* Staff accounts belong to a tenant, with roles `ADMIN`, `CASHIER` and `KITCHEN`, and an outlet list.
* Pickup numbers restart daily per outlet (for example `A-042`). The internal order ID is an opaque UUID; the public tracking token is a separate random value, so order numbers cannot be enumerated (SR-02).
