# Owner Dashboard

A private page for The Fund's owners, signed in with Google. It shows:

- **Portfolio health:** rental income, profit and margin year to date, debt coverage (NOI ÷ loan payments), occupancy
- **Month by month:** income vs. everything going out, with profit per month
- **Profit & loss:** the Operations section of the P&L, month by month
- **Income by property:** year to date and the latest month
- **Worth knowing:** plain-language flags pulled from the numbers (losing months, costs not entered yet, month-to-month units, missing lease dates)
- **Vacancies** and **leases coming up** (next 120 days), plus the month-to-month list

## Where the data comes from (and why it's safe)

This repo is public, so **no financial data lives here**. The code in this folder runs as a Google Apps Script web app:

- Financials are read live from the **2026 Profit & Loss** Google Sheet in Drive (the *Monthly Summaries* and *Ops* tabs).
- Vacancies and lease end dates are read from the site's public `listings.json`.
- The web app runs **as the person signed in**, so it can only read the P&L if that Google account can open it in Drive. It also checks the `OWNERS` list in `Code.gs`. Anyone else sees "Owners only."

Fix a number at its source (the sheet, or `listings.json`) and refresh the dashboard.

## One-time setup (about 10 minutes)

1. Go to **script.google.com** and click **New project**. Name it "Fund Owner Dashboard".
2. Click the gear (**Project Settings**) and check **Show "appsscript.json" manifest file in editor**.
3. Back in the editor:
   - Replace everything in `Code.gs` with this folder's `Code.gs`. On the `PNL_SHEET_ID` line, paste the 2026 P&L sheet's ID (the long string in its URL between `/d/` and `/edit`).
   - Replace everything in `appsscript.json` with this folder's `appsscript.json`.
   - Click **+** next to Files, choose **HTML**, name it `Dashboard`, and paste in this folder's `Dashboard.html`.
   - Save.
4. Click **Deploy → New deployment**. Choose type **Web app**, then:
   - **Execute as:** User accessing the web app
   - **Who has access:** Anyone with Google account
   - Click **Deploy**, then copy the **Web app URL** (it ends in `/exec`).
5. Open that URL and approve access. Because this is a personal script, Google shows **"Google hasn't verified this app."** Click **Advanced → Go to Fund Owner Dashboard** and allow it. It asks to see your spreadsheets (Google has no read-only option for this kind of script; the code only reads), connect to the rentals site, and see your email address.
6. Put the URL in `listings.json` as `"ownerPortalUrl"`. An **Owner login** link then appears in the site footer.
7. Send Jack the link. He signs in with his Google account and approves once (step 5).

## Day-to-day

- **Changed the code?** In Apps Script: **Deploy → Manage deployments → ✏️ → Version: New version → Deploy.** The URL stays the same.
- **Add an owner:** add their Gmail to `OWNERS` in `Code.gs`, give them view access to the P&L sheet, and deploy a new version.
- **New year:** point `PNL_SHEET_ID` at the new year's P&L sheet and deploy a new version. The new sheet needs the same *Monthly Summaries* and *Ops* tabs; the code finds rows by their labels ("Rental Income", "Loan Payments", "Profit / Loss" and so on), so small layout changes are fine.
- **A lease ends or a unit opens up:** update `listings.json` as usual; the dashboard picks it up on refresh.
