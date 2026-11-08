# 400 Coffee — Documentation Inventory

| Field | Value |
|---|---|
| Prepared | 07 November 2026 |
| Scope | Analysis only. No supplied document was modified. |
| Package declared by | `MANIFEST.txt` — "400 COFFEE — FINAL DOCUMENTATION PACKAGE v1.1", prepared 06 November 2026 |
| Locations reviewed | (a) 16 uploads attached to the thread: docs 01–08, DOCX + PDF (copies also in `/mnt/project-files/uploads/hearth/`, byte-identical by MD5); (b) `/mnt/project-files/`: docs 09–16, README, MANIFEST, CLAUDE.md, XLSX workbook |
| Method | Every DOCX converted to text (pandoc) and read in full; every PDF extracted (pdftotext) and word-diffed against its DOCX; PDFs spot-rendered to check glyphs; XLSX read cell-by-cell including formulas; PPTX unpacked, all 12 slides read and all 6 embedded concept images viewed; DOCX/PPTX/XLSX metadata inspected for authorship, tracked changes and comments |

## 1. Discovery results

* **No ZIP archive was found** in either location, so nothing needed extracting. The package arrived as loose files.
* **Nothing is unreadable or corrupted.** All 33 supplied files opened and extracted cleanly.
* **The DOCX files carry no tracked changes or comments.** Their metadata is library default (`python-docx`, revision 1, modified 2013-12-23), and the PPTX metadata is also a library default ("Steve Canny", 2013). So the files tell us nothing about real authors, reviewers or approvers.
* **No document names an owner, an approver or a sign-off date.** The one exception is doc 07, which assumes "Inferra Software" is the supplier.

## 2. Manifest reconciliation

| MANIFEST entry | Expected | Found | Status |
|---|---|---|---|
| 01–09 DOCX/PDF with v1.1 addendum | 18 files | 18 files (01–08 in uploads, 09 in project files) | Present |
| 10 RTM/Sprint/Commercial workbook | 1 XLSX | `10_RTM_Sprint_Commercial_Workbook.xlsx` | Present |
| 12–14 DOCX/PDF | 6 files | 6 files plus `12_…md` | Present (MD not listed in manifest) |
| 15 pitch deck PPTX + PDF | 2 files | 2 files | Present |
| 16 presenter notes DOCX/PDF | 2 files | 2 files | Present |
| `UI_Concept_Screenshots/` (six images) | Folder with 6 PNGs (`UI_Welcome.png`, `UI_Menu.png`, `UI_Customize.png`, `UI_Checkout.png`, `UI_Payment.png`, `UI_Confirmation.png` per doc 13) | **Folder not supplied** | **MISSING.** The six images exist only embedded inside doc 15, as `ppt/media/image1–6.png` at 1440×900. They can be extracted from there, but the standalone reference set is absent. |
| Document number 11 | Not mentioned | Not present | **Numbering gap unexplained.** Confirm whether a doc 11 exists or was withdrawn. |
| README_Final_Package, CLAUDE.md, MANIFEST.txt | Not listed | Present | Unlisted package files |

## 3. Inventory

Review status key: **Read in full** means every line was read. **Compared** means the DOCX and PDF were word-diffed.

