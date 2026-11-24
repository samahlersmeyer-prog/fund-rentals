# Owner Dashboard

A private page for The Fund's owners, signed in with Google. It shows:

- **Today** (opens first): one triage list of everything that needs someone, split into *Needs attention*, *This week* and *Keep an eye on*: late or due to-dos, open repairs (with the status switch and a group text to the tenant), vacancies, leases ending in the next 90 days (with an "Ask about renewing" group text), new leads and GC bids, ARVs that run high against comps, utility bills to post, money marked TO ALLOCATE, and a stale cash balance. *Mine* hides to-dos assigned to someone else. The box at the top adds a to-do (for anyone or one person, with a due date) or a repair at any house
- **Expenses:** utility bills split to each house by account number (see *Utility bills* below)
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
- **Sold comps** (on the Deals tab): sold sales you enter by hand, summarized by zip ($/sq ft overall and for renovated sales). Every deal gets a **Comps check**: the ARV similar renovated houses in its zip support, how far the deal's ARV is over or under that, the sales it used, a **Use comps ARV** button (the wholesaler's number is kept as *Wholesaler ARV*), and **Copy pushback text**, a short counter for the wholesaler with your max offer at the comps ARV
- **Returns & debt** (Money): each home's NOI, cash flow, cap rate, debt coverage (DSCR), cash-on-cash, value, what's owed and LTV, plus the portfolio. It names any number it can't work out and what's missing. Values, balances, rates and our cash in come from the P&L's *Owner Properties* tab (see below)
- **Pay-down order** (Money): loans highest rate first (avalanche), with each one's monthly interest
- **Reserves** (Money): what to keep in the bank (3 months of all-in costs + $1,500 a door; `RULES` in `dashboard/finance.js`) and what's free to use
- **Growth** tab: where we stand (free cash, the rental it could buy, borrowable equity), the growth plan, good habits checked against your own data, and **Connections**, a live check of every outside system (see below)
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

- **Changed `Code.gs`?** Merging to main deploys it on its own (see *Automatic deploys* below). Without that set up: in Apps Script, **Deploy → Manage deployments → ✏️ → Version: New version → Deploy.** The URL stays the same. Changes to the pages (`/dashboard`, `/bid`) just need a commit; bump the `?v=` numbers on their script and style tags so phones don't keep an old copy.
- **Staying signed in:** after a Google sign-in the server gives that device a 30-day session, so owners sign in about once a month. Taking someone off `OWNERS` locks them out at once. To sign everyone out, delete the `SESSION_SECRET` script property (a new one is made on the next sign-in).
- **Add an owner:** add their Gmail to `OWNERS` in `Code.gs` and deploy a new version. If the Google Cloud consent screen is still in *Testing*, add them as a test user too.
- **New year:** point `PNL_SHEET_ID` at the new year's P&L sheet and deploy a new version. The new sheet needs the same *Monthly Summaries* and *Ops* tabs; the code finds rows by their labels ("Rental Income", "Loan Payments", "Profit / Loss" and so on), so small layout changes are fine.
- **Tenant info:** the *Owner Tenants* tab has a row for every tenant. Fill in Tenant, Phone, Email, Lease link, Rent, Due day, **Lease start, Lease end** (a date or "month-to-month"), **Deposit** and **Deposit held at**. Two tenants in one home = two rows with the same Unit ID. Lease dates live only here now, never in the public `listings.json`.
- **Who's on group texts:** Sam and Jack, from the P&L's private *Owner Team* tab (Name, Phone, Email). Whoever is signed in is left off their own text.
- **Rent:** Innago's "Tenant Payment Notification" emails are filed in the *Owner Rent* tab every morning (with the bill scan) and when you tap **Check Innago now**. A payment counts toward the month of its Innago due date; ones whose due day isn't the tenant's rent day (utility bill-backs) are filed as "Other". Venmo, checks and cash: **Mark paid** on the rent card. Rent reminder texts skip anyone who's paid. Payments match by the tenant's name, so keep names in *Owner Tenants* the same as in Innago.
- **Repairs:** Open → Scheduled → Done. A tenant text on the line becomes a repair with **Make it a repair**; an open repair moves to "Needs attention" after 2 days.
- **A unit opens up:** update `listings.json` (status, asking rent, `zillowUrl`); the dashboard picks it up on refresh.
- **Not a Fund home** (Highgate, Sam's dad's): `"fund": false` in `listings.json` keeps it on the site but out of the dashboard.

