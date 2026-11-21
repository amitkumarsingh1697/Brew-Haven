# Legal review: Terms of service, Data processing terms, Privacy policy

*Reviewed 21 Nov 2026 under Indian law, at Amit's request. This review was done by Claude acting as the legal team, not by an advocate. Before launch, have an advocate enrolled with a Bar Council sign off the final text. The fixes below are applied in this pull request. Section D lists what is still open.*

## Summary
The drafts had a sound structure: the café is the data fiduciary, Brew Haven is the processor, liability is capped and consent is separate for marketing. We found **5 high-risk gaps**, **9 medium** and **6 low**. All of them are fixed in the text except the 6 items in section D, which need facts only Amit or the café can supply (legal name, city, grievance officer).

## A. High risk (fixed)

| # | Where | Problem | Law | Fix |
|---|---|---|---|---|
| H1 | Refund policy, section 4 | "Same day only" for complaints could be read as giving up consumer rights. A contract term like that can't override the Consumer Protection Act, and it may be an "unfair contract" term (s. 2(46)). | Consumer Protection Act, 2019 | The same-day rule is kept as the counter process. A sentence now says it does not take away statutory rights and that later complaints still go to the grievance officer. |
| H2 | Terms 6, app | The café sells through its own app, so it is an e-commerce entity. It must name a grievance officer, acknowledge complaints within 48 hours and resolve them within one month. The app had no place to name one. | Consumer Protection (E-Commerce) Rules, 2020, r. 4(4)–(5) | Terms now make this the café's duty. A new "Complaints contact (grievance officer)" field in Settings is printed on every receipt. |
| H3 | Processing terms 3.5 | A 48-hour breach notice from processor to café left the café too little time. The café must send a detailed report to the Data Protection Board within 72 hours. CERT-In's 6-hour incident reporting was missing. | DPDP Rules, 2025, r. 7; CERT-In Directions, 28 Apr 2022 | Processor notice is now 24 hours. Brew Haven commits to CERT-In reporting within 6 hours. |
| H4 | Terms 14 | Arbitration had no seat, no rules and no appointment method. A clause letting one side appoint the arbitrator alone is invalid. | Arbitration and Conciliation Act, 1996; *CORE v. ECI-SPIC-SMO-MCML* (SC, 2024) | Sole arbitrator appointed jointly, or under s. 11. Seat, venue and language are set, and either side can still get urgent interim relief. The city is still blank (D2). |
| H5 | Privacy, Children | Under the DPDP Act a child is anyone under 18, and their data needs verifiable parental consent. The draft only covered sign-ups, but a 16-year-old can order a coffee. | DPDP Act, s. 9; DPDP Rules, r. 10 | Under-18s are asked to have a parent or guardian order. No tracking or offers to children. |

## B. Medium risk (fixed)

| # | Where | Problem | Fix |
|---|---|---|---|
| M1 | Processing terms 5, Privacy | The sub-processor table and storage region were blank. A privacy notice must say who gets the data and where. | Filled in: Render and Neon/AWS (Singapore), Cloudflare (edge, no storage), Razorpay (India, the café's own contract), Meta WhatsApp. Singapore is not restricted under DPDP s. 16. |
| M2 | Terms 5 | The text did not say whose gateway account it is. Brew Haven must never receive customers' money, or it would need RBI authorisation as a payment aggregator. | The text now says payments go to the café's own Razorpay account, in its name, and settle to its own bank. |
| M3 | Terms 6 | Wallet and loyalty balances must not be cashable or usable elsewhere, or they stop being an exempt closed-system prepaid instrument. | Added as a café duty. |
| M4 | Privacy, retention | "[x] years" everywhere. | Orders 8 years (GST s. 36 and income-tax limits), consent proof 3 years, staff 90 days, security logs 1 year (DPDP Rules require at least 1 year). |
| M5 | Terms 4 | "Fees are not refundable" with no exception. That is one-sided if we end the agreement or remove a core feature. | Unused whole months of a yearly plan are refunded in those cases, and also when the café rejects changed terms. |
| M6 | Terms 10 | We could only end the agreement for breach. A provider normally needs an exit. | We can end it with 60 days' notice and a refund. |
| M7 | Terms 11 | The liability cap also covered data breaches and confidentiality, which a café will push back on. | The cap now excludes fraud, confidentiality and processing-terms breaches. |
| M8 | Terms | There was no force majeure clause. Cloud and payment outages are the realistic risk. | Clause 14 added. |
| M9 | Privacy, rights | The rights list missed "who it was shared with", and nomination applies only on death or incapacity. | Wording aligned with DPDP ss. 11–14. |

## C. Low risk (fixed)

| # | Fix |
|---|---|
| L1 | Clickwrap acceptance is valid under IT Act s. 10A. This is now stated, along with an 18+ signatory. |
| L2 | A confidentiality clause was added for both sides. |
| L3 | Boilerplate added: assignment, severability, entire agreement, notices. |
| L4 | A mutual IP indemnity was added, so the café is protected if our software infringes. |
| L5 | Grievance timelines (48 hours / one month) were added to the privacy page, with a pointer to the café's contact on the receipt. |
| L6 | "Encryption at rest" was added. Neon encrypts storage. Two-step sign-in for the Brew Haven team is also listed, since it exists. |

## D. Still open (needs facts from Amit or the café)

| # | Item | Who | Needed by |
|---|---|---|---|
| D1 | Legal entity name, registered address, phone (the "Inferra Software" placeholders). If no company exists yet, a sole proprietorship in Amit's name works for the demo. | Amit | Before going live with paying cafés |
| D2 | Arbitration seat city (suggest the city where the company is registered). | Amit | Same |
| D3 | Brew Haven's grievance officer: name, email. Can be Amit. | Amit | Same |
| D4 | Support email and legal email (e.g. support@ and legal@ on the domain). | Amit | Same |
| D5 | The café enters its own complaints contact, FSSAI number and GSTIN in Settings. | Café owner | Before the first real order |
| D6 | Support hours were set to 9 am–9 pm IST every day, and the uptime target to 99.5%. Change them if they don't suit. | Amit | Optional |

## E. Proposed values I chose (change any you disagree with)
- Trial 30 days (matches the code), pause after 15 days unpaid.
- Data export window 30 days after closing; deletion within 60 days.
- Breach notice to café 24 hours.
- Our termination notice 60 days.

## F. Not needed for the demo
The demo can run with the "Draft" banner on, which shows until `VITE_LEGAL_FINAL=true`. Turn that on only after D1–D4 are filled in and an advocate has read the final text.