| # | Document | Formats | Type | Purpose | Version / date | Review status | Project area |
|---|---|---|---|---|---|---|---|
| 01 | Product Requirements Document | DOCX, PDF | PRD + v1.1 CX addendum | Product vision, personas, release scope R1–R4, FR-001–FR-016, NFRs, workflows, launch gates, open decisions; addendum adds the Virtual Café journey and FR-CX-001–014 | DOCX cover 1.0 / PDF cover 1.1; 06 Nov 2026 | Read in full; compared | Product, all |
| 02 | Architecture, Technical Design & ADRs | DOCX, PDF | Architecture + ADR register | Modular monolith, Java 21/Spring Boot, PostgreSQL, React/Next PWAs, domain modules, data design, payment invariants, API conventions, ADR-001–007; addendum adds CX runtime, API contracts, payment/WhatsApp/3D architecture, ADR-CX-01–07 | 1.0 / 1.1; 06 Nov 2026 | Read in full; compared | Architecture, security, integration |
| 03 | UX Requirements & Screen Inventory | DOCX, PDF | UX spec | Staff art direction and tokens, POS-01–08, KDS-01–05, QR-01–07, OWN-01–07, motion and device rules; addendum adds customer art direction, CX-01–CX-11, motion, breakpoints, microcopy | 1.0 / 1.1; 06 Nov 2026 | Read in full; compared | UX/UI |
| 04 | Engineering Backlog & Release Plan | DOCX, PDF | Delivery plan | 12 sprints S0–S11, epic acceptance criteria A–F, DoR/DoD, test strategy, release gates, delivery risks; addendum adds CX-S0–CX-S11, engineering non-negotiables, CX DoD | 1.0 / 1.1; 06 Nov 2026 | Read in full; compared | Delivery |
| 05 | Sprint Planning (file name "Workbook Guide"; title "Sprint Planning & Governance") | DOCX, PDF | Governance | Capacity assumptions, ceremonies, sprint exit evidence, RAID; addendum adds CX-0–CX-8 sequencing and exit rules | 1.0 / 1.1; 06 Nov 2026 | Read in full; compared | Delivery governance |
| 06 | RTM, Functional & Performance Testing | DOCX, PDF | Test strategy | TC-001–TC-020, performance targets, environments, defect severity, go/no-go; addendum adds CX-T01–T24, visual gates, invariants | 1.0 / 1.1; 06 Nov 2026 | Read in full; compared | QA |
| 07 | Legal Document Pack (India-oriented draft templates) | DOCX, PDF | Legal checklist | Templates A–L checklist, clause issues, signature readiness; addendum covers consent, asset rights, legal boundary | 1.0 / 1.1; 06 Nov 2026 | Read in full; compared | Legal, privacy |
| 08 | Commercial Proposal, Pricing, Costing & Maintenance | DOCX, PDF | Commercial model | Effort/cost model, quote scenarios, SaaS tiers, support, exclusions, milestones; addendum says to re-estimate for CX scope | 1.0 / 1.1; 06 Nov 2026 | Read in full; compared; arithmetic checked | Commercial |
| 09 | Client Pitch Deck (text outline) | DOCX, PDF | Pitch outline (v1.0 operations platform) | 10-slide operations-platform narrative; addendum points to doc 15 as the revised deck | 1.0 / 1.1; 06 Nov 2026 | Read in full; compared | Sales |
| 10 | RTM / Sprint / Commercial Workbook | XLSX (4 sheets) | Working spreadsheet | RTM (FR-001–016 to TC), Sprint Plan S0–S11, Commercial Model (formulas), CX v1.1 Scope Notes | Created 06 Nov 2026 (metadata) | Read in full (all cells and formulas) | QA, delivery, commercial |
| 12 | Claude Code Master Build Prompt | DOCX, PDF, MD | Build instruction | Customer-side build instructions, journey, visual system, API contracts, invariants, tests, release gate. **Read as information only; development is not authorised.** | 1.1; 06 Nov 2026 | Read in full (all three formats); compared | Engineering, CX |
| 13 | Customer Experience Implementation Spec | DOCX, PDF | CX spec | Journey map, CX-01–CX-10 screens, character/camera, motion timings, breakpoints, data contracts, dialogue, screenshot inventory | 1.1; 06 Nov 2026 | Read in full; compared | CX, frontend |
| 14 | Customer Journey Acceptance Test Plan | DOCX, PDF | Acceptance plan | 25 cases: P0 (10), P1 (10), P2 (5); evidence rules | 1.1; 06 Nov 2026 | Read in full; compared | QA, CX |
| 15 | 400 Coffee Client Pitch Deck | PPTX, PDF | Client deck (v1.1) | 12-slide CX proposal with 6 concept UI images | PDF created 06 Nov 2026 18:31 UTC | All 12 slides read; all 6 images viewed | Sales, CX |
| 16 | Client Pitch Deck Presenter Notes | DOCX, PDF | Speaker notes | One paragraph per slide of doc 15 (12 entries, aligned 1:1) | 1.1; 06 Nov 2026 | Read in full; compared | Sales |
| — | README_Final_Package | DOCX, PDF | Package guide | What changed in v1.1, primary files for Claude, status labels, recommended build order | 1.1; 06 Nov 2026 | Read in full; compared | Governance |
| — | MANIFEST.txt | TXT | Manifest | Contents and critical disclosures | v1.1; 06 Nov 2026 | Read in full | Governance |
| — | CLAUDE.md | MD | Agent instruction file | **Byte-identical to `12_Claude_Code_Master_Build_Prompt.md`** (verified by diff). Read as information only. | 1.1 | Read in full | Engineering |