## Deals setup

The Deals tab works for typing and pasting leads as soon as the setup above is done. The GC bid link and the iPhone Shortcut use the same web app URL; they just need a couple of Script Properties.

**Add the secrets.** In Apps Script, gear (**Project Settings**) → **Script Properties** → **Add script property**:
- `INTAKE_KEY`: any long random phrase. The iPhone Shortcut sends it with each lead; without it nothing is saved.
- `GC_PHONE` (optional): your contractor's cell, so **Text David** opens a text already addressed to him.
- `GC_NAME` (optional): defaults to David.
- `ANTHROPIC_API_KEY` (optional): lets Claude read messy lead texts. Without it, built-in rules read the usual formats ("Asking $85k", "ARV 160", "3/1", "1,150 sqft").

These stay in Apps Script. Never put them in `Code.gs`; this repo is public.

Bid links look like `…/fund-rentals/bid/?bid=D261105-cd34&k=…`. David opens it on his phone, fills in the lines, and taps **Send bid**; the numbers land on the deal in the dashboard.

Deals and comps live in their own sheet, **Fund Deals (all years)** in the Fund Worldwide folder (`DEALS_SHEET_ID`), so nothing moves when the P&L rolls over to a new year. The first time the dashboard loads after the Nov 2026 update, the *Owner Deals* and *Owner Comps* tabs are copied there from the P&L, and the old tabs are renamed "… (moved)".

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

The notification also gives the comps read when you have comps for that zip, e.g. "Comps (5 in 46805, $117/sq ft renovated): ARV about $134,500, theirs is 23% higher."

**Want to look before it saves?** Make a second shortcut with **URL Encode** (Shortcut Input) followed by **Open URLs** set to `https://samahlersmeyer-prog.github.io/fund-rentals/dashboard/?lead=` + the encoded text. It opens the Deals tab with the text already read into the form.

## Appraiser check

Under every deal's comps check is an **Appraiser check**: what a lender's appraiser will likely put on the house once it's finished, and the odds it appraises at the deal's ARV. The odds come with a **High / Medium / Low** rating.

- It works the way the Fund's own appraisals did (Oakdale 2025 and 2026, Violet, Wilt, Leith, Herman and Cle Elum, in the Fund Worldwide Drive). It takes the closest recent sales within a mile, renovated ones first. Each sale is adjusted for size at about **$25 per sq ft of difference**, not at its full $/sq ft. It also adjusts **$5k per full bath** and **$5k per bedroom**, and takes **1% off** for seller concessions. The value lands among those adjusted sales and never above the best one.
- Checked against those 7 appraisals, it landed within 4% on 6 of them. Oakdale is the exception that counts: the $300k contract in March 2026 appraised at $278k. The check would have given that contract a 3% chance (Low).
- **Appraisal-safe ARV** is the highest ARV that clears the appraisal about 3 times in 4. The check shows your max offer and profit at that number.
- The odds drop when the data is thin: fewer than 3 nearby sales, fewer than 2 comps marked Renovated, mostly older sales, or comps that disagree. A deal with no adjusted comp at or above its ARV is capped at 20%, since an appraiser needs one to bracket the value.
- Mark each comp **Renovated / Average / As-is** right in the table (check its listing photos). Flips set the number. A Low rating also puts an **Appraisal risk** pill on the deal.
- Tune it under `APPRAISAL` in `Code.gs` as more appraisals come in.

## Owner Properties (values and loans)

One row per home in the P&L's *Owner Properties* tab: **Property** (spelled exactly as in the Ops tab's "Totals Rental Ops" block, e.g. "3rd St."), Units (the listings.json ids), Acquired, Cost, **Cash in** (our own money: down payment, closing, rehab not on a loan), **Value**, Value as of, Lender, **Balance**, Balance as of, **Rate**, Payment (monthly principal and interest; blank = this year's average from the P&L), Maturity, Notes.

It was started on Nov 24, 2026 from a Sept 2025 lender statement. Values and balances older than six months, and missing rates, are flagged on the dashboard. A Bippus statement has the balance, rate and payment. Redo values every January. When a rate is blank, the dashboard estimates one from the payment and the maturity year and marks it "est.".

## Balance sheet (Owner Balance Sheet tab)

Money → **Balance sheet** shows what the Fund owns and owes **today** (homes at market value, live cash and mortgage balances) next to the **2025 return** (Schedule L: cost less depreciation). Rows live on the P&L's *Owner Balance Sheet* tab: Item, Kind (Asset, Debt, or Deposit for tenants' deposits), Amount, As of, Rate, 2025 return, Notes. Leave Amount blank on the cash, rental homes and mortgages rows: the dashboard fills those in. Every Debt row with a rate also joins the **Pay-down order**, so a credit card at 29% sits ahead of a 7% mortgage. Each January, copy the new return's Schedule L into the "2025 return" column (rename it for the year).

