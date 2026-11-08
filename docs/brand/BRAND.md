# Brew Haven: Brand Notes

## Naming (decided 08 Nov 2026, Amit)

| Item | Value |
|---|---|
| **Product name** | **Brew Haven**, a café-operations SaaS owned by Inferra Software |
| Tagline | **SANCTUARY FOR COFFEE LOVERS** |
| Supporting line | *Where Every Sip Feels Like Home.* |
| Brand pillars | COFFEE · COMFORT · CONNECTION |
| First café (tenant) | **400 Coffee** |

**What this means for the build:** the 400 Coffee name, greeting ("Welcome to 400 Coffee…"), apron logo, menu and colours are **tenant configuration**, not hard-coded. The same 3D Virtual Café must work for other cafés later. Brew Haven product branding appears in the product shell, the staff and owner apps, the platform admin and marketing; the café's own branding appears in its customer-facing Virtual Café.

## Brand board

`assets/brew-haven-logo-and-brand-board.png`, supplied by Amit on 08 Nov 2026:
* **Mark:** a steaming coffee cup with a leaf, in warm gold.
* **Wordmark:** "BREW HAVEN" in classical serif capitals, with "SANCTUARY FOR COFFEE LOVERS" in spaced small capitals between rules.
* **Script line:** "Where Every Sip Feels Like Home." in a handwritten script.
* **Mood:** dark espresso background, warm amber lighting, coffee beans, leaves, latte art.

The board is a raster image. A vector logo (SVG) and a transparent-background PNG are still needed for the app and favicon (see Q-R2-15).

## Colours (proposed, from doc 12 and checked against the brand board)

The doc 12 customer palette already matches the brand board's gold-on-espresso look, so it is adopted. A leaf green is added for the "refreshing" feel; the brand board uses green leaves.

| Token | Hex | Use |
|---|---|---|
| espresso | #120D0A | Page background |
| walnut | #241810 | Surfaces, cards |
| roasted | #57331F | Secondary surfaces, borders |
| brass (primary) | #D9AD70 | Primary accent, CTAs, logo gold |
| parchment | #F1E4CC | Primary text on dark, diary pages |
| warm grey | #B8A48B | Secondary text |
| leaf (new) | #6F8F5A | Fresh/success accents, veg markers (to verify for contrast) |

The doc 03 "muted olive" vs doc 12 "warm grey" conflict (C-05) is resolved by keeping the warm grey for text and using leaf green as the accent. Every pairing will be contrast-checked against WCAG AA before sign-off.

## Fonts (proposed, free to use: Google Fonts, SIL Open Font License)

| Role | Font | Why |
|---|---|---|
| Display / wordmark style | **Cinzel** | Classical serif capitals close to the logo's wordmark |
| Editorial headings, menu diary | **Cormorant Garamond** | The editorial serif doc 12 asks for |
| Script accents (sparingly) | **Great Vibes** | Close to the "Where Every Sip Feels Like Home." script |
| UI, prices, status | **Inter** (tabular numbers) | Highly legible sans-serif for controls and money, as docs 03 and 12 require |

These are proposals for Amit's approval. The logo itself stays an image and is not re-typeset.
