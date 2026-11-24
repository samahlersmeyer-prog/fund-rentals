/**
 * The Fund Worldwide · Owner portal API (Google Apps Script)
 *
 * The pages people see live on GitHub Pages:
 *   owner dashboard  https://samahlersmeyer-prog.github.io/fund-rentals/dashboard/
 *   GC bid page      https://samahlersmeyer-prog.github.io/fund-rentals/bid/?bid=…&k=…
 * Those pages hold no data. They call this script, which reads and writes the private
 * Profit & Loss sheet in Drive and answers with JSON.
 *
 * Deploy as a web app with "Execute as: Me" and "Who has access: Anyone".
 * Every owner request carries a Google sign-in token, which is checked with Google and
 * against OWNERS below; anything else gets "Not authorized". The bid page only ever sees
 * one deal (no owner notes), and only with that deal's secret link key.
 * Setup steps: see README.md in this folder.
 */

const CONFIG = {
  // The 2026 Profit & Loss sheet: the long ID in its URL, between /d/ and /edit.
  // Better: set a Script Property named PNL_SHEET_ID (Project Settings > Script Properties). It wins over this line,
  // so pasting a fresh copy of this file from GitHub can't break the connection.
  PNL_SHEET_ID: PropertiesService.getScriptProperties().getProperty('PNL_SHEET_ID') || 'PASTE_THE_PNL_SHEET_ID_HERE',
  // Earlier years' P&Ls (the year comes from each file's name). Add last year's here when the new one starts.
  PNL_PAST: ['1iartFiUX4AlTGYmEWQGAj8NQwJXHHYH2z8Ku9Uf4sOQ', '1KE3Tk5Rnu2e3I69VicJ7MyKW_xy8v3GVlkG1ioUiy4U', '1oJfU_LabjU215mbPSnlqHK19lLUMCZgG6pR2lb-VnsE'],

  // Google accounts allowed in.
  OWNERS: ['sam.ahlersmeyer@gmail.com', 'jackkinsella93@gmail.com', 'erahlersmeyer@gmail.com'],
  // First names for those accounts: who's signed in, and who a to-do can be assigned to.
  OWNER_NAMES: { 'sam.ahlersmeyer@gmail.com': 'Sam', 'jackkinsella93@gmail.com': 'Jack', 'erahlersmeyer@gmail.com': 'Emily' },

  // The OAuth client ID from Google Cloud (ends in .apps.googleusercontent.com). Must match
  // GOOGLE_CLIENT_ID in portal-config.js. Not a secret: it only says which site the sign-in is for.
  GOOGLE_CLIENT_ID: '485326552011-3a8toc242d2cpalhan5f95d0evl78bdk.apps.googleusercontent.com',

  // Where the GitHub Pages site lives (with the trailing slash).
  SITE_URL: 'https://samahlersmeyer-prog.github.io/fund-rentals/',

  // Units and vacancies come from the public site data. Lease dates, tenants and owner phones never do:
  // they live in the private P&L (Owner Tenants and Owner Team tabs).
  LISTINGS_URL: 'https://samahlersmeyer-prog.github.io/fund-rentals/listings.json',

  // "Leases coming up" looks this many days ahead.
  LEASE_WINDOW_DAYS: 120,

  // ----- Deals (flip leads from wholesalers) -----
  // Where the "Owner Deals" tab lives. Blank = the P&L sheet above. Put a separate sheet's ID here
  // if you'd rather the deal pipeline not have to move when the P&L rolls over to a new year.
  // A Script Property named DEALS_SHEET_ID wins over this line.
  DEALS_SHEET_ID: PropertiesService.getScriptProperties().getProperty('DEALS_SHEET_ID') || '1F8KV2YZPRYaZnGFnlo-LhlqZ3h_nydZkF_Wqf4CgZNI',

  // Quick rehab estimate, in dollars per square foot, used until the GC's bid (or your own numbers) are in.
  // These are starting points, not quotes: set them to what your GC's jobs have actually come in at.
  REHAB_PER_SQFT: { Light: 20, Medium: 35, Heavy: 60 },

  // Used only if an ANTHROPIC_API_KEY script property is set; otherwise leads are read with built-in rules.
  CLAUDE_MODEL: 'claude-haiku-5-5',

  // ----- Comps (sold sales you enter by hand in the "Owner Comps" tab) -----
  // Only sales from the last this-many months count toward an area's price per square foot.
  COMP_MONTHS: 12,
  // A comp counts as "similar size" when its square footage is within this share of the house's (0.25 = 25%).
  COMP_SQFT_BAND: 0.25,
  // Pulled comps (RentCast) look this many miles around the house; the comps check widens to twice this if it finds fewer than 3.
  COMP_RADIUS_MILES: 0.75,
  // RentCast's free plan includes 50 lookups a month (one per "Pull sold comps"). The button stops here so there are no overage fees.
  RENTCAST_MONTHLY_LIMIT: 50,
  // New leads (dashboard or iPhone Shortcut) pull their comps on their own, until this many lookups are used in a month.
  // The rest are kept for the "Pull sold comps" button. Set to 0 to turn automatic pulls off.
  AUTO_PULL_UNTIL: 40,
  // City and state added to an address that has neither, before looking up its zip.
  DEFAULT_CITY: 'Fort Wayne, IN',
  // Optional nicknames for zips, shown next to the zip on the dashboard, e.g. { '46805': 'North Anthony' }.
  // Leave empty and the zip is the area.
  AREA_NAMES: {},

  // ----- On the market (listed homes that have sat, checked against our own comps) -----
  // The buy box, taken from what the Fund already owns: the same zips, and houses and duplexes about the same size.
  // PRICE_MAX is a starting guess; set it to the most you'd pay for a house before rehab.
  MARKET: {
    CITY: 'Fort Wayne', STATE: 'IN',
    ZIPS: ['46802', '46804', '46805', '46807', '46808', '46809', '46814', '46815', '46816', '46819', '46825'],
    TYPES: ['Single Family', 'Multi-Family'],
    PRICE_MIN: 40000, PRICE_MAX: 250000,
    SQFT_MIN: 600, SQFT_MAX: 2200,
    MIN_DAYS: 60, // only homes listed at least this long
  },

  // ----- Rental read on a listed home (rough: to sort listings, not to underwrite a loan) -----
  RENTAL: {
    DOWN: 0.25, RATE: 0.07, YEARS: 30, // loan on the purchase price
    TAX_RATE: 0.02,      // property tax per year as a share of price (Indiana caps rentals at 2% of assessed value)
    INSURANCE: 100,      // per month, per building
    RESERVES: 0.30,      // fallback only: the read uses your own repairs + vacancy share of rent from the P&Ls (pnlHistory_)
    MIN_CASH_FLOW: 200,  // per month, per door: the rental max is the most you can pay and still clear this
    // Rehab to make it rentable, $ per sq ft, by what the listing says about condition.
    REHAB_PER_SQFT: { updated: 5, unknown: 15, rough: 45 },
    // Our homes whose rent includes utilities (the Fund pays them), so they'd overstate market rent.
    SKIP_UNITS: ['third-st-1', 'third-st-2', 'archer-1', 'archer-2'],
  },

  // ----- Flip numbers on a listed home (the deal screen starts here; edit to match your real jobs) -----
  FLIP: {
    BUY_CLOSING: 0.03,  // closing costs to buy, share of price (the rental screen uses it too)
    SELL: 0.08,         // agent and closing costs to sell, share of ARV
    HOLD_MONTHS: 6,     // months from closing to sold
    UTILITIES: 150,     // per month while you hold it (taxes and insurance come from RENTAL)
    MIN_PROFIT: 30000,  // the flip max is the most you can pay and still clear this
  },

  // ----- Appraiser check (what a lender's appraiser will likely say the house is worth after the flip) -----
  // Calibrated from the Fund's own appraisals in the Fund Worldwide Drive (Oakdale 2025 and 2026, Violet, Wilt,
  // Leith, Herman, Cle Elum; 2023–2026). Those appraisers adjusted size at $10–30 per sq ft (most $25–30),
  // took about $5,000 per full bath and $5,000 per bedroom, subtracted seller concessions dollar for dollar,
  // rated every finished flip C3 (never C2), used 3 closed sales within about a mile, and never went above
  // their best adjusted comp. Oakdale appraised $278k on a $300k contract (March 2026).
  // Re-tuned the same way on those 7 reports, this method landed within 4% of the appraised value on 6 of 7.
  APPRAISAL: {
    GLA_PER_SQFT: 25,       // $ per sq ft of size difference (not the comp's full $/sq ft)
    PER_FULL_BATH: 5000,    // a half bath is half this
    PER_BEDROOM: 5000,
    CONCESSIONS: 0.01,      // county records don't show seller-paid closing costs; take this share off each sale
    MILES: 1,               // comps further away than this aren't used
    PREFER_MONTHS: 6,       // older sales still count, but rank lower
    COMPS_USED: 4,          // appraisers show 3 closed sales; one extra steadies the estimate
    MISS: 0.04,             // how far off the method typically is from the real appraisal (one standard deviation)
  },

  // ----- Utility bills -----
  // What the daily scan looks for in Sam's Gmail. Only emails that mention an account number from the
  // "Owner Utility Accounts" tab (or a utility named there) are ever saved; everything else is ignored.
  // Innago's "Tenant Payment Notification" emails. Each one is filed in "Owner Rent" so the dashboard knows who has paid.
  RENT_SEARCH: 'from:donotreply@innago.com subject:"Tenant Payment Notification" newer_than:75d',
  // Rent counts as late this many days after the due day.
  RENT_GRACE_DAYS: 3,

  BILL_SEARCH: 'newer_than:45d -in:chats ("amount due" OR "total due" OR "balance due" OR "your bill" OR "bill is ready" OR "statement is ready" OR "payment due" OR "new bill")',
};
// Secrets never go in this file (the repo is public). They live in Apps Script:
// Project Settings → Script Properties:
//   INTAKE_KEY         any long random phrase; the iPhone Shortcut sends it with each lead
//   ANTHROPIC_API_KEY  optional; lets Claude read messy lead texts
//   GC_PHONE           optional; your contractor's cell, so "Text GC" opens a text already addressed to him
//   GC_NAME            optional; defaults to David
//   HUB_KEY            shared with the Braun Real Estate hub (Quo line); lets it file tenant texts, calls and voicemails here

const TODO_TAB = 'Owner To-dos';
const BALANCE_TAB = 'Owner Balances';
const TENANT_TAB = 'Owner Tenants';
const RENTAL_NOTES_TAB = 'Owner Rental Notes';
const TENANT_HEAD = ['Unit ID', 'Unit', 'Tenant', 'Phone', 'Email', 'Lease link', 'Rent', 'Due day', 'Notes', 'Lease start', 'Lease end', 'Deposit', 'Deposit held at'];
const NOTE_HEAD = ['Unit ID', 'Unit', 'Note', 'Status', 'Added by', 'Added on', 'Updated'];
// Repairs move Open → Scheduled → Done. "In progress" (older rows) reads as Scheduled.
const NOTE_STATUSES = ['Open', 'Scheduled', 'Done', 'Log'];
const OWNER_TEAM_TAB = 'Owner Team'; // Name, Phone, Email for Sam and Jack: who's copied on every tenant text
const RENT_TAB = 'Owner Rent';
const RENT_HEAD = ['Month', 'Unit ID', 'Unit', 'Tenant', 'Amount', 'Paid on', 'Kind', 'Method', 'Note', 'Ref', 'Added'];
const RENT_KINDS = ['Rent', 'Other'];
const INBOX_TAB = 'Owner Tenant Inbox';
const INBOX_HEAD = ['When', 'Unit ID', 'Unit', 'Tenant', 'Phone', 'Kind', 'Message', 'Urgent', 'Status', 'Hub link'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ---------- the API ----------

// What a signed-in owner's page may call, by name.
const OWNER_ACTIONS = {
  getDashboardData: () => getDashboardData,
  addRentalNote: () => addRentalNote,
  setRentalNoteStatus: () => setRentalNoteStatus,
  addBalance: () => addBalance,
  addTodo: () => addTodo,
  setTodoDone: () => setTodoDone,
  parseLeadText: () => parseLeadText,
  addDeal: () => addDeal,
  updateDeal: () => updateDeal,
  addComps: () => addComps,
  deleteComp: () => deleteComp,
  setProjectDone: () => setProjectDone,
  setCompCondition: () => setCompCondition,
  scanBillsNow: () => scanBillsNow,
  addUtilAccount: () => addUtilAccount,
  addUtilBill: () => addUtilBill,
  postBillToPnl: () => postBillToPnl,
  setBillStatus: () => setBillStatus,
  pullComps: () => pullComps,
  allocateCell: () => allocateCell,
  setInboxStatus: () => setInboxStatus,
  saveContact: () => saveContact,
  addContactLog: () => addContactLog,
  makeTenant: () => makeTenant,
  tenantThread: () => tenantThread,
  tenantText: () => tenantText,
  getTexts: () => getTexts,
  saveTexts: () => saveTexts,
  groupText: () => groupText,
  testText: () => testText,
  markRentPaid: () => markRentPaid,
  removeRentRow: () => removeRentRow,
  scanRentNow: () => scanRentNow,
  repairFromInbox: () => repairFromInbox,
  getMarket: () => getMarket,
  getPnlHistory: () => getPnlHistory,
  scanMarketNow: () => scanMarketNow,
  marketToDeal: () => marketToDeal,
  marketPass: () => marketPass,
  marketSave: () => marketSave,
};

let REQ_EMAIL_ = ''; // the verified owner for this request

/**
 * Old links (the Apps Script /exec URLs) send people to the GitHub pages,
 * so bookmarks and bid links already sent to the GC keep working.
 */
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.ping) return serverCheck_();
  let url = CONFIG.SITE_URL + 'dashboard/' + (p.lead ? '?lead=' + encodeURIComponent(String(p.lead).slice(0, 5000)) : '');
  if (p.bid) url = CONFIG.SITE_URL + 'bid/?bid=' + encodeURIComponent(p.bid) + '&k=' + encodeURIComponent(p.k || '') + (p.preview === '1' ? '&preview=1' : '');
  const safe = escape_(url);
  return HtmlService.createHtmlOutput(
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<script>window.top.location.replace(' + JSON.stringify(url).replace(/</g, '\\u003c') + ');</script>' +
    '<p style="font:16px system-ui;margin:20vh auto;max-width:420px;text-align:center">This page moved. <a href="' + safe + '" target="_top">Open it here</a>.</p>'
  ).setTitle('Moved · The Fund Worldwide');
}

/**
 * Opened from the dashboard's "Check the server" link (/exec?ping=1). If this page shows,
 * the deployment is fine; if Google shows its own page instead, that page is the problem.
 */
function serverCheck_() {
  let sheet;
  try { sheet = 'opened "' + SpreadsheetApp.openById(CONFIG.PNL_SHEET_ID).getName() + '"'; }
  catch (err) { sheet = 'could not open it. Check PNL_SHEET_ID. (' + (err && err.message ? err.message : err) + ')'; }
  const msg = 'The Fund server is running.\n\nP&L sheet: ' + sheet + '\n\nIf the dashboard still says it can\'t reach the server, deploy a new version: Deploy → Manage deployments → ✏️ → Version: New version → Deploy.';
  return ContentService.createTextOutput(msg);
}

/**
 * Every call from the GitHub pages (and the iPhone Shortcut) comes in here.
 * Body (sent as text/plain so the browser skips a CORS preflight):
 *   {action: 'getDashboardData' | 'addTodo' | …, args: [...], idToken: Google sign-in token}   owner dashboard
 *   {action: 'bid.get', bid, k} / {action: 'bid.submit', bid, k, data}                         GC bid page
 *   {key: INTAKE_KEY, text, from}                                                               iPhone Shortcut (plain-text reply)
 *   {action: 'hub.event', key: HUB_KEY, event: {...}}                                           Braun hub (Quo line)
 *   {action: 'hub.tenants', key: HUB_KEY}                                                       Braun hub: who to text
 *   {action: 'hub.comps', key: HUB_KEY, address}                                                Braun hub: sold comps for a listing
 */
function doPost(e) {
  let body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (x) { body = (e && e.parameter) || {}; }
  if (!body.action) return shortcutIntake_(body);

  const json = (o) => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
  try {
    if (body.action === 'bid.get') {
      const deal = dealForGc_(body.bid, body.k);
      if (deal && body.preview) deal.preview = true;
      return json({ ok: true, result: deal });
    }
    if (body.action === 'bid.submit') {
      return json({ ok: true, result: submitBid(body.bid, body.k, body.data) });
    }
    if (body.action === 'hub.event') {
      return json({ ok: true, result: hubEvent_(body) });
    }
    if (body.action === 'hub.tenants') {
      return json({ ok: true, result: hubTenants_(body) });
    }
    if (body.action === 'hub.comps') {
      return json({ ok: true, result: hubComps_(body) });
    }
    const fn = OWNER_ACTIONS[body.action];
    if (!fn) return json({ ok: false, error: 'Unknown request.' });
    let email = verifySession_(body.session);
    const fresh = !email;
    if (fresh) email = verifyGoogleToken_(body.idToken);
    if (!email) return json({ ok: false, auth: true, error: 'Please sign in again.' });
    if (!isOwner_(email)) return json({ ok: false, auth: true, notOwner: true, email: email, error: email + ' isn\'t one of the owner accounts.' });
    REQ_EMAIL_ = email;
    const args = Array.isArray(body.args) ? body.args : [];
    const out = { ok: true, result: fn().apply(null, args) };
    if (fresh) out.session = makeSession_(email); // the page keeps this, so Google sign-in is needed once a month, not once an hour
    return json(out);
  } catch (err) {
    return json({ ok: false, error: err && err.message ? err.message : String(err) });
  }
}

/** Checks a Google sign-in token (from the dashboard's "Sign in with Google") and returns its email, or ''. */
function verifyGoogleToken_(token) {
  token = String(token || '');
  if (token.split('.').length !== 3) return '';
  const cache = CacheService.getScriptCache();
  const ck = 'tok_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token)).slice(0, 40);
  const hit = cache.get(ck);
  if (hit) return hit;
  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return '';
  const t = JSON.parse(res.getContentText());
  const now = Math.floor(Date.now() / 1000);
  if (t.aud !== CONFIG.GOOGLE_CLIENT_ID) return '';
  if (!/^(https:\/\/)?accounts\.google\.com$/.test(String(t.iss))) return '';
  if (String(t.email_verified) !== 'true') return '';
  if (!(Number(t.exp) > now)) return '';
  const email = String(t.email || '').toLowerCase();
  const ttl = Math.min(600, Number(t.exp) - now - 30);
  if (email && ttl > 0) cache.put(ck, email, ttl);
  return email;
}

// ---------- On the market: listed homes that have sat, priced against our own comps ----------
// One RentCast lookup per scan (it counts toward the same monthly limit as comp pulls). Results live in the
// "Owner Market" tab; a home that drops out of a later scan is marked Gone (sold, pending or pulled).
const MARKET_TAB = 'Owner Market';
const MARKET_HEAD = ['Listing ID', 'Address', 'Zip', 'Type', 'Price', 'First price', 'Sq ft', 'Beds', 'Baths', 'Year built', 'Days on market', 'Listed', 'Agent', 'Agent phone', 'Office', 'MLS #', 'First seen', 'Last seen', 'Status', 'Deal ID', 'Source', 'Last sold', 'Last sold price', 'Notes', 'Stage', 'History', 'Remarks', 'URL'];
const MARKET_STAGES = ['New', 'Watching', 'Toured', 'Offer made'];
// Street number, street and zip, lowercased: how the same home is matched across scans and sources.
const marketKey_ = (addr, zip) => String(addr || '').split(',')[0].toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() + ' ' + String(zip || '');

function marketSheet_() {
  const ss = dealsBook_(MARKET_TAB);
  let sh = ss.getSheetByName(MARKET_TAB);
  if (!sh) { sh = ss.insertSheet(MARKET_TAB); sh.appendRow(MARKET_HEAD); sh.setFrozenRows(1); return sh; }
  // Tabs made before a column existed get it added at the end.
  const head = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0].map((h) => String(h).trim());
  const missing = MARKET_HEAD.filter((h) => head.indexOf(h) < 0);
  if (missing.length) { ensureCols_(sh, head.length + missing.length); sh.getRange(1, head.length + 1, 1, missing.length).setValues([missing]); }
  return sh;
}
function readMarket_(sh) {
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, MARKET_HEAD.length).getValues();
}

/** Keeps the listings that fit the buy box. Pure, so it can be checked without RentCast. */
function marketFilter_(list, box) {
  return (Array.isArray(list) ? list : []).filter((l) => {
    const sqft = num_(l.squareFootage), price = num_(l.price);
    return l && l.id && String(l.status || 'Active') === 'Active' &&
      box.ZIPS.indexOf(String(l.zipCode)) >= 0 && box.TYPES.indexOf(String(l.propertyType)) >= 0 &&
      price >= box.PRICE_MIN && price <= box.PRICE_MAX &&
      (!sqft || (sqft >= box.SQFT_MIN && sqft <= box.SQFT_MAX)) &&
      num_(l.daysOnMarket) >= box.MIN_DAYS;
  });
}

/**
 * Folds a RentCast scan into the saved rows. A home already on the list (same ID or same address) keeps its first price,
 * first seen, notes, stage, last sale and deal link. Only RentCast's own rows become Gone when they drop out of a scan;
 * homes added by hand or from another source are left alone. Pure.
 */
function marketMerge_(old, fresh, today) {
  const I = {}; MARKET_HEAD.forEach((h, i) => { I[h] = i; });
  const byId = {}, byAddr = {}; old.forEach((r) => { byId[String(r[I['Listing ID']])] = r; byAddr[marketKey_(r[I.Address], r[I.Zip])] = r; });
  const seen = new Set();
  const rows = fresh.map((l) => {
    const was = byId[l.id] || byAddr[marketKey_(l.formattedAddress || l.addressLine1, l.zipCode)]; if (was) seen.add(was);
    const agent = l.listingAgent || {}, office = l.listingOffice || {};
    const r = MARKET_HEAD.map(() => '');
    r[I['Listing ID']] = l.id; r[I.Address] = plainCell_(l.formattedAddress || l.addressLine1 || ''); r[I.Zip] = String(l.zipCode || '');
    r[I.Type] = l.propertyType || ''; r[I.Price] = num_(l.price); r[I['First price']] = was ? was[I['First price']] || num_(l.price) : num_(l.price);
    r[I['Sq ft']] = num_(l.squareFootage) || ''; r[I.Beds] = l.bedrooms == null ? '' : l.bedrooms; r[I.Baths] = l.bathrooms == null ? '' : l.bathrooms;
    r[I['Year built']] = l.yearBuilt || ''; r[I['Days on market']] = num_(l.daysOnMarket); r[I.Listed] = String(l.listedDate || '').slice(0, 10);
    r[I.Agent] = plainCell_(agent.name || ''); r[I['Agent phone']] = plainCell_(agent.phone || office.phone || ''); r[I.Office] = plainCell_(office.name || ''); r[I['MLS #']] = plainCell_(l.mlsNumber || '');
    r[I['First seen']] = was ? was[I['First seen']] || today : today; r[I['Last seen']] = today;
    r[I.Status] = was && was[I.Status] === 'Passed' ? 'Passed' : 'Active'; r[I['Deal ID']] = was ? was[I['Deal ID']] : '';
    r[I.Source] = 'RentCast';
    ['Last sold', 'Last sold price', 'Notes', 'Stage', 'History', 'Remarks', 'URL'].forEach((h) => { r[I[h]] = was ? was[I[h]] : ''; });
    return r;
  });
  old.forEach((r) => {
    if (seen.has(r)) return;
    const keep = MARKET_HEAD.map((_, i) => (r[i] == null ? '' : r[i]));
    if (keep[I.Status] === 'Active' && (!keep[I.Source] || keep[I.Source] === 'RentCast')) keep[I.Status] = 'Gone';
    rows.push(keep);
  });
  return rows;
}

