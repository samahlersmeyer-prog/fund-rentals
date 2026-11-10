/**
 * The Fund Worldwide · Owner Dashboard (Google Apps Script web app)
 *
 * Owners sign in with their Google account. The page reads:
 *   - the year's Profit & Loss Google Sheet (private in Drive; never published)
 *   - the public listings.json from the rentals site (vacancies, lease end dates)
 *
 * Deploy as a web app with "Execute as: User accessing the web app" so every
 * read happens with the signed-in owner's own Drive permissions. Someone who
 * isn't in OWNERS, or can't open the P&L in Drive, sees nothing.
 * Setup steps: see README.md in this folder.
 */

const CONFIG = {
  // The 2026 Profit & Loss sheet: the long ID in its URL, between /d/ and /edit.
  PNL_SHEET_ID: 'PASTE_THE_PNL_SHEET_ID_HERE',

  // Google accounts allowed in. Each also needs at least view access to the P&L sheet.
  OWNERS: ['sam.ahlersmeyer@gmail.com', 'jackkinsella93@gmail.com', 'erahlersmeyer@gmail.com'],

  // Vacancies and lease end dates come from the public site data.
  LISTINGS_URL: 'https://samahlersmeyer-prog.github.io/fund-rentals/listings.json',

  // "Leases coming up" looks this many days ahead.
  LEASE_WINDOW_DAYS: 120,

  // ----- Deals (flip leads from wholesalers) -----
  // Where the "Owner Deals" tab lives. Blank = the P&L sheet above. Put a separate sheet's ID here
  // if you'd rather the deal pipeline not have to move when the P&L rolls over to a new year.
  DEALS_SHEET_ID: '',

  // The second deployment's web app URL (Execute as: Me, Who has access: Anyone). It serves the
  // GC bid page and receives leads from the iPhone Shortcut. See "Deals" in README.md.
  BID_URL: '',

  // Quick rehab estimate, in dollars per square foot, used until the GC's bid (or your own numbers) are in.
  // These are starting points, not quotes: set them to what your GC's jobs have actually come in at.
  REHAB_PER_SQFT: { Light: 20, Medium: 35, Heavy: 60 },

  // Used only if an ANTHROPIC_API_KEY script property is set; otherwise leads are read with built-in rules.
  CLAUDE_MODEL: 'claude-haiku-5-5',
};
// Secrets never go in this file (the repo is public). They live in Apps Script:
// Project Settings → Script Properties:
//   INTAKE_KEY         any long random phrase; the iPhone Shortcut sends it with each lead
//   ANTHROPIC_API_KEY  optional; lets Claude read messy lead texts
//   GC_PHONE           optional; your contractor's cell, so "Text GC" opens a text already addressed to him