## Connections

Growth → **Connections** tries each outside system live and shows Working / Check / Down: the P&L and past P&Ls, the deals sheet, the rentals site, Google sign-in, Innago's payment emails in Gmail, the utility bill scan, the scheduled jobs, the tenant line (Quo through the Braun hub, asked for its settings only: no text is ever sent by the check), RentCast (key and this month's count; not called, to save lookups), the Monday on-market pull, the Census address lookup, Claude, and the Script Properties secrets. The first line compares the live Apps Script's `CODE_VERSION` with what the page expects, so a missed deploy shows up red.

## Comps

Comps live in the **Owner Comps** tab, next to the deals (the `DEALS_SHEET_ID` sheet, or the P&L). Add them on the Deals tab: one at a time, or **Paste several at once** from a spreadsheet, Redfin/Zillow copy or an MLS export (keep the header row; it finds address, zip, city, sold/close price, sq ft, sold/close date, beds, baths, and condition or remarks).

- **Condition matters.** Mark flips and redone houses *Renovated*; those set the ARV. Pasted rows whose remarks say renovated/updated/remodeled are marked Renovated; "as-is", "needs", "TLC" and the like are marked As-is.
- **The math:** sales in the deal's zip from the last 12 months (`COMP_MONTHS`), only similar-size ones (within 25%, `COMP_SQFT_BAND`) when there are at least 3; then the median $/sq ft of the renovated ones (or the top quarter of all sales when fewer than 2 are marked Renovated) × the house's square feet. Fewer than 3 sales is flagged as thin.
- **Area names:** zips are the areas. To show a nickname next to a zip, add it to `AREA_NAMES` in `Code.gs`.

### Zips and pulled comps

**Zips fill themselves in.** A lead or comp saved without a zip is looked up with the US Census Bureau's free address service ("1422 Oakland St" becomes "1422 Oakland St, Fort Wayne, IN 46808"). An address with no city is assumed to be in `DEFAULT_CITY` (Fort Wayne, IN). Saving a deal also places it on the map, so comps can be measured by distance.