function scanMarket_() {
  const key = prop_('RENTCAST_API_KEY');
  if (!key) throw new Error('Add your RentCast API key first: Apps Script, Project Settings, Script Properties, RENTCAST_API_KEY.');
  const used = rentcastUsed_();
  if (used >= CONFIG.RENTCAST_MONTHLY_LIMIT) throw new Error('All ' + CONFIG.RENTCAST_MONTHLY_LIMIT + ' RentCast lookups for this month are used. They reset on the 1st.');
  const box = CONFIG.MARKET;
  const q = { city: box.CITY, state: box.STATE, status: 'Active', propertyType: box.TYPES.join('|'), price: box.PRICE_MIN + ':' + box.PRICE_MAX, daysOld: box.MIN_DAYS + ':730', limit: 500 };
  const url = 'https://api.rentcast.io/v1/listings/sale?' + Object.keys(q).map((k) => k + '=' + encodeURIComponent(q[k])).join('&');
  const res = UrlFetchApp.fetch(url, { headers: { 'X-Api-Key': key, Accept: 'application/json' }, muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('RentCast answered ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 200));
  PropertiesService.getScriptProperties().setProperty('RENTCAST_USED_' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMM'), String(used + 1));
  const list = JSON.parse(res.getContentText() || '[]');
  const fit = marketFilter_(list, box);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = marketSheet_();
    const rows = marketMerge_(readMarket_(sh), fit, ymd_(new Date()));
    if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, MARKET_HEAD.length).clearContent();
    if (rows.length) sh.getRange(2, 1, rows.length, MARKET_HEAD.length).setValues(rows);
  } finally { lock.releaseLock(); }
  // shortcut: one page of 500; if RentCast ever returns a full page, some homes were cut off and this needs a second call with offset=500
  PropertiesService.getScriptProperties().setProperty('MARKET_SCAN', JSON.stringify({ at: new Date().toISOString(), returned: list.length, fit: fit.length }));
  return { returned: list.length, fit: fit.length };
}

/** "2026-01-15 Listed $140,000; 2026-04-14 Cut $125,000; ..." into the current listing run: first price, cuts, a deal that fell through. Pure. */
function marketHistory_(text) {
  const ev = String(text || '').split(/;\s*/).map((x) => {
    const m = /^(\d{4}-\d{2}-\d{2})\s+([A-Za-z ]+?)(?:\s+\$([\d,]+))?\s*$/.exec(x.trim());
    return m ? { date: m[1], kind: m[2].trim().toLowerCase(), price: m[3] ? Number(m[3].replace(/,/g, '')) : null } : null;
  }).filter((e) => e && !(e.price && e.price < 10000)) // prices under $10k are rental listings
    .sort((p, q) => (p.date < q.date ? -1 : p.date > q.date ? 1 : 0));
  // The current run starts at the latest "Listed". A relist within 180 days of the step before it (and no sale between)
  // is the same seller still trying, so the run reaches back to the earlier listing.
  const days = (a, b) => (new Date(b) - new Date(a)) / 864e5;
  let start = -1;
  for (let i = ev.length - 1; i >= 0; i--) { if (ev[i].kind === 'sold') break; if (ev[i].kind === 'listed') { start = i; break; } }
  while (start > 0) {
    let j = start - 1; if (ev[j].kind === 'sold' || days(ev[j].date, ev[start].date) > 180) break;
    let k = j; while (k >= 0 && ev[k].kind !== 'listed' && ev[k].kind !== 'sold') k--;
    if (k < 0 || ev[k].kind === 'sold') break;
    start = k;
  }
  const run = start < 0 ? [] : ev.slice(start);
  const cuts = run.filter((e) => /cut|reduc|price chang/.test(e.kind) && e.price);
  const sold = ev.filter((e) => e.kind === 'sold' && e.price).pop() || null;
  return {
    listed: run.length ? run[0].date : '', firstPrice: run.length ? run[0].price : null, cuts: cuts.length,
    fellThrough: run.some((e) => /pending|contingent/.test(e.kind)) ? run.filter((e) => /pending|contingent/.test(e.kind)).pop().date : '',
    sold: sold, events: ev,
  };
}

const ROUGH_RE_ = /as[- ]is|handyman|tear (it )?down|needs (some )?work|fixer|\btlc\b|investor special|bring your (tools|vision)|needs updat/i;
const UPDATED_RE_ = /updated|renovated|remodel|move[- ]in ready|new roof|newer roof|new (furnace|hvac|windows|kitchen|flooring)|newer (furnace|hvac|windows)/i;
const MOTIVE_RE_ = /as[- ]is|investor|handyman|land contract|motivated|bring (all )?offers|cash only|cash or conventional|tear (it )?down|needs (some )?work|estate|price reduced/gi;

/** Rent we'd expect, from our own homes: same zip and bedrooms, else same bedrooms anywhere, else our rent per bedroom. Pure. */
function marketRent_(own, zip, beds, multi) {
  const med = (xs) => { const a = xs.slice().sort((p, q) => p - q); return a.length ? a[Math.floor((a.length - 1) / 2)] : null; };
  const one = (b) => {
    b = Math.max(1, Math.min(6, Math.round(b || 3)));
    const sameZip = own.filter((u) => u.zip === zip && u.beds === b).map((u) => u.rent);
    if (sameZip.length >= 2) return { rent: med(sameZip), basis: sameZip.length + ' of our ' + b + ' bd in ' + zip };
    const sameBeds = own.filter((u) => u.beds === b).map((u) => u.rent);
    if (sameBeds.length) return { rent: med(sameBeds), basis: sameBeds.length + ' of our ' + b + ' bd homes' };
    // Bigger than anything we own: our largest size plus $150 a bedroom, not rent per bedroom (1-bed apartments would inflate it).
    const lower = own.filter((u) => u.beds > 0 && u.beds < b).map((u) => u.beds);
    if (lower.length) {
      const nb = Math.max.apply(null, lower), xs = own.filter((u) => u.beds === nb).map((u) => u.rent);
      return { rent: med(xs) + 150 * (b - nb), basis: 'our ' + nb + ' bd homes + $150 a bedroom' };
    }
    const higher = own.filter((u) => u.beds > b).map((u) => u.beds);
    if (!higher.length) return null;
    const nb = Math.min.apply(null, higher), xs = own.filter((u) => u.beds === nb).map((u) => u.rent);
    return { rent: Math.max(0, med(xs) - 150 * (nb - b)), basis: 'our ' + nb + ' bd homes − $150 a bedroom' };
  };
  if (!own.length) return null;
  if (!multi) return one(beds);
  // shortcut: a multi-unit listing is read as two equal units; check the real unit mix before offering
  const u = one(Math.max(1, Math.floor((beds || 4) / 2)));
  return u ? { rent: u.rent * 2, basis: 'assumes 2 units; ' + u.basis, units: 2 } : null;
}

/** Everything we decide on for one listed home: motivation, a flip read, a rental read, offer, walk-away and a verdict. Pure. */
function marketRead_(m, ctx) {
  const R = ctx.rental, H = marketHistory_(m.history);
  const text = (m.remarks || '') + ' ' + (m.notes || '');
  const cond = ROUGH_RE_.test(text) ? 'rough' : UPDATED_RE_.test(text) ? 'updated' : 'unknown';
  const multi = m.type !== 'Single Family' || /duplex|two separate homes|multi-?family|separate utilities|both units|\b[23] units\b/i.test(m.remarks || '');
  if (H.listed && ctx.today) m.dom = Math.max(m.dom || 0, Math.round((new Date(ctx.today) - new Date(H.listed)) / 864e5));
  const firstPrice = H.firstPrice || m.firstPrice || m.price;
  const lastSold = H.sold ? { date: H.sold.date, price: H.sold.price } : (m.lastSoldPrice ? { date: m.lastSold, price: m.lastSoldPrice } : null);

  // Seller motivation
  let score = 0; const why = [];
  if (m.dom >= 180) { score += 3; why.push(m.dom + ' days listed'); } else if (m.dom >= 120) { score += 2; why.push(m.dom + ' days listed'); } else if (m.dom >= 60) { score += 1; why.push(m.dom + ' days listed'); }
  const cutPct = firstPrice > m.price ? (firstPrice - m.price) / firstPrice : 0;
  if (H.cuts) { score += Math.min(3, H.cuts); why.push(H.cuts + ' price cut' + (H.cuts > 1 ? 's' : '') + (cutPct ? ' (' + Math.round(cutPct * 100) + '% off)' : '')); }
  else if (cutPct >= 0.03) { score += 1; why.push('down ' + Math.round(cutPct * 100) + '% from $' + firstPrice.toLocaleString('en-US')); }
  if (cutPct >= 0.15) score += 2;
  if (H.fellThrough) { score += 2; why.push('a deal fell through'); }
  if (lastSold && lastSold.price > 10000 && lastSold.date >= ctx.tenYearsAgo && m.price <= lastSold.price * 1.1) {
    score += 2; why.push('asking ' + (m.price < lastSold.price ? 'under' : 'near') + ' what the seller paid ($' + lastSold.price.toLocaleString('en-US') + ' in ' + lastSold.date.slice(0, 4) + ')');
  }
  const words = Array.from(new Set((text.match(MOTIVE_RE_) || []).map((w) => w.toLowerCase())));
  if (words.length) { score += Math.min(3, words.length); why.push('says ' + words.slice(0, 3).join(', ')); }
  const level = score >= 6 ? 'High' : score >= 3 ? 'Medium' : 'Low';

  // Flip read: houses only; our comps carry no duplex sales.
  let flip = null;
  if (!multi && m.sqft) {
    const c = compArv_(ctx.comps, m.zip, m.sqft);
    if (c && c.n) {
      const tier = cond === 'rough' ? 'Heavy' : cond === 'updated' ? 'Light' : 'Medium';
      const rehab = Math.round(m.sqft * CONFIG.REHAB_PER_SQFT[tier]);
      // Price where profit = MIN_PROFIT after buy closing, holding (tax, insurance, utilities) and selling; same math as the deal screen.
      const F = CONFIG.FLIP, hm = F.HOLD_MONTHS;
      const max = (c.arv * (1 - F.SELL) - rehab - hm * (R.INSURANCE + F.UTILITIES) - F.MIN_PROFIT) / (1 + F.BUY_CLOSING + hm * R.TAX_RATE / 12);
      flip = { arv: c.arv, compN: c.n, basis: c.basis, rehab: rehab, tier: tier, max: Math.round(max) };
    }
  }

  // Rental read
  let rental = null;
  const est = marketRent_(ctx.own, m.zip, m.beds, multi);
  if (est && est.rent) {
    const r = R.RATE / 12, n = R.YEARS * 12, pay = r / (1 - Math.pow(1 + r, -n));
    const perDollar = R.TAX_RATE / 12 + (1 - R.DOWN) * pay;
    const net = est.rent * (1 - R.RESERVES) - R.INSURANCE;
    const rehab = m.sqft ? Math.round(m.sqft * R.REHAB_PER_SQFT[cond]) : 0;
    rental = {
      rent: est.rent, basis: est.basis, units: est.units || 1, rehab: rehab,
      ratio: (m.price + rehab) ? est.rent / (m.price + rehab) : null,
      cashFlow: Math.round(net - m.price * perDollar),
      max: Math.round((net - R.MIN_CASH_FLOW * (est.units || 1)) / perDollar - rehab),
    };
  }

  // Offer and verdict
  // A flip number only drives the verdict when the zip has renovated sales to stand on, and asking isn't suspiciously far
  // under it without the listing saying why (a rough house already carries the heavy rehab).
  const tooCheap = flip && cond !== 'rough' && m.price < flip.arv * 0.35;
  if (flip) flip.solid = flip.basis === 'renovated' && !tooCheap;
  const picks = [flip && flip.solid && flip.max > 0 ? ['flip', flip.max] : null, rental && rental.max > 0 ? ['rental', rental.max] : null].filter(Boolean).sort((p, q) => q[1] - p[1]);
  const fit = picks.length ? picks[0][0] : '';
  // What the numbers can carry, and the walk-away: never above asking, since there's no reason to pay more than they ask.
  const supports = picks.length ? Math.round(picks[0][1] / 500) * 500 : null;
  const walk = supports ? Math.min(supports, m.price) : null;
  const gap = supports ? (m.price - supports) / m.price : null;
  let verdict, reason;
  const r500 = (x) => Math.round(x / 500) * 500;
  const open = walk ? r500(walk * (level === 'High' ? 0.88 : level === 'Medium' ? 0.92 : 0.95)) : null;
  if (!flip && !rental) { verdict = 'Watch'; reason = 'No comps or rents to judge this one by yet.'; }
  else if (!supports) { verdict = 'Pass'; reason = flip && !flip.solid && flip.max > 0 ? 'The rental math doesn\'t work, and the flip number rests on thin or zip-wide comps, so check sold flips on that street first.' : 'Neither works: no price clears the flip profit or the rental cash flow.'; }
  else if (gap <= 0.10 || (gap <= 0.20 && level === 'High')) { verdict = 'Offer'; }
  else if (gap <= 0.30) { verdict = 'Watch'; }
  else { verdict = 'Pass'; reason = 'Would take ' + Math.round(gap * 100) + '% off asking to work.'; }
  if (!reason) {
    reason = (tooCheap ? 'Asking is far under the zip-wide ARV, which usually means condition or block problems, so the flip number is left out. ' : flip && !flip.solid ? 'Too few renovated sales in ' + m.zip + ' to lean on the flip number. ' : '') + (gap > 0 ? 'The ' + fit + ' math tops out at $' + supports.toLocaleString('en-US') + ', ' + Math.round(gap * 100) + '% under asking.' : 'The ' + fit + ' math works at asking, so asking is your ceiling.') +
      (level === 'High' ? ' The seller looks ready to deal, so open low.' : level === 'Medium' ? ' Some signs the seller will bend.' : ' Little sign the seller will bend; expect a counter.');
  }
  return {
    cond: cond, firstPrice: firstPrice, cuts: H.cuts, fellThrough: H.fellThrough, lastSold: lastSold, events: H.events,
    motivation: { score: score, level: level, why: why }, flip: flip, rental: rental,
    fit: fit, supports: supports, walk: walk, open: open, gap: gap, verdict: verdict, reason: reason,
  };
}

/** Our own homes with a rent on file, with zip and bedrooms from the site's listings. */
function ownRents_() {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.PNL_SHEET_ID);
    const units = readListings_(ss).units || [];
    const rentBy = {};
    // Roommates each carry their share of the rent (Violet: $775 + $775), so a home's rent is the sum of its rows.
    readTenants_(ss, units).forEach((t) => { if (t.rent > 0) rentBy[t.unitId] = (rentBy[t.unitId] || 0) + t.rent; });
    const skip = CONFIG.RENTAL.SKIP_UNITS || [];
    return units.filter((u) => rentBy[u.id] && u.zip && skip.indexOf(u.id) < 0).map((u) => ({ zip: String(u.zip), beds: Number(u.beds) || 0, rent: rentBy[u.id] }));
  } catch (e) { return []; }
}

// ---------- past years (every P&L: 2023's one-tab layout, 2024's Operations/Capital, 2025 on Ops/Cap) ----------
const PNL_OPS_TABS_ = /^(ops|operations|all data overview)$/i, PNL_CAP_TABS_ = /^(cap|capital)$/i;

/** Every month-by-property block on a P&L's operating and capital tabs: a label above a Jan…Dec column, with a Totals column. */
function pnlBlocks_(sheets) {
  const out = [];
  sheets.forEach((sh) => {
    const name = sh.getName(), cap = PNL_CAP_TABS_.test(name);
    if (!cap && !PNL_OPS_TABS_.test(name)) return;
    const v = sh.getDataRange().getValues();
    for (let r = 0; r + 1 < v.length; r++) {
      for (let c = 0; c < v[r].length; c++) {
        const label = String(v[r][c]).trim();
        if (!label || String(v[r + 1][c]).trim() !== 'Jan') continue;
        const t = v[r].findIndex((x, k) => k > c && /^totals?$/i.test(String(x).trim()));
        const props = [];
        for (let k = c + 1; k < (t > 0 ? t : v[r].length); k++) if (String(v[r][k]).trim()) props.push({ name: String(v[r][k]).trim(), col: k, months: MONTHS.map(() => 0) });
        const months = MONTHS.map(() => 0);
        for (let rr = r + 1; rr < Math.min(v.length, r + 14); rr++) {
          const m = MONTHS.indexOf(String(v[rr][c]).trim().slice(0, 3));
          if (m < 0) continue;
          props.forEach((p) => { p.months[m] = num_(v[rr][p.col]); });
          months[m] = t > 0 ? num_(v[rr][t]) : props.reduce((a, p) => a + p.months[m], 0);
        }
        out.push({ label: label, cap: cap, months: months, props: props });
      }
    }
  });
  return out;
}

const PNL_OPEX_ = [[/secur|deposit/i, ''], [/rental income|^income$/i, 'income'], [/loan/i, 'loans'], [/escrow/i, 'Tax and insurance (escrow)'], [/expense/i, 'Repairs and upkeep'],
  [/utilit/i, 'Utilities'], [/insurance/i, 'Insurance'], [/tax/i, 'Property tax']];

/** One year's totals from its blocks. A month counts once it has rent in it (so this year stops at the last month entered). */
function pnlYear_(blocks, year) {
  const kind = (label) => { const k = PNL_OPEX_.filter((x) => x[0].test(label))[0]; return k ? k[1] : 'Other'; };
  const inc = blocks.filter((b) => !b.cap && kind(b.label) === 'income')[0];
  if (!inc) return null;
  let last = -1; inc.months.forEach((x, i) => { if (x > 0) last = i; });
  const upTo = (a) => a.slice(0, last + 1).reduce((p, q) => p + q, 0);
  const y = { year: year, months: last + 1, income: upTo(inc.months), opex: {}, loans: 0, capex: null, vacantMonths: 0, vacancyLoss: 0 };
  blocks.forEach((b) => {
    const k = kind(b.label), amt = upTo(b.months);
    if (b.cap) { y.capex = y.capex || {}; const l = /loan/i.test(b.label) ? 'Loan payments' : /material|labor/i.test(b.label) ? 'Materials and labor' : /utilit/i.test(b.label) ? 'Utilities' : /insur/i.test(b.label) ? 'Insurance' : /tax/i.test(b.label) ? 'Property tax' : b.label; y.capex[l] = (y.capex[l] || 0) + amt; return; }
    if (!k || k === 'income') return;
    if (k === 'loans') y.loans += amt; else y.opex[k] = (y.opex[k] || 0) + amt;
  });
  // Vacancy: a month with no rent between a home's first and last rent month this year, at that home's usual rent.
  inc.props.forEach((p) => {
    const m = p.months.slice(0, last + 1), paid = m.map((x, i) => x > 0 ? i : -1).filter((i) => i >= 0);
    if (paid.length < 2) return;
    const usual = m.filter((x) => x > 0).sort((a, b) => a - b)[Math.floor((paid.length - 1) / 2)];
    for (let i = paid[0]; i <= paid[paid.length - 1]; i++) if (!(m[i] > 0)) { y.vacantMonths++; y.vacancyLoss += usual; }
  });
  y.opexTotal = Object.keys(y.opex).reduce((a, k) => a + y.opex[k], 0);
  y.capexTotal = y.capex ? Object.keys(y.capex).reduce((a, k) => a + y.capex[k], 0) : null;
  y.repairs = y.opex['Repairs and upkeep'] || 0;
  return y;
}

/** Every year we have, plus the reserve the rental read should hold back: our own repairs and vacancy as a share of rent. */
function pnlHistory_() {
  const cache = CacheService.getScriptCache(), hit = cache.get('pnlHistory2');
  if (hit) return JSON.parse(hit);
  const years = CONFIG.PNL_PAST.concat([CONFIG.PNL_SHEET_ID]).map((id) => {
    try {
      const ss = SpreadsheetApp.openById(id), year = Number((/\b(20\d\d)\b/.exec(ss.getName()) || [])[1]) || null;
      const y = pnlYear_(pnlBlocks_(ss.getSheets()), year);
      return y && Object.assign(y, { url: ss.getUrl() });
    } catch (e) { return null; }
  }).filter(Boolean).sort((a, b) => a.year - b.year);
  const sum = (k) => years.reduce((a, y) => a + y[k], 0), income = sum('income');
  const res = income ? { repairs: sum('repairs') / income, vacancy: sum('vacancyLoss') / (income + sum('vacancyLoss')) } : null;
  if (res) { res.total = Math.round((res.repairs + res.vacancy) * 200) / 200; res.from = years[0].year + (years.length > 1 ? '–' + years[years.length - 1].year : ''); }
  const out = { years: years, reserves: res };
  try { cache.put('pnlHistory2', JSON.stringify(out), 6 * 3600); } catch (e) {}
  return out;
}
function getPnlHistory() { requireOwner_(); CacheService.getScriptCache().remove('pnlHistory2'); return pnlHistory_(); }

/** The saved list with our full read on each home. */
function marketData_() {
  const I = {}; MARKET_HEAD.forEach((h, i) => { I[h] = i; });
  const tz = Session.getScriptTimeZone();
  // Reserves come from our own P&Ls (repairs + vacancy as a share of rent), not a rule of thumb.
  let hist = null; try { hist = pnlHistory_().reserves; } catch (e) {}
  const rental = Object.assign({}, CONFIG.RENTAL, hist ? { RESERVES: hist.total, RESERVES_FROM: hist } : {});
  const ctx = { comps: readComps_(), own: ownRents_(), rental: rental, today: Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd'), tenYearsAgo: Utilities.formatDate(new Date(Date.now() - 3652 * 864e5), tz, 'yyyy-MM-dd') };
  const rows = readMarket_(marketSheet_()).filter((r) => r[I.Status] === 'Active').map((r) => {
    const m = {
      id: String(r[I['Listing ID']]), address: String(r[I.Address]), zip: String(r[I.Zip]), type: String(r[I.Type]) || 'Single Family', price: num_(r[I.Price]), firstPrice: num_(r[I['First price']]),
      sqft: num_(r[I['Sq ft']]) || null, beds: r[I.Beds] === '' ? null : num_(r[I.Beds]), baths: r[I.Baths] === '' ? null : num_(r[I.Baths]), year: num_(r[I['Year built']]) || null,
      dom: num_(r[I['Days on market']]), listed: cellDate_(r[I.Listed]), agent: String(r[I.Agent]), agentPhone: String(r[I['Agent phone']]), office: String(r[I.Office]), mls: String(r[I['MLS #']]),
      dealId: String(r[I['Deal ID']]), source: String(r[I.Source] || ''), lastSold: cellDate_(r[I['Last sold']]), lastSoldPrice: num_(r[I['Last sold price']]) || null,
      notes: String(r[I.Notes] || ''), stage: MARKET_STAGES.indexOf(String(r[I.Stage])) >= 0 ? String(r[I.Stage]) : 'New',
      history: String(r[I.History] || ''), remarks: String(r[I.Remarks] || ''),
      url: /^https:\/\/www\.(redfin|zillow|realtor)\.com\//.test(String(r[I.URL] || '')) ? String(r[I.URL]) : '',
    };
    if (!m.price) return null;
    return Object.assign(m, { read: marketRead_(m, ctx) });
  }).filter(Boolean);
  let scan = null; try { scan = JSON.parse(prop_('MARKET_SCAN') || 'null'); } catch (e) {}
  return { rows: rows, scan: scan, box: CONFIG.MARKET, rental: rental, flip: CONFIG.FLIP, rehabRates: CONFIG.REHAB_PER_SQFT, ownRents: ctx.own.length, flaggedComps: ctx.comps.filter((c) => c.flag).length,
    used: rentcastUsed_(), limit: CONFIG.RENTCAST_MONTHLY_LIMIT, hasKey: !!prop_('RENTCAST_API_KEY'), stages: MARKET_STAGES };
}
function getMarket() { requireOwner_(); return marketData_(); }
function scanMarketNow() { requireOwner_(); scanMarket_(); return marketData_(); }

function marketSet_(id, col, val) {
  const sh = marketSheet_(), rows = readMarket_(sh);
  const i = rows.findIndex((r) => String(r[0]) === String(id));
  if (i < 0) throw new Error('That home is no longer on the list. Refresh and try again.');
  sh.getRange(i + 2, MARKET_HEAD.indexOf(col) + 1).setValue(val);
  return rows[i];
}
function marketPass(id) { requireOwner_(); marketSet_(id, 'Status', 'Passed'); return true; }
/** Your own notes and where you are with a listed home. */
function marketSave(id, notes, stage) {
  requireOwner_();
  if (MARKET_STAGES.indexOf(stage) < 0) throw new Error('Pick a stage from the list.');
  marketSet_(id, 'Notes', plainCell_(String(notes || '').slice(0, 2000)));
  marketSet_(id, 'Stage', stage);
  return true;
}
/** Starts a deal from a listed home, so it gets comps, the appraiser check and a GC bid link like any lead. */
function marketToDeal(id) {
  const email = requireOwner_();
  const m = marketData_().rows.filter((x) => x.id === String(id))[0];
  if (!m) throw new Error('That home is no longer on the list. Refresh and try again.');
  if (m.dealId) return m.dealId;
  const dealId = addDeal({
    address: m.address, asking: m.price, arv: (m.read.flip && m.read.flip.arv) || '', sqft: m.sqft || '', yearBuilt: m.year || '', from: 'On market' + (m.agent ? ': ' + m.agent : ''),
    bedsBaths: m.beds != null && m.baths != null ? m.beds + '/' + m.baths : '',
    notes: 'Listed ' + m.dom + ' days' + (m.firstPrice > m.price ? ', down from $' + m.firstPrice.toLocaleString('en-US') : '') + (m.mls ? '. MLS ' + m.mls : '') + (m.agentPhone ? '. Agent ' + m.agent + ' ' + m.agentPhone : '') + '.',
  });
  marketSet_(id, 'Deal ID', dealId);
  return dealId;
}
/** Runs from a weekly trigger. Start it once from the editor: run installWeeklyMarketScan. */
function weeklyMarketScan() { scanMarket_(); }
function installWeeklyMarketScan() {
  ScriptApp.getProjectTriggers().filter((t) => t.getHandlerFunction() === 'weeklyMarketScan').forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('weeklyMarketScan').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(6).create();
  return scanMarket_();
}

// ---------- 30-day sign-in ----------
// After a Google sign-in checks out, the page gets a session: "email|expiry" signed with a secret only this script holds.
// Owners are re-checked on every request, so taking someone off OWNERS locks them out at once.
// To sign everyone out, delete the SESSION_SECRET script property.
const SESSION_DAYS = 30;
function sessionSig_(payload) {
  const props = PropertiesService.getScriptProperties();
  let secret = props.getProperty('SESSION_SECRET');
  // shortcut: two first-ever requests at the same moment could each make a secret (one owner signs in twice); add LockService if that ever matters
  if (!secret) { secret = Utilities.getUuid() + Utilities.getUuid(); props.setProperty('SESSION_SECRET', secret); }
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(payload, secret));
}
function makeSession_(email) {
  const payload = email + '|' + (Date.now() + SESSION_DAYS * 864e5);
  return Utilities.base64EncodeWebSafe(payload) + '.' + sessionSig_(payload);
}
/** Returns the session's email, or '' if it's missing, forged or expired. */
function verifySession_(tok) {
  const parts = String(tok || '').split('.');
  if (parts.length !== 2) return '';
  let payload;
  try { payload = Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString(); } catch (e) { return ''; }
  if (!sameSecret_(parts[1], sessionSig_(payload))) return '';
  const i = payload.lastIndexOf('|');
  return Number(payload.slice(i + 1)) > Date.now() ? payload.slice(0, i) : '';
}

