# The Fund Worldwide · Rentals

A simple listings site for our Fort Wayne rentals, hosted on GitHub Pages.

## Updating listings

Everything lives in **`listings.json`**. Edit it right on github.com (pencil icon) and commit, and the site updates in a minute or two.

- **Unit opens up:** set `"status": "available"`, `"askingRent": 1650`, and `"availableDate": "2026-12-01"` (or `null` for "available now").
- **Unit leased:** set `"status": "leased"`, `"leaseEnds"` (`"2027-07-31"` or `"month-to-month"`), and `"askingRent": null`. Leased units only show `"rentRange"` ("rents typically $X–$Y"), never what the current tenant pays.
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