**Pull sold comps (RentCast, free plan).** RentCast has county-recorded sales (price, date, square feet and each house's sale history). One lookup brings in every single-family house sold within 1.5 miles in the last 12 months.
1. Make a free account at app.rentcast.io, open the API dashboard and create an API key. The free Developer plan includes 50 lookups a month; keep it on that plan.
2. In Apps Script: gear (**Project Settings**) → **Script Properties** → add `RENTCAST_API_KEY` with the key.
3. That's it. New leads pull their comps on their own (until 40 lookups are used in a month, `AUTO_PULL_UNTIL`), and every deal has a **Pull sold comps** button. The dashboard stops at 50 a month (`RENTCAST_MONTHLY_LIMIT`), so there are no overage fees.

How pulled sales are read: a house that resold for at least a third more within two years of its previous sale is marked **Renovated** (a flip), and its earlier purchase is added as an **As-is** sale. Everything else is **Average**. Change any row's condition in the *Owner Comps* tab if you know better.

How the check picks comps: sales within 0.75 miles of the house (`COMP_RADIUS_MILES`), widening to 1.5 miles when there are fewer than 3; houses without a map position fall back to the same zip. Then the same math as before: similar size, renovated $/sq ft × the house's square feet.

## Utility bills

1. **Accounts:** on the Expenses tab, add each utility account number with its utility and house. The house list comes from the column names in the Ops tab's utilities block (the "Operating Utilities" header with a column per house). This is the **Owner Utility Accounts** tab.
2. **Turn on the daily scan (one time):** after pasting the new `Code.gs` and `appsscript.json`, pick **installDailyBillScan** in the Apps Script toolbar and click **Run**. Google asks for permission to read Gmail (read-only) and to run on a schedule; approve with your account. It scans right away and then every morning around 6.
3. **What the scan does:** it searches the last 45 days of your Gmail for bill emails (`BILL_SEARCH`) and keeps only ones that mention one of your account numbers (full, or "ending in 4417" when that matches exactly one account). Each lands in **Owner Utility Bills** with its house and amount. A bill from a utility on your list whose account isn't on the list shows up flagged so you can match it. If a utility's emails aren't being found, put a Gmail search for it (e.g. `from:ebill@utility.com`) in that account's *Gmail search* column.
4. **Posting:** **Post to P&L** adds the bill to that house's cell in the Ops utilities block, for the bill date's month (a number gets the bill added; a formula gets `+amount`; a blank cell gets the amount) and adds a line to the cell's note saying what it was. **Ignore** is for bills that aren't ours or that are already entered. Nothing is posted on its own.

Paper bills and autopays you only see on the bank statement: **Add a bill by hand** on the Expenses tab.

## Texting

Texts are group texts from your own phone: every tenant text includes the other owner so no conversation is one-on-one. The Today list pre-writes the repair follow-up and the renewal ask; you can edit before sending.

## Updating to this version

1. Paste the new `Code.gs` and `appsscript.json` into the Apps Script project.
2. Run **installDailyBillScan** once (step 2 above) and approve.
3. **Deploy → Manage deployments → ✏️ → Version: New version → Deploy.**

The new tabs (*Owner Comps*, *Owner Utility Accounts*, *Owner Utility Bills*) and the *Assigned to* column on *Owner To-dos* are added on their own the first time the dashboard loads.


## On the market (listed homes that have sat)

Deals → **On market** reads every saved listing two ways and gives a verdict (Offer, Watch or Pass), top 10 first:

- **Seller motivation:** days listed, price cuts, a deal that fell through, asking near or under what the seller paid, and listing words like as-is, investor, handyman or land contract. Read from the *History* and *Remarks* columns of *Owner Market*.
- **Flip read:** ARV from your sold comps for that zip, rehab by what the listing says (updated = light, unknown = medium, rough = heavy, from `REHAB_PER_SQFT`), 10% hold and close, $30k profit. Houses only.
- **Rental read:** rent from your own homes (*Owner Tenants*, roommate rows added up) with the same zip and bedrooms, then the same bedrooms anywhere. Cash flow uses `CONFIG.RENTAL`: 25% down at 7%, tax 2% of price a year, $100/mo insurance, 15% of rent held back, and a $200/mo floor for the walk-away price. Multi-unit listings are read as two equal units.
- **Offer:** walk-away is the higher of the two maxes; the opening offer is 5–12% under it (more off when the seller is more motivated).
- **Comps that look wrong** ($1M+ for a small house, or $/sq ft far off the zip's median) are left out of every ARV and listed under Comps.

The list fills from Redfin every Monday (a scheduled task in Sam's Chrome) and from **Scan now** (RentCast, when it answers). The buy box is `MARKET` in `CONFIG`.

## Automatic deploys

`.github/workflows/deploy-apps-script.yml` pushes `owner-dashboard/` to the Apps Script project and updates the live deployment (same URL) whenever `Code.gs` or `appsscript.json` changes on main. It replaces the whole Apps Script project with what's in the repo, so make edits here, not in the Apps Script editor. One-time setup:

1. Turn on the Apps Script API for your Google account: <https://script.google.com/home/usersettings>.
2. On the Mac, in Terminal: `npx @google/clasp@2.4.2 login` and sign in with the Google account that owns the script. Then `cat ~/.clasprc.json | pbcopy`.
3. GitHub → this repo → **Settings → Secrets and variables → Actions → New repository secret**: name `CLASPRC_JSON`, paste.
4. Apps Script → **Project Settings** (gear) → copy the **Script ID** → new repository secret `SCRIPT_ID`.
5. GitHub → **Actions → Deploy Apps Script → Run workflow** to test it.

Until both secrets are there, the workflow fails with a red X saying Code.gs was not deployed (until Nov 2026 it passed green while deploying nothing). Deploy by hand in the meantime: Apps Script → paste Code.gs → Deploy → Manage deployments → ✏️ → New version.