/** Called from the page. Returns plain data; the page does the math and drawing. */
function getDashboardData() {
  const email = currentEmail_();
  if (!isOwner_(email)) throw new Error('Not authorized.');

  let ss;
  try {
    ss = SpreadsheetApp.openById(CONFIG.PNL_SHEET_ID);
  } catch (e) {
    throw new Error('Couldn\'t open the P&L sheet. Check PNL_SHEET_ID in the Apps Script. (Google said: ' + (e && e.message ? e.message : e) + ')');
  }

  const portfolio = readListings_(ss);
  const tenants = readTenants_(ss, portfolio.units || []);
  return {
    user: email,
    team: { me: CONFIG.OWNER_NAMES[email] || email.split('@')[0], names: CONFIG.OWNERS.map((x) => CONFIG.OWNER_NAMES[x] || x.split('@')[0]) },
    generatedAt: new Date().toISOString(),
    sheet: { name: ss.getName(), url: ss.getUrl() },
    summary: readMonthlySummaries_(ss),
    byProperty: readOpsIncome_(ss),
    loansByProperty: readOpsBlock_(ss, /^operating loan payments$/i),
    portfolio: portfolio,
    tenants: tenants,
    rent: rentData_(ss, portfolio.units || [], tenants),
    rentalNotes: readRentalNotes_(ss),
    tenantInbox: readTenantInbox_(ss),
    contacts: readContacts_(ss),
    contactLog: readContactLog_(ss),
    crm: { types: CONTACT_TYPES, stages: PROSPECT_STAGES, kinds: LOG_KINDS },
    leaseWindowDays: CONFIG.LEASE_WINDOW_DAYS,
    allocate: readToAllocate_(ss),
    todos: readTodos_(ss),
    balances: readBalances_(ss),
    properties: readPropertySummary_(ss),
    projects: readProjects_(ss),
    deals: dealsData_(),
    comps: compsData_(),
    utilities: utilData_(ss),
  };
}

// ---------- tenants (the "Owner Tenants" tab) ----------
// One row per tenant. Two tenants in one unit = two rows with the same Unit ID.
// Rows are pre-filled with every unit from the site; fill in Tenant, Phone, Email, Lease link.

function tenantSheet_(ss, units) {
  let sh = ss.getSheetByName(TENANT_TAB);
  if (!sh) {
    sh = ss.insertSheet(TENANT_TAB);
    sh.appendRow(TENANT_HEAD);
    sh.setFrozenRows(1);
    sh.getRange('A:A').setFontColor('#9a9a9a');
    sh.getRange('A1').setNote('Matches the unit "id" in the rentals site\'s listings.json. Leave it as is.');
    sh.getRange('F1').setNote('Link to the signed lease: the Innago lease page or the PDF in Drive.');
    sh.getRange('H1').setNote('Day of the month rent is due, e.g. 1. Used in the rent nudge text.');
  }
  // Add a blank row for any unit on the site that isn't in the tab yet.
  const have = {};
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().forEach((r) => { have[String(r[0]).trim()] = true; });
  const add = units.filter((u) => u.id && !have[u.id]).map((u) => [u.id, u.name, '', '', '', '', '', 1, '', '', '', '', '']);
  // Tabs made before a column existed (lease dates, deposit) get it added at the end.
  const head = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0].map((h) => String(h).trim());
  const missing = TENANT_HEAD.filter((h) => head.indexOf(h) < 0);
  if (missing.length) {
    ensureCols_(sh, head.length + missing.length);
    sh.getRange(1, head.length + 1, 1, missing.length).setValues([missing]);
  }
  if (add.length) {
    const width = Math.max(TENANT_HEAD.length, sh.getLastColumn());
    sh.getRange(sh.getLastRow() + 1, 1, add.length, width).setValues(add.map((r) => r.concat(new Array(width - r.length).fill(''))));
  }
  return sh;
}

function readTenants_(ss, units) {
  let sh;
  try {
    sh = tenantSheet_(ss, units);
  } catch (e) {
    sh = ss.getSheetByName(TENANT_TAB);
  }
  if (!sh || sh.getLastRow() < 2) return [];
  const v = sh.getRange(1, 1, sh.getLastRow(), Math.max(TENANT_HEAD.length, sh.getLastColumn())).getDisplayValues();
  const head = v[0].map((h) => String(h).trim().toLowerCase());
  const get = (r, name) => { const c = head.indexOf(name); return c < 0 ? '' : String(r[c] || '').trim(); };
  return v.slice(1).map((r) => ({
    unitId: get(r, 'unit id'),
    unit: get(r, 'unit'),
    name: get(r, 'tenant'),
    phone: get(r, 'phone'),
    email: get(r, 'email'),
    lease: /^https?:\/\//i.test(get(r, 'lease link')) ? get(r, 'lease link') : '',
    rent: num_(get(r, 'rent')),
    dueDay: parseInt(get(r, 'due day'), 10) || 1,
    notes: get(r, 'notes'),
    leaseStart: leaseDate_(get(r, 'lease start')),
    leaseEnd: leaseDate_(get(r, 'lease end')),
    deposit: num_(get(r, 'deposit')),
    depositAt: get(r, 'deposit held at'),
  })).filter((t) => t.unitId && (t.name || t.phone || t.email || t.lease));
}

/** "2027-08-31", "8/31/2027" or "month-to-month" → "2027-08-31" / "month-to-month" / "". */
function leaseDate_(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  if (/month/i.test(s)) return 'month-to-month';
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s);
  if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return y + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2); }
  return '';
}

/** Each unit's lease end, from the Owner Tenants tab (the first tenant row with one). */
function leaseEndsByUnit_(ss) {
  const out = {};
  const sh = ss.getSheetByName(TENANT_TAB);
  if (!sh || sh.getLastRow() < 2) return out;
  const v = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getDisplayValues();
  const head = v[0].map((h) => String(h).trim().toLowerCase());
  const cId = head.indexOf('unit id'), cEnd = head.indexOf('lease end');
  if (cId < 0 || cEnd < 0) return out;
  v.slice(1).forEach((r) => { const id = String(r[cId] || '').trim(), e = leaseDate_(r[cEnd]); if (id && e && !out[id]) out[id] = e; });
  return out;
}

/** Sam and Jack (name, phone, email) from the private Owner Team tab. */
function readOwnerTeam_(ss) {
  const sh = ss.getSheetByName(OWNER_TEAM_TAB);
  if (!sh || sh.getLastRow() < 2) return [];
  const v = sh.getRange(1, 1, sh.getLastRow(), Math.max(3, sh.getLastColumn())).getDisplayValues();
  const head = v[0].map((h) => String(h).trim().toLowerCase());
  const col = (n) => head.indexOf(n);
  return v.slice(1).map((r) => ({ name: String(r[col('name')] || '').trim(), phone: String(r[col('phone')] || '').trim(), email: String(r[col('email')] || '').trim().toLowerCase() }))
    .filter((o) => o.name && (o.phone || o.email));
}

// ---------- tenant inbox (the "Owner Tenant Inbox" tab), fed by the Braun Real Estate hub ----------
// When a Fund tenant texts, calls or leaves a voicemail on the Quo line (260) 254-8558, the hub posts it here.
// Only numbers that match a tenant in "Owner Tenants" are kept; everyone else (Joe's listing traffic) is ignored.

function inboxSheet_(ss) {
  let sh = ss.getSheetByName(INBOX_TAB);
  if (!sh) {
    sh = ss.insertSheet(INBOX_TAB);
    sh.appendRow(INBOX_HEAD);
    sh.setFrozenRows(1);
    sh.getRange('I2:I').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['New', 'Handled'], true).build());
  }
  return sh;
}

function phoneKey_(p) {
  const d = String(p || '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : '';
}

function sameSecret_(a, b) {
  a = String(a || ''); b = String(b || '');
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Called by the Braun hub (no Google sign-in): files one tenant message. */
/** Tenant names, units and phones (no emails, rent or leases) for the Braun hub's "text tenants" tools. */
function hubTenants_(body) {
  const want = PropertiesService.getScriptProperties().getProperty('HUB_KEY');
  if (!want) throw new Error('HUB_KEY is not set in Script Properties.');
  if (!sameSecret_(body.key, want)) throw new Error('Bad hub key.');
  const ss = SpreadsheetApp.openById(CONFIG.PNL_SHEET_ID);
  const listings = readListings_(ss);
  const tenants = readTenants_(ss, listings.units || [])
    .filter((t) => t.name)
    .map((t) => ({ unitId: t.unitId, unit: t.unit, name: t.name, phone: t.phone }));
  return { tenants: tenants, owners: (listings.owners || []).map((o) => ({ name: o.name, phone: o.phone })) };
}

function hubEvent_(body) {
  const want = PropertiesService.getScriptProperties().getProperty('HUB_KEY');
  if (!want) throw new Error('HUB_KEY is not set in Script Properties.');
  if (!sameSecret_(body.key, want)) throw new Error('Bad hub key.');
  const ev = body.event || {};
  const key = phoneKey_(ev.phone);
  if (!key) return { matched: false };

  const ss = SpreadsheetApp.openById(CONFIG.PNL_SHEET_ID);
  const listings = readListings_(ss);
  const tenants = readTenants_(ss, listings.units || []);
  const t = tenants.find((x) => phoneKey_(x.phone) === key);
  if (!t) return { matched: false };

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = inboxSheet_(ss);
    const id = String(ev.id || '');
    // Quo can resend an event; skip anything already filed.
    if (id && sh.getLastRow() > 1) {
      const links = sh.getRange(2, 10, sh.getLastRow() - 1, 1).getValues();
      if (links.some((r) => String(r[0]).indexOf('#' + id) >= 0)) return { matched: true, duplicate: true, unitId: t.unitId, unit: t.unit, tenant: t.name };
    }
    const kinds = { 'text-in': 'Text', voicemail: 'Voicemail', summary: 'Message taken by Sona', call: 'Missed call' };
    // Tenant text is stored as plain text: a leading = + - @ would otherwise run as a sheet formula.
    const plain = (v) => { const x = String(v == null ? '' : v); return /^[=+\-@]/.test(x) ? "'" + x : x; };
    const text = plain(String(ev.text || '').trim().slice(0, 1500));
    const link = (ev.hubLink || '') + (id ? '#' + id : '');
    sh.appendRow([new Date(), t.unitId, t.unit, t.name, plain(ev.phone || t.phone), kinds[ev.kind] || 'Message', text, ev.urgent ? 'Yes' : '', 'New', plain(link)]);

    // A repair request also opens a note on the rental (once a day per unit, so a back-and-forth stays one repair).
    let noteAdded = false;
    if (ev.maintenance && text) {
      const nsh = rentalNotesSheet_(ss);
      const tz = Session.getScriptTimeZone();
      const today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
      const recent = readRentalNotes_(ss).some((n) => n.unitId === t.unitId && n.by === 'Quo line' && n.added === today && n.status !== 'Done');
      if (!recent) {
        const short = String(ev.text || '').trim().replace(/\s+/g, ' ').slice(0, 220);
        nsh.appendRow([t.unitId, t.unit, (ev.urgent ? 'URGENT: ' : '') + (t.name ? t.name.split(' ')[0] + ' says: ' : '') + short, 'Open', 'Quo line', today, today]);
        noteAdded = true;
      }
    }
    return { matched: true, unitId: t.unitId, unit: t.unit, tenant: t.name, noteAdded: noteAdded };
  } finally {
    lock.releaseLock();
  }
}

function readTenantInbox_(ss) {
  const sh = ss.getSheetByName(INBOX_TAB);
  if (!sh || sh.getLastRow() < 2) return [];
  const n = Math.min(80, sh.getLastRow() - 1);
  const start = sh.getLastRow() - n + 1;
  return sh.getRange(start, 1, n, INBOX_HEAD.length).getValues().map((r, i) => ({
    row: start + i,
    when: r[0] instanceof Date ? r[0].toISOString() : String(r[0] || ''),
    unitId: String(r[1] || ''),
    unit: String(r[2] || ''),
    tenant: String(r[3] || ''),
    phone: String(r[4] || ''),
    kind: String(r[5] || ''),
    text: String(r[6] || ''),
    urgent: String(r[7]).trim().toLowerCase() === 'yes',
    status: String(r[8] || 'New'),
    link: String(r[9] || '').split('#')[0],
  })).reverse();
}

/** Marks a tenant message Handled (or back to New). `row` is its sheet row. */
function setInboxStatus(row, status) {
  const email = currentEmail_();
  if (!isOwner_(email)) throw new Error('Not authorized.');
  status = status === 'New' ? 'New' : 'Handled';
  const sh = inboxSheet_(SpreadsheetApp.openById(CONFIG.PNL_SHEET_ID));
  row = Number(row);
  if (!(row >= 2 && row <= sh.getLastRow())) throw new Error('That message is gone. Refresh the page.');
  sh.getRange(row, 9).setValue(status);
  return true;
}

/** One tap on a tenant message: opens it as a repair on that rental and marks the message Handled. */
function repairFromInbox(row) {
  const email = currentEmail_();
  if (!isOwner_(email)) throw new Error('Not authorized.');
  const ss = SpreadsheetApp.openById(CONFIG.PNL_SHEET_ID);
  const sh = inboxSheet_(ss);
  row = Number(row);
  if (!(row >= 2 && row <= sh.getLastRow())) throw new Error('That message is gone. Refresh the page.');
  const r = sh.getRange(row, 1, 1, INBOX_HEAD.length).getValues()[0];
  const unitId = String(r[1] || ''), unit = String(r[2] || ''), tenant = String(r[3] || ''), text = String(r[6] || '').trim().replace(/\s+/g, ' ');
  if (!unitId) throw new Error('That message isn\'t tied to a rental.');
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  rentalNotesSheet_(ss).appendRow([unitId, unit, cellText_((tenant ? tenant.split(' ')[0] + ' says: ' : '') + text.slice(0, 220)), 'Open', email.split('@')[0], today, today]);
  sh.getRange(row, 9).setValue('Handled');
  return true;
}

// ---------- rental notes / repairs (the "Owner Rental Notes" tab) ----------

function rentalNotesSheet_(ss) {
  let sh = ss.getSheetByName(RENTAL_NOTES_TAB);
  if (!sh) {
    sh = ss.insertSheet(RENTAL_NOTES_TAB);
    sh.appendRow(NOTE_HEAD);
    sh.setFrozenRows(1);
    sh.getRange('D2:D').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(NOTE_STATUSES, true).build());
  } else if (!PropertiesService.getScriptProperties().getProperty('NOTES_V2')) {
    // One time: "In progress" becomes "Scheduled" in the dropdown and in existing rows.
    sh.getRange('D2:D').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(NOTE_STATUSES.concat(['In progress']), true).build());
    if (sh.getLastRow() > 1) {
      const r = sh.getRange(2, 4, sh.getLastRow() - 1, 1);
      r.setValues(r.getValues().map((x) => [/^in progress$/i.test(String(x[0]).trim()) ? 'Scheduled' : x[0]]));
    }
    PropertiesService.getScriptProperties().setProperty('NOTES_V2', '1');
  }
  return sh;
}

function readRentalNotes_(ss) {
  const sh = ss.getSheetByName(RENTAL_NOTES_TAB);
  if (!sh || sh.getLastRow() < 2) return [];
  const tz = Session.getScriptTimeZone();
  const day = (x) => (x instanceof Date ? Utilities.formatDate(x, tz, 'yyyy-MM-dd') : String(x || ''));
  return sh.getRange(2, 1, sh.getLastRow() - 1, NOTE_HEAD.length).getValues().map((r, i) => ({
    row: i + 2,
    unitId: String(r[0] || '').trim(),
    text: String(r[2] || '').trim(),
    status: /^in progress$/i.test(String(r[3]).trim()) ? 'Scheduled' : NOTE_STATUSES.indexOf(String(r[3]).trim()) >= 0 ? String(r[3]).trim() : 'Open',
    by: String(r[4] || ''),
    added: day(r[5]),
    updated: day(r[6]),
  })).filter((n) => n.unitId && n.text);
}

/** Adds a note (a repair, something to do) to one rental. status "Log" records a message that went out. */
function addRentalNote(unitId, unitName, text, status) {
  const email = currentEmail_();
  if (!isOwner_(email)) throw new Error('Not authorized.');
  text = String(text || '').trim().slice(0, 500);
  if (!unitId || !text) throw new Error('Type a note first.');
  status = NOTE_STATUSES.indexOf(status) >= 0 ? status : 'Open';
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  rentalNotesSheet_(SpreadsheetApp.openById(CONFIG.PNL_SHEET_ID))
    .appendRow([String(unitId), String(unitName || ''), text, status, email.split('@')[0], today, today]);
  return true;
}