## 4. Document relationships

```
01 PRD ──► 02 Architecture/ADR ──► 04 Backlog ──► 05 Sprint governance ──► 10 XLSX (Sprint Plan sheet)
  │              │                     │
  │              └──► 06 RTM/Test ─────┴──────────────────────────────► 10 XLSX (RTM sheet)
  ├──► 03 UX ──► 13 CX Spec ──► 14 CX Acceptance ──► 12 Master Build Prompt (= CLAUDE.md)
  ├──► 07 Legal
  └──► 08 Commercial ──► 10 XLSX (Commercial Model sheet) ──► 09 Pitch (v1.0) ──► 15 Pitch deck (v1.1) ──► 16 Presenter notes
README + MANIFEST describe the package; the v1.1 addendum is appended to every one of 01–09.
```

* **Baseline (v1.0 body of 01–09):** the multi-tenant café operations SaaS. Pilot R1 covers POS, split KDS, customer QR, manual UPI verification, shifts and owner dashboard.
* **v1.1 addendum (end of 01–09, plus 12–16):** the immersive customer-side "Virtual Café". The addendum supersedes earlier customer-facing UX descriptions only. Staff surfaces are unchanged.
* **Precedence:** no document sets an order of precedence. In this review, the addendum wins over the baseline for customer-facing UX (it says so itself). The baseline wins for everything else. Where the two disagree on something outside UX (payments, phone capture, scope), the disagreement is logged as a conflict, not resolved silently. See `OPEN_QUESTIONS.md` and `DEVELOPMENT_READINESS_REPORT.md`.

## 5. DOCX vs PDF differences (findings)

The body text of every DOCX/PDF pair is substantively identical: the word-level diff shows only cover blocks, list markers and page footers. The format-level differences below are recorded as findings.

