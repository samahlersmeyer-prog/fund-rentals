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
  OWNERS: ['sam.ahlersmeyer@gmail.com', 'jackkinsella93@gmail.com'],

  // Vacancies and lease end dates come from the public site data.
  LISTINGS_URL: 'https://samahlersmeyer-prog.github.io/fund-rentals/listings.json',

  // "Leases coming up" looks this many days ahead.
  LEASE_WINDOW_DAYS: 120,
};

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
    throw new Error('Couldn\'t open the P&L sheet. Check PNL_SHEET_ID, and that ' + email + ' can open it in Drive.');
  }

  return {
    user: email,
    generatedAt: new Date().toISOString(),
    sheet: { name: ss.getName(), url: ss.getUrl() },
    summary: readMonthlySummaries_(ss),
    byProperty: readOpsIncome_(ss),
    portfolio: readListings_(),
    leaseWindowDays: CONFIG.LEASE_WINDOW_DAYS,
  };
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