/** Moves a repair between Open, Scheduled and Done. `row` is its sheet row number. */
function setRentalNoteStatus(row, status) {
  const email = currentEmail_();
  if (!isOwner_(email)) throw new Error('Not authorized.');
  if (status === 'In progress') status = 'Scheduled';
  if (['Open', 'Scheduled', 'Done'].indexOf(status) < 0) throw new Error('Unknown status.');
  const sh = rentalNotesSheet_(SpreadsheetApp.openById(CONFIG.PNL_SHEET_ID));
  row = Number(row);
  if (!(row >= 2 && row <= sh.getLastRow())) throw new Error('That note no longer exists.');
  sh.getRange(row, 4).setValue(status);
  sh.getRange(row, 7).setValue(Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd') + ' · ' + email.split('@')[0]);
  return true;
}

// ---------- cash on hand ----------

/** Records today's checking balance (entered by an owner from the dashboard). */
function addBalance(amount, asOf) {
  const email = currentEmail_();
  if (!isOwner_(email)) throw new Error('Not authorized.');
  const n = num_(amount);
  if (!n) throw new Error('Enter the balance as a number.');
  const tz = Session.getScriptTimeZone();
  const sh = balanceSheet_(SpreadsheetApp.openById(CONFIG.PNL_SHEET_ID));
  sh.appendRow([asOf || Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd'), n, email.split('@')[0], 'Entered on the dashboard']);
  return true;
}

function balanceSheet_(ss) {
  let sh = ss.getSheetByName(BALANCE_TAB);
  if (!sh) {
    sh = ss.insertSheet(BALANCE_TAB);
    sh.appendRow(['As of', 'Checking cash on hand', 'Updated by', 'Notes']);
    sh.setFrozenRows(1);
  }
  return sh;
}

function readBalances_(ss) {
  const sh = ss.getSheetByName(BALANCE_TAB);
  if (!sh || sh.getLastRow() < 2) return [];
  const tz = Session.getScriptTimeZone();
  return sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues()
    .map((r) => ({
      asOf: r[0] instanceof Date ? Utilities.formatDate(r[0], tz, 'yyyy-MM-dd') : String(r[0] || ''),
      amount: num_(r[1]),
      by: String(r[2] || ''),
    }))
    .filter((b) => b.asOf && b.amount)
    .sort((a, b) => (a.asOf < b.asOf ? -1 : a.asOf > b.asOf ? 1 : 0));
}

// ---------- work in progress (the "Owner Projects" tab) ----------

function readProjects_(ss) {
  const sh = ss.getSheetByName('Owner Projects');
  if (!sh || sh.getLastRow() < 2) return [];
  const tz = Session.getScriptTimeZone();
  const v = sh.getRange(1, 1, sh.getLastRow(), Math.max(11, sh.getLastColumn())).getValues();
  const head = v[0].map((h) => String(h).trim().toLowerCase());
  const col = (name) => head.indexOf(name);
  const get = (r, name) => { const c = col(name); return c < 0 ? '' : r[c]; };
  return v.slice(1).map((r) => ({
    name: String(get(r, 'project') || '').trim(),
    status: String(get(r, 'status') || ''),
    close: get(r, 'target close') instanceof Date ? Utilities.formatDate(get(r, 'target close'), tz, 'yyyy-MM-dd') : String(get(r, 'target close') || ''),
    price: num_(get(r, 'sale price')),
    agent: num_(get(r, 'buyer agent fee')),
    concessions: num_(get(r, 'seller concessions')),
    other: num_(get(r, 'other closing costs')),
    payoff: num_(get(r, 'loan payoff')),
    invested: num_(get(r, 'total invested')),
    done: get(r, 'done') === true,
    notes: String(get(r, 'notes') || ''),
  })).filter((p) => p.name && !p.done);
}

/** Checks Done on a project in the "Owner Projects" tab (it closed), so it drops off Work in progress. */
function setProjectDone(name) {
  if (!isOwner_(currentEmail_())) throw new Error('Not authorized.');
  const sh = SpreadsheetApp.openById(CONFIG.PNL_SHEET_ID).getSheetByName('Owner Projects');
  if (!sh || sh.getLastRow() < 2) throw new Error('No Owner Projects tab.');
  const v = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  const head = v[0].map((h) => String(h).trim().toLowerCase());
  const pc = head.indexOf('project'), dc = head.indexOf('done');
  if (pc < 0 || dc < 0) throw new Error('The Owner Projects tab needs Project and Done columns.');
  for (let r = 1; r < v.length; r++) {
    if (String(v[r][pc]).trim() === String(name).trim()) { sh.getRange(r + 1, dc + 1).setValue(true); return true; }
  }
  throw new Error('That project is no longer in the tab.');
}

// ---------- per-property summary (the "Totals Rental Ops" block at the bottom of Ops) ----------

function readPropertySummary_(ss) {
  const sh = ss.getSheetByName('Ops');
  if (!sh) return null;
  const v = sh.getDataRange().getValues();
  const find = (re, from) => { for (let r = from || 0; r < v.length; r++) if (re.test(String(v[r][1]).trim())) return r; return -1; };
  const hr = find(/^totals rental ops$/i);
  if (hr < 0) return null;
  const names = [];
  for (let c = 2; c < v[hr].length; c++) {
    const n = String(v[hr][c]).trim();
    if (!n || /^totals?$/i.test(n)) break;
    names.push(n);
  }
  const rowOf = (re) => { const r = find(re, hr + 1); return r < 0 ? null : names.map((_, i) => num_(v[r][2 + i])); };
  // Year totals from one of the blocks above (e.g. "Operating Loan Payments", "Prop Taxes"):
  // the block's "Total ..." row, lined up to the summary's property names by header.
  const blockTotal = (headRe) => {
    const h = find(headRe);
    if (h < 0 || h > hr) return null;
    let t = -1;
    for (let r = h + 1; r < hr; r++) if (/^total/i.test(String(v[r][1]).trim())) { t = r; break; }
    if (t < 0) return null;
    const cols = v[h].map((x) => String(x).trim().toLowerCase());
    return names.map((n) => { const c = cols.indexOf(n.toLowerCase(), 2); return c < 0 ? 0 : num_(v[t][c]); });
  };
  return {
    names: names,
    income: rowOf(/^income$/i),
    costs: rowOf(/^operating expenses$/i), // loan payments + everything else, before property tax
    loans: blockTotal(/loan pay/i),
    taxes: blockTotal(/^prop(erty)? tax/i),
    profit: rowOf(/^profit \(loss\)$/i),
    net: rowOf(/^net profit including tax$/i),
  };
}

// ---------- to-dos ----------

/** Adds a to-do to the "Owner To-dos" tab. `who` is the first name it's assigned to (blank = anyone). */
function addTodo(task, due, who) {
  const email = currentEmail_();
  if (!isOwner_(email)) throw new Error('Not authorized.');
  task = String(task || '').trim().slice(0, 300);
  if (!task) throw new Error('Type a to-do first.');
  const sh = todoSheet_(SpreadsheetApp.openById(CONFIG.PNL_SHEET_ID));
  sh.appendRow([task, due || '', false, email.split('@')[0], Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'), '', String(who || '').trim().slice(0, 40)]);
  return true;
}

/** Checks a to-do off (or back on). `row` is its sheet row number. */
function setTodoDone(row, done) {
  if (!isOwner_(currentEmail_())) throw new Error('Not authorized.');
  const sh = todoSheet_(SpreadsheetApp.openById(CONFIG.PNL_SHEET_ID));
  row = Number(row);
  if (!(row >= 2 && row <= sh.getLastRow())) throw new Error('That to-do no longer exists.');
  sh.getRange(row, 3).setValue(!!done);
  return true;
}

function todoSheet_(ss) {
  let sh = ss.getSheetByName(TODO_TAB);
  if (!sh) {
    sh = ss.insertSheet(TODO_TAB);
    sh.appendRow(['Task', 'Due', 'Done', 'Added by', 'Added on', 'Notes', 'Assigned to']);
    sh.setFrozenRows(1);
  } else {
    ensureCols_(sh, 7);
    if (!String(sh.getRange(1, 7).getValue()).trim()) sh.getRange(1, 7).setValue('Assigned to'); // tabs made before assignments existed
  }
  return sh;
}

function readTodos_(ss) {
  const sh = ss.getSheetByName(TODO_TAB);
  if (!sh || sh.getLastRow() < 2) return [];
  const v = sh.getRange(2, 1, sh.getLastRow() - 1, Math.min(7, sh.getMaxColumns())).getValues();
  return v.map((r, i) => ({
    row: i + 2,
    task: String(r[0] || '').trim(),
    due: r[1] instanceof Date ? Utilities.formatDate(r[1], Session.getScriptTimeZone(), 'yyyy-MM-dd') : String(r[1] || ''),
    done: r[2] === true || /^(true|yes|x|done)$/i.test(String(r[2]).trim()),
    by: String(r[3] || ''),
    notes: String(r[5] || ''),
    who: String(r[6] || '').trim(),
  })).filter((t) => t.task);
}

/**
 * Cells on the Ops and Cap tabs whose note contains "TO ALLOCATE": money that's in the P&L
 * but still needs splitting to a property. Remove "TO ALLOCATE" from the note once it's split.
 */
function readToAllocate_(ss) {
  const out = [];
  ['Ops', 'Cap'].forEach((tab) => {
    const sh = ss.getSheetByName(tab);
    if (!sh) return;
    const rng = sh.getDataRange();
    const notes = rng.getNotes(), vals = rng.getValues();
    for (let r = 0; r < notes.length; r++) {
      for (let c = 0; c < notes[r].length; c++) {
        const note = notes[r][c];
        if (!/TO ALLOCATE/i.test(note)) continue;
        // Walk up to this block's header row (the one with property names) to name the section and column.
        let h = r;
        while (h > 0 && MONTHS.indexOf(String(vals[h][1]).trim().slice(0, 3)) >= 0) h--;
        const A = allocNote_(note);
        // The house columns this money can move to: every column of the block except General Business and Totals.
        const columns = [];
        for (let k = 2; k < vals[h].length; k++) {
          const n = String(vals[h][k]).trim();
          if (!n || /^totals?$/i.test(n)) break;
          if (k !== c && !/general business/i.test(n)) columns.push(n);
        }
        out.push({
          tab: tab,
          section: String(vals[h][1] || '').trim(),
          column: String(vals[h][c] || '').trim(),
          month: String(vals[r][1] || '').trim(),
          amount: A.remaining != null ? A.remaining : num_(vals[r][c]),
          detail: A.line,
          items: A.items,
          moved: A.moved,
          columns: columns,
          cell: tab + '!' + colLetter_(c + 1) + (r + 1),
        });
      }
    }
  });
  return out;
}

function colLetter_(n) {
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/**
 * Reads a TO ALLOCATE note. The TO ALLOCATE line lists what's unsplit:
 *   "TO ALLOCATE: Lowe's card 7/13 $77.00; Menards 7/2 $28.61; Waynedale hardware 7/20 $6.93, 7/21 $18.80 = $131.34"
 * Each "$amount" is an item, labeled with the words before it in its group (and the date in front of it, if any).
 * An item already moved carries a check mark after it ("$77.00 ✓Archer"). "= $131.34" at the end is what's left to split;
 * without it, the whole cell is. Only the first sentence of the line counts (later sentences are commentary).
 */
function allocNote_(note) {
  const lines = String(note || '').split('\n');
  const li = lines.findIndex((l) => /TO ALLOCATE/i.test(l));
  const line = li >= 0 ? lines[li] : '';
  let body = line.replace(/^.*?TO ALLOCATE[^:]*:\s*/i, '');
  body = body.split(/\.\s+(?=[A-Z])/)[0];
  const rem = /=\s*\$([\d,]+(?:\.\d+)?)\s*\.?\s*$/.exec(body);
  if (rem) body = body.slice(0, rem.index);
  const items = [];
  let idx = 0;
  body.split(';').forEach((g) => {
    const first = g.search(/(\d{1,2}\/\d{1,2}|#\d+|\$)/);
    const base = (first >= 0 ? g.slice(0, first) : g).replace(/[,\s]+$/, '').trim();
    let lastDate = '';
    const re = /((?:\d{1,2}\/\d{1,2})\s+)?((?:#\d+)\s+)?\$([\d,]+\.\d{2})(\s*✓\s*[^,;$]*)?/g;
    let m;
    while ((m = re.exec(g))) {
      if (m[1]) lastDate = m[1].trim();
      const label = [base, m[1] ? lastDate : (base && !m[2] ? lastDate : ''), m[2] ? m[2].trim() : ''].filter(Boolean).join(' ');
      items.push({ i: idx++, label: label || 'Item', amount: num_(m[3]), done: m[4] ? m[4].replace('✓', '').trim() || 'moved' : '' });
    }
  });
  const moved = lines.filter((l) => /^Moved \$/.test(l));
  return { line: line.replace(/^.*?TO ALLOCATE[^:]*:\s*/i, '').trim(), items: items, remaining: rem ? num_(rem[1]) : null, moved: moved };
}

/**
 * Moves money from a TO ALLOCATE cell to a house column in the same block and month, from the dashboard.
 * `item` is the item's number in the note (or -1 for a typed amount). `column` is the house's column name,
 * or '__off' to take it off the P&L (billed back to a tenant, or not a business cost).
 * Both cells keep their formulas (a number is added to, a formula gets "+amount" / "-amount"), and both notes say what moved.
 */
function allocateCell(cell, item, amount, column) {
  const email = requireOwner_();
  const who = (CONFIG.OWNER_NAMES || {})[email] || email.split('@')[0];
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const m = /^(Ops|Cap)!([A-Z]+)(\d+)$/.exec(String(cell || ''));
    if (!m) throw new Error('Unknown cell.');
    const ss = SpreadsheetApp.openById(CONFIG.PNL_SHEET_ID);
    const sh = ss.getSheetByName(m[1]);
    const src = sh.getRange(m[2] + m[3]);
    const note = src.getNote();
    if (!/TO ALLOCATE/i.test(note)) throw new Error('That item was already split. Refresh the page.');
    const A = allocNote_(note);
    item = Number(item);
    const it = item >= 0 ? A.items.filter((x) => x.i === item)[0] : null;
    if (item >= 0 && !it) throw new Error('Couldn\'t find that line in the note anymore. Refresh the page.');
    if (it && it.done) throw new Error('That line was already moved to ' + it.done + '.');
    const amt = Math.round(num_(it ? it.amount : amount) * 100) / 100;
    if (!(amt > 0)) throw new Error('Enter an amount.');
    const remainingBefore = A.remaining != null ? A.remaining : num_(src.getValue());
    if (amt > remainingBefore + 0.005) throw new Error('That\'s more than the $' + remainingBefore.toFixed(2) + ' left to split here.');

    // The block's header row names the columns.
    const row = Number(m[3]);
    const labels = sh.getRange(1, 2, row, 1).getValues().map((r) => String(r[0]).trim());
    let h = row - 1;
    while (h > 0 && MONTHS.indexOf(labels[h].slice(0, 3)) >= 0) h--;
    const head = sh.getRange(h + 1, 1, 1, sh.getLastColumn()).getValues()[0].map((x) => String(x).trim());
    const month = labels[row - 1];
    const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'M/d');
    const what = it ? it.label + ' $' + amt.toFixed(2) : '$' + amt.toFixed(2);

    const bump = (rng, delta) => {
      const f = rng.getFormula();
      if (f) rng.setFormula(f + (delta < 0 ? '-' : '+') + Math.abs(delta));
      else rng.setValue(Math.round((num_(rng.getValue()) + delta) * 100) / 100);
    };
    let dest = 'off P&L';
    if (column !== '__off') {
      const c = head.findIndex((x, k) => k >= 2 && x.toLowerCase() === String(column || '').trim().toLowerCase());
      if (c < 0 || /general business|^totals?$/i.test(head[c])) throw new Error('No "' + column + '" column in that block.');
      const tgt = sh.getRange(row, c + 1);
      bump(tgt, amt);
      const tn = tgt.getNote();
      tgt.setNote((tn ? tn + '\n' : '') + what + ' from General Business (' + today + ', ' + who + ')');
      dest = head[c];
    }
    bump(src, -amt);

    // Update the source note: check the line off, lower the "= $" left, and drop TO ALLOCATE when nothing's left.
    const left = Math.round((remainingBefore - amt) * 100) / 100;
    let lines = note.split('\n');
    const li = lines.findIndex((l) => /TO ALLOCATE/i.test(l));
    let line = lines[li];
    if (it) {
      // The it.i-th "$amount" on the line (counting only within the first sentence) gets the check mark.
      let n = -1;
      line = line.replace(/\$([\d,]+\.\d{2})(\s*✓\s*[^,;$]*)?/g, (all, a, done) => { n++; return n === it.i && !done ? all + ' ✓' + dest : all; });
    }
    if (/=\s*\$[\d,]+(?:\.\d+)?\s*\.?\s*$/.test(line.split(/\.\s+(?=[A-Z])/)[0])) line = line.replace(/=\s*\$[\d,]+(?:\.\d+)?/, '= $' + left.toFixed(2));
    if (left < 0.01) line = line.replace(/TO ALLOCATE/i, 'ALLOCATED');
    lines[li] = line;
    lines.push((column === '__off' ? 'Moved $' + amt.toFixed(2) + ' off the P&L' : 'Moved $' + amt.toFixed(2) + ' to ' + dest) + ' (' + (it ? it.label + ', ' : '') + today + ', ' + who + ')');
    src.setNote(lines.join('\n'));
    return { left: left, dest: dest, month: month };
  } finally {
    lock.releaseLock();
  }
}

// ---------- readers (find things by their labels, so small layout changes don't break them) ----------

/** "Monthly Summaries" tab: sections (Operations, Capital) with labeled rows of 12 monthly values + total. */
function readMonthlySummaries_(ss) {
  const sh = ss.getSheetByName('Monthly Summaries');
  if (!sh) return null;
  const v = sh.getDataRange().getValues();

  let hr = -1, jan = -1;
  for (let r = 0; r < v.length && hr < 0; r++) {
    const c = v[r].findIndex((x) => String(x).trim() === 'Jan');
    if (c >= 0) { hr = r; jan = c; }
  }
  if (hr < 0) return null;
  const totalCol = v[hr].findIndex((x) => /^total$/i.test(String(x).trim()));
  const labelCol = jan - 1;
  const sectionCol = jan - 2;

  const sections = {};
  let section = null;
  for (let r = hr + 1; r < v.length; r++) {
    const row = v[r];
    if (sectionCol >= 0 && String(row[sectionCol]).trim()) section = String(row[sectionCol]).trim();
    const label = String(row[labelCol] || '').trim();
    if (!label || !section) continue;
    if (/^%$/.test(label)) continue; // the margin row is recomputed on the page
    (sections[section] = sections[section] || {})[label] = {
      months: MONTHS.map((_, i) => num_(row[jan + i])),
      total: totalCol >= 0 ? num_(row[totalCol]) : null,
    };
  }
  return sections;
}

/** "Ops" tab: the Rental Income block, one column per property, one row per month. */
function readOpsIncome_(ss) {
  return readOpsBlock_(ss, /^rental income$/i);
}

/** Any monthly block on the Ops tab (e.g. "Operating Loan Payments"), found by its header label. */
function readOpsBlock_(ss, headRe) {
  const sh = ss.getSheetByName('Ops');
  if (!sh) return null;
  const v = sh.getDataRange().getValues();

  for (let r = 0; r < v.length; r++) {
    const c = v[r].findIndex((x) => headRe.test(String(x).trim()));
    if (c < 0) continue;
    const names = [];
    for (let k = c + 1; k < v[r].length; k++) {
      const n = String(v[r][k]).trim();
      if (!n || /^totals?$/i.test(n)) break;
      names.push(n);
    }
    const months = MONTHS.map(() => names.map(() => 0));
    for (let rr = r + 1; rr < Math.min(v.length, r + 20); rr++) {
      const m = MONTHS.indexOf(String(v[rr][c]).trim().slice(0, 3));
      if (m < 0) continue;
      names.forEach((_, i) => { months[m][i] = num_(v[rr][c + 1 + i]); });
    }
    return { properties: names, months: months };
  }
  return null;
}

function readListings_(ss) {
  try {
    ss = ss || SpreadsheetApp.openById(CONFIG.PNL_SHEET_ID);
    const res = UrlFetchApp.fetch(CONFIG.LISTINGS_URL + '?t=' + Date.now(), { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return { error: 'Listings returned HTTP ' + res.getResponseCode() };
    const d = JSON.parse(res.getContentText());
    const ends = leaseEndsByUnit_(ss);
    let owners = readOwnerTeam_(ss);
    if (!owners.length) owners = (d.contacts || []).map((c) => ({ name: c.name, phone: c.phone || '', email: c.email || '' }));
    return {
      // Sam and Jack: copied on every tenant text and email so no conversation is one-on-one.
      owners: owners,
      // Homes marked "fund": false on the site (Highgate, Sam's dad's house) stay out of the Fund's numbers.
      units: (d.properties || []).filter((p) => p.fund !== false).map((p) => ({
        id: p.id,
        name: p.name,
        address: [p.number, p.street].filter(Boolean).join(' '),
        zip: p.zip || '',
        beds: p.beds,
        type: p.type,
        status: p.status,
        leaseEnds: ends[p.id] || null,
        availableDate: p.availableDate || null,
        askingRent: p.askingRent || null,
      })),
    };
  } catch (e) {
    return { error: String(e) };
  }
}

// ---------- deals: flip leads from wholesalers (the "Owner Deals" tab) ----------
// One row per lead. The GC's page shows the deal and the rehab budget, but never the Notes column.

const DEALS_TAB = 'Owner Deals';
const DEAL_STATUSES = ['New', 'Sent to GC', 'Bid in', 'Offer made', 'Under contract', 'Passed', 'Closed'];
// The standard lines on every bid. Anything else (foundation, windows…) goes in as an extra line.
const REHAB = [
  ['demo', 'Demo'], ['roof', 'Roof & Gutters'], ['hvac', 'HVAC'], ['plumb', 'Plumbing'], ['elec', 'Electrical'],
  ['kitchen', 'Kitchen'], ['bath', 'Bathroom'], ['floor', 'Flooring / Carpet'], ['paint', 'Paint'],
  ['appl', 'Appliances'], ['light', 'Lighting'], ['ext', 'Exterior/Landscaping'], ['misc', 'Misc/Contingency'],
];
// Categories offered under "+ Add a line" on the dashboard and the bid page.
const REHAB_EXTRA = ['Foundation', 'Windows', 'Doors', 'Drywall', 'Insulation', 'Siding', 'Water heater', 'Permits', 'Dumpster'];
// [field, column header, 'n' for numbers]
const DEAL_FIELDS = [
  ['id', 'Deal ID'], ['key', 'GC link key'], ['added', 'Added'], ['by', 'Added by'], ['status', 'Status'], ['from', 'From'],
  ['address', 'Address'], ['asking', 'Asking', 'n'], ['arv', 'ARV', 'n'], ['wsArv', 'Wholesaler ARV', 'n'], ['sqft', 'Sq ft', 'n'], ['bedsBaths', 'Beds/Baths'], ['yearBuilt', 'Year built', 'n'],
  ['photoLink', 'Photo link'], ['lead', 'Lead text'], ['lat', 'Lat', 'n'], ['lon', 'Lon', 'n'],
  ['rehabLevel', 'Rehab level'],
].concat(REHAB.map((r) => [r[0], r[1], 'n'])).concat([
  ['extraLines', 'Extra rehab lines'],
  ['gcNotes', 'GC notes'], ['bidUpdated', 'Bid updated'], ['holdPct', 'Hold & close %', 'n'], ['targetProfit', 'Target profit', 'n'],
  ['method', 'Method'], ['notes', 'Notes'],
  // Snapshot of the dashboard's appraiser check, saved with the deal so the GC page can show the same scenarios.
  ['apprEst', 'Likely appraisal', 'n'], ['apprSafe', 'Appraisal-safe ARV', 'n'], ['apprOdds', 'Appraisal odds %', 'n'],
]);
const OWNER_EDITABLE = DEAL_FIELDS.map((f) => f[0]).filter((k) => ['id', 'key', 'added', 'by', 'lead', 'bidUpdated'].indexOf(k) < 0);

function dealsData_() {
  const base = { bidUrl: CONFIG.SITE_URL + 'bid/', gcPhone: prop_('GC_PHONE'), claude: !!prop_('ANTHROPIC_API_KEY'), intake: !!prop_('INTAKE_KEY'), statuses: DEAL_STATUSES, rehab: REHAB, rehabExtra: REHAB_EXTRA, gcName: prop_('GC_NAME') || 'David', rates: CONFIG.REHAB_PER_SQFT, rentcast: !!prop_('RENTCAST_API_KEY'), rentcastUsed: rentcastUsed_(), rentcastLimit: CONFIG.RENTCAST_MONTHLY_LIMIT, compRadius: CONFIG.COMP_RADIUS_MILES };
  try {
    return Object.assign(base, { list: readDeals_(dealsSheet_()) });
  } catch (e) {
    return Object.assign(base, { list: [], error: e && e.message ? e.message : String(e) });
  }
}

/**
 * The spreadsheet that holds a deals-side tab (Owner Deals, Owner Comps). It's DEALS_SHEET_ID, kept apart
 * from the P&L so nothing moves when a new year's P&L starts. The first time a tab is asked for there, it's
 * copied over from the P&L (the old one is renamed "… (moved)" so it isn't edited by mistake).
 */
function dealsBook_(tab) {
  const id = CONFIG.DEALS_SHEET_ID || CONFIG.PNL_SHEET_ID;
  const ss = SpreadsheetApp.openById(id);
  if (id !== CONFIG.PNL_SHEET_ID && !ss.getSheetByName(tab)) {
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      const pnl = SpreadsheetApp.openById(CONFIG.PNL_SHEET_ID);
      const old = pnl.getSheetByName(tab);
      if (old && !ss.getSheetByName(tab)) {
        old.copyTo(ss).setName(tab);
        old.setName(tab + ' (moved)');
        old.getRange('A1').setNote('Moved to the "' + ss.getName() + '" sheet on ' + new Date().toDateString() + '. Edit it there; this copy is no longer read.');
        const blank = ss.getSheetByName('Sheet1');
        if (blank && ss.getSheets().length > 1 && blank.getLastRow() === 0) ss.deleteSheet(blank);
      }
    } finally { lock.releaseLock(); }
  }
  return ss;
}

function dealsSheet_() {
  const ss = dealsBook_(DEALS_TAB);
  let sh = ss.getSheetByName(DEALS_TAB);
  if (!sh) {
    sh = ss.insertSheet(DEALS_TAB);
    sh.appendRow(DEAL_FIELDS.map((f) => f[1]));
    sh.setFrozenRows(1);
    sh.getRange('B:B').setFontColor('#9a9a9a');
    sh.getRange('B1').setNote('Secret part of the GC bid link. Change it to cut off an old link.');
    sh.getRange('E2:E').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(DEAL_STATUSES, true).build());
    return sh;
  }
  // Older tab missing a column (e.g. after an update)? Add it at the end.
  const head = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0].map((h) => String(h).trim());
  const missing = DEAL_FIELDS.map((f) => f[1]).filter((h) => head.indexOf(h) < 0);
  if (missing.length) {
    ensureCols_(sh, head.length + missing.length);
    sh.getRange(1, head.length + 1, 1, missing.length).setValues([missing]);
  }
  return sh;
}

/** Column number (1-based) for each field, by header, so columns can be moved around in the sheet. */
function dealCols_(sh) {
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map((h) => String(h).trim().toLowerCase());
  const cols = {};
  DEAL_FIELDS.forEach((f) => { const c = head.indexOf(f[1].toLowerCase()); if (c >= 0) cols[f[0]] = c + 1; });
  return cols;
}

function readDeals_(sh) {
  if (sh.getLastRow() < 2) return [];
  const cols = dealCols_(sh);
  const tz = Session.getScriptTimeZone();
  const v = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
  return v.map((r) => {
    const d = {};
    DEAL_FIELDS.forEach((f) => {
      const x = cols[f[0]] ? r[cols[f[0]] - 1] : '';
      d[f[0]] = f[2] === 'n' ? (x === '' || x == null ? null : num_(x))
        : x instanceof Date ? Utilities.formatDate(x, tz, f[0] === 'added' || f[0] === 'bidUpdated' ? 'yyyy-MM-dd HH:mm' : 'yyyy-MM-dd') : String(x == null ? '' : x).trim();
    });
    if (DEAL_STATUSES.indexOf(d.status) < 0) d.status = 'New';
    // Older rows: the sheet turned "3/1" into a date. Read beds/baths back out of the lead text instead.
    if (/^\d{4}-\d{2}-\d{2}$/.test(d.bedsBaths)) d.bedsBaths = (d.lead && parseLeadRules_(d.lead).bedsBaths) || '';
    d.extraLines = textToLines_(d.extraLines);
    return d;
  }).filter((d) => d.id).reverse(); // newest first
}

function findDealRow_(sh, id) {
  const cols = dealCols_(sh);
  if (!cols.id || sh.getLastRow() < 2) return -1;
  const ids = sh.getRange(2, cols.id, sh.getLastRow() - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]).trim() === String(id)) return i + 2;
  return -1;
}

/** Text going into a cell: stop the sheet from treating it as a formula or turning "3/1" into a date. */
function cellText_(s) {
  s = String(s == null ? '' : s);
  return /^[=+\-@]/.test(s) || /^\d+\s*[\/.-]\s*\d/.test(s) ? "'" + s : s;
}
function cellValue_(field, val) {
  const f = DEAL_FIELDS.filter((x) => x[0] === field)[0];
  if (!f) return '';
  if (f[2] === 'n') { if (val === '' || val == null) return ''; const n = num_(val); return Math.max(-1e9, Math.min(1e9, n)); }
  if (field === 'status') return DEAL_STATUSES.indexOf(val) >= 0 ? val : 'New';
  if (field === 'method') return val === '70' ? '70' : 'profit';
  if (field === 'rehabLevel') return CONFIG.REHAB_PER_SQFT[val] ? val : '';
  if (field === 'extraLines') return cellText_(linesToText_(val));
  if (field === 'photoLink') return /^https?:\/\//i.test(String(val || '').trim()) ? String(val).trim().slice(0, 1000) : '';
  return cellText_(String(val == null ? '' : val).slice(0, field === 'lead' ? 5000 : 2000));
}

// Extra rehab lines (beyond the standard ones), added by an owner or the GC.
// Kept readable in the sheet, one per line: "Foundation: 30000".
function cleanLines_(val) {
  let a = val;
  if (typeof a === 'string') { try { a = JSON.parse(a); } catch (e) { a = textToLines_(a); } }
  if (!Array.isArray(a)) return [];
  return a.slice(0, 40).map((x) => {
    const label = String((x && x.label) || '').replace(/[\r\n:]+/g, ' ').trim().slice(0, 60);
    const v = x && x.value !== '' && x.value != null ? num_(x.value) : null;
    return { label: label, value: v == null || isNaN(v) ? null : Math.max(0, Math.min(5e6, Math.round(v))) };
  }).filter((x) => x.label);
}
function linesToText_(val) {
  return cleanLines_(val).map((x) => x.label + ': ' + (x.value == null ? '' : x.value)).join('\n');
}
function textToLines_(t) {
  return String(t || '').split(/\n/).map((ln) => {
    const i = ln.lastIndexOf(':');
    if (i < 0) return { label: ln.trim(), value: null };
    const v = ln.slice(i + 1).replace(/[$,\s]/g, '');
    return { label: ln.slice(0, i).trim(), value: v === '' || isNaN(+v) ? null : +v };
  }).filter((x) => x.label);
}

function writeDeal_(sh, row, changes) {
  const cols = dealCols_(sh);
  const width = sh.getLastColumn();
  const range = sh.getRange(row, 1, 1, width);
  const vals = range.getValues()[0];
  Object.keys(changes).forEach((k) => { if (cols[k]) vals[cols[k] - 1] = cellValue_(k, changes[k]); });
  range.setValues([vals]);
}

function createDeal_(d, by) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sh = dealsSheet_();
    const tz = Session.getScriptTimeZone();
    const id = 'D' + Utilities.formatDate(new Date(), tz, 'yyMMdd') + '-' + Utilities.getUuid().slice(0, 4);
    const fields = Object.assign({ status: 'New', holdPct: 10, targetProfit: 30000, method: 'profit' }, d);
    // Keep the wholesaler's own ARV, so it's still on record after you swap in the comps ARV.
    if (fields.wsArv == null && fields.arv) fields.wsArv = fields.arv;
    const cols = dealCols_(sh);
    const vals = new Array(sh.getLastColumn()).fill('');
    Object.keys(fields).forEach((k) => { if (cols[k]) vals[cols[k] - 1] = cellValue_(k, fields[k]); });
    vals[cols.id - 1] = id;
    vals[cols.key - 1] = Utilities.getUuid().replace(/-/g, '');
    vals[cols.added - 1] = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm');
    vals[cols.by - 1] = by || '';
    sh.appendRow(vals);
    return id;
  } finally {
    lock.releaseLock();
  }
}

/** Same house sent again (wholesalers re-blast)? Match on house number + street name among open deals. */
function findDuplicate_(parsed, text) {
  const norm = (a) => String(a || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 2).join(' ');
  const want = parsed.address ? norm(parsed.address) : '';
  return readDeals_(dealsSheet_()).filter((d) => d.status !== 'Passed' && d.status !== 'Closed')
    .filter((d) => (want && want.split(' ').length === 2 && norm(d.address) === want) || (!want && d.lead === String(text).trim()))[0] || null;
}

function intakeLead_(text, from, by) {
  const parsed = parseLead_(text);
  if (parsed.address) parsed.address = withZip_(parsed.address);
  const dup = findDuplicate_(parsed, text);
  if (dup) return { id: dup.id, duplicate: true, message: 'Already have this one: ' + (dup.address || dup.id) + ' (' + dup.status + ').' };
  const id = createDeal_({
    from: from || parsed.from || '', address: parsed.address, asking: parsed.asking, arv: parsed.arv, sqft: parsed.sqft,
    bedsBaths: parsed.bedsBaths, yearBuilt: parsed.yearBuilt, photoLink: parsed.photoLink, lead: text,
    notes: parsed.repairs ? 'Wholesaler says repairs ≈ $' + Math.round(parsed.repairs).toLocaleString('en-US') : '',
  }, by);
  if (parsed.address) autoPullComps_(id);
  return { id: id, message: 'Saved to Fund deals: ' + (parsed.address || 'new lead (no address found)') + (parsed.asking ? ', asking $' + parsed.asking.toLocaleString('en-US') : '') + '.' + quickLook_(parsed) + compsLook_(parsed) };
}

/**
 * The first read on a brand-new lead, for the phone notification: max offer at a Medium quick rehab estimate
 * with the default 10% hold & close and $30,000 target profit (the same math the dashboard shows).
 * Rests on the wholesaler's ARV, so it's a screen, not a decision.
 */
function quickLook_(p) {
  const rate = CONFIG.REHAB_PER_SQFT.Medium;
  if (!p.arv) return ' No ARV in the text, so no quick read yet.';
  if (!p.sqft || !rate) return ' No square footage in the text, so no quick rehab estimate yet.';
  const $ = (n) => '$' + Math.round(n).toLocaleString('en-US');
  const rehab = p.sqft * rate;
  const max = Math.round(p.arv - rehab - p.arv * 0.10 - 30000);
  const basis = ' (their ARV ' + $(p.arv) + ', medium rehab est. ' + $(rehab) + ')';
  if (max <= 0) return ' Quick read: PASS, no price works' + basis + '.';
  if (!p.asking) return ' Quick read: max offer about ' + $(max) + basis + '.';
  if (p.asking <= max) return ' Quick read: WORKS at asking, ' + $(max - p.asking) + ' under a max offer of ' + $(max) + basis + '.';
  if (p.asking <= max * 1.1) return ' Quick read: CLOSE, worth it at ' + $(max) + ' or less, which is ' + $(p.asking - max) + ' off asking' + basis + '.';
  return ' Quick read: TOO HIGH, only worth it at ' + $(max) + ' or less, which is ' + $(p.asking - max) + ' off asking' + basis + '.';
}

// ----- called from the owner dashboard -----

function parseLeadText(text) {
  requireOwner_();
  return parseLead_(String(text || '').slice(0, 5000));
}

/** Saves a lead typed or pasted on the dashboard. Returns its Deal ID. */
function addDeal(d) {
  const email = requireOwner_();
  d = d || {};
  if (!String(d.address || '').trim() && !String(d.lead || '').trim()) throw new Error('Paste the lead text or type an address first.');
  const clean = {};
  OWNER_EDITABLE.concat(['lead']).forEach((k) => { if (d[k] !== undefined) clean[k] = d[k]; });
  if (clean.address) { const g = withZip_(clean.address, true); clean.address = g.address; if (g.lat) { clean.lat = g.lat; clean.lon = g.lon; } }
  const id = createDeal_(clean, email.split('@')[0]);
  if (clean.lat) autoPullComps_(id);
  return id;
}

/** Saves changes to one deal (any field except its ID, link key and history). */
function updateDeal(id, changes) {
  requireOwner_();
  const clean = {};
  OWNER_EDITABLE.forEach((k) => { if (changes && changes[k] !== undefined) clean[k] = changes[k]; });
  // A new address gets its zip filled in and is placed on the map again (for distance to comps).
  if (clean.address) { const g = withZip_(clean.address, true); clean.address = g.address; clean.lat = g.lat || ''; clean.lon = g.lon || ''; }
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sh = dealsSheet_();
    const row = findDealRow_(sh, id);
    if (row < 0) throw new Error('That deal no longer exists.');
    writeDeal_(sh, row, clean);
  } finally {
    lock.releaseLock();
  }
  return true;
}

// ----- iPhone Shortcut intake (POST to the web app URL) -----
// Body: JSON {"key": INTAKE_KEY, "text": the message, "from": sender (optional)}

function shortcutIntake_(body) {
  const out = (msg) => ContentService.createTextOutput(msg);
  try {
    const want = prop_('INTAKE_KEY');
    if (!want || String(body.key || '') !== want) return out('Not saved: the key doesn\'t match INTAKE_KEY in Script Properties.');
    const text = String(body.text || '').trim().slice(0, 5000);
    if (!text) return out('Not saved: no text came through.');
    return out(intakeLead_(text, String(body.from || '').trim().slice(0, 200), 'iPhone').message);
  } catch (err) {
    return out('Not saved: ' + (err && err.message ? err.message : err));
  }
}

// ----- GC bid page (SITE_URL/bid/?bid=ID&k=KEY) -----

function dealForGc_(id, key) {
  if (!id || !key) return null;
  const d = readDeals_(dealsSheet_()).filter((x) => x.id === String(id))[0];
  if (!d || !d.key || d.key !== String(key)) return null;
  // The whole deal (Sam's call: David sees what we see), plus the rehab budget it needs to make sense.
  // Owner notes stay off this page; they can hold things meant only for Sam and Jack.
  const out = {
    id: d.id, k: d.key, address: d.address, sqft: d.sqft, bedsBaths: d.bedsBaths, yearBuilt: d.yearBuilt, photoLink: d.photoLink,
    from: d.from, asking: d.asking, arv: d.arv, lead: d.lead,
    gcNotes: d.gcNotes, bidUpdated: d.bidUpdated, rehab: REHAB, rehabExtra: REHAB_EXTRA, extraLines: d.extraLines,
    budget: rehabBudget_(d),
    comps: compsFor_(d),
    appraisal: d.apprEst ? { est: d.apprEst, safe: d.apprSafe || null, odds: d.apprOdds == null ? null : d.apprOdds } : null,
  };
  REHAB.forEach((r) => { out[r[0]] = d[r[0]]; });
  return out;
}

/**
 * How much rehab the deal can carry at the asking price, with the same math as the dashboard
 * (target profit after hold & close, or the 70% rule), plus the Light / Medium / Heavy quick estimates.
 */
function rehabBudget_(d) {
  const arv = Number(d.arv) || 0, asking = Number(d.asking) || 0, sqft = Number(d.sqft) || 0;
  const holdPct = d.holdPct == null ? 10 : Number(d.holdPct) || 0;
  const target = d.targetProfit == null ? 30000 : Number(d.targetProfit) || 0;
  const is70 = d.method === '70';
  const level = CONFIG.REHAB_PER_SQFT[d.rehabLevel] ? d.rehabLevel : 'Medium';
  const tiers = sqft ? Object.keys(CONFIG.REHAB_PER_SQFT).map((name) => ({ name: name, rate: CONFIG.REHAB_PER_SQFT[name], total: Math.round(sqft * CONFIG.REHAB_PER_SQFT[name]) })) : [];
  const max = arv && asking ? Math.round(is70 ? arv * 0.7 - asking : arv - asking - arv * holdPct / 100 - target) : null;
  return { max: max, method: is70 ? '70' : 'profit', holdPct: holdPct, target: target, level: level, tiers: tiers };
}

/** Called from the GC bid page. Saves only the rehab numbers and GC notes. */
function submitBid(id, key, bid) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const d = dealForGc_(id, key);
    if (!d) throw new Error('This bid link isn\'t valid anymore. Ask Sam for a new one.');
    const sh = dealsSheet_();
    const row = findDealRow_(sh, id);
    const changes = {};
    REHAB.forEach((r) => { const v = bid ? bid[r[0]] : ''; changes[r[0]] = v === '' || v == null ? '' : Math.max(0, Math.min(5e6, num_(v))); });
    changes.extraLines = cleanLines_(bid && bid.extraLines);
    changes.gcNotes = String((bid && bid.gcNotes) || '').slice(0, 2000);
    writeDeal_(sh, row, changes);
    const cols = dealCols_(sh);
    const when = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
    sh.getRange(row, cols.bidUpdated).setValue(when);
    const st = sh.getRange(row, cols.status).getValue();
    if (st === 'New' || st === 'Sent to GC' || st === '') sh.getRange(row, cols.status).setValue('Bid in');
    return when;
  } finally {
    lock.releaseLock();
  }
}

