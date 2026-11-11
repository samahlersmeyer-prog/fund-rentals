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
- **Deals:** flip leads from wholesalers. Paste a lead text (or send it from an iPhone Shortcut) and it's read into address, asking price, ARV, beds/baths, square feet and photo link. Each deal shows the max offer (target-profit or 70% rule) and profit at asking, and has a **GC bid link**: a page your contractor opens with no sign-in that shows the house, a live mini P&L (ARV, purchase, his rehab total, hold & close, profit and the most you'd pay), the rehab budget that makes the deal work at asking (with the Light / Medium / Heavy quick estimates), and the rehab lines. Your Notes column never goes to it. His numbers flow straight back into the math. Deals live in the *Owner Deals* tab. Setup is in **Deals setup** below
- **Year-end forecast** (actuals plus the rest of the year at the last 3 months' pace, including the fall property tax) and **Things to work on** (common landlord rules of thumb applied to your numbers)

## How it fits together

- **The pages** live on GitHub Pages, next to the rentals site:
  - Owner dashboard: `https://samahlersmeyer-prog.github.io/fund-rentals/dashboard/` (code in `/dashboard`)
  - GC bid page: `https://samahlersmeyer-prog.github.io/fund-rentals/bid/?bid=…&k=…` (code in `/bid`)
- **The data** stays private in Drive. This folder's `Code.gs` runs as an Apps Script web app that reads and writes the **2026 Profit & Loss** sheet and answers the pages with JSON. No numbers are ever stored in this public repo.
- **Who gets in:** owners tap *Sign in with Google* on the dashboard. Every request carries that sign-in, and the script checks it with Google and against the `OWNERS` list before reading anything. Anyone else gets "isn't one of the owner accounts." The bid page needs no sign-in, but it only ever gets one deal (never the owners' notes), and only with that deal's secret link key.
- Old Apps Script links (bookmarks, bid links already texted to David) forward to the new pages automatically.

## One-time setup (about 15 minutes)

### 1. The script (Apps Script)

1. Open the existing **Fund Owner Dashboard** project at **script.google.com** (or click **New project** and name it that).
2. Replace everything in `Code.gs` with this folder's `Code.gs`. Paste the 2026 P&L sheet's ID on the `PNL_SHEET_ID` line (the long string in its URL between `/d/` and `/edit`).
3. Replace `appsscript.json` with this folder's version (gear → **Show "appsscript.json" manifest file** if you don't see it).
4. Delete the `Dashboard` and `Bid` HTML files from the project. The pages live on GitHub now.
5. Save, then pick any function (e.g. `getDashboardData`) in the toolbar and click **Run** once. Approve the permissions with **your** Google account (Advanced → Go to Fund Owner Dashboard). The script reads the sheet as you from now on, so Jack and Emily never see that screen.

### 2. Google sign-in (Google Cloud, one time)

1. Go to **console.cloud.google.com**, signed in as sam.ahlersmeyer@gmail.com. Create a project named "Fund Portal" (or use any project).
2. **APIs & Services → OAuth consent screen**: User type **External**, app name "The Fund Owners", your email for support and developer contact. Save. You can leave it in *Testing* mode; add Jack's and Emily's Gmail (and yours) under **Test users**.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**
   - Authorized JavaScript origins: `https://samahlersmeyer-prog.github.io`
   - Create, then copy the **Client ID** (ends in `.apps.googleusercontent.com`).
4. Paste it into `GOOGLE_CLIENT_ID` in **both** places: `Code.gs` (save) and `portal-config.js` in this repo.

### 3. Deploy

1. In Apps Script: **Deploy → New deployment → Web app**:
   - **Execute as:** Me
   - **Who has access:** Anyone
   - Deploy and copy the **Web app URL** (ends in `/exec`).
2. Paste that URL into `API_URL` in `portal-config.js` and commit. The dashboard is live at `/dashboard/` a minute later.
3. Optional, so old links keep working: **Deploy → Manage deployments**, pick the old dashboard deployment (and the old bid one, if you made it), ✏️ → **Version: New version** → Deploy. They'll forward to the GitHub pages. Or archive them.

The footer's **Owner login** link already points to `/dashboard/`.

## Day-to-day

- **Changed `Code.gs`?** In Apps Script: **Deploy → Manage deployments → ✏️ → Version: New version → Deploy.** The URL stays the same. Changes to the pages (`/dashboard`, `/bid`) just need a commit; bump the `?v=` numbers on their script and style tags so phones don't keep an old copy.
- **Add an owner:** add their Gmail to `OWNERS` in `Code.gs` and deploy a new version. If the Google Cloud consent screen is still in *Testing*, add them as a test user too.
- **New year:** point `PNL_SHEET_ID` at the new year's P&L sheet and deploy a new version. The new sheet needs the same *Monthly Summaries* and *Ops* tabs; the code finds rows by their labels ("Rental Income", "Loan Payments", "Profit / Loss" and so on), so small layout changes are fine.
- **Tenant info:** the *Owner Tenants* tab is created the first time the dashboard loads, with a row for every unit on the site. Fill in Tenant, Phone, Email, Lease link (Innago lease page or the PDF in Drive), Rent and Due day. Two tenants in one home = two rows with the same Unit ID. This stays in the private P&L, never in this public repo.
- **Who's on group texts:** Sam and Jack, from `contacts` in `listings.json`. Whoever is signed in is left off their own text.
- **A lease ends or a unit opens up:** update `listings.json` as usual; the dashboard picks it up on refresh.

## Deals setup

The Deals tab works for typing and pasting leads as soon as the setup above is done. The GC bid link and the iPhone Shortcut use the same web app URL; they just need a couple of Script Properties.

**Add the secrets.** In Apps Script, gear (**Project Settings**) → **Script Properties** → **Add script property**:
- `INTAKE_KEY`: any long random phrase. The iPhone Shortcut sends it with each lead; without it nothing is saved.
- `GC_PHONE` (optional): your contractor's cell, so **Text David** opens a text already addressed to him.
- `GC_NAME` (optional): defaults to David.
- `ANTHROPIC_API_KEY` (optional): lets Claude read messy lead texts. Without it, built-in rules read the usual formats ("Asking $85k", "ARV 160", "3/1", "1,150 sqft").

These stay in Apps Script. Never put them in `Code.gs`; this repo is public.

Bid links look like `…/fund-rentals/bid/?bid=D261105-cd34&k=…`. David opens it on his phone, fills in the lines, and taps **Send bid**; the numbers land on the deal in the dashboard.

The *Owner Deals* tab is created in the P&L sheet the first time the Deals tab loads. To keep deals in their own sheet instead (so nothing moves when the P&L rolls over to a new year), put that sheet's ID in `DEALS_SHEET_ID` and share it with Jack and Emily as editors.

**Cutting off a bid link:** change that deal's *GC link key* cell in the Owner Deals tab. The old link stops working and the dashboard shows the new one.

### How a new lead gets its first read

Every lead gets a verdict as soon as it has an ARV and a square footage, before your GC has seen it:

- **Quick rehab estimate:** square feet × a Light, Medium or Heavy rate (`REHAB_PER_SQFT` in `Code.gs`, starting at $20 / $35 / $60). New leads start at Medium; switch it on the deal card. Set the three rates to what your GC's jobs have really cost. As soon as any rehab line has a number (your own or the GC's bid), the real numbers replace the estimate.
- **Verdict:** **Works** (asking is at or under your max offer), **Close** (within 10% over) or **Too high**, always with the most it's worth paying. The iPhone Shortcut's notification includes the same quick read.
- **Sorting:** the pipeline lists the best deal first (asking furthest under your max offer). Tap the *Sorted* button to switch to newest first.
- **Sold comps:** opens Zillow's sold search for the deal's zip: last 6 months, same bedrooms, square footage within 20%. It needs the full address (street, city, state, zip); without those it looks the address up instead. The ARV on a new lead is the wholesaler's number, so check comps and put in your own before trusting a verdict. Nothing is pulled from Zillow automatically.

