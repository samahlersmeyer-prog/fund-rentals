# Owner Dashboard

A private page for The Fund's owners, signed in with Google. It shows:

- **Portfolio health:** rental income, profit and margin year to date, debt coverage (NOI ÷ loan payments), occupancy
- **Month by month:** income vs. everything going out, with profit per month
- **Profit & loss:** the Operations section of the P&L, month by month, with costs split into loan payments, property tax and everything else (insurance, utilities, repairs)
- **Income by property:** year to date and the latest month
- **Worth knowing:** plain-language flags pulled from the numbers (losing months, costs not entered yet, month-to-month units, missing lease dates)
- **Vacancies** and **leases coming up** (next 120 days), plus the month-to-month list
- **To-dos:** shared tasks saved in the P&L's *Owner To-dos* tab (add and check off from the page), plus every P&L cell whose note says "TO ALLOCATE" (money that's in the P&L but not yet split to a property; remove "TO ALLOCATE" from the note once it's split)
- **Cash on hand:** the latest checking balance from the P&L's *Owner Balances* tab, shown as months of costs covered. Update it from the dashboard (there's no live bank feed)
- **By property:** income, loan payments, other costs, property tax and net for each address, from the summary block at the bottom of the Ops tab
- **Work in progress:** open projects from the P&L's *Owner Projects* tab (sale price, costs, payoff, gain vs. invested). Check *Done* once a project closes
- **Rentals & tenants:** every unit with who lives there, their phone and email, and a link to the lease. Buttons open a **group text** or **email** that always includes Sam and Jack (so nothing is one-on-one), plus a **Rent nudge** that pre-writes a friendly reminder with the rent and due date; each nudge is logged on that rental so both owners can see it went out. Each rental also has **Notes & repairs** (Open → In progress → Done). Tenant details come from the P&L's *Owner Tenants* tab, notes from *Owner Rental Notes*. Payments themselves still happen in Innago
- **Deals:** flip leads from wholesalers. Paste a lead text (or send it from an iPhone Shortcut) and it's read into address, asking price, ARV, beds/baths, square feet and photo link. Each deal shows the max offer (target-profit or 70% rule) and profit at asking, and has a **GC bid link**: a page your contractor opens with no sign-in that shows the house and seven rehab lines and nothing about the money. His numbers flow straight back into the math. Deals live in the *Owner Deals* tab. Setup is in **Deals setup** below
- **Year-end forecast** (actuals plus the rest of the year at the last 3 months' pace, including the fall property tax) and **Things to work on** (common landlord rules of thumb applied to your numbers)

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
- **Tenant info:** the *Owner Tenants* tab is created the first time the dashboard loads, with a row for every unit on the site. Fill in Tenant, Phone, Email, Lease link (Innago lease page or the PDF in Drive), Rent and Due day. Two tenants in one home = two rows with the same Unit ID. This stays in the private P&L, never in this public repo.
- **Who's on group texts:** Sam and Jack, from `contacts` in `listings.json`. Whoever is signed in is left off their own text.
- **A lease ends or a unit opens up:** update `listings.json` as usual; the dashboard picks it up on refresh.

## Deals setup (about 15 minutes, Sam does this once)

The Deals tab works for typing and pasting leads as soon as the new code is in. The GC bid link and the iPhone Shortcut need a second deployment, because a contractor (or your phone) can't sign in as an owner.

1. **Update the code.** In the Apps Script project, replace `Code.gs` and `Dashboard` with this folder's versions (keep your `PNL_SHEET_ID` line), and add a new **HTML** file named `Bid` with this folder's `Bid.html`.
2. **Add the secrets.** Gear (**Project Settings**) → **Script Properties** → **Add script property**:
   - `INTAKE_KEY`: any long random phrase. The iPhone Shortcut sends it with each lead; without it nothing is saved.
   - `GC_PHONE` (optional): your contractor's cell, so **Text GC** opens a text already addressed to him.
   - `ANTHROPIC_API_KEY` (optional): lets Claude read messy lead texts. Without it, built-in rules read the usual formats ("Asking $85k", "ARV 160", "3/1", "1,150 sqft").
   These stay in Apps Script. Never put them in `Code.gs`; this repo is public.
3. **Make the second deployment.** **Deploy → New deployment → Web app**:
   - **Execute as:** Me
   - **Who has access:** Anyone
   - Deploy and copy its URL. This is the *bid URL*. It only ever shows the bid page; the dashboard still refuses anyone who isn't a signed-in owner.
4. **Tell the code about it.** Paste that URL into `BID_URL` in `Code.gs` and save.
5. **Update both deployments** (**Deploy → Manage deployments → ✏️ → Version: New version**), one at a time. Before you click Deploy on each, check that *Execute as* still says what it should: **User accessing the web app** for the owner dashboard, **Me** for the bid one.

The *Owner Deals* tab is created in the P&L sheet the first time the Deals tab loads. To keep deals in their own sheet instead (so nothing moves when the P&L rolls over to a new year), put that sheet's ID in `DEALS_SHEET_ID` and share it with Jack and Emily as editors.

**Cutting off a bid link:** change that deal's *GC link key* cell in the Owner Deals tab. The old link stops working and the dashboard shows the new one.

### iPhone Shortcut: send a lead from a text

1. Open **Shortcuts**, tap **+**, and name it "Fund lead".
2. Tap the ⓘ at the bottom and turn on **Show in Share Sheet**. At the top of the shortcut, set it to receive **Text**, and set **If there's no input** to **Get Clipboard**.
3. Add the action **Get Contents of URL**:
   - URL: the bid URL from step 3 above
   - Method: **POST**, Request Body: **JSON**
   - Add a Text field `key` with your `INTAKE_KEY`
   - Add a Text field `text` set to **Shortcut Input**
4. Add **Show Notification** and set it to show **Contents of URL**. You'll see "Saved to Fund deals: 1422 Oakland St, asking $85,000." or the reason it wasn't saved.

To use it: press and hold the wholesaler's text, tap **Copy**, then run "Fund lead" (add it to your Home Screen, or set it as a Back Tap). The lead lands in the pipeline as **New**. If the same house is sent again, it tells you that you already have it instead of adding a second copy.

**Want to look before it saves?** Make a second shortcut with **URL Encode** (Shortcut Input) followed by **Open URLs** set to your owner dashboard URL + `?lead=` + the encoded text. It opens the Deals tab with the text already read into the form.