// ----- reading a wholesaler's text -----

function parseLead_(text) {
  text = String(text || '');
  const rules = parseLeadRules_(text);
  const apiKey = prop_('ANTHROPIC_API_KEY');
  if (!apiKey) return Object.assign(rules, { via: 'rules' });
  try {
    const ai = parseLeadClaude_(text, apiKey);
    const merged = { via: 'claude' };
    ['address', 'asking', 'arv', 'sqft', 'bedsBaths', 'yearBuilt', 'photoLink', 'repairs', 'from'].forEach((k) => {
      merged[k] = ai[k] != null && ai[k] !== '' ? ai[k] : rules[k];
    });
    return merged;
  } catch (e) {
    return Object.assign(rules, { via: 'rules', warning: 'Claude couldn\'t read it (' + (e && e.message ? e.message : e) + '), so the built-in rules filled what they could.' });
  }
}

function parseLeadClaude_(text, apiKey) {
  const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    muteHttpExceptions: true,
    payload: JSON.stringify({
      model: CONFIG.CLAUDE_MODEL,
      max_tokens: 400,
      system: 'You pull the facts out of a real-estate wholesaler\'s deal text. Reply with only a JSON object with these keys: ' +
        'address (street address with city/state/zip if given, else ""), asking (asking/purchase price in dollars as a number), ' +
        'arv (after-repair value as a number), sqft (number), bedsBaths (like "3/1.5", else ""), yearBuilt (4-digit year as a number), photoLink (URL for photos or the listing, else ""), ' +
        'repairs (the wholesaler\'s own repair estimate as a number), from (wholesaler or company name if the text gives one, else ""). ' +
        'Use null for any number the text doesn\'t state. "85k" means 85000. Never guess.',
      messages: [{ role: 'user', content: text.slice(0, 5000) }],
    }),
  });
  const code = res.getResponseCode();
  if (code !== 200) throw new Error('HTTP ' + code);
  const body = JSON.parse(res.getContentText());
  const out = (body.content || []).map((c) => c.text || '').join('');
  const m = /\{[\s\S]*\}/.exec(out);
  if (!m) throw new Error('no JSON in reply');
  const j = JSON.parse(m[0]);
  const n = (x) => (x == null || x === '' ? null : num_(x) || null);
  return {
    address: String(j.address || '').trim(), asking: n(j.asking), arv: n(j.arv), sqft: n(j.sqft),
    bedsBaths: String(j.bedsBaths || '').trim(), yearBuilt: n(j.yearBuilt), photoLink: /^https?:\/\//i.test(j.photoLink || '') ? String(j.photoLink).trim() : '',
    repairs: n(j.repairs), from: String(j.from || '').trim(),
  };
}

