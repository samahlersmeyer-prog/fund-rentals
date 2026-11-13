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
  PNL_SHEET_ID: 'PASTE_THE_PNL_SHEET_ID_HERE',

  // Google accounts allowed in.
  OWNERS: ['sam.ahlersmeyer@gmail.com', 'jackkinsella93@gmail.com', 'erahlersmeyer@gmail.com'],
  // First names for those accounts: who's signed in, and who a to-do can be assigned to.
  OWNER_NAMES: { 'sam.ahlersmeyer@gmail.com': 'Sam', 'jackkinsella93@gmail.com': 'Jack', 'erahlersmeyer@gmail.com': 'Emily' },

  // The OAuth client ID from Google Cloud (ends in .apps.googleusercontent.com). Must match
  // GOOGLE_CLIENT_ID in portal-config.js. Not a secret: it only says which site the sign-in is for.
  GOOGLE_CLIENT_ID: '485326552011-3a8toc242d2cpalhan5f95d0evl78bdk.apps.googleusercontent.com',

  // Where the GitHub Pages site lives (with the trailing slash).
  SITE_URL: 'https://samahlersmeyer-prog.github.io/fund-rentals/',

  // Vacancies and lease end dates come from the public site data.
  LISTINGS_URL: 'https://samahlersmeyer-prog.github.io/fund-rentals/listings.json',

  // "Leases coming up" looks this many days ahead.
  LEASE_WINDOW_DAYS: 120,

  // ----- Deals (flip leads from wholesalers) -----
  // Where the "Owner Deals" tab lives. Blank = the P&L sheet above. Put a separate sheet's ID here
  // if you'd rather the deal pipeline not have to move when the P&L rolls over to a new year.
  DEALS_SHEET_ID: '',

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

  // ----- Utility bills -----
  // What the daily scan looks for in Sam's Gmail. Only emails that mention an account number from the
  // "Owner Utility Accounts" tab (or a utility named there) are ever saved; everything else is ignored.
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
const TENANT_HEAD = ['Unit ID', 'Unit', 'Tenant', 'Phone', 'Email', 'Lease link', 'Rent', 'Due day', 'Notes'];
const NOTE_HEAD = ['Unit ID', 'Unit', 'Note', 'Status', 'Added by', 'Added on', 'Updated'];
const NOTE_STATUSES = ['Open', 'In progress', 'Done', 'Log'];
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
  scanBillsNow: () => scanBillsNow,
  addUtilAccount: () => addUtilAccount,
  addUtilBill: () => addUtilBill,
  postBillToPnl: () => postBillToPnl,
  setBillStatus: () => setBillStatus,
  pullComps: () => pullComps,
  allocateCell: () => allocateCell,
  setInboxStatus: () => setInboxStatus,
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
    const fn = OWNER_ACTIONS[body.action];
    if (!fn) return json({ ok: false, error: 'Unknown request.' });
    const email = verifyGoogleToken_(body.idToken);
    if (!email) return json({ ok: false, auth: true, error: 'Please sign in again.' });
    if (!isOwner_(email)) return json({ ok: false, auth: true, notOwner: true, email: email, error: email + ' isn\'t one of the owner accounts.' });
    REQ_EMAIL_ = email;
    const args = Array.isArray(body.args) ? body.args : [];
    return json({ ok: true, result: fn().apply(null, args) });
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

  const portfolio = readListings_();
  return {
    user: email,
    team: { me: CONFIG.OWNER_NAMES[email] || email.split('@')[0], names: CONFIG.OWNERS.map((x) => CONFIG.OWNER_NAMES[x] || x.split('@')[0]) },
    generatedAt: new Date().toISOString(),
    sheet: { name: ss.getName(), url: ss.getUrl() },
    summary: readMonthlySummaries_(ss),
    byProperty: readOpsIncome_(ss),
    loansByProperty: readOpsBlock_(ss, /^operating loan payments$/i),
    portfolio: portfolio,
    tenants: readTenants_(ss, portfolio.units || []),
    rentalNotes: readRentalNotes_(ss),
    tenantInbox: readTenantInbox_(ss),
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
  const add = units.filter((u) => u.id && !have[u.id]).map((u) => [u.id, u.name, '', '', '', '', '', 1, '']);
  if (add.length) sh.getRange(sh.getLastRow() + 1, 1, add.length, TENANT_HEAD.length).setValues(add);
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
  })).filter((t) => t.unitId && (t.name || t.phone || t.email || t.lease));
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
function hubEvent_(body) {
  const want = PropertiesService.getScriptProperties().getProperty('HUB_KEY');
  if (!want) throw new Error('HUB_KEY is not set in Script Properties.');
  if (!sameSecret_(body.key, want)) throw new Error('Bad hub key.');
  const ev = body.event || {};
  const key = phoneKey_(ev.phone);
  if (!key) return { matched: false };

  const ss = SpreadsheetApp.openById(CONFIG.PNL_SHEET_ID);
  const listings = readListings_();
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
    const text = String(ev.text || '').trim().slice(0, 1500);
    const link = (ev.hubLink || '') + (id ? '#' + id : '');
    sh.appendRow([new Date(), t.unitId, t.unit, t.name, ev.phone || t.phone, kinds[ev.kind] || ev.kind || 'Message', text, ev.urgent ? 'Yes' : '', 'New', link]);

    // A repair request also opens a note on the rental (once a day per unit, so a back-and-forth stays one repair).
    let noteAdded = false;
    if (ev.maintenance && text) {
      const nsh = rentalNotesSheet_(ss);
      const tz = Session.getScriptTimeZone();
      const today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
      const recent = readRentalNotes_(ss).some((n) => n.unitId === t.unitId && n.by === 'Quo line' && n.added === today && n.status !== 'Done');
      if (!recent) {
        const short = text.replace(/\s+/g, ' ').slice(0, 220);
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

// ---------- rental notes / repairs (the "Owner Rental Notes" tab) ----------

function rentalNotesSheet_(ss) {
  let sh = ss.getSheetByName(RENTAL_NOTES_TAB);
  if (!sh) {
    sh = ss.insertSheet(RENTAL_NOTES_TAB);
    sh.appendRow(NOTE_HEAD);
    sh.setFrozenRows(1);
    sh.getRange('D2:D').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(NOTE_STATUSES, true).build());
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
    status: NOTE_STATUSES.indexOf(String(r[3]).trim()) >= 0 ? String(r[3]).trim() : 'Open',
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

/** Moves a note between Open, In progress and Done. `row` is its sheet row number. */
function setRentalNoteStatus(row, status) {
  const email = currentEmail_();
  if (!isOwner_(email)) throw new Error('Not authorized.');
  if (['Open', 'In progress', 'Done'].indexOf(status) < 0) throw new Error('Unknown status.');
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

function readListings_() {
  try {
    const res = UrlFetchApp.fetch(CONFIG.LISTINGS_URL, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return { error: 'Listings returned HTTP ' + res.getResponseCode() };
    const d = JSON.parse(res.getContentText());
    return {
      // Sam and Jack: copied on every tenant text and email so no conversation is one-on-one.
      owners: (d.contacts || []).map((c) => ({ name: c.name, phone: c.phone || '', email: c.email || '' })),
      units: (d.properties || []).map((p) => ({
        id: p.id,
        name: p.name,
        address: [p.number, p.street].filter(Boolean).join(' '),
        beds: p.beds,
        type: p.type,
        status: p.status,
        leaseEnds: p.leaseEnds || null,
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

function dealsSheet_() {
  const ss = SpreadsheetApp.openById(CONFIG.DEALS_SHEET_ID || CONFIG.PNL_SHEET_ID);
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
  return /^[=+\-@]/.test(s) || /^\d+\s*\/\s*\d/.test(s) ? "'" + s : s;
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
  const ss = SpreadsheetApp.openById(CONFIG.DEALS_SHEET_ID || CONFIG.PNL_SHEET_ID);
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
  return v.slice(1).map((r, i) => {
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
}

function compsData_() {
  const base = { conditions: COMP_CONDITIONS, months: CONFIG.COMP_MONTHS, band: CONFIG.COMP_SQFT_BAND, areaNames: CONFIG.AREA_NAMES || {} };
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
  const pool = comps.filter((c) => c.zip === zip && (!c.sold || c.sold >= cut));
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
    const recent = readComps_().filter((c) => !c.sold || c.sold >= cut);
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
  const key = prop_('RENTCAST_API_KEY');
  if (!key) throw new Error('Add your RentCast API key first: Apps Script, Project Settings, Script Properties, RENTCAST_API_KEY. Steps are in the README.');
  const used = rentcastUsed_();
  if (used >= CONFIG.RENTCAST_MONTHLY_LIMIT) throw new Error('All ' + CONFIG.RENTCAST_MONTHLY_LIMIT + ' RentCast lookups for this month are used. They reset on the 1st.');

  const sh = dealsSheet_();
  const row = findDealRow_(sh, id);
  if (row < 0) throw new Error('That deal no longer exists.');
  const d = readDeals_(sh).filter((x) => x.id === String(id))[0];
  const g = withZip_(d.address, true);
  if (!g.lat) throw new Error('Couldn\'t find ' + (d.address || 'that address') + ' on the map. Check the house number and street.');

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
  const saved = saveComps_(rows, by);
  writeDeal_(sh, row, { address: g.address, lat: g.lat, lon: g.lon });
  return {
    found: rows.length, added: saved.added, duplicates: saved.duplicates, flips: rows.filter((r) => r.condition === 'Renovated').length,
    used: used + 1, limit: CONFIG.RENTCAST_MONTHLY_LIMIT,
  };
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