### iPhone Shortcut: send a lead from a text

1. Open **Shortcuts**, tap **+**, and name it "Fund lead".
2. Tap the ⓘ at the bottom and turn on **Show in Share Sheet**. At the top of the shortcut, set it to receive **Text**, and set **If there's no input** to **Get Clipboard**.
3. Add the action **Get Contents of URL**:
   - URL: the web app URL (the `API_URL` in `portal-config.js`)
   - Method: **POST**, Request Body: **JSON**
   - Add a Text field `key` with your `INTAKE_KEY`
   - Add a Text field `text` set to **Shortcut Input**
4. Add **Show Notification** and set it to show **Contents of URL**. You'll see "Saved to Fund deals: 1422 Oakland St, asking $85,000." or the reason it wasn't saved.

To use it: press and hold the wholesaler's text, tap **Copy**, then run "Fund lead" (add it to your Home Screen, or set it as a Back Tap). The lead lands in the pipeline as **New**. If the same house is sent again, it tells you that you already have it instead of adding a second copy.

**Want to look before it saves?** Make a second shortcut with **URL Encode** (Shortcut Input) followed by **Open URLs** set to `https://samahlersmeyer-prog.github.io/fund-rentals/dashboard/?lead=` + the encoded text. It opens the Deals tab with the text already read into the form.