/** Built-in reader for the usual wholesaler formats ("Asking: $85k", "ARV 160,000", "3/1", "1,150 sqft"). */
function parseLeadRules_(text) {
  const t = String(text || '');
  const dollars = (s, unit) => {
    let n = parseFloat(String(s).replace(/,/g, ''));
    if (!isFinite(n)) return null;
    unit = String(unit || '').toLowerCase();
    if (unit === 'k') n *= 1e3; else if (unit === 'm' || unit === 'mm') n *= 1e6; else if (n < 2000) n *= 1e3; // "ARV 160" = $160k
    return Math.round(n);
  };
  const amount = '\\$?\\s*(\\d[\\d,]*(?:\\.\\d+)?)\\s*(k|mm|m)?(?![a-z])';
  const grab = (labels) => {
    const m = new RegExp('(?:' + labels + ')[^\\d$\\n]{0,20}' + amount, 'i').exec(t);
    return m ? dollars(m[1], m[2]) : null;
  };
  const out = { address: '', asking: null, arv: null, sqft: null, bedsBaths: '', yearBuilt: null, photoLink: '', repairs: null, from: '' };

  out.arv = grab('\\barv\\b|after[- ]repair(?:ed)? value');
  out.asking = grab('\\basking\\b|\\bprice\\b|purchase price|contract price|\\bbuy(?: it)? for\\b|\\bcash price|\\bwholesale price|\\bour price');
  out.repairs = grab('\\brepairs?\\b|\\brehab\\b|\\breno(?:vation)?s?\\b');
  if (out.repairs == null) { // "needs about 35k in rehab": the number comes first
    const r = new RegExp(amount + '\\s*(?:in|of|for|worth of)?\\s*(?:repairs?|rehab|reno(?:vation)?s?|work)\\b', 'i').exec(t);
    if (r) out.repairs = dollars(r[1], r[2]);
  }

  // "1,150 sqft", "1,800 (Sq. Ft)", "Sq Ft: 1800", "Living Area Size: 1,800"
  let m = /(\d{1,2},\d{3}|\d{3,5})\s*[(\[]?\s*(?:sq\.?\s*f(?:ee|oo)?t\.?|sqft|sf\b|square\s*f(?:ee|oo)t)/i.exec(t) ||
    /(?:sq\.?\s*f(?:ee|oo)?t\.?|sqft|square\s*f(?:ee|oo)t|living\s*area(?:\s*size)?|(?:home|house|building)\s*size)\W{0,5}(\d{1,2},\d{3}|\d{3,5})/i.exec(t);
  if (m) out.sqft = parseInt(m[1].replace(/,/g, ''), 10);

  // "Year Built: 1977", "built in 1977", "YB 1977"
  m = /(?:year\s*built|built(?:\s+in)?|\byb\b|\byr\.?\s*built)\W{0,5}((?:18|19|20)\d{2})\b/i.exec(t) || /\b((?:18|19|20)\d{2})\s+(?:build|built)\b/i.exec(t);
  if (m) out.yearBuilt = parseInt(m[1], 10);

  m = /(\d+)\s*(?:bd|bds|bed|beds|br|bdrm|bedrooms?)\b[\s,/|·&+-]*(\d+(?:\.\d)?)\s*(?:ba|bth|baths?|bathrooms?)\b/i.exec(t) ||
    /(?:^|[^\d/])([1-9])\s*\/\s*([1-9](?:\.5)?)(?![\d/])/.exec(t);
  if (m) out.bedsBaths = m[1] + '/' + m[2];

  m = /(?<![\d,.$])\d{2,6}\s+(?:[NSEW]\.?\s+)?(?:[A-Za-z0-9.']+\s+){0,4}?(?:St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Ln|Lane|Ct|Court|Blvd|Boulevard|Way|Pl|Place|Cir|Circle|Pkwy|Parkway|Ter|Terrace|Trl|Trail|Hwy|Highway|Pike|Run|Xing|Cove|Pass)\b\.?(?:\s*(?:Apt|Unit|#)\s*\w+)?(?:,?\s+[A-Za-z][A-Za-z .]{1,28}?,?\s+(?:IN|Indiana|OH|Ohio|MI|Michigan|KY|IL)\b\.?(?:\s+\d{5})?)?/i.exec(t);
  if (m) out.address = m[0].replace(/\s+/g, ' ').trim().replace(/[.,]+$/, '');

  const urls = t.match(/https?:\/\/[^\s<>"')\]]+/gi) || [];
  out.photoLink = (urls.filter((u) => /photo|drive\.google|dropbox|icloud|zillow|realtor|redfin|imgur|flickr|box\.com|onedrive|1drv|share|album|gallery|pics/i.test(u))[0] || urls[0] || '').replace(/[.,;]+$/, '');
  // No wholesaler named? Use the site their link points to ("home.ltdflips.com" → "ltdflips.com").
  if (out.photoLink) { const h = /^https?:\/\/(?:www\.|home\.|app\.)?([^\/:?#]+)/i.exec(out.photoLink); if (h && !/drive\.google|dropbox|icloud|photos\.app\.goo|imgur|zillow|redfin|realtor|box\.com|1drv|onedrive|flickr/i.test(h[1])) out.from = h[1].toLowerCase(); }
  return out;
}

// ---------- comps: sold sales entered by hand (the "Owner Comps" tab) ----------
// One row per sold house. The dashboard works out price per square foot by zip, and checks every
// deal's ARV against what similar houses in that zip actually sold for. Lives next to the deals
// (DEALS_SHEET_ID, or the P&L) so it carries over from year to year.

const COMPS_TAB = 'Owner Comps';
const COMP_HEAD = ['Address', 'Zip', 'Sold date', 'Sold price', 'Sq ft', 'Beds', 'Baths', 'Condition', 'Source', 'Notes', 'Added by', 'Added on', 'Lat', 'Lon'];
const COMP_CONDITIONS = ['Renovated', 'Average', 'As-is'];

function compsSheet_() {
  const ss = dealsBook_(COMPS_TAB);
  let sh = ss.getSheetByName(COMPS_TAB);
  if (!sh) {
    sh = ss.insertSheet(COMPS_TAB);
    sh.appendRow(COMP_HEAD);
    sh.setFrozenRows(1);
    sh.getRange('H2:H').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(COMP_CONDITIONS, true).setAllowInvalid(true).build());
    sh.getRange('H1').setNote('Renovated = flipped or redone (this is what sets the ARV). Average = lived-in. As-is = needs work.');
    sh.getRange('B1').setNote('Filled in from the address when left blank.');
    return sh;
  }
  // Tabs made before a column existed (e.g. Lat / Lon) get it added at the end.
  const head = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0].map((h) => String(h).trim());
  const missing = COMP_HEAD.filter((h) => head.indexOf(h) < 0);
  if (missing.length) { ensureCols_(sh, head.length + missing.length); sh.getRange(1, head.length + 1, 1, missing.length).setValues([missing]); }
  return sh;
}

/** The zip in an address: the last 5-digit group that isn't the house number. */
function zipOf_(addr) {
  const m = String(addr || '').match(/\b\d{5}(?:-\d{4})?\b/g) || [];
  const last = m.length ? m[m.length - 1].slice(0, 5) : '';
  if (!last) return '';
  return m.length === 1 && String(addr).trim().indexOf(m[0]) === 0 ? '' : last;
}

function readComps_() {
  const sh = compsSheet_();
  if (sh.getLastRow() < 2) return [];
  const tz = Session.getScriptTimeZone();
  const v = sh.getRange(1, 1, sh.getLastRow(), Math.max(COMP_HEAD.length, sh.getLastColumn())).getValues();
  const head = v[0].map((h) => String(h).trim().toLowerCase());
  const col = (name) => head.indexOf(name.toLowerCase());
  const get = (r, name) => { const c = col(name); return c < 0 ? '' : r[c]; };
  const list = v.slice(1).map((r, i) => {
    const address = String(get(r, 'Address') || '').trim();
    const sold = get(r, 'Sold date');
    const cond = String(get(r, 'Condition') || '').trim();
    return {
      row: i + 2,
      address: address,
      zip: String(get(r, 'Zip') || '').replace(/\D/g, '').slice(0, 5) || zipOf_(address),
      sold: sold instanceof Date ? Utilities.formatDate(sold, tz, 'yyyy-MM-dd') : String(sold || '').trim(),
      price: num_(get(r, 'Sold price')),
      sqft: num_(get(r, 'Sq ft')),
      beds: num_(get(r, 'Beds')) || null,
      baths: num_(get(r, 'Baths')) || null,
      condition: COMP_CONDITIONS.filter((c) => c.toLowerCase() === cond.toLowerCase())[0] || (cond ? 'Average' : ''),
      source: String(get(r, 'Source') || ''),
      notes: String(get(r, 'Notes') || ''),
      lat: num_(get(r, 'Lat')) || null,
      lon: num_(get(r, 'Lon')) || null,
    };
  }).filter((c) => c.address && c.price > 0 && c.sqft > 0);
  return flagComps_(list);
}
/**
 * Marks sales that look wrong so they stay out of every ARV: a price of $1M+ (county records log
 * portfolio and bulk sales against one small house), or $/sq ft over 2.5x or under a fifth of the zip's median. Pure.
 */
function flagComps_(list) {
  const byZip = {};
  list.forEach((c) => { (byZip[c.zip] = byZip[c.zip] || []).push(c.price / c.sqft); });
  const med = {};
  Object.keys(byZip).forEach((z) => { const a = byZip[z].sort((p, q) => p - q); med[z] = a.length >= 3 ? a[Math.floor((a.length - 1) / 2)] : null; });
  return list.map((c) => {
    const ppsf = c.price / c.sqft, m = med[c.zip];
    const flag = c.price >= 1000000 ? 'price of $1M+ for a ' + c.sqft + ' sq ft house'
      : m && ppsf > m * 2.5 ? '$' + Math.round(ppsf) + '/sq ft vs $' + Math.round(m) + ' typical in ' + c.zip
      : m && ppsf < m / 5 ? '$' + Math.round(ppsf) + '/sq ft vs $' + Math.round(m) + ' typical in ' + c.zip : '';
    return flag ? Object.assign(c, { flag: flag }) : c;
  });
}

function compsData_() {
  const base = { conditions: COMP_CONDITIONS, months: CONFIG.COMP_MONTHS, band: CONFIG.COMP_SQFT_BAND, areaNames: CONFIG.AREA_NAMES || {}, appraisal: CONFIG.APPRAISAL };
  try {
    return Object.assign(base, { list: readComps_() });
  } catch (e) {
    return Object.assign(base, { list: [], error: e && e.message ? e.message : String(e) });
  }
}

/** Saves sold comps typed or pasted on the dashboard. Skips a sale already in the tab (same address and sold date). */
function addComps(rows) {
  const email = requireOwner_();
  rows = Array.isArray(rows) ? rows.slice(0, 500) : [];
  // Addresses typed or pasted without a zip get one looked up (a few per save, so a big paste stays quick).
  let looked = 0;
  rows.forEach((r) => { if (r && r.address && !r.zip && !zipOf_(r.address) && looked++ < 25) { const g = withZip_(r.address, true); r.address = g.address; r.lat = g.lat; r.lon = g.lon; } });
  return saveComps_(rows, email.split('@')[0]);
}

function saveComps_(rows, by) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sh = compsSheet_();
    const have = {};
    readComps_().forEach((c) => { have[c.address.toLowerCase().replace(/[^a-z0-9]/g, '') + '|' + c.sold] = true; });
    const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    const out = [];
    let dup = 0;
    rows.forEach((r) => {
      const address = String((r && r.address) || '').trim().slice(0, 200);
      const price = num_(r && r.price), sqft = num_(r && r.sqft);
      if (!address || !(price > 1000) || !(sqft > 100)) return;
      const sold = /^\d{4}-\d{2}-\d{2}$/.test(String(r.sold || '')) ? r.sold : '';
      const k = address.toLowerCase().replace(/[^a-z0-9]/g, '') + '|' + sold;
      if (have[k]) { dup++; return; }
      have[k] = true;
      const cond = COMP_CONDITIONS.filter((c) => c.toLowerCase() === String(r.condition || '').toLowerCase())[0] || 'Average';
      out.push([cellText_(address), String(r.zip || zipOf_(address)).replace(/\D/g, '').slice(0, 5), sold, Math.round(price), Math.round(sqft),
        num_(r.beds) || '', num_(r.baths) || '', cond, cellText_(String(r.source || 'Entered by hand').slice(0, 100)), cellText_(String(r.notes || '').slice(0, 500)), by, today,
        num_(r.lat) || '', num_(r.lon) || '']);
    });
    if (out.length) {
      // Write by header name, so the columns can be in any order in the tab.
      const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map((h) => String(h).trim());
      const width = head.length;
      const rowsOut = out.map((o) => { const a = new Array(width).fill(''); COMP_HEAD.forEach((h, i) => { const c = head.indexOf(h); if (c >= 0) a[c] = o[i]; }); return a; });
      sh.getRange(sh.getLastRow() + 1, 1, rowsOut.length, width).setValues(rowsOut);
    }
    return { added: out.length, duplicates: dup, skipped: rows.length - out.length - dup };
  } finally {
    lock.releaseLock();
  }
}

/** Marks a sold comp Renovated, Average or As-is (from a deal's appraiser check). */
function setCompCondition(row, cond, address) {
  requireOwner_();
  const sh = compsSheet_();
  row = Number(row);
  cond = COMP_CONDITIONS.filter((c) => c.toLowerCase() === String(cond || '').toLowerCase())[0];
  if (!cond) throw new Error('Pick Renovated, Average or As-is.');
  if (!(row >= 2 && row <= sh.getLastRow())) throw new Error('That comp no longer exists.');
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map((h) => String(h).trim().toLowerCase());
  const a = head.indexOf('address') + 1, c = head.indexOf('condition') + 1;
  if (!c) throw new Error('The comps tab has no Condition column.');
  // Rows shift when one is deleted: make sure it's still the same house.
  if (address && a && String(sh.getRange(row, a).getValue()).trim() !== String(address).trim()) throw new Error('The comps tab changed. Refresh and try again.');
  sh.getRange(row, c).setValue(cond);
  return true;
}

function deleteComp(row) {
  requireOwner_();
  const sh = compsSheet_();
  row = Number(row);
  if (!(row >= 2 && row <= sh.getLastRow())) throw new Error('That comp no longer exists.');
  sh.deleteRow(row);
  return true;
}

/**
 * What the comps say a house is worth after rehab. Same math as the dashboard:
 * sales in the same zip from the last COMP_MONTHS, similar size if there are at least 3 of those,
 * priced at the renovated sales' median $/sq ft (or the top quarter of all sales if fewer than 2 are marked Renovated).
 */
function compArv_(comps, zip, sqft) {
  if (!zip || !sqft) return null;
  const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - CONFIG.COMP_MONTHS);
  const cut = Utilities.formatDate(cutoff, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const pool = comps.filter((c) => !c.flag && c.zip === zip && (!c.sold || c.sold >= cut));
  const near = pool.filter((c) => Math.abs(c.sqft / sqft - 1) <= CONFIG.COMP_SQFT_BAND);
  const use = near.length >= 3 ? near : pool;
  if (!use.length) return { n: 0 };
  const ppsf = (xs) => xs.map((c) => c.price / c.sqft).sort((a, b) => a - b);
  const q = (a, p) => { const i = (a.length - 1) * p, lo = Math.floor(i); return a[lo] + (a[Math.min(a.length - 1, lo + 1)] - a[lo]) * (i - lo); };
  const reno = use.filter((c) => c.condition === 'Renovated');
  const rate = reno.length >= 2 ? q(ppsf(reno), 0.5) : q(ppsf(use), 0.75);
  return { n: use.length, rate: rate, arv: Math.round(rate * sqft / 500) * 500, basis: reno.length >= 2 ? 'renovated' : 'top 25%' };
}

/**
 * The comps for one deal, for the GC bid page: same picks as the dashboard's comps check
 * (within COMP_RADIUS_MILES of the house, twice that if fewer than 3, else the same zip; similar size if 3+),
 * plus the sales it used, closest in size first.
 */
function compsFor_(d) {
  try {
    const sqft = Number(d.sqft) || 0;
    if (!sqft) return null;
    const cutD = new Date(); cutD.setMonth(cutD.getMonth() - CONFIG.COMP_MONTHS);
    const cut = Utilities.formatDate(cutD, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    const recent = readComps_().filter((c) => !c.flag && (!c.sold || c.sold >= cut));
    const mi = (a, b, c2, e) => { const r = Math.PI / 180, x = Math.sin((c2 - a) * r / 2), y = Math.sin((e - b) * r / 2); return 3958.8 * 2 * Math.asin(Math.sqrt(x * x + Math.cos(a * r) * Math.cos(c2 * r) * y * y)); };
    let pool = [], area = '', radius = CONFIG.COMP_RADIUS_MILES;
    if (d.lat && d.lon) {
      recent.forEach((c) => { c.dist = c.lat && c.lon ? mi(d.lat, d.lon, c.lat, c.lon) : null; });
      pool = recent.filter((c) => c.dist != null && c.dist <= radius);
      if (pool.length < 3) { radius *= 2; pool = recent.filter((c) => c.dist != null && c.dist <= radius); }
      if (pool.length) area = 'within ' + radius + ' mi';
    }
    if (!area) {
      const zip = zipOf_(d.address);
      if (!zip) return null;
      pool = recent.filter((c) => c.zip === zip);
      area = 'in ' + zip;
    }
    const near = pool.filter((c) => Math.abs(c.sqft / sqft - 1) <= CONFIG.COMP_SQFT_BAND);
    const use = near.length >= 3 ? near : pool;
    if (!use.length) return { n: 0, area: area };
    const ppsf = (xs) => xs.map((c) => c.price / c.sqft).sort((a, b) => a - b);
    const q = (a, p) => { const i = (a.length - 1) * p, lo = Math.floor(i); return a[lo] + (a[Math.min(a.length - 1, lo + 1)] - a[lo]) * (i - lo); };
    const reno = use.filter((c) => c.condition === 'Renovated');
    const rate = reno.length >= 2 ? q(ppsf(reno), 0.5) : q(ppsf(use), 0.75);
    return {
      n: use.length, area: area, rate: Math.round(rate), arv: Math.round(rate * sqft / 500) * 500, basis: reno.length >= 2 ? 'renovated' : 'top 25%',
      list: use.slice().sort((a, b) => Math.abs(a.sqft - sqft) - Math.abs(b.sqft - sqft)).slice(0, 8).map((c) => ({
        address: c.address.split(',')[0], miles: c.dist != null ? Math.round(c.dist * 100) / 100 : null, sold: c.sold, price: c.price, sqft: c.sqft, condition: c.condition,
      })),
    };
  } catch (e) {
    return null;
  }
}

/** One line for the iPhone Shortcut's notification: the comps ARV next to the wholesaler's. */
function compsLook_(p) {
  try {
    const zip = zipOf_(p.address);
    if (!zip || !p.sqft) return '';
    const c = compArv_(readComps_(), zip, p.sqft);
    if (!c || !c.n) return ' No comps for ' + zip + ' yet.';
    const $ = (n) => '$' + Math.round(n).toLocaleString('en-US');
    let s = ' Comps (' + c.n + ' in ' + zip + ', ' + $(c.rate) + '/sq ft ' + c.basis + '): ARV about ' + $(c.arv);
    if (p.arv) { const diff = (p.arv - c.arv) / c.arv; s += Math.abs(diff) < 0.03 ? ', in line with theirs.' : ', theirs is ' + Math.round(Math.abs(diff) * 100) + '% ' + (diff > 0 ? 'higher' : 'lower') + '.'; }
    else s += '.';
    return s + (c.n < 3 ? ' (thin, only ' + c.n + ' sale' + (c.n > 1 ? 's' : '') + ')' : '');
  } catch (e) {
    return '';
  }
}


// ---------- addresses: zip and map position (US Census geocoder, free, no key) ----------

/** Looks an address up with the Census Bureau's geocoder. Returns {zip, city, state, lat, lon} or null. Cached for 6 hours. */
function geocode_(addr) {
  addr = String(addr || '').trim();
  if (!/\d/.test(addr)) return null;
  let q = addr;
  if (q.indexOf(',') < 0 && !zipOf_(q)) q += ', ' + CONFIG.DEFAULT_CITY;
  const cache = CacheService.getScriptCache();
  const ck = 'geo_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, q.toLowerCase()));
  const hit = cache.get(ck);
  if (hit) return hit === 'none' ? null : JSON.parse(hit);
  let out = null;
  try {
    const url = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?benchmark=Public_AR_Current&format=json&address=' + encodeURIComponent(q);
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() === 200) {
      const m = (((JSON.parse(res.getContentText()) || {}).result || {}).addressMatches || [])[0];
      if (m) {
        const c = m.addressComponents || {};
        out = { zip: String(c.zip || ''), city: String(c.city || ''), state: String(c.state || ''), lat: Number(m.coordinates.y), lon: Number(m.coordinates.x) };
      }
    }
  } catch (e) {
    return null; // don't cache a failure; try again next time
  }
  cache.put(ck, out ? JSON.stringify(out) : 'none', 21600);
  return out;
}

/**
 * The address with its zip filled in ("1422 Oakland St" → "1422 Oakland St, Fort Wayne, IN 46808").
 * An address that already has a zip is left as typed. With `full`, returns {address, lat, lon}.
 */
function withZip_(addr, full) {
  addr = String(addr || '').trim();
  const g = addr ? geocode_(addr) : null;
  let out = addr;
  if (g && g.zip && !zipOf_(addr)) {
    const title = (s) => String(s || '').toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
    out = addr.split(',')[0].trim() + ', ' + title(g.city) + ', ' + g.state + ' ' + g.zip;
  }
  return full ? { address: out, lat: g ? g.lat : null, lon: g ? g.lon : null } : out;
}

// ---------- pulled comps: recorded sales near a deal (RentCast) ----------
// RentCast's property records carry each house's last sale price and date from county records, plus its sale history.
// One "Pull sold comps" = one lookup: every single-family house within COMP_RADIUS_MILES sold in the last COMP_MONTHS.
// A house that sold for at least a third more than its previous sale within two years is marked Renovated (a flip),
// and that earlier purchase is added as an As-is sale. Script property RENTCAST_API_KEY turns this on.

function rentcastUsed_() {
  return Number(prop_('RENTCAST_USED_' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMM')) || 0);
}

function pullComps(id) {
  return pullComps_(id, requireOwner_().split('@')[0]);
}

/** Pulls comps for a brand-new lead if there's a key and lookups to spare. Never stops the lead from saving. */
function autoPullComps_(id) {
  try {
    if (prop_('RENTCAST_API_KEY') && rentcastUsed_() < CONFIG.AUTO_PULL_UNTIL) return pullComps_(id, 'auto');
  } catch (e) { /* the button is still there */ }
  return null;
}

function pullComps_(id, by) {
  const sh = dealsSheet_();
  const row = findDealRow_(sh, id);
  if (row < 0) throw new Error('That deal no longer exists.');
  const d = readDeals_(sh).filter((x) => x.id === String(id))[0];
  const g = withZip_(d.address, true);
  if (!g.lat) throw new Error('Couldn\'t find ' + (d.address || 'that address') + ' on the map. Check the house number and street.');
  const found = rentcastSearch_(g);
  const rows = found.rows;
  const saved = saveComps_(rows, by);
  writeDeal_(sh, row, { address: g.address, lat: g.lat, lon: g.lon });
  return {
    found: rows.length, added: saved.added, duplicates: saved.duplicates, flips: rows.filter((r) => r.condition === 'Renovated').length,
    used: found.used, limit: CONFIG.RENTCAST_MONTHLY_LIMIT,
  };
}

/** One RentCast lookup around a geocoded address {address, lat, lon}: recorded sales, flips marked. Counts toward the month. */
function rentcastSearch_(g) {
  const key = prop_('RENTCAST_API_KEY');
  if (!key) throw new Error('Add your RentCast API key first: Apps Script, Project Settings, Script Properties, RENTCAST_API_KEY. Steps are in the README.');
  const used = rentcastUsed_();
  if (used >= CONFIG.RENTCAST_MONTHLY_LIMIT) throw new Error('All ' + CONFIG.RENTCAST_MONTHLY_LIMIT + ' RentCast lookups for this month are used. They reset on the 1st.');
  const days = Math.round(CONFIG.COMP_MONTHS * 30.5);
  // A big search can take RentCast longer than Google waits, so start at 1 mile / 150 houses and fall back to half a mile.
  let res = null, lastErr = '';
  for (const t of [{ r: 1, n: 150 }, { r: 0.5, n: 75 }]) {
    const url = 'https://api.rentcast.io/v1/properties?latitude=' + g.lat + '&longitude=' + g.lon + '&radius=' + t.r +
      '&propertyType=' + encodeURIComponent('Single Family') + '&saleDateRange=' + days + '&limit=' + t.n;
    try {
      res = UrlFetchApp.fetch(url, { headers: { 'X-Api-Key': key, Accept: 'application/json' }, muteHttpExceptions: true });
      break;
    } catch (e) {
      lastErr = String(e && e.message || e);
      if (!/timeout|timed out/i.test(lastErr)) break;
    }
  }
  if (!res) throw new Error(/timeout|timed out/i.test(lastErr) ? 'RentCast is slow right now and didn\'t answer in time. Try again in a minute.' : 'Couldn\'t reach RentCast: ' + lastErr.slice(0, 150));
  const code = res.getResponseCode();
  if (code === 401 || code === 403) {
    const why = res.getContentText();
    if (/subscription|billing/i.test(why)) throw new Error('RentCast says this key has no active plan yet. In RentCast\'s API dashboard, choose the free Developer plan (Billing / Subscription), then try again.');
    throw new Error('RentCast didn\'t accept the API key. Check RENTCAST_API_KEY in Script Properties.');
  }
  if (code !== 200) throw new Error('RentCast answered ' + code + ': ' + res.getContentText().slice(0, 200));
  // Only lookups that came back count toward the month.
  PropertiesService.getScriptProperties().setProperty('RENTCAST_USED_' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMM'), String(used + 1));
  const list = JSON.parse(res.getContentText() || '[]');

  const tz = Session.getScriptTimeZone();
  const cut = Utilities.formatDate(new Date(Date.now() - days * 864e5), tz, 'yyyy-MM-dd');
  const norm = (a) => String(a || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 2).join(' ');
  const self = norm(g.address);
  const rows = [];
  (Array.isArray(list) ? list : []).forEach((p) => {
    const sold = String(p.lastSaleDate || '').slice(0, 10), price = num_(p.lastSalePrice), sqft = num_(p.squareFootage);
    if (!sold || sold < cut || price < 10000 || sqft < 300 || norm(p.formattedAddress || p.addressLine1) === self) return;
    const sales = Object.keys(p.history || {}).map((k) => p.history[k]).filter((e) => e && /sale/i.test(String(e.event || 'Sale')) && num_(e.price) > 0)
      .map((e) => ({ date: String(e.date || '').slice(0, 10), price: num_(e.price) })).filter((e) => e.date && e.date < sold).sort((a, b) => (a.date < b.date ? -1 : 1));
    const prior = sales[sales.length - 1];
    const gapDays = prior ? (new Date(sold) - new Date(prior.date)) / 864e5 : 9999;
    const flip = prior && gapDays <= 730 && price >= prior.price * 1.33;
    const base = { zip: p.zipCode, sqft: sqft, beds: p.bedrooms, baths: p.bathrooms, lat: p.latitude, lon: p.longitude, source: 'RentCast (county record)' };
    rows.push(Object.assign({}, base, { address: p.formattedAddress, sold: sold, price: price, condition: flip ? 'Renovated' : 'Average',
      notes: flip ? 'Flip: bought ' + prior.date + ' for $' + Math.round(prior.price).toLocaleString('en-US') : (p.yearBuilt ? 'Built ' + p.yearBuilt : '') }));
    if (flip && prior.date >= cut) rows.push(Object.assign({}, base, { address: p.formattedAddress, sold: prior.date, price: prior.price, condition: 'As-is', notes: 'Bought before the flip; resold ' + sold }));
  });
  return { rows: rows, used: used + 1 };
}

/**
 * Braun hub: sold comps around a listing's address (one RentCast lookup from the Fund's monthly allowance).
 * Nothing is saved to the Fund's comps tab; the hub keeps them on the listing.
 */
function hubComps_(body) {
  const want = PropertiesService.getScriptProperties().getProperty('HUB_KEY');
  if (!want) throw new Error('HUB_KEY is not set in Script Properties.');
  if (!sameSecret_(body.key, want)) throw new Error('Bad hub key.');
  const g = withZip_(String(body.address || ''), true);
  if (!g.lat) throw new Error('Couldn\'t find ' + (body.address || 'that address') + ' on the map.');
  const found = rentcastSearch_(g);
  const R = 3958.8, rad = (x) => x * Math.PI / 180;
  const miles = (a, b) => {
    const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return Math.round(2 * R * Math.asin(Math.sqrt(h)) * 100) / 100;
  };
  const rows = found.rows.map((r) => Object.assign({}, r, { miles: r.lat && r.lon ? miles(g, { lat: r.lat, lon: r.lon }) : null }));
  const out = { address: g.address, rows: rows, used: found.used, limit: CONFIG.RENTCAST_MONTHLY_LIMIT, months: CONFIG.COMP_MONTHS };
  // A second lookup when asked: RentCast's value estimate for the house itself, with the listings it compared against.
  if (body.withValue) {
    try { out.value = rentcastValue_(g, body.facts || {}); out.used = out.value.used; }
    catch (e) { out.valueError = String(e && e.message || e).slice(0, 200); }
  }
  return out;
}

/** One RentCast lookup: value estimate (85% range) for a geocoded address, plus the sale listings it used (active and recent). */
function rentcastValue_(g, facts) {
  const key = prop_('RENTCAST_API_KEY');
  if (!key) throw new Error('No RentCast API key.');
  const used = rentcastUsed_();
  if (used >= CONFIG.RENTCAST_MONTHLY_LIMIT) throw new Error('All ' + CONFIG.RENTCAST_MONTHLY_LIMIT + ' RentCast lookups for this month are used.');
  let url = 'https://api.rentcast.io/v1/avm/value?address=' + encodeURIComponent(g.address) + '&propertyType=' + encodeURIComponent('Single Family') + '&compCount=25';
  if (Number(facts.beds) > 0) url += '&bedrooms=' + Number(facts.beds);
  if (Number(facts.baths) > 0) url += '&bathrooms=' + Number(facts.baths);
  if (Number(facts.sqft) > 0) url += '&squareFootage=' + Math.round(Number(facts.sqft));
  const res = UrlFetchApp.fetch(url, { headers: { 'X-Api-Key': key, Accept: 'application/json' }, muteHttpExceptions: true });
  const code = res.getResponseCode();
  if (code !== 200) throw new Error('RentCast value estimate answered ' + code + ': ' + res.getContentText().slice(0, 150));
  PropertiesService.getScriptProperties().setProperty('RENTCAST_USED_' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMM'), String(used + 1));
  const d = JSON.parse(res.getContentText() || '{}');
  const day = (x) => String(x || '').slice(0, 10);
  return {
    price: num_(d.price), low: num_(d.priceRangeLow), high: num_(d.priceRangeHigh), used: used + 1,
    comps: (d.comparables || []).map((c) => ({
      address: c.formattedAddress || c.addressLine1 || '', price: num_(c.price), status: String(c.status || ''), listed: day(c.listedDate), removed: day(c.removedDate),
      dom: c.daysOnMarket != null ? num_(c.daysOnMarket) : null, sqft: num_(c.squareFootage), beds: c.bedrooms != null ? c.bedrooms : null, baths: c.bathrooms != null ? c.bathrooms : null,
      miles: c.distance != null ? Math.round(Number(c.distance) * 100) / 100 : null, match: c.correlation != null ? Math.round(Number(c.correlation) * 100) : null,
    })).filter((c) => c.address && c.price > 0),
  };
}

// ---------- People (light CRM): "Owner Contacts" + "Owner Contact Log" ----------
// Everyone who isn't a tenant: prospects for open units, vendors, agents, wholesalers, lenders.
// Tenants stay in "Owner Tenants"; their calls and notes go in the same log under a "tenant:<unit>:<phone>" ID.

const CONTACTS_TAB = 'Owner Contacts';
const CONTACTS_HEAD = ['ID', 'Name', 'Type', 'Stage', 'Phone', 'Email', 'Property', 'Next follow-up', 'Tags', 'Notes', 'Source', 'Created', 'Updated'];
// Prospect = someone applying for a rental (shown on the Tenants tab). The rest are deal people (shown on the Deals tab).
const CONTACT_TYPES = ['Prospect', 'Agent', 'Wholesaler', 'Seller', 'Lender', 'Contractor', 'Vendor', 'Other'];
const PROSPECT_STAGES = ['New', 'Contacted', 'Showing set', 'Applied', 'Approved', 'Leased', 'Lost'];
const LOG_TAB = 'Owner Contact Log';
const LOG_HEAD = ['When', 'Contact ID', 'Name', 'Kind', 'Note', 'By'];
const LOG_KINDS = ['Note', 'Call', 'Text', 'Email', 'Showing', 'Follow-up'];

function contactsSheet_(ss) {
  let sh = ss.getSheetByName(CONTACTS_TAB);
  if (!sh) {
    sh = ss.insertSheet(CONTACTS_TAB);
    sh.appendRow(CONTACTS_HEAD);
    sh.setFrozenRows(1);
    sh.getRange('A:A').setFontColor('#9a9a9a');
    sh.getRange('C2:C').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(CONTACT_TYPES, true).build());
    sh.getRange('D2:D').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(PROSPECT_STAGES, true).setAllowInvalid(true).build());
  }
  return sh;
}
function logSheet_(ss) {
  let sh = ss.getSheetByName(LOG_TAB);
  if (!sh) { sh = ss.insertSheet(LOG_TAB); sh.appendRow(LOG_HEAD); sh.setFrozenRows(1); }
  return sh;
}
const plainCell_ = (v) => { const x = String(v == null ? '' : v); return /^[=+\-@]/.test(x) ? "'" + x : x; };
const ymd_ = (d) => Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
const cellDate_ = (v) => (v instanceof Date ? ymd_(v) : String(v || '').trim());

function readContacts_(ss) {
  const sh = ss.getSheetByName(CONTACTS_TAB);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, CONTACTS_HEAD.length).getValues().map((r, i) => ({
    row: i + 2, id: String(r[0] || ''), name: String(r[1] || ''), type: String(r[2] || 'Other'), stage: String(r[3] || ''),
    phone: String(r[4] || ''), email: String(r[5] || ''), property: String(r[6] || ''), followUp: cellDate_(r[7]),
    tags: String(r[8] || ''), notes: String(r[9] || ''), source: String(r[10] || ''), created: cellDate_(r[11]), updated: cellDate_(r[12]),
  })).filter((c) => c.id && c.name);
}

function readContactLog_(ss) {
  const sh = ss.getSheetByName(LOG_TAB);
  if (!sh || sh.getLastRow() < 2) return [];
  const n = Math.min(600, sh.getLastRow() - 1);
  const start = sh.getLastRow() - n + 1;
  return sh.getRange(start, 1, n, LOG_HEAD.length).getValues().map((r) => ({
    when: r[0] instanceof Date ? r[0].toISOString() : String(r[0] || ''), id: String(r[1] || ''), name: String(r[2] || ''),
    kind: String(r[3] || 'Note'), note: String(r[4] || ''), by: String(r[5] || ''),
  })).reverse();
}

/** Add or update a contact. Returns its ID. */
function saveContact(c) {
  const email = currentEmail_();
  if (!isOwner_(email)) throw new Error('Not authorized.');
  c = c || {};
  const name = String(c.name || '').trim().slice(0, 120);
  if (!name) throw new Error('Add a name.');
  const type = CONTACT_TYPES.indexOf(c.type) >= 0 ? c.type : 'Other';
  const stage = type === 'Prospect' ? (PROSPECT_STAGES.indexOf(c.stage) >= 0 ? c.stage : 'New') : '';
  const follow = /^\d{4}-\d{2}-\d{2}$/.test(String(c.followUp || '')) ? String(c.followUp) : '';
  const ss = SpreadsheetApp.openById(CONFIG.PNL_SHEET_ID);
  const sh = contactsSheet_(ss);
  const today = ymd_(new Date());
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const all = readContacts_(ss);
    const hit = c.id ? all.find((x) => x.id === String(c.id)) : null;
    const id = hit ? hit.id : 'c' + Date.now().toString(36);
    const row = [id, name, type, stage, String(c.phone || '').slice(0, 40), String(c.email || '').slice(0, 120), String(c.property || '').slice(0, 120),
      follow, String(c.tags || '').slice(0, 200), String(c.notes || '').slice(0, 2000), String(c.source || (hit && hit.source) || '').slice(0, 80),
      hit ? hit.created : today, today].map(plainCell_);
    if (hit) sh.getRange(hit.row, 1, 1, row.length).setValues([row]);
    else sh.appendRow(row);
    if (hit && hit.stage !== stage && stage) logSheet_(ss).appendRow([new Date(), id, name, 'Note', 'Stage: ' + (hit.stage || 'none') + ' → ' + stage, ownerName_(email)].map(plainCell_));
    return id;
  } finally { lock.releaseLock(); }
}

/** Log a call, text, email, showing or note against a contact (or a tenant). Optionally sets the next follow-up. */
function addContactLog(id, name, kind, note, followUp) {
  const email = currentEmail_();
  if (!isOwner_(email)) throw new Error('Not authorized.');
  id = String(id || ''); note = String(note || '').trim().slice(0, 1500);
  if (!id) throw new Error('Pick a person first.');
  kind = LOG_KINDS.indexOf(kind) >= 0 ? kind : 'Note';
  const ss = SpreadsheetApp.openById(CONFIG.PNL_SHEET_ID);
  if (note || kind !== 'Note') logSheet_(ss).appendRow([new Date(), id, String(name || '').slice(0, 120), kind, note, ownerName_(email)].map(plainCell_));
  if (followUp !== undefined && !/^tenant:/.test(id)) {
    const c = readContacts_(ss).find((x) => x.id === id);
    if (c) contactsSheet_(ss).getRange(c.row, 8, 1, 6).setValues([[/^\d{4}-\d{2}-\d{2}$/.test(String(followUp)) ? followUp : '', c.tags, c.notes, c.source, c.created, ymd_(new Date())].map(plainCell_)]);
  }
  return true;
}

/** A prospect who signed: add them to the unit's row in Owner Tenants (fills the blank row, or adds one for a roommate). */
function makeTenant(contactId, unitId) {
  const email = currentEmail_();
  if (!isOwner_(email)) throw new Error('Not authorized.');
  const ss = SpreadsheetApp.openById(CONFIG.PNL_SHEET_ID);
  const c = readContacts_(ss).find((x) => x.id === String(contactId));
  if (!c) throw new Error('That contact no longer exists.');
  const units = (readListings_(ss).units || []);
  const u = units.find((x) => x.id === String(unitId));
  if (!u) throw new Error('Pick a unit.');
  const sh = tenantSheet_(ss, units);
  const v = sh.getRange(2, 1, Math.max(1, sh.getLastRow() - 1), 5).getValues();
  const blank = v.findIndex((r) => String(r[0]) === u.id && !String(r[2]).trim() && !String(r[3]).trim() && !String(r[4]).trim());
  const vals = [c.name, c.phone, c.email].map(plainCell_);
  if (blank >= 0) sh.getRange(blank + 2, 3, 1, 3).setValues([vals]);
  else sh.appendRow([u.id, u.name].concat(vals, ['', '', 1, '']));
  saveContact(Object.assign({}, c, { stage: 'Leased', followUp: '' }));
  logSheet_(ss).appendRow([new Date(), c.id, c.name, 'Note', 'Moved to tenants: ' + u.name, ownerName_(email)].map(plainCell_));
  return true;
}

function ownerName_(email) { return (CONFIG.OWNER_NAMES || {})[email] || String(email || '').split('@')[0]; }

// ---------- Tenant conversations, through the Braun hub's Quo line ----------
// The hub keeps every text and call on (260) 254-8558. These ask it, server to server with HUB_KEY, for one
// tenant's history or to text a tenant. The hub only answers for numbers on the Owner Tenants list.

function hubApi_(payload) {
  const key = PropertiesService.getScriptProperties().getProperty('HUB_KEY');
  if (!key) throw new Error('HUB_KEY is not set in Script Properties.');
  const url = PropertiesService.getScriptProperties().getProperty('BRAUN_HUB_API') || 'https://us-central1-braun-hub.cloudfunctions.net/fundApi';
  const res = UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify(Object.assign({ key: key }, payload)) });
  let body = {};
  try { body = JSON.parse(res.getContentText()); } catch (e) { /* not JSON */ }
  if (res.getResponseCode() !== 200 || !body.ok) throw new Error(body.error || ('The tenant line didn\'t answer (' + res.getResponseCode() + ').'));
  return body.result;
}

function tenantThread(phone) {
  const email = currentEmail_();
  if (!isOwner_(email)) throw new Error('Not authorized.');
  return hubApi_({ action: 'thread', phone: String(phone || '') });
}

function tenantText(phone, text, name) {
  const email = currentEmail_();
  if (!isOwner_(email)) throw new Error('Not authorized.');
  text = String(text || '').trim();
  if (!text) throw new Error('Type a message first.');
  const r = hubApi_({ action: 'send', phone: String(phone || ''), text: text.slice(0, 1200), by: email });
  addContactLog('tenant:' + phoneKey_(phone), name || '', 'Text', text.slice(0, 300));
  return r;
}

// ---------- utility bills, split to each house by account number ----------
// "Owner Utility Accounts": one row per utility account, saying which P&L column (house) it belongs to.
// "Owner Utility Bills": every bill found, by the daily Gmail scan or typed in, with its house filled in.
// Posting a bill adds it to that house's cell in the Ops tab's utilities block and leaves a note on the cell.

const UTIL_ACCT_TAB = 'Owner Utility Accounts';
const UTIL_ACCT_HEAD = ['Account #', 'Utility', 'P&L column', 'Gmail search', 'Notes'];
const UTIL_BILL_TAB = 'Owner Utility Bills';
const UTIL_BILL_HEAD = ['Bill date', 'Utility', 'Account #', 'P&L column', 'Amount', 'Status', 'Source', 'Subject', 'Message ID', 'Posted on', 'Added on'];
const UTIL_BLOCK_RE = /^(operating\s+)?util/i; // "Operating Utilities" (or "Utilties") block on the Ops tab

const digitsOf_ = (s) => String(s || '').replace(/\D/g, '');

function utilAcctSheet_(ss) {
  let sh = ss.getSheetByName(UTIL_ACCT_TAB);
  if (!sh) {
    sh = ss.insertSheet(UTIL_ACCT_TAB);
    sh.appendRow(UTIL_ACCT_HEAD);
    sh.setFrozenRows(1);
    sh.getRange('A:A').setNumberFormat('@');
    sh.getRange('A1').setNote('The account number exactly as it shows on the bill. Dashes and spaces don\'t matter.');
    sh.getRange('C1').setNote('The house\'s column name in the Ops tab\'s utilities block, so posted bills land in the right cell.');
    sh.getRange('D1').setNote('Optional. A Gmail search that finds this utility\'s bill emails, e.g. from:billing@example.com. The general search usually finds them without it.');
  }
  const block = readOpsBlock_(ss, UTIL_BLOCK_RE);
  if (block && block.properties.length) {
    sh.getRange('C2:C').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(block.properties, true).setAllowInvalid(true).build());
  }
  return sh;
}

function utilBillSheet_(ss) {
  let sh = ss.getSheetByName(UTIL_BILL_TAB);
  if (!sh) {
    sh = ss.insertSheet(UTIL_BILL_TAB);
    sh.appendRow(UTIL_BILL_HEAD);
    sh.setFrozenRows(1);
    sh.getRange('C:C').setNumberFormat('@');
    sh.getRange('F1').setNote('Blank = waiting to be posted. Posted = added to the P&L. Ignored = not ours or already entered.');
  }
  return sh;
}

function readUtilAccounts_(ss) {
  const sh = utilAcctSheet_(ss);
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, UTIL_ACCT_HEAD.length).getDisplayValues().map((r, i) => ({
    row: i + 2,
    account: String(r[0]).trim(),
    digits: digitsOf_(r[0]),
    utility: String(r[1]).trim(),
    column: String(r[2]).trim(),
    query: String(r[3]).trim(),
    notes: String(r[4]).trim(),
  })).filter((a) => a.digits.length >= 4);
}

function readUtilBills_(ss) {
  const sh = ss.getSheetByName(UTIL_BILL_TAB);
  if (!sh || sh.getLastRow() < 2) return [];
  const tz = Session.getScriptTimeZone();
  const day = (x) => (x instanceof Date ? Utilities.formatDate(x, tz, 'yyyy-MM-dd') : String(x || ''));
  return sh.getRange(2, 1, sh.getLastRow() - 1, UTIL_BILL_HEAD.length).getValues().map((r, i) => ({
    row: i + 2,
    date: day(r[0]),
    utility: String(r[1] || ''),
    account: String(r[2] || ''),
    column: String(r[3] || ''),
    amount: r[4] === '' ? null : num_(r[4]),
    status: String(r[5] || ''),
    source: String(r[6] || ''),
    subject: String(r[7] || ''),
    messageId: String(r[8] || ''),
    postedOn: day(r[9]),
  }));
}

function utilData_(ss) {
  try {
    const accounts = readUtilAccounts_(ss);
    const bills = readUtilBills_(ss);
    const block = readOpsBlock_(ss, UTIL_BLOCK_RE);
    // Unposted bills plus the last 120 days of history; older posted ones stay in the sheet.
    const cutoff = new Date(Date.now() - 120 * 864e5);
    const cut = Utilities.formatDate(cutoff, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    return {
      accounts: accounts.map((a) => ({ row: a.row, account: a.account, utility: a.utility, column: a.column })),
      bills: bills.filter((b) => !b.status || b.date >= cut).reverse(),
      columns: block ? block.properties : [],
      blockFound: !!block,
      lastScan: prop_('LAST_BILL_SCAN'),
      lastScanResult: prop_('LAST_BILL_SCAN_RESULT'),
      scanOn: ScriptApp.getProjectTriggers().some((t) => t.getHandlerFunction() === 'dailyBillScan'),
    };
  } catch (e) {
    return { accounts: [], bills: [], columns: [], error: e && e.message ? e.message : String(e) };
  }
}

/** Runs once a day from a trigger (set up with installDailyBillScan). Runs as Sam, so it reads Sam's Gmail. */
function dailyBillScan() {
  scanBills_();
  try { scanRent_(); } catch (e) { console.warn('Rent scan: ' + e); }
}

/**
 * Run this once from the Apps Script editor (pick it in the toolbar, then Run) to start the daily scan.
 * Google asks for permission to read Gmail the first time.
 */
function installDailyBillScan() {
  ScriptApp.getProjectTriggers().filter((t) => t.getHandlerFunction() === 'dailyBillScan').forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('dailyBillScan').timeBased().everyDays(1).atHour(6).create();
  return scanBills_();
}

/** The dashboard's "Scan Gmail now" button. */
function scanBillsNow() {
  requireOwner_();
  return scanBills_();
}

function scanBills_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = SpreadsheetApp.openById(CONFIG.PNL_SHEET_ID);
    const accts = readUtilAccounts_(ss);
    if (!accts.length) return { added: 0, message: 'Add your utility account numbers first.' };
    const sh = utilBillSheet_(ss);
    const seen = {};
    readUtilBills_(ss).forEach((b) => { if (b.messageId) seen[b.messageId] = true; });
    const queries = [CONFIG.BILL_SEARCH].concat(accts.map((a) => a.query).filter(Boolean).map((q) => q + ' newer_than:45d'));
    const tz = Session.getScriptTimeZone();
    const today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
    const rows = [];
    let looked = 0, unmatched = 0;
    const done = {};
    queries.filter((q, i) => queries.indexOf(q) === i).forEach((q) => {
      GmailApp.search(q, 0, 40).forEach((th) => {
        th.getMessages().forEach((m) => {
          const id = m.getId();
          if (seen[id] || done[id] || looked >= 120) return;
          done[id] = true; looked++;
          const subject = m.getSubject() || '';
          const body = m.getPlainBody() || '';
          const text = subject + '\n' + body;
          const hits = matchAccounts_(text, accts);
          const amount = billAmount_(text);
          const date = Utilities.formatDate(m.getDate(), tz, 'yyyy-MM-dd');
          if (hits.length) {
            hits.forEach((a) => rows.push([date, a.utility, a.account, a.column, hits.length > 1 ? '' : amount == null ? '' : amount, '', 'Gmail', cellText_(subject.slice(0, 200)), id, '', today]));
          } else {
            // A bill from one of your utilities whose account isn't on the list yet: save it so it can be mapped.
            const from = (m.getFrom() || '').toLowerCase();
            const util = accts.filter((a) => a.utility.length >= 3 && (from.indexOf(a.utility.toLowerCase()) >= 0 || subject.toLowerCase().indexOf(a.utility.toLowerCase()) >= 0))[0];
            if (!util) return;
            const masked = (/(?:account|acct)[^\d\n]{0,25}([\dxX*•\- ]{4,24}\d)/i.exec(text) || [])[1] || '';
            rows.push([date, util.utility, cellText_(masked.trim()), '', amount == null ? '' : amount, '', 'Gmail · account not on list', cellText_(subject.slice(0, 200)), id, '', today]);
            unmatched++;
          }
        });
      });
    });
    if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, UTIL_BILL_HEAD.length).setValues(rows);
    const result = rows.length ? rows.length + ' new bill' + (rows.length > 1 ? 's' : '') + (unmatched ? ' (' + unmatched + ' with an account that isn\'t on your list)' : '') : 'No new bills';
    PropertiesService.getScriptProperties().setProperties({ LAST_BILL_SCAN: Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm'), LAST_BILL_SCAN_RESULT: result });
    return { added: rows.length, unmatched: unmatched, looked: looked, message: result + '.' };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Which accounts an email is about. A full account number anywhere in the text counts. A masked one
 * ("account ending in 4417", "****4417") counts only if exactly one of your accounts ends that way.
 */
function matchAccounts_(text, accts) {
  // The full number, with or without dashes or spaces between digits, not part of a longer number.
  const full = accts.filter((a) => new RegExp('(?<!\\d)' + a.digits.split('').join('[\\s-]?') + '(?!\\d)').test(text));
  if (full.length) return full;
  const tails = [];
  const re = /(?:ending\s+(?:in|with)|ends\s+(?:in|with)|[x*•]{2,}[\s-]*)\s*(\d{3,6})\b/gi;
  let m;
  while ((m = re.exec(text))) tails.push(m[1]);
  for (const t of tails) {
    const hit = accts.filter((a) => a.digits.slice(-t.length) === t);
    if (hit.length === 1) return hit;
  }
  return [];
}

/** The amount due on a bill email, or null if there isn't a clear one. */
function billAmount_(text) {
  const res = [
    /(?:total\s+amount\s+due|amount\s+due|total\s+due|balance\s+due|new\s+balance|total\s+balance|current\s+charges|statement\s+balance|amount\s+of)[^$\n]{0,40}\$\s?([\d,]+\.\d{2})/i,
    /\$\s?([\d,]+\.\d{2})[^.\n]{0,30}(?:is\s+due|due\s+on|due\s+by)/i,
  ];
  for (const re of res) { const m = re.exec(text); if (m) return num_(m[1]); }
  return null;
}

/** Adds (or updates) a utility account from the dashboard: account number → the house's P&L column. */
function addUtilAccount(account, utility, column) {
  requireOwner_();
  const digits = digitsOf_(account);
  if (digits.length < 4) throw new Error('Type the account number from the bill.');
  const ss = SpreadsheetApp.openById(CONFIG.PNL_SHEET_ID);
  const sh = utilAcctSheet_(ss);
  const hit = readUtilAccounts_(ss).filter((a) => a.digits === digits)[0];
  const row = [String(account).trim(), String(utility || '').trim().slice(0, 60), String(column || '').trim()];
  if (hit) sh.getRange(hit.row, 1, 1, 3).setValues([row]);
  else sh.appendRow(row.concat(['', '']));
  // Bills already saved for this account (or with its last digits and no house yet) get the house filled in.
  const bsh = ss.getSheetByName(UTIL_BILL_TAB);
  if (bsh && row[2]) readUtilBills_(ss).forEach((b) => {
    if (b.status || b.column) return;
    const bd = digitsOf_(b.account);
    if (bd && (bd === digits || (bd.length >= 4 && digits.slice(-bd.length) === bd) || (bd.length >= 4 && digits.slice(-4) === bd.slice(-4)))) {
      bsh.getRange(b.row, 2, 1, 3).setValues([[row[1] || b.utility, row[0], row[2]]]);
    }
  });
  return true;
}

/** A bill typed in by hand (paper bill, autopay you saw on the bank statement). */
function addUtilBill(account, amount, date) {
  const email = requireOwner_();
  const ss = SpreadsheetApp.openById(CONFIG.PNL_SHEET_ID);
  const digits = digitsOf_(account);
  const a = readUtilAccounts_(ss).filter((x) => x.digits === digits || (digits.length >= 4 && x.digits.slice(-digits.length) === digits))[0];
  if (!a) throw new Error('That account isn\'t on your list yet. Add it under Utility accounts first.');
  const n = num_(amount);
  if (!(n > 0)) throw new Error('Enter the amount.');
  const tz = Session.getScriptTimeZone();
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? date : Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  utilBillSheet_(ss).appendRow([day, a.utility, a.account, a.column, n, '', 'Entered by ' + email.split('@')[0], '', '', '', Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd')]);
  return true;
}

/** Marks a bill Ignored (not ours, or already in the P&L) or back to waiting. */
function setBillStatus(row, status) {
  requireOwner_();
  if (['', 'Ignored'].indexOf(status) < 0) throw new Error('Unknown status.');
  const sh = utilBillSheet_(SpreadsheetApp.openById(CONFIG.PNL_SHEET_ID));
  row = Number(row);
  if (!(row >= 2 && row <= sh.getLastRow())) throw new Error('That bill no longer exists.');
  sh.getRange(row, 6).setValue(status);
  return true;
}

/**
 * Adds one bill to the P&L: the Ops tab's utilities block, the bill's house column, the bill date's month.
 * A number in the cell gets the bill added to it; a formula gets "+amount" on the end; an empty cell gets the amount.
 * Every posted bill leaves a line in the cell's note, so you can see what's in it.
 */
function postBillToPnl(row, amountOverride) {
  const email = requireOwner_();
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const ss = SpreadsheetApp.openById(CONFIG.PNL_SHEET_ID);
    const bsh = utilBillSheet_(ss);
    row = Number(row);
    if (!(row >= 2 && row <= bsh.getLastRow())) throw new Error('That bill no longer exists.');
    const b = readUtilBills_(ss).filter((x) => x.row === row)[0];
    if (b.status === 'Posted') throw new Error('Already posted on ' + b.postedOn + '.');
    const amount = amountOverride !== undefined && amountOverride !== '' && amountOverride != null ? num_(amountOverride) : b.amount;
    if (!(amount > 0)) throw new Error('This bill has no amount. Type it in first.');
    if (!b.column) throw new Error('This bill\'s account isn\'t matched to a house yet.');
    const m = /^(\d{4})-(\d{2})/.exec(b.date);
    if (!m) throw new Error('This bill has no date.');
    const month = Number(m[2]) - 1;

    const sh = ss.getSheetByName('Ops');
    if (!sh) throw new Error('Couldn\'t find the Ops tab.');
    const v = sh.getDataRange().getValues();
    let cell = null;
    for (let r = 0; r < v.length && !cell; r++) {
      const c = v[r].findIndex((x) => UTIL_BLOCK_RE.test(String(x).trim()));
      if (c < 0) continue;
      let pc = -1;
      for (let k = c + 1; k < v[r].length; k++) {
        const n = String(v[r][k]).trim();
        if (!n || /^totals?$/i.test(n)) break;
        if (n.toLowerCase() === b.column.toLowerCase()) { pc = k; break; }
      }
      if (pc < 0) throw new Error('No "' + b.column + '" column in the Ops utilities block. Fix the P&L column on the account.');
      for (let rr = r + 1; rr < Math.min(v.length, r + 20); rr++) {
        if (MONTHS.indexOf(String(v[rr][c]).trim().slice(0, 3)) === month) { cell = sh.getRange(rr + 1, pc + 1); break; }
      }
      if (!cell) throw new Error('Couldn\'t find the ' + MONTHS[month] + ' row in the Ops utilities block.');
    }
    if (!cell) throw new Error('Couldn\'t find the utilities block on the Ops tab.');

    const f = cell.getFormula();
    const amt = Math.round(amount * 100) / 100;
    if (f) cell.setFormula(f + '+' + amt);
    else cell.setValue(num_(cell.getValue()) + amt);
    const tz = Session.getScriptTimeZone();
    const today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
    const line = b.utility + ' acct ' + b.account + ' bill ' + b.date + ': $' + amt.toFixed(2) + ' (posted ' + today + ' by ' + email.split('@')[0] + ')';
    const note = cell.getNote();
    cell.setNote((note ? note + '\n' : '') + line);
    bsh.getRange(row, 5, 1, 2).setValues([[amt, 'Posted']]);
    bsh.getRange(row, 10).setValue(today);
    return { cell: 'Ops!' + cell.getA1Notation(), amount: amt };
  } finally {
    lock.releaseLock();
  }
}

// ---------- helpers ----------

/** Adds columns to a tab when it has fewer than `n` (tabs are made with only as many columns as they needed). */
function ensureCols_(sh, n) {
  const have = sh.getMaxColumns();
  if (have < n) sh.insertColumnsAfter(have, n - have);
}

function prop_(name) {
  return String(PropertiesService.getScriptProperties().getProperty(name) || '');
}
function requireOwner_() {
  const email = currentEmail_();
  if (!isOwner_(email)) throw new Error('Not authorized.');
  return email;
}

// The owner whose sign-in token came with this request (checked in doPost).
// Not Session.getActiveUser(): the script runs as Sam, so that would always be Sam.
function currentEmail_() {
  return REQ_EMAIL_;
}
function isOwner_(email) {
  return !!email && CONFIG.OWNERS.map((x) => x.toLowerCase()).indexOf(email) >= 0;
}
function num_(x) {
  if (typeof x === 'number') return isFinite(x) ? x : 0;
  const s = String(x || '').replace(/[$,\s]/g, '');
  if (!s || s[0] === '#') return 0;
  const neg = /^\(.*\)$/.test(s);
  const n = parseFloat(s.replace(/[()]/g, ''));
  return isFinite(n) ? (neg ? -n : n) : 0;
}
function escape_(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}


// ---------- Texts: scheduled tenant texts, group texts, and the tenant auto-replies ----------
// Everything goes out from the shared Quo line (260) 254-8558 through the Braun hub (hubApi_).
// One switch, kept in the hub as tenantMode: in test mode nothing is texted to tenants. Scheduled texts are
// written to "Owner Text Log" as "Test (not sent)"; auto-replies show in the hub's outbox, listed on the Texts tab.

const TEXT_LOG_TAB = 'Owner Text Log';
const TEXT_LOG_HEAD = ['When', 'Kind', 'Tenant', 'Unit', 'Phone', 'Message', 'Status', 'By', 'Key'];
const TEXT_KINDS = { rentReminder: 'Rent reminder', rentDue: 'Rent due today', renewal: 'Lease renewal', group: 'Group text' };
const TEXT_DEFAULTS = {
  hour: 10,
  rentReminder: { on: true, days: 3, text: "Hi {first}, it's The Fund. Friendly reminder that rent{amount} for {unit} is due {due}. If you've already paid, thank you!" },
  rentDue: { on: false, days: 0, text: "Hi {first}, it's The Fund. Rent{amount} for {unit} is due today. If you've already paid, thank you!" },
  renewal: { on: true, days: 60, text: "Hi {first}, it's The Fund. Your lease at {unit} ends {leaseEnd}. Are you planning to stay? Reply here and we'll send renewal paperwork." },
};

function textSettings_() {
  let saved = {};
  try { saved = JSON.parse(PropertiesService.getScriptProperties().getProperty('FUND_TEXTS') || '{}'); } catch (e) { saved = {}; }
  const out = { hour: Number(saved.hour) >= 6 && Number(saved.hour) <= 20 ? Number(saved.hour) : TEXT_DEFAULTS.hour };
  ['rentReminder', 'rentDue', 'renewal'].forEach((k) => {
    const d = TEXT_DEFAULTS[k], x = saved[k] || {};
    out[k] = { on: typeof x.on === 'boolean' ? x.on : d.on, days: Number.isFinite(Number(x.days)) && x.days !== '' ? Math.max(0, Math.min(120, Math.round(Number(x.days)))) : d.days, text: String(x.text || d.text) };
  });
  return out;
}

function textLogSheet_(ss) {
  let sh = ss.getSheetByName(TEXT_LOG_TAB);
  if (!sh) { sh = ss.insertSheet(TEXT_LOG_TAB); sh.appendRow(TEXT_LOG_HEAD); sh.setFrozenRows(1); }
  return sh;
}

function readTextLog_(ss, n) {
  const sh = ss.getSheetByName(TEXT_LOG_TAB);
  if (!sh || sh.getLastRow() < 2) return [];
  const rows = Math.min(n || 400, sh.getLastRow() - 1);
  const tz = Session.getScriptTimeZone();
  return sh.getRange(sh.getLastRow() - rows + 1, 1, rows, TEXT_LOG_HEAD.length).getValues().reverse().map((r) => ({
    when: r[0] instanceof Date ? Utilities.formatDate(r[0], tz, "yyyy-MM-dd'T'HH:mm:ss") : String(r[0] || ''),
    kind: String(r[1]), tenant: String(r[2]), unit: String(r[3]), phone: String(r[4]), text: String(r[5]), status: String(r[6]), by: String(r[7]), key: String(r[8]),
  }));
}

function fillText_(tpl, v) { return String(tpl || '').replace(/\{(\w+)\}/g, (_, k) => (v[k] == null ? '' : String(v[k]))); }
function dayOnly_(y, m, d) { const last = new Date(y, m + 1, 0).getDate(); return new Date(y, m, Math.min(d, last)); }
function daysApart_(a, b) { return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 864e5); }
function niceDate_(d) { return Utilities.formatDate(d, Session.getScriptTimeZone(), 'MMM d'); }

/** The scheduled texts that would go out on one day. */
function plannedTexts_(s, tenants, units, day, paid) {
  const unitBy = {}; (units || []).forEach((u) => { unitBy[u.id] = u; });
  paid = paid || {}; // "unitId|yyyy-MM" → true once that month's rent is in (Owner Rent tab)
  const out = [];
  tenants.forEach((t) => {
    if (!phoneKey_(t.phone)) return;
    const u = unitBy[t.unitId] || {};
    const first = String(t.name || '').trim().split(/\s+/)[0] || 'there';
    const base = { first: first, unit: u.address || t.unit || 'your rental', amount: t.rent ? ' of $' + Math.round(t.rent).toLocaleString('en-US') : '' };
    const add = (kind, target, vars) => out.push({ kind: kind, label: TEXT_KINDS[kind], tenant: t.name || '', unitId: t.unitId, unit: base.unit, phone: t.phone,
      date: ymd_(day), key: kind + '|' + phoneKey_(t.phone) + '|' + ymd_(target), text: fillText_(s[kind].text, Object.assign({}, base, vars)) });
    // Rent: the next due date on or after this day.
    let due = dayOnly_(day.getFullYear(), day.getMonth(), t.dueDay || 1);
    if (daysApart_(day, due) < 0) due = dayOnly_(day.getFullYear(), day.getMonth() + 1, t.dueDay || 1);
    const until = daysApart_(day, due);
    const alreadyPaid = paid[t.unitId + '|' + Utilities.formatDate(due, Session.getScriptTimeZone(), 'yyyy-MM')];
    if (!alreadyPaid && s.rentReminder.on && s.rentReminder.days > 0 && until === s.rentReminder.days) add('rentReminder', due, { due: niceDate_(due) });
    if (!alreadyPaid && s.rentDue.on && until === 0) add('rentDue', due, { due: 'today' });
    // Lease renewal: a set number of days before the lease ends (not month-to-month).
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(u.leaseEnds || ''));
    if (s.renewal.on && m) {
      const end = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      if (daysApart_(day, end) === s.renewal.days) add('renewal', end, { leaseEnd: Utilities.formatDate(end, Session.getScriptTimeZone(), 'MMMM d') });
    }
  });
  return out;
}

function hubTexts_() {
  try { return hubApi_({ action: 'texts.get' }); } catch (e) { return { error: e.message }; }
}

/** The Texts tab. */
function getTexts() {
  const email = currentEmail_();
  if (!isOwner_(email)) throw new Error('Not authorized.');
  const ss = SpreadsheetApp.openById(CONFIG.PNL_SHEET_ID);
  const units = (readListings_(ss).units) || [];
  const tenants = readTenants_(ss, units);
  const s = textSettings_();
  const sent = {}; readTextLog_(ss, 600).forEach((l) => { if (l.key && /^(Sent|Test)/.test(l.status)) sent[l.key] = true; });
  const upcoming = [];
  const today = new Date();
  const paid = paidMonths_(ss, units, tenants);
  for (let i = 0; i < 31; i++) {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
    plannedTexts_(s, tenants, units, day, paid).forEach((x) => { if (!sent[x.key]) upcoming.push(x); });
  }
  let outbox = [];
  try { outbox = hubApi_({ action: 'texts.outbox' }).items || []; } catch (e) { /* hub not reachable; the tab says so */ }
  return {
    settings: s,
    hub: hubTexts_(),
    upcoming: upcoming.slice(0, 40),
    log: readTextLog_(ss, 60),
    outbox: outbox,
    scheduleOn: ScriptApp.getProjectTriggers().some((t) => t.getHandlerFunction() === 'dailyTenantTexts'),
    withPhone: tenants.filter((t) => phoneKey_(t.phone)).length,
  };
}

function saveTexts(x) {
  const email = currentEmail_();
  if (!isOwner_(email)) throw new Error('Not authorized.');
  x = x || {};
  const cur = textSettings_();
  const next = { hour: x.hour != null ? Number(x.hour) : cur.hour };
  ['rentReminder', 'rentDue', 'renewal'].forEach((k) => {
    const y = x[k] || {};
    next[k] = { on: typeof y.on === 'boolean' ? y.on : cur[k].on, days: y.days != null ? Number(y.days) : cur[k].days, text: String(y.text != null ? y.text : cur[k].text).trim().slice(0, 600) || TEXT_DEFAULTS[k].text };
  });
  PropertiesService.getScriptProperties().setProperty('FUND_TEXTS', JSON.stringify(next));
  if (x.hub) hubApi_({ action: 'texts.save', settings: x.hub, by: ownerName_(email) });
  setupTextSchedule();
  return getTexts();
}

/** One daily run sends whatever is due that day. Run this from the editor, or Save on the Texts tab. */
function setupTextSchedule() {
  const s = textSettings_();
  ScriptApp.getProjectTriggers().filter((t) => t.getHandlerFunction() === 'dailyTenantTexts').forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('dailyTenantTexts').timeBased().everyDays(1).atHour(s.hour).nearMinute(5).create();
  return 'Daily tenant texts at ' + s.hour + ':00';
}

/** Runs once a day (trigger). Sends, or in test mode only logs, the scheduled texts due today. */
function dailyTenantTexts() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  try {
    const ss = SpreadsheetApp.openById(CONFIG.PNL_SHEET_ID);
    const units = (readListings_(ss).units) || [];
    const tenants = readTenants_(ss, units);
    const hub = hubTexts_();
    const live = hub && hub.tenantMode === 'live';
    const done = {}; readTextLog_(ss, 600).forEach((l) => { if (l.key && /^(Sent|Test)/.test(l.status)) done[l.key] = true; });
    try { scanRent_(); } catch (e) { /* Gmail hiccup: send reminders on what's already filed */ }
    const due = plannedTexts_(textSettings_(), tenants, units, new Date(), paidMonths_(ss, units, tenants)).filter((x) => !done[x.key]);
    const sh = textLogSheet_(ss);
    due.forEach((x) => {
      let status = 'Test (not sent)';
      if (hub.error) status = 'Failed: ' + hub.error;
      else if (live) {
        try { hubApi_({ action: 'send', phone: x.phone, text: x.text, by: 'auto:' + x.kind }); status = 'Sent'; } catch (e) { status = 'Failed: ' + e.message; }
      }
      sh.appendRow([new Date(), x.label, x.tenant, x.unit, "'" + x.phone, x.text, status, 'Schedule', x.key]);
    });
  } finally {
    lock.releaseLock();
  }
}

/** One message to every tenant with a cell (or one unit's tenants). {first} becomes each tenant's first name. Always sends. */
function groupText(text, unitId) {
  const email = currentEmail_();
  if (!isOwner_(email)) throw new Error('Not authorized.');
  text = String(text || '').trim().slice(0, 1000);
  if (!text) throw new Error('Type a message first.');
  const ss = SpreadsheetApp.openById(CONFIG.PNL_SHEET_ID);
  const units = (readListings_(ss).units) || [];
  const unitBy = {}; units.forEach((u) => { unitBy[u.id] = u; });
  const list = readTenants_(ss, units).filter((t) => phoneKey_(t.phone) && (!unitId || t.unitId === unitId));
  if (!list.length) throw new Error('No tenants with a cell number' + (unitId ? ' at that unit.' : '.'));
  const sh = textLogSheet_(ss);
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMddHHmm');
  const res = { sent: 0, failed: [] };
  list.forEach((t) => {
    const first = String(t.name || '').trim().split(/\s+/)[0] || 'there';
    const msg = fillText_(text, { first: first, unit: (unitBy[t.unitId] || {}).address || t.unit || '' });
    let status = 'Sent';
    try { hubApi_({ action: 'send', phone: t.phone, text: msg, by: email }); res.sent++; } catch (e) { status = 'Failed: ' + e.message; res.failed.push((t.name || t.phone) + ': ' + e.message); }
    sh.appendRow([new Date(), TEXT_KINDS.group, t.name || '', (unitBy[t.unitId] || {}).address || t.unit || '', "'" + t.phone, msg, status, ownerName_(email), 'group|' + phoneKey_(t.phone) + '|' + stamp]);
  });
  return res;
}


// ---------- Rent: who has paid this month (the "Owner Rent" tab) ----------
// One row per payment. Innago's payment emails are filed here automatically (daily, and from the dashboard's
// "Check Innago" button); Venmo, checks and cash are added with "Mark paid". A payment counts toward the month
// of its due date, so rent paid on the 30th for the 1st lands in the right month.
// Innago payments whose due day isn't the tenant's rent day (utility bill-backs, fees) are filed as "Other".

function rentSheet_(ss) {
  let sh = ss.getSheetByName(RENT_TAB);
  if (!sh) {
    sh = ss.insertSheet(RENT_TAB);
    sh.appendRow(RENT_HEAD);
    sh.setFrozenRows(1);
    sh.getRange('A1').setNote('The month the payment counts toward, as yyyy-MM (e.g. 2026-12).');
    sh.getRange('G2:G').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(RENT_KINDS, true).build());
    sh.getRange('J1').setNote('Innago invoice and Gmail message, so the same payment is never filed twice.');
    sh.getRange('A:A').setNumberFormat('@');
  }
  return sh;
}