const TODO_TAB = 'Owner To-dos';
const BALANCE_TAB = 'Owner Balances';
const TENANT_TAB = 'Owner Tenants';
const RENTAL_NOTES_TAB = 'Owner Rental Notes';
const TENANT_HEAD = ['Unit ID', 'Unit', 'Tenant', 'Phone', 'Email', 'Lease link', 'Rent', 'Due day', 'Notes'];
const NOTE_HEAD = ['Unit ID', 'Unit', 'Note', 'Status', 'Added by', 'Added on', 'Updated'];
const NOTE_STATUSES = ['Open', 'In progress', 'Done', 'Log'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function doGet(e) {
  const p = (e && e.parameter) || {};
  // GC bid page: no sign-in, opened from the bid link (only works on the BID_URL deployment).
  if (p.bid) return bidPage_(p.bid, p.k);

  const email = currentEmail_();
  if (!isOwner_(email)) {
    return HtmlService.createHtmlOutput(
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<div style="font:16px/1.5 system-ui,sans-serif;max-width:460px;margin:12vh auto;padding:0 20px;color:#1d2233">' +
      '<h2 style="margin:0 0 8px">Owners only</h2>' +
      '<p style="color:#5b6070;margin:0">You\'re signed in as <b>' + escape_(email || 'an unknown account') +
      '</b>, which doesn\'t have access to this dashboard. If you\'re an owner, switch to the Google account you use for The Fund.</p></div>'
    ).setTitle('Owners only · The Fund Worldwide');
  }
  // Google lets people uncheck individual permissions when they approve the app,
  // and won't ask again on its own. If any are missing, send them back to approve.
  const auth = ScriptApp.getAuthorizationInfo(ScriptApp.AuthMode.FULL);
  if (auth.getAuthorizationStatus() === ScriptApp.AuthorizationStatus.REQUIRED) {
    return HtmlService.createHtmlOutput(
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<div style="font:16px/1.5 system-ui,sans-serif;max-width:460px;margin:12vh auto;padding:0 20px;color:#1d2233">' +
      '<h2 style="margin:0 0 8px">One more step</h2>' +
      '<p style="color:#5b6070;margin:0 0 20px">The dashboard needs permission to read the P&amp;L sheet with <b>' + escape_(email) +
      '</b>. Tap below, then on Google\'s screen tap <b>Select all</b> (or check every box) and <b>Continue</b>. Come back here and refresh.</p>' +
      '<a href="' + escape_(auth.getAuthorizationUrl()) + '" target="_top" ' +
      'style="display:inline-block;background:#1d2233;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600">Grant access</a></div>'
    ).setTitle('Grant access · The Fund Worldwide');
  }
  const t = HtmlService.createTemplateFromFile('Dashboard');
  t.email = email;
  // ?lead=… (from the iPhone Shortcut's "review first" option) pre-fills the New lead form.
  t.lead = String(p.lead || '').slice(0, 5000);
  return t.evaluate()
    .setTitle('Owner Dashboard · The Fund Worldwide')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Called from the page. Returns plain data; the page does the math and drawing. */
function getDashboardData() {
  const email = currentEmail_();
  if (!isOwner_(email)) throw new Error('Not authorized.');

  let ss;
  try {
    ss = SpreadsheetApp.openById(CONFIG.PNL_SHEET_ID);
  } catch (e) {
    throw new Error('Couldn\'t open the P&L sheet. Check PNL_SHEET_ID, and that ' + email + ' can open it in Drive. (Google said: ' + (e && e.message ? e.message : e) + ')');
  }

  const portfolio = readListings_();
  return {
    user: email,
    generatedAt: new Date().toISOString(),
    sheet: { name: ss.getName(), url: ss.getUrl() },
    summary: readMonthlySummaries_(ss),
    byProperty: readOpsIncome_(ss),
    loansByProperty: readOpsBlock_(ss, /^operating loan payments$/i),
    portfolio: portfolio,
    tenants: readTenants_(ss, portfolio.units || []),
    rentalNotes: readRentalNotes_(ss),
    leaseWindowDays: CONFIG.LEASE_WINDOW_DAYS,
    allocate: readToAllocate_(ss),
    todos: readTodos_(ss),
    balances: readBalances_(ss),
    properties: readPropertySummary_(ss),
    projects: readProjects_(ss),
    deals: dealsData_(),
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
    // View-only owners can't create or extend the tab; just read what's there.
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

/** Adds a to-do to the "Owner To-dos" tab. */
function addTodo(task, due) {
  const email = currentEmail_();
  if (!isOwner_(email)) throw new Error('Not authorized.');
  task = String(task || '').trim().slice(0, 300);
  if (!task) throw new Error('Type a to-do first.');
  const sh = todoSheet_(SpreadsheetApp.openById(CONFIG.PNL_SHEET_ID));
  sh.appendRow([task, due || '', false, email.split('@')[0], Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'), '']);
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
    sh.appendRow(['Task', 'Due', 'Done', 'Added by', 'Added on', 'Notes']);
    sh.setFrozenRows(1);
  }
  return sh;
}

function readTodos_(ss) {
  const sh = ss.getSheetByName(TODO_TAB);
  if (!sh || sh.getLastRow() < 2) return [];
  const v = sh.getRange(2, 1, sh.getLastRow() - 1, 6).getValues();
  return v.map((r, i) => ({
    row: i + 2,
    task: String(r[0] || '').trim(),
    due: r[1] instanceof Date ? Utilities.formatDate(r[1], Session.getScriptTimeZone(), 'yyyy-MM-dd') : String(r[1] || ''),
    done: r[2] === true || /^(true|yes|x|done)$/i.test(String(r[2]).trim()),
    by: String(r[3] || ''),
    notes: String(r[5] || ''),
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
        const detail = note.split(/TO ALLOCATE[^:]*:/i)[1] ? note.split(/TO ALLOCATE[^:]*:/i)[1].trim() : note;
        // If the note ends with "= $123.45", only that part is unallocated (the rest of the cell is already sorted).
        const part = /=\s*\$([\d,]+(?:\.\d+)?)\s*$/.exec(detail);
        out.push({
          tab: tab,
          section: String(vals[h][1] || '').trim(),
          column: String(vals[h][c] || '').trim(),
          month: String(vals[r][1] || '').trim(),
          amount: part ? num_(part[1]) : num_(vals[r][c]),
          detail: detail,
          cell: tab + '!' + String.fromCharCode(65 + c) + (r + 1),
        });
      }
    }
  });
  return out;
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
// One row per lead. The GC sees only the specs and the rehab bid, never the money side.

const DEALS_TAB = 'Owner Deals';
const DEAL_STATUSES = ['New', 'Sent to GC', 'Bid in', 'Offer made', 'Under contract', 'Passed', 'Closed'];
const REHAB = [
  ['roof', 'Roof & Gutters'], ['hvac', 'HVAC'], ['mep', 'Plumbing & Electrical'], ['kb', 'Kitchen & Baths'],
  ['floor', 'Flooring & Paint'], ['ext', 'Exterior/Landscaping'], ['misc', 'Misc/Contingency'],
];
// [field, column header, 'n' for numbers]
const DEAL_FIELDS = [
  ['id', 'Deal ID'], ['key', 'GC link key'], ['added', 'Added'], ['by', 'Added by'], ['status', 'Status'], ['from', 'From'],
  ['address', 'Address'], ['asking', 'Asking', 'n'], ['arv', 'ARV', 'n'], ['sqft', 'Sq ft', 'n'], ['bedsBaths', 'Beds/Baths'], ['yearBuilt', 'Year built', 'n'],
  ['photoLink', 'Photo link'], ['lead', 'Lead text'],
  ['rehabLevel', 'Rehab level'],
].concat(REHAB.map((r) => [r[0], r[1], 'n'])).concat([
  ['extraLines', 'Extra rehab lines'],
  ['gcNotes', 'GC notes'], ['bidUpdated', 'Bid updated'], ['holdPct', 'Hold & close %', 'n'], ['targetProfit', 'Target profit', 'n'],
  ['method', 'Method'], ['notes', 'Notes'],
]);
const OWNER_EDITABLE = DEAL_FIELDS.map((f) => f[0]).filter((k) => ['id', 'key', 'added', 'by', 'lead', 'bidUpdated'].indexOf(k) < 0);

function dealsData_() {
  const base = { bidUrl: CONFIG.BID_URL, gcPhone: prop_('GC_PHONE'), claude: !!prop_('ANTHROPIC_API_KEY'), intake: !!prop_('INTAKE_KEY'), statuses: DEAL_STATUSES, rehab: REHAB, rates: CONFIG.REHAB_PER_SQFT };
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
  if (missing.length) sh.getRange(1, head.length + 1, 1, missing.length).setValues([missing]);
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
  const dup = findDuplicate_(parsed, text);
  if (dup) return { id: dup.id, duplicate: true, message: 'Already have this one: ' + (dup.address || dup.id) + ' (' + dup.status + ').' };
  const id = createDeal_({
    from: from || parsed.from || '', address: parsed.address, asking: parsed.asking, arv: parsed.arv, sqft: parsed.sqft,
    bedsBaths: parsed.bedsBaths, yearBuilt: parsed.yearBuilt, photoLink: parsed.photoLink, lead: text,
    notes: parsed.repairs ? 'Wholesaler says repairs ≈ $' + Math.round(parsed.repairs).toLocaleString('en-US') : '',
  }, by);
  return { id: id, message: 'Saved to Fund deals: ' + (parsed.address || 'new lead (no address found)') + (parsed.asking ? ', asking $' + parsed.asking.toLocaleString('en-US') : '') + '.' + quickLook_(parsed) };
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
  return createDeal_(clean, email.split('@')[0]);
}

/** Saves changes to one deal (any field except its ID, link key and history). */
function updateDeal(id, changes) {
  requireOwner_();
  const clean = {};
  OWNER_EDITABLE.forEach((k) => { if (changes && changes[k] !== undefined) clean[k] = changes[k]; });
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

// ----- iPhone Shortcut intake (POST to BID_URL) -----
// Body: JSON {"key": INTAKE_KEY, "text": the message, "from": sender (optional)}

function doPost(e) {
  const out = (msg) => ContentService.createTextOutput(msg);
  try {
    let body = {};
    try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (x) { body = (e && e.parameter) || {}; }
    const want = prop_('INTAKE_KEY');
    if (!want || String(body.key || '') !== want) return out('Not saved: the key doesn\'t match INTAKE_KEY in Script Properties.');
    const text = String(body.text || '').trim().slice(0, 5000);
    if (!text) return out('Not saved: no text came through.');
    return out(intakeLead_(text, String(body.from || '').trim().slice(0, 200), 'iPhone').message);
  } catch (err) {
    return out('Not saved: ' + (err && err.message ? err.message : err));
  }
}

// ----- GC bid page (BID_URL?bid=ID&k=KEY) -----

function dealForGc_(id, key) {
  if (!id || !key) return null;
  const d = readDeals_(dealsSheet_()).filter((x) => x.id === String(id))[0];
  if (!d || !d.key || d.key !== String(key)) return null;
  // Specs and the bid only. No asking price, ARV or profit math.
  const out = { id: d.id, k: d.key, address: d.address, sqft: d.sqft, bedsBaths: d.bedsBaths, yearBuilt: d.yearBuilt, photoLink: d.photoLink, gcNotes: d.gcNotes, bidUpdated: d.bidUpdated, rehab: REHAB, extraLines: d.extraLines };
  REHAB.forEach((r) => { out[r[0]] = d[r[0]]; });
  return out;
}

function bidPage_(id, key) {
  let deal = null;
  try { deal = dealForGc_(id, key); } catch (e) { deal = null; }
  const t = HtmlService.createTemplateFromFile('Bid');
  t.data = JSON.stringify(deal).replace(/</g, '\\u003c');
  return t.evaluate()
    .setTitle((deal && deal.address ? deal.address + ' · ' : '') + 'Rehab bid · The Fund Worldwide')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
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

// ---------- helpers ----------

function prop_(name) {
  return String(PropertiesService.getScriptProperties().getProperty(name) || '');
}
function requireOwner_() {
  const email = currentEmail_();
  if (!isOwner_(email)) throw new Error('Not authorized.');
  return email;
}

function currentEmail_() {
  return String(Session.getActiveUser().getEmail() || '').toLowerCase();
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
