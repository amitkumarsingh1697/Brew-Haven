# ADR-0006: Look and feel

**Status:** Accepted, 09 Nov 2026. Delegated to Claude (D-08, D-15). Amit's brief: "café, coffee, and refreshing vibe".

## What customers want from café ordering apps (research summary)

* **Speed first.** Ordering a regular in a few taps; no forced sign-up. Starbucks' app is the benchmark for reorder and saved favourites.
* **Clear customisation.** Size, milk and sugar in one sheet, with the price updating live.
* **Live order tracking**, so customers don't wait at the counter.
* **Appetising photography** and short descriptions; dietary badges (veg/non-veg is essential in India).
* **Delight that doesn't block.** Brand moments (here, the 3D café and the manager) must be skippable and must never sit between a returning customer and "Pay".

## Visual system

* **Base:** the Brew Haven brand board's dark, warm palette for brand surfaces (espresso, walnut, brass), and parchment/cream for content surfaces, so menus read like a café chalkboard and a paper menu.
* **Refreshing accent:** a fresh leaf green for success, freshness and "available", plus a cool mint highlight. This keeps the warm coffee palette from feeling heavy.
* **Type:** Cormorant Garamond for display headings (elegant, café menu feel); Inter for all interface and body text (legible at small sizes, tabular numbers for prices); Great Vibes only inside the logo lockup. Cinzel is dropped from UI use because it is all caps and hurts readability at small sizes.
* **Contrast:** every text/background pair meets WCAG 2.1 AA (4.5:1 for body text). Tokens are checked in tests.
* **Motion:** short, warm transitions (150–250 ms); steam and light bloom only in the 3D scene; everything respects `prefers-reduced-motion`.

Tokens live in `packages/ui-tokens` and are documented in `docs/brand/BRAND.md`.

## Sources

* Built In, "UX Design Lessons From the Starbucks App": https://builtin.com/articles/starbucks-mobile-loyalty-rewards-order-payment
* MobMaxime, "Improving the User Experience of an Online Coffee Ordering App": https://www.mobmaxime.com/blog/online-coffee-ordering-app/
* Restolabs, "Coffee shop ordering app": https://www.restolabs.com/blog/coffee-shop-ordering-app
