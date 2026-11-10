# The Fund Worldwide · Rentals

A simple listings site for our Fort Wayne rentals, hosted on GitHub Pages.

## Updating listings

Everything lives in **`listings.json`**. Edit it right on github.com (pencil icon) and commit, and the site updates in a minute or two.

- **Unit opens up:** set `"status": "available"`, `"askingRent": 1650`, and `"availableDate": "2026-12-01"` (or `null` for "available now").
- **Unit leased:** set `"status": "leased"`, `"leaseEnds"` (`"2027-07-31"` or `"month-to-month"`), and `"askingRent": null`. Leased units show no rent at all on the site (just "Currently leased · Ask about openings"), so tenants can't compare. `"rentRange"` on a leased unit is kept for your own reference only.
- **Description:** fill in `"description"` with a sentence or two about the place.
- **Photos:** each entry is a Google Drive file ID from the *Fund Rentals – Website Photos (public)* folder in Sam's Drive. The first photo is the cover. To add a photo, put it in that folder, copy the ID from its share link (the part after `/d/`), and add it to the list.

Leased units show only the street (no house number) to protect current tenants. Available units show the full address.

## Inquiries and applications

- `"applyUrl"`: the Innago application link. It shows an "Apply online" button when filled in.
- `"inquiry"`:
  - `"mode": "email"` (default): the form opens the visitor's email app addressed to Sam and Jack.
  - `"mode": "jotform"` + `"jotformId"`: embeds a Jotform form instead.
  - `"mode": "web3forms"` + `"web3formsKey"`: sends the form straight to email without leaving the page.

## Publishing changes to the code

When `app.js` or `styles.css` change, bump the `?v=` number on their tags in `index.html` so visitors don't get an old cached copy.

## Tenants page

`tenants.html` is the page for current tenants: pay rent, request repairs, emergency contacts. The rent portal and repairs buttons go to Innago. Settings live in the `"tenants"` block of `listings.json`:

- `"portalUrl"`: the Innago tenant login.
- `"zelle"`: the email or phone enrolled with Zelle on the business account. Leave blank to hide the Zelle option.
- `"venmo"`: the Venmo **business** profile handle (no @). Leave blank to hide the Venmo option.

Zelle and Venmo payments don't post to Innago on their own, so record them in Innago as payments received.

## Owners page (work in progress)

`owners.html` is a draft property-management page for outside owners. It is **not linked** from the site and carries `noindex`, so search engines skip it, but anyone with the URL can open it. Before launch: replace every `[Brokerage name]` placeholder, confirm pricing, remove the yellow draft banner and the `noindex` tag, then add a "For owners" link in the footer.

## Owner dashboard and GC bid page

- `/dashboard/` is the private owner dashboard (P&L, tenants, deals, to-dos). Owners sign in with Google.
- `/bid/` is the page David gets a link to for rehab bids. It shows the house and the rehab lines only.

Both pages hold no data. They talk to the Apps Script in `owner-dashboard/`, which reads the private P&L sheet in Drive. Their two settings live in `portal-config.js`. Setup steps are in `owner-dashboard/README.md`.
