# The Fund Worldwide · Rentals

A simple listings site for our Fort Wayne rentals, hosted on GitHub Pages.

## Updating listings

Everything lives in **`listings.json`**. Edit it right on github.com (pencil icon) and commit, and the site updates in a minute or two.

- **Unit opens up:** set `"status": "available"`, `"askingRent": 1650`, `"availableDate": "2026-12-01"` (or `null` for "available now"), and `"zillowUrl"` once it's listed.
- **Unit leased:** set `"status": "leased"` and `"askingRent": null`, and clear `"zillowUrl"`. Leased units show no rent and no dates on the site. Record the lease end in the P&L's *Owner Tenants* tab.
- **Description:** fill in `"description"` with a sentence or two about the place.
- **Photos:** each entry is a Google Drive file ID from the *Fund Rentals – Website Photos (public)* folder in Sam's Drive. The first photo is the cover. To add a photo, put it in that folder, copy the ID from its share link (the part after `/d/`), and add it to the list.

Leased units show only the street (no house number) to protect current tenants. Available units show the full address.

## Applications and contact

- Applicants apply on **Zillow Rentals** before any showing. Put each open unit's Zillow listing link in its `"zillowUrl"`; the site then shows an "Apply on Zillow" button. With no link yet, the unit page asks people to text for the application link.
- `"line"` is the one public number, the Quo line (260) 254-8558. Calls and texts reach Sam and Jack. Owner cell numbers and emails never go in this file; they live in the private P&L's *Owner Team* tab.
- No lease end dates, rents on leased units or Innago IDs go in `listings.json`. It's public. Lease dates live in the P&L's *Owner Tenants* tab.

## Publishing changes to the code

When `app.js` or `styles.css` change, bump the `?v=` number on their tags in `index.html` so visitors don't get an old cached copy.

## Tenants page

`tenants.html` is the page for current tenants: pay rent, request repairs, emergency contacts. The rent portal and repairs buttons go to Innago. Settings live in the `"tenants"` block of `listings.json`:

- `"portalUrl"`: the Innago tenant login.
- `"zelle"`: the email or phone enrolled with Zelle on the business account. Leave blank to hide the Zelle option.
- `"venmo"`: the Venmo **business** profile handle (no @). Leave blank to hide the Venmo option.

Zelle and Venmo payments don't post to Innago on their own, so record them in Innago as payments received.

## Owners page (parked)

The draft property-management page for outside owners (`owners.html`) was taken off the live site on Nov 14, 2026: it claimed a license and a trust account that aren't set up yet. It's in the git history (commit `5d169e5`) if you want it back after the legal setup with Joe's brokerage is settled.

## Owner dashboard and GC bid page

- `/dashboard/` is the private owner dashboard (P&L, tenants, deals, to-dos). Owners sign in with Google.
- `/bid/` is the page David gets a link to for rehab bids. It shows the deal, the rehab budget that works at asking, and the rehab lines (never the owners' notes).

Both pages hold no data. They talk to the Apps Script in `owner-dashboard/`, which reads the private P&L sheet in Drive. Their two settings live in `portal-config.js`. Setup steps are in `owner-dashboard/README.md`.