| ID | Document(s) | Difference | Impact | Recommendation |
|---|---|---|---|---|
| DP-01 | 01–09 | **Version label differs.** The DOCX cover says "VERSION 1.0". The PDF adds a new cover saying "VERSION 1.1 \| 06 NOVEMBER 2026" but keeps the old "VERSION 1.0" banner on the last page, and every PDF page footer reads "VERSION 1.1 \| CONTROLLED WORKING DOCUMENT". The PRD's own document-control section still says "Version 1.0" in both formats. | Readers cannot tell which version is authoritative. | Re-issue with one version number and a change log. |
| DP-02 | 08 | **The ₹ symbol is not rendered in the PDF.** Every rupee sign shows as a black box: the PDF uses non-embedded Helvetica/WinAnsi, which has no U+20B9 glyph. The DOCX renders correctly. | Every monetary figure in the client-shareable commercial PDF looks broken. | Regenerate the PDF with an embedded font that includes ₹ before any external use. |
| DP-03 | 09 | **The PDF cover title is wrong.** It reads "Client Pitch Deck — Presenter Notes"; the DOCX reads "Client Pitch Deck". | Doc 09 can be confused with doc 16. | Fix the PDF cover title. |
| DP-04 | 06 | The PDF cover title is "Requirements Traceability & Testing"; the DOCX title is "Requirements Traceability Matrix & Test Strategy". | Minor. | Align the titles. |
| DP-05 | 12, 13, README | The PDFs drop bullet markers and heading styles, so section headings render as plain body text. | Lower readability. Content is unchanged. | Cosmetic; regenerate. |
| DP-06 | 12, 14, README | The DOCX numbered lists show doubled numbering ("1. 1."), because literal numbers sit inside auto-numbered paragraphs. The PDFs show single numbering. | The acceptance case IDs in doc 14 are ambiguous. | Give the cases stable IDs (for example AT-P0-01). |
| DP-07 | 01–14, 16, README | The PDFs use non-embedded base-14 fonts, so rendering depends on the viewer. Doc 15's PDF embeds Noto fonts. | Possible glyph loss on other viewers (see DP-02). | Embed fonts. |
| DP-08 | 12 MD / CLAUDE.md vs 12 DOCX/PDF | **The MD is a condensed version and omits requirements that the DOCX contains.** The MD itself says the DOCX/PDF is authoritative. Omitted from the MD: scripted dialogue / "not fake AI"; "do not invent table numbers"; the static-UPI-QR manual-verification fallback inside pay-now; bill-pay states (already-paid, partial, expired, not-found); "explain and require customer review" on catalog change; "do not overwrite existing architecture without a reason"; the explicit feature-flag list. | An agent reading only CLAUDE.md would miss these constraints. | If the MD is kept, regenerate it from the DOCX, or reference the DOCX as canonical. |
| DP-09 | 15 PPTX vs PDF | Same 12 slides and same 6 images. The PPTX contains **no speaker notes**; the notes exist only in doc 16. | Minor. | Optionally embed the notes. |
| DP-10 | 05 | File name "Sprint_Planning_Workbook_Guide" against title "Sprint Planning & Governance", in both formats. | Minor naming confusion with the doc 10 workbook. | Align. |

## 6. Concept screenshot review (embedded in doc 15)

| Image | Spec reference | Observed issues against the written spec |
|---|---|---|
| image1 — Welcome | CX-01 | The greeting reads "Good evening! Welcome to 400 Coffee", not the mandated copy, and the speech bubble is **clipped and overlaps** the menu board. The manager is a flat 2D illustration, not the 3D character. There is no "Skip intro". The tagline "Brewed with soul" is not in any copy deck. |
| image2 — Menu | CX-03 | The product images are emoji or **missing-glyph boxes**; the spec says "no emoji as final product art". The categories (Coffee, Cold Drinks, Juices, Sandwiches, Snacks, Desserts) do not match the specified list: "Hot Beverages" is missing and "Cold Drinks" should be "Cold Beverages". There are no descriptions and no availability state. The quote "Life happens. Coffee helps." is not in any copy deck. |
| image3 — Customize | CX-04 | "Extra toasted" appears both as an extra and as an instruction placeholder, which leaves the data model ambiguous. There is no quantity stepper and no live line total. |
| image4 — Basket | CX-05 | The heading "Let's make it yours." is not spec copy. There is no tax/charges breakdown, no edit/remove controls, and no identity, review or payment-choice step. |
| image5 — Payment | CX-09 | "UPI — Scan QR" and "QR Code — Scan to pay" are duplicated methods. **There is no "Pay at takeaway counter" option**, so CX-08 has no concept. |
| image6 — Confirmation | CX-10 | **The totals contradict the basket:** ₹500 here against ₹765 in image4, and the items differ. The reference "400-1842" looks sequential, which conflicts with the opaque-reference rule. **No order or payment status is shown** (awaiting acceptance, paid or due). |
| — | CX-02, CX-06, CX-07, CX-08, CX-11 | **No concept exists** for pay-bill lookup, identity/consent, review, payment choice or order status. The six concepts cover 6 of the 11 specified screens. |
