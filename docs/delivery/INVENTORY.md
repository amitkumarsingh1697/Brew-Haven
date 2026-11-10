# Inventory

Ingredient stock per café, worked out from recipes and what was sold. It sits alongside the
simple per-item "sold out / count left" switch on the Stock tab, which still decides what
customers can order.

## How it works

- **Ingredients** (Setup → Inventory) are shared by all cafés of the business. Each is measured
  in whole grams, millilitres or pieces. Retiring one hides it from the Stock tab and from new
  recipe lines; its history stays.
- **Recipes** say what one serving of a menu item uses. "Every serving" lines are the base
  recipe. Lines for a choice (e.g. *Milk: Oat milk*) are added on top when the customer picks it,
  and may be negative so a choice can swap one ingredient for another. Choice lines are matched by
  group and option name, so editing an item's choices keeps its recipe as long as the names stay.
  Items without a recipe don't touch ingredient stock.
- **Sales** are written as stock movements in the same database transaction that places the order
  (online payment verified, counter order taken, or a replacement item confirmed).
- **At the café** (Stock tab) any team member records a delivery, waste, or a shelf count. A count
  records the difference from what the system expected, so the history shows the correction.
- **On hand** is the sum of all movements. An ingredient with nothing recorded at a café shows
  "Not counted yet" rather than "Out".
- **Low-stock levels** are set per café by the owner. The owner's "Running low" list shows anything
  at or below its level, or out, at any café.

Every delivery, waste entry, count, recipe change and low-stock level is in the Activity log.

## Not yet

- Cancelled or refunded orders don't put ingredients back (the drink was usually made). Correct with
  a shelf count.
- Ingredient stock doesn't mark menu items sold out automatically; staff still use the item switch.
- Wastage and variance reports, purchase orders and supplier lists are later backlog items.

## API

| Route | Who |
|---|---|
| `GET /v1/staff/inventory?outletId` | Staff of the café |
| `GET /v1/staff/inventory/history?outletId&ingredientId` | Staff of the café |
| `POST /v1/staff/inventory/movements` (`RECEIVE`, `WASTE`, `COUNT`) | Staff of the café |
| `POST /v1/admin/ingredients`, `PATCH /v1/admin/ingredients/:id` | Owner |
| `GET /v1/admin/recipes`, `PUT /v1/admin/recipes/:itemId` | Owner |
| `PUT /v1/admin/low-stock`, `GET /v1/admin/low-stock` | Owner |