function readRent_(ss) {
  const sh = ss.getSheetByName(RENT_TAB);
  if (!sh || sh.getLastRow() < 2) return [];
  const tz = Session.getScriptTimeZone();
  const day = (x) => (x instanceof Date ? Utilities.formatDate(x, tz, 'yyyy-MM-dd') : String(x || ''));
  const month = (x) => (x instanceof Date ? Utilities.formatDate(x, tz, 'yyyy-MM') : String(x || '').trim().slice(0, 7));
  return sh.getRange(2, 1, sh.getLastRow() - 1, RENT_HEAD.length).getValues().map((r, i) => ({
    row: i + 2, month: month(r[0]), unitId: String(r[1] || '').trim(), unit: String(r[2] || ''), tenant: String(r[3] || ''),
    amount: num_(r[4]), paidOn: day(r[5]), kind: String(r[6] || 'Rent'), method: String(r[7] || ''), note: String(r[8] || ''), ref: String(r[9] || ''),
  })).filter((x) => x.month);
}

/** What each unit owes a month: the rents in Owner Tenants added up (two tenants splitting = two rows). */
function rentDueByUnit_(tenants) {
  const due = {}, day = {};
  (tenants || []).forEach((t) => { if (!t.unitId) return; due[t.unitId] = (due[t.unitId] || 0) + (t.rent || 0); if (!day[t.unitId]) day[t.unitId] = t.dueDay || 1; });
  return { due: due, day: day };
}

