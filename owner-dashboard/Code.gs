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
};

const TODO_TAB = 'Owner To-dos';
const BALANCE_TAB = 'Owner Balances';
const TENANT_TAB = 'Owner Tenants';
const RENTAL_NOTES_TAB = 'Owner Rental Notes';
const TENANT_HEAD = ['Unit ID', 'Unit', 'Tenant', 'Phone', 'Email', 'Lease link', 'Rent', 'Due day', 'Notes'];
const NOTE_HEAD = ['Unit ID', 'Unit', 'Note', 'Status', 'Added by', 'Added on', 'Updated'];
const NOTE_STATUSES = ['Open', 'In progress', 'Done', 'Log'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function doGet() {
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
  const t = HtmlService.createTemplateFromFile('Dashboard');
  t.email = email;
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
    portfolio: portfolio,
    tenants: readTenants_(ss, portfolio.units || []),
    rentalNotes: readRentalNotes_(ss),
    leaseWindowDays: CONFIG.LEASE_WINDOW_DAYS,
    allocate: readToAllocate_(ss),
    todos: readTodos_(ss),
    balances: readBalances_(ss),
    properties: readPropertySummary_(ss),
    projects: readProjects_(ss),
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
  return {
    names: names,
    income: rowOf(/^income$/i),
    costs: rowOf(/^operating expenses$/i),
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
  const sh = ss.getSheetByName('Ops');
  if (!sh) return null;
  const v = sh.getDataRange().getValues();

  for (let r = 0; r < v.length; r++) {
    const c = v[r].findIndex((x) => /^rental income$/i.test(String(x).trim()));
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

// ---------- helpers ----------

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