/** "unitId|yyyy-MM" → true when that month's rent is fully in. Used to skip rent reminders. */
function paidMonths_(ss, units, tenants) {
  const out = {};
  try {
    const owed = rentDueByUnit_(tenants).due, got = {};
    readRent_(ss).filter((x) => x.kind !== 'Other').forEach((x) => { const k = x.unitId + '|' + x.month; got[k] = (got[k] || 0) + x.amount; });
    Object.keys(got).forEach((k) => { const u = k.split('|')[0]; if (owed[u] && got[k] >= owed[u] - 1) out[k] = true; });
  } catch (e) { /* no rent tab yet */ }
  return out;
}

/** The dashboard's rent card: this month (and last month) by unit, with paid / partial / late. */
function rentData_(ss, units, tenants) {
  try {
    const tz = Session.getScriptTimeZone();
    const now = new Date();
    const thisM = Utilities.formatDate(now, tz, 'yyyy-MM');
    const lastM = Utilities.formatDate(new Date(now.getFullYear(), now.getMonth() - 1, 1), tz, 'yyyy-MM');
    const rows = readRent_(ss);
    const owed = rentDueByUnit_(tenants);
    const leasedIds = {}; (units || []).forEach((u) => { if (owed.due[u.id]) leasedIds[u.id] = u; });
    const month = (m) => Object.keys(leasedIds).map((id) => {
      const u = leasedIds[id];
      const pays = rows.filter((x) => x.unitId === id && x.month === m && x.kind !== 'Other');
      const paid = pays.reduce((a, x) => a + x.amount, 0);
      const due = owed.due[id];
      const [y, mo] = m.split('-').map(Number);
      const dueDate = new Date(y, mo - 1, owed.day[id] || 1);
      const lateFrom = new Date(dueDate.getTime() + (CONFIG.RENT_GRACE_DAYS || 3) * 864e5);
      const status = paid >= due - 1 ? 'Paid' : now >= lateFrom ? (paid > 0 ? 'Partial' : 'Late') : (paid > 0 ? 'Partial' : 'Due');
      return { unitId: id, unit: u.name, address: u.address, due: due, paid: Math.round(paid * 100) / 100, status: status,
        dueDate: Utilities.formatDate(dueDate, tz, 'yyyy-MM-dd'), payments: pays.map((x) => ({ row: x.row, amount: x.amount, paidOn: x.paidOn, method: x.method, tenant: x.tenant, note: x.note })) };
    });
    const other = rows.filter((x) => x.kind === 'Other' && (x.month === thisM || x.month === lastM)).map((x) => ({ row: x.row, unitId: x.unitId, unit: x.unit, tenant: x.tenant, amount: x.amount, paidOn: x.paidOn, note: x.note }));
    const unmatched = rows.filter((x) => !x.unitId && (x.month === thisM || x.month === lastM)).map((x) => ({ row: x.row, tenant: x.tenant, amount: x.amount, paidOn: x.paidOn, note: x.note }));
    return { thisMonth: thisM, lastMonth: lastM, units: month(thisM), last: month(lastM), other: other, unmatched: unmatched,
      graceDays: CONFIG.RENT_GRACE_DAYS || 3, scanned: prop_('RENT_SCANNED_AT') };
  } catch (e) {
    return { error: e && e.message ? e.message : String(e), units: [], last: [] };
  }
}

/** "Mark paid" on the dashboard: Venmo, check, cash or anything Innago didn't email about. */
function markRentPaid(x) {
  const email = requireOwner_();
  x = x || {};
  const ss = SpreadsheetApp.openById(CONFIG.PNL_SHEET_ID);
  const units = readListings_(ss).units || [];
  const u = units.find((v) => v.id === x.unitId);
  if (!u) throw new Error('Pick a rental.');
  const amount = num_(x.amount);
  if (!(amount > 0)) throw new Error('Enter the amount paid.');
  const month = /^\d{4}-\d{2}$/.test(String(x.month || '')) ? x.month : Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM');
  const method = ['Venmo', 'Zelle', 'Check', 'Cash', 'Innago', 'Other'].indexOf(x.method) >= 0 ? x.method : 'Other';
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  rentSheet_(ss).appendRow([month, u.id, u.name, cellText_(String(x.tenant || '').slice(0, 80)), amount, x.paidOn || today, 'Rent', method, cellText_(String(x.note || '').slice(0, 200)), 'manual:' + ownerName_(email), today]);
  return true;
}

/** Takes back a payment row (entered by mistake). */
function removeRentRow(row) {
  requireOwner_();
  const sh = rentSheet_(SpreadsheetApp.openById(CONFIG.PNL_SHEET_ID));
  row = Number(row);
  if (!(row >= 2 && row <= sh.getLastRow())) throw new Error('That payment is gone. Refresh the page.');
  sh.deleteRow(row);
  return true;
}

/** The dashboard's "Check Innago" button. */
function scanRentNow() {
  requireOwner_();
  return scanRent_();
}

/** Reads Innago "Tenant Payment Notification" emails in Sam's Gmail and files any new ones. */
function scanRent_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = SpreadsheetApp.openById(CONFIG.PNL_SHEET_ID);
    const units = readListings_(ss).units || [];
    const tenants = readTenants_(ss, units);
    const sh = rentSheet_(ss);
    const seen = {}; readRent_(ss).forEach((x) => { if (x.ref) seen[x.ref.split('|').pop()] = true; });
    const norm = (n) => String(n || '').toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
    const byName = {}; tenants.forEach((t) => { if (t.name) byName[norm(t.name)] = t; });
    const unitName = {}; units.forEach((u) => { unitName[u.id] = u.name; });
    const tz = Session.getScriptTimeZone();
    const today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
    const rows = [];
    GmailApp.search(CONFIG.RENT_SEARCH, 0, 100).forEach((th) => th.getMessages().forEach((m) => {
      const id = m.getId();
      if (seen[id] || !/payment notification/i.test(m.getSubject() || '')) return;
      seen[id] = true;
      const p = parseInnagoPayment_(m.getPlainBody() || m.getBody() || '');
      if (!p || !(p.amount > 0)) return;
      const t = byName[norm(p.tenant)] || null;
      const unitId = t ? t.unitId : '';
      // Not a Fund home (e.g. Highgate)? Skip it entirely.
      if (t && !unitName[unitId]) return;
      const due = p.due || Utilities.formatDate(m.getDate(), tz, 'yyyy-MM-dd');
      const dueDay = Number(due.slice(8, 10));
      const isRent = !t || dueDay === (t.dueDay || 1);
      rows.push([due.slice(0, 7), unitId, unitId ? unitName[unitId] : p.address, p.tenant, p.amount, p.paidOn || Utilities.formatDate(m.getDate(), tz, 'yyyy-MM-dd'),
        isRent ? 'Rent' : 'Other', 'Innago', unitId ? '' : 'No tenant named ' + p.tenant + ' in Owner Tenants', 'innago:' + (p.invoice || '') + '|' + id, today]);
    }));
    if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, RENT_HEAD.length).setValues(rows);
    PropertiesService.getScriptProperties().setProperty('RENT_SCANNED_AT', new Date().toISOString());
    return { added: rows.length };
  } finally {
    lock.releaseLock();
  }
}

/** Pulls tenant, address, invoice, amount, payment date and due date out of one Innago email. */
function parseInnagoPayment_(raw) {
  const text = String(raw).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
  const pick = (re) => { const m = re.exec(text); return m ? m[1].trim() : ''; };
  const tenant = pick(/,\s*([A-Za-z.'\- ]+?) has made the following payment/i);
  if (!tenant) return null;
  const us = (d) => { const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(d || ''); return m ? m[3] + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2) : ''; };
  return {
    tenant: tenant,
    address: pick(/Property Address:\s*(.+?)\s*Invoice ID/i).slice(0, 120),
    invoice: pick(/Invoice ID\s*(\d+)/i),
    amount: num_(pick(/Amount Paid\s*\$?([\d,]+(?:\.\d{1,2})?)/i)),
    paidOn: us(pick(/Payment Date\s*([\d\/]+)/i)),
    due: us(pick(/Due Date\s*([\d\/]+)/i)),
  };
}

/** Run once from the editor after deploying: files the last ~2 months of Innago payments right away. */
function setupRentTracker() {
  const r = scanRent_();
  return 'Filed ' + r.added + ' Innago payment' + (r.added === 1 ? '' : 's') + ' in "' + RENT_TAB + '".';
}

/** Texts a message to the signed-in owner's own cell (from the Owner Team tab), so they can see it on a phone first. Always sends. */
function testText(text) {
  const email = currentEmail_();
  if (!isOwner_(email)) throw new Error('Not authorized.');
  text = String(text || '').trim();
  if (!text) throw new Error('Nothing to send.');
  return hubApi_({ action: 'test', owner: ownerName_(email), text: '[Test] ' + text });
}
