/* The Fund Worldwide · Owner dashboard (runs on GitHub Pages; data comes from the Apps Script API in owner-dashboard/). */
(function () {
  var MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  var FULL = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]; }); };
  var money = function (n, cents) { var a = Math.abs(n), s = "$" + a.toLocaleString("en-US", { maximumFractionDigits: cents ? 2 : 0 }); return n < 0 ? "−" + s : s; };
  var short = function (n) { var a = Math.abs(n), s = a >= 1000 ? "$" + (a / 1000).toFixed(a >= 10000 ? 0 : 1) + "k" : "$" + Math.round(a); return n < 0 ? "−" + s : s; };
  var pct = function (n) { return isFinite(n) ? Math.round(n * 100) + "%" : "—"; };
  var sum = function (a, upto) { var t = 0; for (var i = 0; i <= upto; i++) t += a[i] || 0; return t; };
  var parseDate = function (s) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ""); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
  var fmtDate = function (d) { return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); };

  // Find a row by label, forgiving of small wording differences in the sheet.
  function row(section, re) {
    if (!section) return null;
    for (var k in section) if (re.test(k)) return section[k].months;
    return null;
  }

  // P&L view: "actual" (taxes in the months they're paid) or "run" (spread evenly). Remembered on this device.
  var plMode = "actual", LAST = null;
  try { plMode = localStorage.getItem("plMode") || plMode; } catch (e) {}
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-plmode]");
    if (!b || !LAST) return;
    plMode = b.getAttribute("data-plmode");
    try { localStorage.setItem("plMode", plMode); } catch (x) {}
    var y = window.scrollY; render(LAST); window.scrollTo(0, y);
  });

  // Which tab is showing; kept across refreshes (e.g. after adding a to-do).
  // Opens on Today; a refresh (e.g. after adding a to-do) stays on whatever tab was showing.
  var tab = "today";
  try { tab = sessionStorage.getItem("ownerTab") || tab; } catch (e) {}
  function showTab(id) {
    tab = id;
    try { sessionStorage.setItem("ownerTab", id); } catch (e) {}
    [].forEach.call(document.querySelectorAll(".tabs [data-tab]"), function (b) { b.setAttribute("aria-selected", b.getAttribute("data-tab") === id); });
    [].forEach.call(document.querySelectorAll("[data-panel]"), function (p) { p.hidden = p.getAttribute("data-panel") !== id; });
    var nav = document.querySelector(".tabs");
    if (nav && nav.getBoundingClientRect().top <= 0) window.scrollTo(0, nav.offsetTop);
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest(".tabs [data-tab]");
    if (b) showTab(b.getAttribute("data-tab"));
  });

  function render(d) {
    LAST = d;
    if (d.sheet && d.sheet.url) { var a = $("sheetLink"); a.href = d.sheet.url; a.hidden = false; }
    var S = d.summary || {};
    var ops = S.Operations || S[Object.keys(S)[0]];
    var cap = S.Capital;
    var zero = MONTHS.map(function () { return 0; });
    var income = row(ops, /rental income/i) || zero;
    var loans = row(ops, /loan/i) || zero;
    var expenses = row(ops, /^expenses$/i) || zero;
    var utilities = row(ops, /utilit/i) || zero;
    var insurance = row(ops, /insurance/i) || zero;
    var taxes = row(ops, /tax/i) || zero;
    var totalOut = row(ops, /total/i) || MONTHS.map(function (_, i) { return loans[i] + expenses[i] + utilities[i] + insurance[i] + taxes[i]; });
    var profit = row(ops, /profit/i) || MONTHS.map(function (_, i) { return income[i] - totalOut[i]; });
    var capTotal = row(cap, /^total$/i) || zero;

    var last = -1; income.forEach(function (v, i) { if (v > 0) last = i; });
    if (last < 0) { $("app").innerHTML = '<p class="err">The P&amp;L doesn\'t have any rental income entered yet.</p>'; return; }

    var ytdIn = sum(income, last), ytdOut = sum(totalOut, last), ytdProfit = sum(profit, last);
    var ytdLoans = sum(loans, last);
    var ytdOpCosts = sum(expenses, last) + sum(utilities, last) + sum(insurance, last) + sum(taxes, last);
    var noi = ytdIn - ytdOpCosts, dscr = ytdLoans ? noi / ytdLoans : Infinity;
    var margin = ytdIn ? ytdProfit / ytdIn : 0;
    var ytdCap = sum(capTotal, last);
    var n = last + 1, avgProfit = ytdProfit / n;

    // Portfolio (from the site's listings)
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var units = (d.portfolio && d.portfolio.units) || [];
    var leased = units.filter(function (u) { return u.status === "leased"; });
    var open = units.filter(function (u) { return u.status !== "leased"; });
    var m2m = units.filter(function (u) { return u.leaseEnds === "month-to-month"; });
    var horizon = new Date(today.getTime() + (d.leaseWindowDays || 120) * 864e5);
    var ending = units.map(function (u) { return { u: u, end: parseDate(u.leaseEnds) }; })
      .filter(function (x) { return x.end && x.end <= horizon; })
      .sort(function (a, b) { return a.end - b.end; });
    var noDate = units.filter(function (u) { return u.status === "leased" && !u.leaseEnds; });

    // Plain-language notes, all straight from the numbers.
    var notes = [];
    MONTHS.forEach(function (m, i) {
      if (i > last || profit[i] >= 0) return;
      var parts = [["property tax", taxes[i]], ["insurance", insurance[i]], ["expenses", expenses[i]], ["loan payments", loans[i]], ["utilities", utilities[i]]].sort(function (a, b) { return b[1] - a[1]; });
      notes.push(["neg", FULL[i] + " lost " + money(profit[i]) + ", mostly from " + parts[0][0] + " (" + money(parts[0][1]) + ")."]);
    });
    notes.push(["pos", "Profit has averaged " + money(avgProfit) + " a month this year, about " + money(avgProfit * 12) + " a year at that pace (that includes the big bills like property tax)."]);
    var lagging = [["Utilities", utilities], ["Insurance", insurance], ["Expenses", expenses]].map(function (x) {
      var lastHit = -1; for (var i = 0; i <= last; i++) if (x[1][i] > 0) lastHit = i;
      return [x[0], lastHit];
    }).filter(function (x) { return x[1] >= 0 && x[1] < last && x[0] !== "Expenses"; });
    if (lagging.length) notes.push(["mid", lagging.map(function (x) { return x[0] + " were last entered for " + FULL[x[1]]; }).join("; ") + ". Later months may look better than they'll end up once those are caught up."]);
    if (m2m.length) notes.push(["mid", m2m.length + " of " + units.length + " units are month-to-month."]);
    if (ending.length) notes.push(["mid", ending.length + " lease" + (ending.length > 1 ? "s end" : " ends") + " in the next " + (d.leaseWindowDays || 120) + " days."]);
    if (noDate.length) notes.push(["mid", noDate.length + " leased unit" + (noDate.length > 1 ? "s have" : " has") + " no lease end date on the site: " + noDate.map(function (u) { return u.name; }).join(", ") + "."]);
    if (ytdCap) notes.push(["", money(ytdCap) + " in capital spending this year (renovations), tracked separately from operations."]);

    // ----- Forecast: actuals through the last entered month, the rest of the year at the recent pace -----
    var avg3 = function (a) { var xs = a.slice(Math.max(0, last - 2), last + 1); return xs.reduce(function (p, c) { return p + c; }, 0) / xs.length; };
    var springTax = 0; for (var ti = 0; ti < 6; ti++) springTax += taxes[ti] || 0;
    var fallTaxIn = 0; for (var tj = 6; tj < 12; tj++) fallTaxIn += taxes[tj] || 0;
    var left = 11 - last;
    var mIncome = avg3(income), mLoans = loans[last], mIns = insurance[last] || avg3(insurance);
    var mUtil = avg3(utilities), mExp = avg3(expenses);
    var mCost = mLoans + mIns + mUtil + mExp;
    // Fall installment: the spring bill minus homes that are sold (not on the rentals site any more).
    var soldTax = 0, soldNames = [];
    (function () {
      var P = d.properties; if (!P || !P.names || !P.net) return;
      P.names.forEach(function (n, i) {
        if (/general business/i.test(n)) return;
        var w = n.replace(/^\d+\s+/, "").split(/\s+/)[0].replace(/\.$/, "").toLowerCase();
        var owned = units.some(function (u) { return u.address.toLowerCase().split(/\s+/).indexOf(w) >= 0; });
        var tax = (P.profit ? P.profit[i] || 0 : 0) - (P.net[i] || 0);
        if (!owned && tax > 0) { soldTax += tax; soldNames.push(n); }
      });
    })();
    // Taxes already entered for months after the last month with rent (e.g. the real fall bill in November) count as known.
    var futureTax = 0; for (var tf = last + 1; tf < 12; tf++) futureTax += taxes[tf] || 0;
    var fallTaxActual = futureTax > 0;
    var fallTax = fallTaxActual ? futureTax : (springTax && !fallTaxIn && last < 10 ? Math.max(0, springTax - soldTax) : 0);
    var fcIn = mIncome * left, fcCost = mCost * left + fallTax;
    var yrIn = ytdIn + fcIn, yrCost = ytdOut + fcCost;
    var ownedSpring = Math.max(0, springTax - soldTax);
    var paceProfit = (mIncome - mCost) * 12 - ownedSpring - (fallTax || ownedSpring);

    function forecastCard() {
      var row = function (label, a, b, c, cls) { return "<tr><td>" + label + '</td><td>' + money(a) + "</td><td>" + money(b) + '</td><td class="' + (cls || "") + '">' + money(c) + "</td></tr>"; };
      var sub = function (label, a, b) { return '<tr class="indent"><td style="font-weight:400">' + label + "</td><td>" + money(a) + "</td><td>" + money(b) + "</td><td>" + money(a + b) + "</td></tr>"; };
      var ytdTax = sum(taxes, last), fcLoans = mLoans * left, fcOther = (mIns + mUtil + mExp) * left;
      return '<section class="card o-fc"><h2>Year-end forecast</h2><p class="sub">' + FULL[0] + "–" + FULL[last] + " actual, " + (left ? FULL[last + 1] + "–December at the last 3 months' pace" : "full year actual") + ".</p>" +
        '<div class="tbl-wrap"><table class="fc"><thead><tr><th></th><th>Actual</th><th>Forecast</th><th>Full year</th></tr></thead><tbody>' +
        row("Income", ytdIn, fcIn, yrIn) +
        sub("Loan payments", ytdLoans, fcLoans) + sub("Property tax", ytdTax, fallTax) + sub("Everything else", ytdOut - ytdLoans - ytdTax, fcOther) +
        row("Going out", ytdOut, fcCost, yrCost) +
        row("Profit", ytdProfit, fcIn - fcCost, yrIn - yrCost, yrIn - yrCost < 0 ? "neg" : "pos") + "</tbody></table></div>" +
        '<ul class="notes" style="margin-top:12px">' +
        (fallTax ? '<li><span class="dot mid"></span><span>' + (fallTaxActual ? "Includes the fall property tax bill entered in the P&amp;L: " + money(fallTax) + "." : "Includes the fall property tax installment, estimated at " + money(fallTax) + " (the spring bill" + (soldNames.length ? " minus " + soldNames.join(" and ") + ", which are sold or settle taxes at closing" : "") + "). Indiana's fall installment is usually due around November 10.") + "</span></li>" : "") +
        '<li><span class="dot"></span><span>At the current pace, the next 12 months would net about ' + money(paceProfit) + " after loan payments and both tax installments.</span></li>" +
        "</ul></section>";
    }

    // ----- Things to work on: common landlord rules of thumb, applied to these numbers -----
    function workCard() {
      var items = [];
      var parked = (d.allocate || []).reduce(function (t, a) { return t + a.amount; }, 0);
      if (parked) items.push(["mid", "Split the parked costs", money(parked) + " is sitting in General Business waiting to be split to properties (see To-dos). Until it is, per-property profit looks better than it really is."]);
      if (units.length && m2m.length / units.length > 0.25) items.push(["mid", "Move month-to-month tenants onto leases", m2m.length + " of " + units.length + " units are month-to-month. A 12-month lease makes income steadier; if a tenant wants to stay flexible, a common approach is to charge a month-to-month premium (often $50–$100 a month)."]);
      var byMonth = {};
      units.forEach(function (u) { var e = parseDate(u.leaseEnds); if (e && e >= today) { var k = e.getFullYear() + "-" + e.getMonth(); (byMonth[k] = byMonth[k] || []).push(u); } });
      Object.keys(byMonth).forEach(function (k) {
        var us = byMonth[k]; if (us.length < 3) return;
        var mi = +k.split("-")[1];
        if (!(mi === 11 || mi <= 2)) return; // only winter clusters are worth flagging
        items.push(["mid", "Stagger lease end dates", us.length + " leases end in " + FULL[mi] + " " + k.split("-")[0] + ". Winter turnovers rent slower. When you renew, offer terms that end in late spring or summer (for example, 15 or 16 months) so move-outs spread out."]);
      });
      var repairPct = ytdIn ? sum(expenses, last) / ytdIn : 0;
      if (repairPct < 0.05) items.push(["mid", "Capture every repair cost", "Repairs and expenses are " + pct(repairPct) + " of rent this year. Rentals typically run 5–10%, so some repair costs may be missing or still parked."]);
      open.forEach(function (u) {
        var dt = parseDate(u.availableDate); if (!dt || dt <= today) return;
        var start = new Date(dt.getTime() - 50 * 864e5);
        items.push(["", "Start marketing " + u.name + " early", "It opens " + fmtDate(dt) + ". Starting photos and the Zillow listing about 6–8 weeks ahead (around " + fmtDate(start) + ") usually avoids an empty month."]);
      });
      var P = d.properties;
      if (P && P.names && P.income && P.net) {
        // Judge each home at its current pace, not year to date, so a vacancy that's since been filled doesn't drag it down.
        // A year at pace = last 3 months' rent and the latest loan payment, other costs at this year's monthly average, plus the full year's property tax.
        var monthly = function (block, n) {
          if (!block || !block.properties) return null;
          var k = block.properties.indexOf(n); if (k < 0) return null;
          return block.months.map(function (m) { return m[k] || 0; });
        };
        var cand = P.names.map(function (n, i) {
          var inc = monthly(d.byProperty, n), ln = monthly(d.loansByProperty, n);
          var loanYtd = P.loans ? P.loans[i] || 0 : 0, otherYtd = (P.costs ? P.costs[i] || 0 : 0) - loanYtd;
          var yrInc = inc ? avg3(inc) * 12 : (P.income[i] || 0) / (last + 1) * 12;
          var yrLoan = ln ? ln[last] * 12 : loanYtd / (last + 1) * 12;
          var yrNet = yrInc - yrLoan - otherYtd / (last + 1) * 12 - (P.taxes ? P.taxes[i] || 0 : 0);
          return { n: n, inc: yrInc, net: yrNet };
        })
          .filter(function (x) { return !/general business/i.test(x.n) && x.inc > 6000 && units.some(function (u) { return u.address.toLowerCase().indexOf(x.n.replace(/^\d+\s+/, "").split(/\s+/)[0].replace(/\.$/, "").toLowerCase()) >= 0; }); })
          .sort(function (a, b) { return a.net / a.inc - b.net / b.inc; });
        if (cand.length && cand[0].net / cand[0].inc < 0.2) items.push(["mid", "Look at " + cand[0].n, "At its current rent it keeps about " + pct(cand[0].net / cand[0].inc) + " of its rent (around " + money(cand[0].net) + " a year after the loan, its costs and property tax), the lowest of the homes you still own. Worth checking whether its rent is below market or its costs (utilities you pay, loan rate) are high."]);
      }
      if (dscr < 1.25 && isFinite(dscr)) items.push(["neg", "Watch debt coverage", "Net operating income covers loan payments " + dscr.toFixed(2) + "×. Lenders usually like to see 1.25× or more."]);
      var low = mCost * 3, high = mCost * 6;
      var bs = d.balances || [], cash = bs.length ? bs[bs.length - 1].amount : 0;
      items.push([cash && cash < low ? "neg" : "", "Keep a cash reserve", "A common rule of thumb is 3–6 months of costs set aside for vacancies and big repairs: roughly " + money(low) + "–" + money(high) + " for you." + (cash ? " You have " + money(cash) + " now" + (cash < low ? ", below that range" : cash > high ? ", above it, so some could go toward the highest-rate loan" : ", inside it") + "." : "")]);
      return '<section class="card o-work"><h2>Things to work on</h2><p class="sub">Common landlord rules of thumb, applied to your numbers.</p><ul class="notes work">' +
        items.map(function (x) { return '<li><span class="dot ' + x[0] + '"></span><span><b>' + esc(x[1]) + "</b>" + esc(x[2]) + "</span></li>"; }).join("") + "</ul></section>";
    }

    function cashKpi() {
      var bs = d.balances || [], b = bs[bs.length - 1];
      var months = b && mCost ? b.amount / mCost : 0;
      var cls = months >= 3 ? "pos" : months >= 1.5 ? "mid" : "neg";
      var age = b ? Math.round((today - parseDate(b.asOf)) / 864e5) : 0;
      var hint = b ? '<span class="pill ' + cls + '">' + months.toFixed(1) + " months</span> of costs · as of " + fmtDate(parseDate(b.asOf)) + (age > 14 ? ' <span style="color:var(--neg)">(update)</span>' : "") : "No balance entered yet";
      return '<div class="kpi"><div class="l">Cash on hand</div><div class="v">' + (b ? money(b.amount) : "—") + '</div><div class="h">' + hint +
        '</div><form class="cash-form" id="cashForm"><input type="text" inputmode="decimal" id="cashAmt" placeholder="New balance" aria-label="Checking balance"><button type="submit">Update</button></form></div>';
    }

    function propertyCard() {
      var P = d.properties;
      if (!P || !P.names || !P.income) return "";
      var addr = function (name) {
        var num = (/^(\d+)\s/.exec(name) || [])[1];
        var word = name.replace(/^\d+\s+/, "").split(/\s+/)[0].replace(/\.$/, "").toLowerCase();
        var hit = units.filter(function (u) { return num ? u.address.indexOf(num + " ") === 0 : u.address.toLowerCase().split(/\s+/).indexOf(word) >= 0; })[0];
        return hit ? hit.address.replace(/ Road$/, " Rd") : name;
      };
      var rows = [], shared = null;
      P.names.forEach(function (n, i) {
        var inc = P.income[i] || 0, cost = P.costs ? P.costs[i] || 0 : 0, prof = P.profit ? P.profit[i] || 0 : inc - cost, net = P.net ? P.net[i] || 0 : prof;
        // "Operating Expenses" on the sheet is loan payments plus everything else; split them apart.
        var loan = P.loans ? P.loans[i] || 0 : 0, other = cost - loan;
        var tax = P.taxes ? P.taxes[i] || 0 : prof - net;
        if (/general business/i.test(n)) { shared = { inc: inc, loan: loan, other: other, tax: tax }; return; }
        if (!inc && !cost && !net) return;
        var a = addr(n); rows.push({ name: n, addr: a, inc: inc, loan: loan, other: other, tax: tax, net: net, sold: a === n });
      });
      rows.sort(function (a, b) { return b.net - a.net; });
      var tot = rows.reduce(function (t, r) { t.inc += r.inc; t.loan += r.loan; t.other += r.other; t.tax += r.tax; t.net += r.net; return t; }, { inc: 0, loan: 0, other: 0, tax: 0, net: 0 });
      var sharedNet = shared ? shared.inc - shared.loan - shared.other - shared.tax : 0;
      if (shared) { tot.inc += shared.inc; tot.loan += shared.loan; tot.other += shared.other; tot.tax += shared.tax; tot.net += sharedNet; }
      var line = function (label, sub, r, net, cls) {
        var m = r.inc && !r.noMargin ? net / r.inc : null;
        return '<tr class="' + (cls || "") + '"><td>' + label + (sub ? '<br><span style="color:var(--muted);font-size:12px;font-weight:400">' + sub + "</span>" : "") + "</td><td>" + money(r.inc) + "</td><td>" + money(r.loan) + "</td><td>" + money(r.other) + "</td><td>" + money(r.tax) + '</td><td class="' + (net < 0 ? "neg" : "pos") + '">' + money(net) + "</td><td>" + (m == null ? "—" : pct(m)) + "</td></tr>";
      };
      return '<section class="card o-prop"><h2>By property</h2><p class="sub">Year to date, from the Ops tab. Loans are that home\'s loan payments; other costs are its utilities and repairs. Property tax is its own column. Insurance and parked costs sit in the shared row until they\'re split.</p>' +
        '<div class="tbl-wrap"><table><thead><tr><th></th><th>Income</th><th>Loans</th><th>Other costs</th><th>Prop. tax</th><th>Net</th><th>Margin</th></tr></thead><tbody>' +
        rows.map(function (r) { return line(esc(r.addr), r.sold ? "Sold" : "", r, r.net); }).join("") +
        (shared ? line("Shared costs", "Insurance, parked costs, judgments", { inc: shared.inc, loan: shared.loan, other: shared.other, tax: shared.tax, noMargin: true }, sharedNet, "indent") : "") +
        line("Total", "", tot, tot.net, "pl") +
        "</tbody></table></div></section>";
    }

    var dsCls = dscr >= 1.25 ? "pos" : dscr >= 1 ? "mid" : "neg";
    var marCls = margin >= .15 ? "pos" : margin >= 0 ? "mid" : "neg";

    var html = "";
    html += '<div class="band"><div class="band-in"><div class="band-head"><h1>Portfolio health</h1><p class="asof">Numbers through ' + FULL[last] + ", refreshed " + new Date(d.generatedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + '<button type="button" class="refresh" data-refresh aria-label="Refresh">' + REFRESH_IC + "</button></p></div>";

    var openTodoCount = (d.todos || []).filter(function (t) { return !t.done; }).length;
    DEALS = d.deals || { list: [], rehab: [], statuses: [] };
    DEALS.me = firstName((((d.portfolio && d.portfolio.owners) || []).filter(function (o) { return String(o.email).toLowerCase() === String(d.user || "").toLowerCase(); })[0] || {}).name);
    var dealsNeedingLook = (DEALS.list || []).filter(function (x) { return x.status === "New" || x.status === "Bid in"; }).length;
    COMPS = d.comps || { list: [] };
    var TODAY = todayItems(d, units, today);
    var nowCount = TODAY.filter(function (x) { return x.lvl === 0; }).length;
    var billsWaiting = ((d.utilities && d.utilities.bills) || []).filter(function (b) { return !b.status; }).length;
    var TABS = [["today", "Today", nowCount], ["overview", "Overview"], ["tenants", "Tenants"], ["deals", "Deals", dealsNeedingLook], ["expenses", "Expenses", billsWaiting], ["pnl", "P&amp;L"], ["todos", "To-dos", openTodoCount]];
    if (!TABS.some(function (t) { return t[0] === tab; })) tab = "today";
    html += '<section class="kpis">' +
      kpi("Rental income this year", money(ytdIn), money(ytdIn / n) + " a month on average") +
      kpi("Profit this year", money(ytdProfit), '<span class="pill ' + marCls + '">' + pct(margin) + " margin</span> after loan payments") +
      kpi("Debt coverage", isFinite(dscr) ? dscr.toFixed(2) + "×" : "—", '<span class="pill ' + dsCls + '">' + (dscr >= 1.25 ? "Healthy" : dscr >= 1 ? "Thin" : "Short") + "</span> NOI ÷ loan payments") +
      kpi("Occupancy", units.length ? leased.length + " of " + units.length : "—", units.length ? pct(leased.length / units.length) + " leased, " + open.length + " open or opening" : "Couldn't load listings") +
      cashKpi() +
      "</section></div>";
    html += '<nav class="tabs" role="tablist"><div class="tabs-in">' + TABS.map(function (t) {
      return '<button type="button" role="tab" data-tab="' + t[0] + '" aria-selected="' + (t[0] === tab) + '">' + t[1] + (t[2] ? ' <span class="badge">' + t[2] + "</span>" : "") + "</button>";
    }).join("") + "</div></nav></div><div class=\"wrap\">";
    var panel = function (id) { return '<div class="panel" role="tabpanel" data-panel="' + id + '"' + (id === tab ? "" : " hidden") + ">"; };

    // ----- Today -----
    html += panel("today") + todayCard(d, TODAY) + "</div>";

    // ----- Overview -----
    html += panel("overview");
    html += '<div class="grid2"><div>';
    html += '<section class="card o-chart"><h2>Month by month</h2><p class="sub">Rental income vs. everything going out (loans, taxes, insurance, utilities, expenses).</p>' +
      '<div class="legend"><span><i style="background:var(--bar-in)"></i>Income</span><span><i style="background:var(--bar-out)"></i>Going out</span><span><i style="background:var(--pos)"></i>Profit</span></div>' +
      '<div id="chart">' + chart(income, totalOut, profit, last) + "</div></section>";
    html += "</div><div>";
    html += '<section class="card o-notes"><h2>Worth knowing</h2><p class="sub">Pulled straight from the numbers.</p><ul class="notes">' +
      notes.map(function (x) { return '<li><span class="dot ' + x[0] + '"></span><span>' + esc(x[1]) + "</span></li>"; }).join("") + "</ul></section>";
    html += "</div></div></div>";

    // ----- Tenants -----
    html += panel("tenants");
    html += rentalsCard(d, units, today);
    html += '<div class="grid2 even"><div>';
    html += '<section class="card o-leases"><h2>Leases coming up</h2><p class="sub">Ending in the next ' + (d.leaseWindowDays || 120) + " days.</p>" +
      (ending.length ? '<div class="units">' + ending.map(function (x) {
        var days = Math.round((x.end - today) / 864e5);
        var cls = days < 0 ? "neg" : days <= 60 ? "neg" : "mid";
        return '<div class="unit"><span><b>' + esc(x.u.name) + '</b><br><span class="m">Ends ' + fmtDate(x.end) + (x.u.status !== "leased" ? " · listed" : "") + '</span></span><span class="r"><span class="pill ' + cls + '">' + (days < 0 ? Math.abs(days) + " days ago" : days + " days") + "</span></span></div>";
      }).join("") + "</div>" : '<p class="empty">No leases end in that window.</p>') +
      (m2m.length ? '<p class="sub" style="margin:16px 0 8px">Month-to-month (' + m2m.length + ")</p><div class=\"chips\">" + m2m.map(function (u) { return '<span class="chip">' + esc(u.name) + "</span>"; }).join("") + "</div>" : "") +
      (d.portfolio && d.portfolio.error ? '<p class="err" style="margin-top:12px">Couldn\'t load the listings: ' + esc(d.portfolio.error) + "</p>" : "") +
      "</section>";
    html += "</div><div>";
    html += '<section class="card o-vac"><h2>Vacancies</h2><p class="sub">Units marked available on the site.</p>' +
      (open.length ? '<div class="units">' + open.map(function (u) {
        var dt = parseDate(u.availableDate);
        return '<div class="unit"><span><b>' + esc(u.name) + '</b><br><span class="m">' + esc(u.address) + " · " + (u.beds === 0 ? "Studio" : u.beds + " bd") + '</span></span><span class="r">' + (dt && dt > today ? "Opens " + fmtDate(dt) : "Available now") + (u.askingRent ? '<br><span class="m">' + money(u.askingRent) + "/mo</span>" : "") + "</span></div>";
      }).join("") + "</div>" : '<p class="empty">Everything is leased.</p>') + "</section>";
    html += "</div></div></div>";

    // ----- Deals -----
    html += panel("deals") + leadCard() + pipelineCard() + compsCard() + "</div>";

    // ----- Expenses -----
    html += panel("expenses") + expensesPanel(d) + "</div>";

    // ----- P&L -----
    html += panel("pnl");
    // P&L table
    var otherCosts = MONTHS.map(function (_, i) { return insurance[i] + utilities[i] + expenses[i]; });
    // Run rate: the year's property tax spread evenly over 12 months instead of landing in May and November.
    // Uses both installments once the fall bill is entered; until then, twice the spring bill.
    var taxAll = sum(taxes, 11), fallIn = 0; for (var fi = 6; fi < 12; fi++) fallIn += taxes[fi] || 0;
    var taxYear = fallIn > 0 ? taxAll : springTax * 2, taxMonth = taxYear / 12;
    var run = plMode === "run";
    var plTax = run ? MONTHS.map(function () { return taxMonth; }) : taxes;
    var plOut = run ? MONTHS.map(function (_, i) { return totalOut[i] - taxes[i] + taxMonth; }) : totalOut;
    var plProfit = MONTHS.map(function (_, i) { return income[i] - plOut[i]; });
    if (!run) plProfit = profit;
    var plMargin = sum(income, last) ? sum(plProfit, last) / sum(income, last) : 0;
    var lines = [["Rental income", income, "sum"], ["Loan payments", loans, "cost"], [run ? "Property tax (spread)" : "Property tax", plTax, "cost"], ["Everything else", otherCosts, "cost"], ["Insurance", insurance, "sub"], ["Utilities", utilities, "sub"], ["Repairs &amp; expenses", expenses, "sub"], ["Total going out", plOut, "sum"], ["Profit / loss", plProfit, "pl"]];
    html += '<section class="card o-pl"><div class="today-head"><div><h2>Profit &amp; loss</h2></div>' +
      '<span class="seg" role="group" aria-label="How property tax is shown"><button type="button" data-plmode="actual" aria-pressed="' + !run + '">Actual</button><button type="button" data-plmode="run" aria-pressed="' + run + '">Run rate</button></span></div>' +
      '<p class="sub">' + (run
        ? "Run rate: this year's property tax (" + money(taxYear) + (fallIn > 0 ? ", both installments" : ", estimated as twice the spring bill") + ") spread evenly at " + money(taxMonth) + " a month, so every month shows what it really costs to hold the portfolio. Everything else is actual."
        : "Operations, from the Monthly Summaries tab. Costs are split into loan payments, property tax, and everything else. Months not entered yet are greyed out. Switch to Run rate to spread property tax across the year.") +
      '</p><div class="tbl-wrap"><table><thead><tr><th></th>' +
      MONTHS.map(function (m, i) { return '<th class="' + (i > last ? "muted" : "") + '">' + m + "</th>"; }).join("") + "<th>YTD</th></tr></thead><tbody>" +
      lines.map(function (L) {
        var cls = { cost: "indent cost", sub: "indent subline", pl: "pl" }[L[2]] || "sum";
        return '<tr class="' + cls + '"><td>' + L[0] + "</td>" + L[1].map(function (v, i) {
          var c = i > last ? "muted" : L[2] === "pl" ? (v < 0 ? "neg" : "pos") : "";
          return '<td class="' + c + '">' + (i > last ? "—" : money(v)) + "</td>";
        }).join("") + '<td class="' + (L[2] === "pl" ? (sum(L[1], last) < 0 ? "neg" : "pos") : "") + '">' + money(sum(L[1], last)) + "</td></tr>";
      }).join("") +
      '<tr class="indent"><td>Margin</td>' + MONTHS.map(function (_, i) { return '<td class="' + (i > last ? "muted" : "") + '">' + (i > last || !income[i] ? "—" : pct(plProfit[i] / income[i])) + "</td>"; }).join("") + "<td>" + pct(plMargin) + "</td></tr>" +
      "</tbody></table></div></section>";
    html += '<div class="grid2 even"><div>' + propertyCard() + "</div><div>" + forecastCard() + "</div></div></div>";

    // ----- To-dos -----
    html += panel("todos");
    html += '<div class="grid2 even"><div>' + todoCard(d) + "</div><div>" + projectsCard(d) + workCard() + "</div></div></div>";

    html += '<footer>Numbers come from the P&amp;L sheet in Drive; vacancies and lease dates come from the rentals site (listings.json). Fix either one at its source and refresh this page.</footer></div>';
    var wasOpen = [].map.call(document.querySelectorAll("details.rent[open]"), function (x) { return x.getAttribute("data-unit"); });
    var dealsOpen = [].map.call(document.querySelectorAll("details.deal[open]"), function (x) { return x.getAttribute("data-deal"); });
    if (openDeal) { dealsOpen.push(openDeal); openDeal = ""; }
    $("app").innerHTML = html;
    wasOpen.forEach(function (id) { var x = document.querySelector('details.rent[data-unit="' + id + '"]'); if (x) x.open = true; });
    dealsOpen.forEach(function (id) { var x = document.querySelector('details.deal[data-deal="' + id + '"]'); if (x) x.open = true; });
    applyRentFilter();
    applyDealFilter();
    applyTodayFilter();
    // A lead handed over by the iPhone Shortcut (?lead=…) gets read as soon as the page is up.
    if (leadDraft && leadDraft.auto) { leadDraft.auto = false; readLead(); }
  }

  // ---------- Rentals & tenants ----------
  var rentFilter = "all";
  var IC = {
    text: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>',
    mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
    call: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/></svg>',
    doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/></svg>',
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21h4"/></svg>',
  };
  var digits = function (p) { var x = String(p || "").replace(/\D/g, ""); if (x.length === 10) x = "1" + x; return x ? "+" + x : ""; };
  var isIOS = /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent);
  function smsHref(phones, body) {
    var list = phones.filter(Boolean);
    if (!list.length) return "";
    var b = body ? encodeURIComponent(body) : "";
    if (isIOS) return "sms:/open?addresses=" + list.join(",") + (b ? "&body=" + b : "");
    return "sms:" + list.join(",") + (b ? "?body=" + b : "");
  }
  function mailHref(to, cc, subject, body) {
    var q = [];
    if (cc.length) q.push("cc=" + encodeURIComponent(cc.join(",")));
    if (subject) q.push("subject=" + encodeURIComponent(subject));
    if (body) q.push("body=" + encodeURIComponent(body));
    return "mailto:" + to.map(encodeURIComponent).join(",") + (q.length ? "?" + q.join("&") : "");
  }
  var firstName = function (s) { return String(s || "").trim().split(/\s+/)[0]; };
  var joinNames = function (xs) { return xs.length <= 1 ? xs.join("") : xs.slice(0, -1).join(", ") + " and " + xs[xs.length - 1]; };

  function rentalsCard(d, units, today) {
    var me = String(d.user || "").toLowerCase();
    var owners = (d.portfolio && d.portfolio.owners) || [];
    var meOwner = owners.filter(function (o) { return String(o.email).toLowerCase() === me; })[0];
    var others = owners.filter(function (o) { return o !== meOwner; });
    var myName = meOwner ? firstName(meOwner.name) : firstName(me.split("@")[0]);
    var ownerPhones = others.map(function (o) { return digits(o.phone); });
    var ownerEmails = others.map(function (o) { return o.email; }).filter(Boolean);
    var team = joinNames(owners.map(function (o) { return firstName(o.name); }));

    var tenantsBy = {}, notesBy = {};
    (d.tenants || []).forEach(function (t) { (tenantsBy[t.unitId] = tenantsBy[t.unitId] || []).push(t); });
    (d.rentalNotes || []).forEach(function (n) { (notesBy[n.unitId] = notesBy[n.unitId] || []).push(n); });

    var openCount = 0, progCount = 0, missing = 0;
    var cards = units.map(function (u) {
      var ts = tenantsBy[u.id] || [];
      var ns = notesBy[u.id] || [];
      var active = ns.filter(function (n) { return n.status === "Open" || n.status === "In progress"; })
        .sort(function (a, b) { return (a.status === "In progress" ? 0 : 1) - (b.status === "In progress" ? 0 : 1) || (a.added < b.added ? -1 : 1); });
      var past = ns.filter(function (n) { return n.status === "Done" || n.status === "Log"; }).sort(function (a, b) { return a.row < b.row ? 1 : -1; });
      var nOpen = active.filter(function (n) { return n.status === "Open"; }).length, nProg = active.length - nOpen;
      openCount += nOpen; progCount += nProg;
      if (u.status === "leased" && !ts.length) missing++;
      var lastNudge = past.filter(function (n) { return n.status === "Log" && /rent/i.test(n.text); })[0];

      var names = ts.map(function (t) { return t.name; }).filter(Boolean);
      var firsts = names.map(firstName);
      var tPhones = ts.map(function (t) { return digits(t.phone); }).filter(Boolean);
      var tEmails = ts.map(function (t) { return t.email; }).filter(Boolean);
      var lease = ts.map(function (t) { return t.lease; }).filter(Boolean)[0];
      var rent = ts.reduce(function (m, t) { return m + (t.rent || 0); }, 0); // whole home, roommates' shares added up
      var dueDay = (ts[0] && ts[0].dueDay) || 1;

      // Rent nudge wording: this month's due date, "is due" or "was due".
      var due = new Date(today.getFullYear(), today.getMonth(), dueDay);
      var dueTxt = (due < today ? "was due " : "is due ") + due.toLocaleDateString("en-US", { month: "long", day: "numeric" });
      var greet = "Hi " + (firsts.length ? joinNames(firsts) : "there") + ", ";
      var nudge = greet + "it's " + myName + " with The Fund (" + team + " are both on this so we're all on the same page). Friendly reminder that rent" + (rent ? " of " + money(rent) : "") + " for " + u.address + " " + dueTxt + ". If you've already paid in Innago, thank you, and please ignore this!";
      var intro = greet + "it's " + myName + ". I've included " + joinNames(others.map(function (o) { return firstName(o.name); })) + " so we're all on the same thread.";

      var groupSms = tPhones.length ? smsHref(tPhones.concat(ownerPhones), intro) : "";
      var nudgeSms = tPhones.length ? smsHref(tPhones.concat(ownerPhones), nudge) : "";
      var groupMail = tEmails.length ? mailHref(tEmails, ownerEmails, u.address, greet + "\n\n\n— " + myName + " (The Fund Worldwide)") : "";
      var nudgeMail = tEmails.length ? mailHref(tEmails, ownerEmails, "Rent reminder · " + u.address, nudge + "\n\n— " + myName) : "";

      var endTxt = u.leaseEnds === "month-to-month" ? "Month-to-month" : u.leaseEnds ? "Lease ends " + fmtDate(parseDate(u.leaseEnds)) : u.status === "leased" ? "No lease end date" : "";
      var statusPill = u.status !== "leased" ? '<span class="pill mid">Vacant</span>' : "";

      var s = '<details class="rent" data-unit="' + esc(u.id) + '" data-open="' + (active.length ? 1 : 0) + '" data-missing="' + (u.status === "leased" && !ts.length ? 1 : 0) + '">';
      s += '<summary><span><b>' + esc(u.address) + '</b> <span class="m">' + esc(u.name.indexOf("·") > 0 ? u.name.split("·")[1].trim() : "") + "</span><br>" +
        '<span class="m">' + (names.length ? esc(names.join(" & ")) : u.status === "leased" ? '<i>Tenant not entered</i>' : "No tenant") + (endTxt ? " · " + esc(endTxt) : "") + "</span></span>" +
        '<span class="pills">' + statusPill +
        (nProg ? '<span class="pill prog">' + nProg + " in progress</span>" : "") +
        (nOpen ? '<span class="pill mid">' + nOpen + " to do</span>" : "") + "</span></summary>";

      s += '<div class="rent-body">';
      if (ts.length) {
        s += ts.map(function (t) {
          var p = digits(t.phone);
          return '<div class="tenant"><b>' + esc(t.name || "Tenant") + "</b>" + (t.rent ? ' <span class="m">· ' + money(t.rent) + (ts.length > 1 ? " share" : "/mo") + ", due the " + ordinal(t.dueDay) + "</span>" : "") +
            '<div class="c">' + [t.phone ? '<a href="tel:' + p + '">' + esc(t.phone) + "</a>" : "", t.email ? '<a href="mailto:' + esc(t.email) + '">' + esc(t.email) + "</a>" : ""].filter(Boolean).join(" · ") + "</div>" +
            (t.notes ? '<div class="c">' + esc(t.notes) + "</div>" : "") + "</div>";
        }).join("");
        s += '<div class="acts">' +
          (groupSms ? '<a class="act primary" href="' + esc(groupSms) + '">' + IC.text + "Group text</a>" : "") +
          (groupMail ? '<a class="act" href="' + esc(groupMail) + '">' + IC.mail + "Email</a>" : "") +
          (nudgeSms || nudgeMail ? '<a class="act warn" data-nudge="' + esc(u.id) + '" data-name="' + esc(u.name) + '" data-via="' + (nudgeSms ? "text" : "email") + '" href="' + esc(nudgeSms || nudgeMail) + '">' + IC.bell + "Rent nudge</a>" : "") +
          (lease ? '<a class="act" href="' + esc(lease) + '" target="_blank" rel="noopener">' + IC.doc + "Lease</a>" : '<span class="m" style="align-self:center">No lease linked</span>') +
          "</div>";
        if (lastNudge) s += '<p class="m" style="margin:8px 0 0">Last rent nudge: ' + fmtDate(parseDate(lastNudge.added)) + " by " + esc(lastNudge.by) + "</p>";
        if (!tPhones.length && !tEmails.length) s += '<p class="m" style="margin:8px 0 0">Add a phone or email in the Owner Tenants tab to message them.</p>';
      } else if (u.status === "leased") {
        s += '<p class="m" style="margin:12px 0 0">Add the tenant\'s name, phone, email and lease link to this unit\'s row in the P&amp;L\'s <b>Owner Tenants</b> tab.</p>';
      }

      s += '<div class="h3">Notes &amp; repairs</div>';
      s += active.length ? active.map(noteRow).join("") : '<p class="empty" style="font-size:13.5px">Nothing open.</p>';
      s += '<form class="note-add" data-unit="' + esc(u.id) + '" data-name="' + esc(u.name) + '"><input type="text" maxlength="500" placeholder="Add a note or repair…" aria-label="New note for ' + esc(u.address) + '"><button type="submit">Add</button></form>';
      if (past.length) s += '<details style="margin-top:8px"><summary class="linkbtn">Done &amp; history (' + past.length + ")</summary>" + past.map(noteRow).join("") + "</details>";
      s += "</div></details>";
      return s;
    }).join("");

    return '<section class="card o-rentals"><h2>Rentals &amp; tenants</h2><p class="sub">Who\'s in each home, and what\'s open there. Texts and emails include ' + esc(team || "both owners") + " so no conversation is one-on-one. Tenant details live in the P&amp;L's <b>Owner Tenants</b> tab; notes in <b>Owner Rental Notes</b>.</p>" +
      '<div class="rent-tools" role="group" aria-label="Filter rentals">' +
      '<button type="button" data-filter="all" aria-pressed="' + (rentFilter === "all") + '">All ' + units.length + "</button>" +
      '<button type="button" data-filter="open" aria-pressed="' + (rentFilter === "open") + '">Open items ' + (openCount + progCount) + "</button>" +
      (missing ? '<button type="button" data-filter="missing" aria-pressed="' + (rentFilter === "missing") + '">Tenant not entered ' + missing + "</button>" : "") +
      '<button type="button" data-filter="expand" aria-pressed="false">Expand all</button>' +
      "</div><div class=\"rentals\">" + cards + "</div></section>";
  }

  function noteRow(n) {
    if (n.status === "Log") return '<div class="rnote log"><span>' + esc(n.text) + '<span class="m">' + [n.by, n.added ? fmtDate(parseDate(n.added)) : ""].filter(Boolean).map(esc).join(" · ") + "</span></span></div>";
    var cls = n.status === "Open" ? "s-open" : n.status === "In progress" ? "s-prog" : "";
    return '<div class="rnote"><span>' + esc(n.text) + '<span class="m">' + [n.by ? "Added by " + esc(n.by) : "", n.added ? fmtDate(parseDate(n.added)) : "", n.status === "Done" && n.updated ? "done " + esc(n.updated) : ""].filter(Boolean).join(" · ") + "</span></span>" +
      '<select class="' + cls + '" data-note-row="' + n.row + '" aria-label="Status">' + ["Open", "In progress", "Done"].map(function (st) { return "<option" + (st === n.status ? " selected" : "") + ">" + st + "</option>"; }).join("") + "</select></div>";
  }
  function ordinal(n) { var s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  function applyRentFilter() {
    [].forEach.call(document.querySelectorAll("details.rent"), function (x) {
      x.hidden = rentFilter === "open" ? x.getAttribute("data-open") !== "1" : rentFilter === "missing" ? x.getAttribute("data-missing") !== "1" : false;
    });
  }
  document.addEventListener("click", function (e) {
    var f = e.target.closest && e.target.closest(".rent-tools button");
    if (f) {
      var k = f.getAttribute("data-filter");
      if (k === "expand") {
        var all = document.querySelectorAll("details.rent:not([hidden])"), anyClosed = [].some.call(all, function (x) { return !x.open; });
        [].forEach.call(all, function (x) { x.open = anyClosed; });
        f.textContent = anyClosed ? "Collapse all" : "Expand all";
        return;
      }
      rentFilter = k;
      [].forEach.call(document.querySelectorAll(".rent-tools button[data-filter]:not([data-filter=expand])"), function (b) { b.setAttribute("aria-pressed", String(b === f)); });
      applyRentFilter();
      return;
    }
    // Rent nudge: let the text/email open, and record it on the rental so both owners see it went out.
    var nb = e.target.closest && e.target.closest("a[data-nudge]");
    if (nb) FundAPI.run.withSuccessHandler(load).addRentalNote(nb.getAttribute("data-nudge"), nb.getAttribute("data-name"), "Rent nudge sent by " + nb.getAttribute("data-via"), "Log");
  });

  // ---------- Deals (flip leads from wholesalers) ----------
  var DEALS = { list: [], rehab: [], statuses: [] };
  var openDeal = "";        // a deal to open after the next refresh (the one just saved)
  var leadDraft = null;     // what's typed in the New lead form, kept across refreshes
  var dealFilter = "active";
  var dealSort = "best";    // "best" = furthest under your max offer first; "new" = newest first
  // [field, label, kind]: "n" = dollars or a count, "y" = a year (no comma), "p" = a percent, "wide" = full-width text
  var LEAD_FIELDS = [["address", "Address", "wide"], ["from", "From (wholesaler)"], ["asking", "Asking", "n"], ["arv", "ARV", "n"], ["sqft", "Sq ft", "n"], ["bedsBaths", "Beds/Baths"], ["yearBuilt", "Year built", "y"], ["photoLink", "Listing / photos link", "wide"]];
  var DEAL_PILL = { "New": "mid", "Sent to GC": "prog", "Bid in": "pos", "Offer made": "prog", "Under contract": "pos", "Passed": "plain", "Closed": "plain" };
  var dealDone = function (st) { return st === "Passed" || st === "Closed"; };
  var errText = function (err) { return (err && err.message) || String(err); };

  // "$85,000", "85k" and "1.2m" all work. Returns "" when it isn't a number.
  function numIn(v, exact) {
    var m = /^(-?\d*\.?\d+)(k|m)?$/.exec(String(v == null ? "" : v).replace(/[$,%\s]/g, "").toLowerCase());
    if (!m) return "";
    var n = parseFloat(m[1]) * (m[2] === "k" ? 1e3 : m[2] === "m" ? 1e6 : 1);
    return exact ? n : Math.round(n);
  }
  function fld(key, label, val, kind) {
    var num = kind === "n" || kind === "p" || kind === "y";
    var shown = val == null ? "" : typeof val !== "number" ? val : kind === "y" ? String(val) : val.toLocaleString("en-US", { maximumFractionDigits: 2 });
    return '<label class="' + (kind === "wide" ? "wide" : "") + '" data-for="' + key + '">' + esc(label) +
      '<input type="text" data-f="' + key + '"' + (num ? ' data-n="' + kind + '" inputmode="decimal"' : "") + ' value="' + esc(shown) + '" autocomplete="off"></label>';
  }

  // The lead handed over by the iPhone Shortcut's "review first" option.
  (function () {
    var q = new URLSearchParams(location.search), text = (q.get("lead") || "").trim();
    if (text) { try { history.replaceState(null, "", location.pathname); } catch (e) {} }
    if (text) { leadDraft = { lead: text, open: true, auto: true }; tab = "deals"; }
  })();

  function leadCard() {
    var L = leadDraft || {};
    return '<details class="card lead-card" id="leadCard"' + (L.open ? " open" : "") + '><summary><h2>New lead</h2><span class="act primary">' + (L.open ? "Close" : "+ Add a lead") + "</span></summary>" +
      '<p class="sub">Paste the wholesaler\'s text, tap <b>Read it</b>, check the numbers, then save.' + (DEALS.intake ? " Leads sent from the iPhone Shortcut land in the pipeline below on their own." : "") + "</p>" +
      '<textarea data-f="lead" rows="5" maxlength="5000" placeholder="Paste the lead text here…" aria-label="Lead text">' + esc(L.lead || "") + "</textarea>" +
      '<div class="save-bar"><button type="button" class="act primary" data-lead="read"' + (L.busy ? " disabled" : "") + ">" + (L.busy === "read" ? "Reading…" : "Read it") + '</button><span class="m">' + esc(L.msg || "") + "</span></div>" +
      '<div class="fields">' + LEAD_FIELDS.map(function (f) { return fld(f[0], f[1], L[f[0]], f[2]); }).join("") + "</div>" +
      '<div class="save-bar"><button type="button" class="act primary" data-lead="save"' + (L.busy ? " disabled" : "") + ">" + (L.busy === "save" ? "Saving…" : L.dupOk ? "Save anyway" : "Save lead") + "</button>" +
      '<button type="button" class="act" data-lead="clear"' + (L.busy ? " disabled" : "") + '>Clear</button><span class="m">' + esc(L.saveMsg || "") + "</span></div></details>";
  }
  function drawLead() { var el = $("leadCard"); if (el) el.outerHTML = leadCard(); }

  function readLead() {
    var L = leadDraft = leadDraft || { open: true };
    var text = String(L.lead || "").trim();
    L.saveMsg = "";
    if (!text) { L.msg = "Paste the text first."; drawLead(); return; }
    L.busy = "read"; L.msg = ""; drawLead();
    FundAPI.run.withSuccessHandler(function (p) {
      p = p || {};
      L.busy = "";
      var found = LEAD_FIELDS.filter(function (f) { if (p[f[0]] == null || p[f[0]] === "") return false; L[f[0]] = p[f[0]]; return true; }).length;
      L.repairs = p.repairs || null;
      L.msg = (found ? (p.via === "claude" ? "Read by Claude." : "Read with the built-in rules.") + " Check the numbers before saving." : "Couldn't pick anything out of that. Type in what you know below.") +
        (p.repairs ? " Their repair estimate (" + money(p.repairs) + ") goes in the notes." : "") + (p.warning ? " " + p.warning : "");
      if (leadDraft === L) drawLead();
    }).withFailureHandler(function (err) {
      L.busy = ""; L.msg = "Couldn't read it: " + errText(err);
      if (leadDraft === L) drawLead();
    }).parseLeadText(text);
  }

  function saveLead() {
    var L = leadDraft = leadDraft || { open: true };
    var d = { lead: String(L.lead || "").trim() }, bad = "";
    LEAD_FIELDS.forEach(function (f) {
      var v = L[f[0]];
      if (v == null || String(v).trim() === "") return;
      if (f[2] !== "n" && f[2] !== "y") { d[f[0]] = String(v).trim(); return; }
      var n = typeof v === "number" ? v : numIn(v);
      if (n === "") bad = bad || f[1]; else d[f[0]] = n;
    });
    L.saveMsg = "";
    if (bad) L.saveMsg = "Check the number in " + bad + ".";
    else if (!d.lead && !d.address) L.saveMsg = "Paste the lead text or type an address first.";
    else if (!L.dupOk) {
      // Wholesalers re-send the same house. Match on house number + street name among open deals.
      var norm = function (a) { return String(a || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean).slice(0, 2).join(" "); };
      var want = norm(d.address);
      var dup = want.split(" ").length === 2 && (DEALS.list || []).filter(function (x) { return !dealDone(x.status) && norm(x.address) === want; })[0];
      if (dup) { L.dupOk = true; L.saveMsg = "You already have " + (dup.address || dup.id) + " (" + dup.status + "). Tap Save anyway to add it again."; }
    }
    if (L.saveMsg) { drawLead(); return; }
    if (L.repairs) d.notes = "Wholesaler says repairs ≈ " + money(L.repairs);
    L.busy = "save"; drawLead();
    FundAPI.run.withSuccessHandler(function (id) {
      if (leadDraft === L) leadDraft = null;
      openDeal = id; dealFilter = "active";
      load();
    }).withFailureHandler(function (err) {
      L.busy = ""; L.saveMsg = "Couldn't save: " + errText(err);
      if (leadDraft === L) drawLead();
    }).addDeal(d);
  }

  // The flip math. Hold & close is a percent of ARV (holding costs, closing both ways, agent on the sale).
  //   Target profit: max offer = ARV − rehab − hold & close − the profit you want
  //   70% rule:      max offer = 70% of ARV − rehab
  function dealMath(d) {
    var n = function (x) { return typeof x === "number" && isFinite(x) ? x : 0; };
    var rehab = (DEALS.rehab || []).reduce(function (t, r) { return t + n(d[r[0]]); }, 0) +
      (d.extraLines || []).reduce(function (t, x) { return t + n(x.value); }, 0);
    var arv = n(d.arv), asking = n(d.asking);
    // No real rehab numbers yet? Use the quick estimate: square feet × the Light / Medium / Heavy rate.
    var level = (DEALS.rates || {})[d.rehabLevel] ? d.rehabLevel : "Medium", rate = (DEALS.rates || {})[level] || 0, est = false;
    if (!rehab && n(d.sqft) && rate) { rehab = Math.round(n(d.sqft) * rate); est = true; }
    var holdPct = d.holdPct == null ? 10 : n(d.holdPct);
    var target = d.targetProfit == null ? 30000 : n(d.targetProfit);
    var is70 = d.method === "70";
    var hold = arv * holdPct / 100;
    var max = arv ? Math.round(is70 ? arv * 0.7 - rehab : arv - rehab - hold - target) : null;
    var profit = arv && asking ? Math.round(arv - asking - rehab - hold) : null;
    var M = { arv: arv, asking: asking, rehab: rehab, holdPct: holdPct, hold: hold, target: target, is70: is70, max: max, profit: profit, cls: "mid", est: est, level: level, rate: rate, word: "" };
    if (!arv) M.verdict = "Add the ARV to see the math.";
    else if (!rehab) M.verdict = "No rehab numbers or square footage yet. Before rehab the most you could pay is " + money(max) + "; every rehab dollar comes straight off that.";
    else if (max <= 0) { M.cls = "neg"; M.word = "Pass"; M.verdict = "Pass: doesn't work at any price with these numbers."; }
    else if (!asking) M.verdict = "Worth it at " + money(max) + " or less. Add the asking price to compare.";
    else if (asking <= max) { M.cls = "pos"; M.word = "Works"; M.verdict = "Works at asking: " + money(max - asking) + " under your max offer of " + money(max) + "."; }
    else if (asking <= max * 1.1) { M.word = "Close"; M.verdict = "Close: worth it at " + money(max) + " or less, which is " + money(asking - max) + " off asking (" + pct((asking - max) / asking) + ")."; }
    else { M.cls = "neg"; M.word = "Too high"; M.verdict = "Too high: only worth it at " + money(max) + " or less, which is " + money(asking - max) + " off asking (" + pct((asking - max) / asking) + ")."; }
    M.ready = !!(arv && rehab);
    // How far under (+) or over (−) your max offer the asking price is. Used to sort the pipeline.
    M.spread = M.ready && asking ? max - asking : null;
    if (M.ready && est) M.verdict += " Rehab is a quick estimate (" + level.toLowerCase() + ", $" + rate + "/sq ft) and the ARV is the wholesaler's until you check comps.";
    return M;
  }
  function mathHtml(d) {
    var M = dealMath(d);
    var r = function (l, v, cls, vcls) { return '<tr class="' + (cls || "") + '"><td>' + l + '</td><td class="' + (vcls || "") + '">' + v + "</td></tr>"; };
    var t = "", rl = M.est ? "Rehab (quick estimate)" : "Rehab";
    if (M.arv) {
      t = '<div class="math"><table><tbody>' + r("ARV", money(M.arv)) +
        (M.is70 ? r("70% of ARV", money(M.arv * 0.7)) + r(rl, "−" + money(M.rehab))
          : r(rl, "−" + money(M.rehab)) + r("Hold &amp; close (" + M.holdPct + "% of ARV)", "−" + money(M.hold)) + r("Target profit", "−" + money(M.target))) +
        r("Max offer", money(M.max), "pl") +
        (M.asking ? r("Asking", money(M.asking)) + r("Profit at asking", money(M.profit), "pl", M.profit < 0 ? "neg" : "pos") +
          '<tr><td class="note" colspan="2">After rehab and ' + M.holdPct + "% hold &amp; close.</td></tr>" : "") +
        "</tbody></table></div>";
    }
    return t + '<div class="verdict ' + M.cls + '">' + esc(M.verdict) + "</div>";
  }

  // The text to the GC: short on purpose.
  function gcText(d, link) {
    var addr = String(d.address || "").trim();
    return "Hey " + (DEALS.gcName || "there") + ", here's the house" + (addr ? ": " + addr : "") + "\n\n" +
      "Fill in your numbers here: " + link + "\n\n" +
      "Let me know your thoughts. Thanks!";
  }
  function gcLink(d) {
    if (!DEALS.bidUrl || !d.key) return "";
    return DEALS.bidUrl + (DEALS.bidUrl.indexOf("?") < 0 ? "?" : "&") + "bid=" + encodeURIComponent(d.id) + "&k=" + encodeURIComponent(d.key);
  }
  function extraRow(p) {
    return '<div class="line" data-xrow><input type="text" class="x-label" placeholder="Category" maxlength="60" value="' + esc(p.label || "") + '" aria-label="Category">' +
      '<span class="money"><span>$</span><input type="text" class="x-val" inputmode="decimal" autocomplete="off" value="' + (p.value == null ? "" : esc(Number(p.value).toLocaleString("en-US"))) + '" aria-label="Amount"></span>' +
      '<button type="button" class="act" data-x-rm aria-label="Remove line">×</button></div>';
  }

  // Sold comps on Zillow: same zip, same bedrooms, square footage within 20%, sold in the last 6 months.
  // Zillow only lands on the right area when the link has the city, state and zip, so without all three
  // this falls back to looking the address up.
  function compsLink(d) {
    var addr = String(d.address || "").trim();
    if (!addr) return null;
    var m = /,\s*([A-Za-z][A-Za-z .'-]*?),?\s+([A-Za-z]{2})\.?\s+(\d{5})(?:-\d{4})?\s*$/.exec(addr);
    if (!m) return { href: "https://www.zillow.com/homes/" + encodeURIComponent(addr.replace(/[,#]/g, " ").replace(/\s+/g, "-")) + "_rb/", label: "Look up on Zillow", exact: false };
    var f = { rs: { value: true }, fsba: { value: false }, fsbo: { value: false }, nc: { value: false }, cmsn: { value: false }, auc: { value: false }, fore: { value: false }, doz: { value: "6m" } };
    var bb = /^(\d+)\s*\/\s*(\d+(?:\.\d)?)$/.exec(String(d.bedsBaths || "").trim());
    if (bb) { f.beds = { min: +bb[1], max: +bb[1] }; f.baths = { min: Math.floor(+bb[2]) || 1 }; }
    if (typeof d.sqft === "number" && d.sqft > 0) f.sqft = { min: Math.floor(d.sqft * 0.8 / 50) * 50, max: Math.ceil(d.sqft * 1.2 / 50) * 50 };
    var slug = (m[1].trim() + " " + m[2] + " " + m[3]).toLowerCase().replace(/[^a-z0-9]+/g, "-");
    return { href: "https://www.zillow.com/" + slug + "/sold/?searchQueryState=" + encodeURIComponent(JSON.stringify({ filterState: f, isListVisible: true })), label: "Sold comps", exact: true, zip: m[3] };
  }

  function dealCard(d) {
    var M = dealMath(d), link = gcLink(d), C = compCheck(d);
    var arvHigh = C.n && C.diff != null && C.diff > 0.1;
    var added = parseDate(String(d.added || "").slice(0, 10));
    var comps = compsLink(d);
    var s = '<details class="deal" data-deal="' + esc(d.id) + '" data-status="' + esc(d.status) + '" data-spread="' + (M.spread == null ? "" : M.spread) + '">';
    s += "<summary><span><b>" + esc(d.address || "No address yet") + '</b><br><span class="m">' +
      [d.from, d.asking != null ? "Asking " + money(d.asking) : "", d.arv != null ? "ARV " + money(d.arv) : "", d.yearBuilt ? "Built " + d.yearBuilt : "", added ? "Added " + fmtDate(added) : ""].filter(Boolean).map(esc).join(" · ") + "</span></span>" +
      '<span class="pills"><span class="pill ' + (DEAL_PILL[d.status] || "plain") + '">' + esc(d.status) + "</span>" +
      (M.ready && !dealDone(d.status) ? '<span class="pill ' + M.cls + '">' + (M.word ? M.word + " · " : "") + (M.max > 0 ? "max " + short(M.max) : "no price works") + (M.est ? " est." : "") + "</span>" : "") +
      (arvHigh && !dealDone(d.status) ? '<span class="pill neg">ARV ' + pct(C.diff) + " over comps</span>" : "") + "</span></summary>";

    s += '<div class="deal-body">';
    s += '<div class="h3"><span>The house</span><span class="acts" style="margin:0">' +
      (comps ? '<a class="act" href="' + esc(comps.href) + '" target="_blank" rel="noopener">' + comps.label + "</a>" : "") +
      (d.photoLink ? '<a class="act" href="' + esc(d.photoLink) + '" target="_blank" rel="noopener">Listing &amp; photos</a>' : "") + "</span></div>";
    if (comps) s += '<p class="m" style="margin:6px 0 0">' + (comps.exact ? "Sold comps opens Zillow: sold in " + esc(comps.zip) + " in the last 6 months, same bedrooms, similar size. Check the heading says " + esc(comps.zip) + ", then put your own ARV below."
      : "Add the city, state and zip to the address (like <i>1422 Oakland St, Fort Wayne, IN 46808</i>) to get a filtered sold-comps search.") + "</p>";
    s += '<div class="fields"><label>Status<select data-deal-status aria-label="Status">' + (DEALS.statuses || []).map(function (st) { return "<option" + (st === d.status ? " selected" : "") + ">" + esc(st) + "</option>"; }).join("") + "</select></label>" +
      LEAD_FIELDS.map(function (f) { return fld(f[0], f[1], d[f[0]], f[2]); }).join("") + "</div>";
    s += "<div data-comps>" + compHtml(d) + "</div>";

    s += '<div class="h3"><span>Rehab</span><span class="m">' + (d.bidUpdated ? "GC bid in " + esc(d.bidUpdated) : "No GC bid yet") + "</span></div>";
    var rates = DEALS.rates || {}, lvls = Object.keys(rates);
    if (lvls.length) s += '<div class="save-bar" style="margin:0 0 4px"><span class="seg" role="group" aria-label="Quick rehab estimate">' + lvls.map(function (L) {
      return '<button type="button" data-level="' + esc(L) + '" aria-pressed="' + (L === M.level) + '">' + esc(L) + " $" + rates[L] + "</button>"; }).join("") +
      '</span><span class="m">Quick estimate per sq ft, used until the lines below have numbers.</span></div>';
    s += '<div class="fields rehab">' + (DEALS.rehab || []).map(function (r) { return fld(r[0], r[1], d[r[0]], "n"); }).join("") + "</div>";
    if (d.gcNotes) s += '<p class="lead-raw"><b>GC notes:</b> ' + esc(d.gcNotes) + "</p>";

    // Extra lines beyond the standard ones. The GC sees and can change these on the bid link.
    s += '<div class="prefill-lines">' + (d.extraLines || []).map(extraRow).join("") + "</div>";
    s += '<div class="save-bar" style="margin-top:6px"><select data-x-add aria-label="Add a rehab line"><option value="">+ Add a line…</option>' +
      (DEALS.rehabExtra || []).map(function (c) { return "<option>" + c + "</option>"; }).join("") + '<option value="__other__">Other…</option></select>' +
      '<span class="m">On the phone with your GC? Type what he says, save, and the link shows it to him.</span></div>';

    if (link) {
      var body = gcText(d, link);
      var gc = digits(DEALS.gcPhone);
      var sms = gc ? smsHref([gc], body) : (isIOS ? "sms:&body=" : "sms:?body=") + encodeURIComponent(body);
      s += '<div class="h3"><span>What ' + esc(DEALS.gcName || "your GC") + ' gets</span></div>' +
        '<p class="lead-raw" style="margin:0">' + esc(body) + "</p>" +
        '<div class="gclink"><input type="text" readonly value="' + esc(link) + '" aria-label="GC bid link"><button type="button" class="act" data-gc-copy>Copy</button>' +
        '<a class="act" data-gc-preview href="' + esc(link + "&preview=1") + '" target="_blank" rel="noopener">Preview his page</a>' +
        '<a class="act primary" data-gc-text href="' + esc(sms) + '">' + IC.text + "Text " + esc(DEALS.gcName || "GC") + "</a></div>" +
        '<p class="m" style="margin:6px 0 0">His page shows the deal (asking, ARV, the wholesaler\'s text) and the rehab budget that works at asking, but not your notes. Unsaved changes get saved when you preview or text.</p>';
    } else {
      s += '<p class="m" style="margin:6px 0 0">To get a bid link for your GC, finish the Deals setup in the README (the second deployment and <b>BID_URL</b>). Until then, type the rehab numbers in here.</p>';
    }

    s += '<div class="h3"><span>The math</span><span class="seg" role="group" aria-label="How to figure the max offer">' +
      '<button type="button" data-method="profit" aria-pressed="' + (d.method !== "70") + '">Target profit</button>' +
      '<button type="button" data-method="70" aria-pressed="' + (d.method === "70") + '">70% rule</button></span></div>';
    s += '<div class="fields">' + fld("holdPct", "Hold & close %", d.holdPct == null ? 10 : d.holdPct, "p") + fld("targetProfit", "Target profit", d.targetProfit == null ? 30000 : d.targetProfit, "n").replace("<label ", d.method === "70" ? "<label hidden " : "<label ") + "</div>";
    s += "<div data-math>" + mathHtml(d) + "</div>";

    s += '<div class="h3"><span>Notes</span></div><textarea data-f="notes" rows="2" maxlength="2000" aria-label="Notes">' + esc(d.notes) + "</textarea>";
    if (d.lead) s += '<details style="margin-top:8px"><summary class="linkbtn">Original text</summary><p class="lead-raw">' + esc(d.lead) + "</p></details>";
    s += '<div class="save-bar"><button type="button" class="act primary" data-deal-save disabled>Save</button><span class="m" data-deal-msg></span></div>';
    s += "</div></details>";
    return s;
  }

  function pipelineCard() {
    var list = DEALS.list || [];
    var count = function (fn) { return list.filter(function (x) { return fn(x.status); }).length; };
    var h = '<section class="card"><h2>Deal pipeline</h2><p class="sub">Flip leads with a first read on each: <b>Works</b>, <b>Close</b> or <b>Too high</b>, and the most it\'s worth paying. Open one to check comps, send it to your GC, or move it along. Saved in the <b>Owner Deals</b> tab.</p>';
    if (DEALS.error) h += '<p class="err" style="margin-bottom:12px">Couldn\'t open the deals sheet: ' + esc(DEALS.error) + "</p>";
    if (!list.length) return h + '<p class="empty">No deals yet. Add the first one above.</p></section>';
    var btn = function (k, label, n) { return '<button type="button" data-deal-filter="' + k + '" aria-pressed="' + (dealFilter === k) + '">' + label + " " + n + "</button>"; };
    h += '<div class="deal-tools" role="group" aria-label="Filter deals">' +
      btn("active", "Active", count(function (s) { return !dealDone(s); })) +
      btn("look", "Needs a look", count(function (s) { return s === "New" || s === "Bid in"; })) +
      btn("done", "Passed &amp; closed", count(dealDone)) +
      btn("all", "All", list.length) +
      '<button type="button" data-deal-sort aria-pressed="false" style="margin-left:auto"></button></div>';
    return h + '<div class="deals">' + list.map(dealCard).join("") + '</div><p class="empty" id="dealEmpty" hidden>Nothing in this group.</p></section>';
  }

  function applyDealFilter() {
    var shown = 0;
    [].forEach.call(document.querySelectorAll("details.deal"), function (x) {
      var st = x.getAttribute("data-status");
      var show = dealFilter === "all" || (dealFilter === "done" ? dealDone(st) : dealFilter === "look" ? st === "New" || st === "Bid in" : !dealDone(st));
      x.hidden = !show; if (show) shown++;
    });
    [].forEach.call(document.querySelectorAll("[data-deal-filter]"), function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-deal-filter") === dealFilter)); });
    var empty = $("dealEmpty"); if (empty) empty.hidden = shown > 0;
    // Order: best deal first (asking furthest under your max offer; deals without enough numbers go last), or newest first.
    var box = document.querySelector(".deals"), sb = document.querySelector("[data-deal-sort]");
    if (sb) sb.textContent = dealSort === "best" ? "Sorted: best deal first" : "Sorted: newest first";
    if (box) {
      var order = {}; (DEALS.list || []).forEach(function (x, i) { order[x.id] = i; });
      [].slice.call(box.children).sort(function (a, b) {
        if (dealSort === "best") {
          var sa = a.getAttribute("data-spread"), sb2 = b.getAttribute("data-spread");
          if ((sa === "") !== (sb2 === "")) return sa === "" ? 1 : -1;
          if (sa !== "" && +sa !== +sb2) return +sb2 - +sa;
        }
        return order[a.getAttribute("data-deal")] - order[b.getAttribute("data-deal")];
      }).forEach(function (el) { box.appendChild(el); });
    }
  }

  // What's in a deal card's form right now. Numbers that are blank come back as null.
  function collectDeal(card) {
    var v = {}, bad = "";
    [].forEach.call(card.querySelectorAll("[data-f]"), function (el) {
      var k = el.getAttribute("data-f"), kind = el.getAttribute("data-n");
      if (!kind) { v[k] = el.value.trim(); return; }
      var n = numIn(el.value, kind === "p");
      if (n === "" && el.value.trim()) bad = bad || el.parentNode.firstChild.textContent;
      v[k] = n === "" ? null : n;
    });
    var on = card.querySelector("[data-method][aria-pressed=true]"), lv = card.querySelector("[data-level][aria-pressed=true]");
    v.method = on ? on.getAttribute("data-method") : "profit";
    if (lv) v.rehabLevel = lv.getAttribute("data-level");
    v.status = card.querySelector("[data-deal-status]").value;
    v.extraLines = [];
    [].forEach.call(card.querySelectorAll("[data-xrow]"), function (row) {
      var label = row.querySelector(".x-label").value.trim(), raw = row.querySelector(".x-val").value, n = numIn(raw);
      if (n === "" && raw.trim()) bad = bad || (label || "an added line");
      if (label) v.extraLines.push({ label: label, value: n === "" ? null : n });
    });
    return { vals: v, bad: bad };
  }
  function dealDirty(card) {
    var btn = card.querySelector("[data-deal-save]"); if (btn) btn.disabled = false;
    card.querySelector("[data-deal-msg]").textContent = "";
    card.querySelector("[data-math]").innerHTML = mathHtml(collectDeal(card).vals);
    var cb = card.querySelector("[data-comps]"); if (cb) cb.innerHTML = compHtml(collectDealFull(card));
  }
  // Saves only what changed, so a bid the GC sent in the meantime isn't overwritten by an old copy of this page.
  function saveDeal(card, extra, after) {
    var id = card.getAttribute("data-deal");
    var orig = (DEALS.list || []).filter(function (x) { return x.id === id; })[0] || {};
    var c = collectDeal(card), msg = card.querySelector("[data-deal-msg]"), btn = card.querySelector("[data-deal-save]");
    if (c.bad) { msg.textContent = "Check the number in " + c.bad + "."; return; }
    var k, changes = {}, any = false;
    for (k in extra || {}) c.vals[k] = extra[k];
    var same = function (a, b) { return (a == null ? "" : String(a)) === (b == null ? "" : String(b)); };
    for (k in c.vals) {
      var was = orig[k];
      if (k === "method" && !was) was = "profit";
      if (k === "rehabLevel" && !was) was = "Medium";
      if (k === "extraLines") {
        var ser = function (a) { return JSON.stringify((a || []).map(function (x) { return [x.label, x.value == null ? null : +x.value]; })); };
        if (ser(was) !== ser(c.vals[k])) { changes[k] = c.vals[k]; any = true; }
        continue;
      }
      if (!same(was, c.vals[k])) { changes[k] = c.vals[k] == null ? "" : c.vals[k]; any = true; }
    }
    if (!any) { msg.textContent = "Nothing to save."; btn.disabled = true; if (after) after(); return; }
    btn.disabled = true; btn.textContent = "Saving…"; msg.textContent = "";
    FundAPI.run.withSuccessHandler(function () { if (after) after(); load(); }).withFailureHandler(function (err) {
      btn.disabled = false; btn.textContent = "Save"; msg.textContent = "Couldn't save: " + errText(err);
    }).updateDeal(id, changes);
  }

  document.addEventListener("input", function (e) {
    var el = e.target;

    if (el.classList && (el.classList.contains("x-label") || el.classList.contains("x-val"))) {
      var xc = el.closest("details.deal"); if (xc) dealDirty(xc);
      return;
    }

    if (!el.hasAttribute("data-f")) return;
    if (el.closest("#leadCard")) {
      leadDraft = leadDraft || { open: true };
      leadDraft[el.getAttribute("data-f")] = el.value;
      leadDraft.dupOk = false;
      return;
    }
    var card = el.closest("details.deal"); if (card) dealDirty(card);
  });
  document.addEventListener("change", function (e) {
    var xa = e.target.closest && e.target.closest("[data-x-add]");
    if (xa) {
      var label = xa.value, xcard = xa.closest("details.deal");
      xa.value = "";
      if (label === "__other__") label = (window.prompt("Name for the new line:") || "").trim();
      if (!label) return;
      var box = xcard.querySelector(".prefill-lines");
      box.insertAdjacentHTML("beforeend", extraRow({ label: label, value: null }));
      box.lastElementChild.querySelector(".x-val").focus();
      dealDirty(xcard);
      return;
    }
    var sel = e.target.closest && e.target.closest("[data-deal-status]");
    if (sel) saveDeal(sel.closest("details.deal"));
  });
  // <details> toggle events don't bubble, so listen on the way down.
  document.addEventListener("toggle", function (e) {
    if (e.target.id !== "leadCard") return;
    leadDraft = leadDraft || {};
    leadDraft.open = e.target.open;
    e.target.querySelector("summary .act").textContent = e.target.open ? "Close" : "+ Add a lead";
  }, true);
  document.addEventListener("click", function (e) {
    var t = e.target; if (!t.closest) return;
    var lb = t.closest("[data-lead]");
    if (lb) {
      var what = lb.getAttribute("data-lead");
      if (what === "read") readLead(); else if (what === "save") saveLead(); else { leadDraft = { open: true }; drawLead(); }
      return;
    }
    var fb = t.closest("[data-deal-filter]");
    if (fb) { dealFilter = fb.getAttribute("data-deal-filter"); applyDealFilter(); return; }
    if (t.closest("[data-deal-sort]")) { dealSort = dealSort === "best" ? "new" : "best"; applyDealFilter(); return; }
    var card = t.closest("details.deal"); if (!card) return;
    var mb = t.closest(".seg [data-method]");
    if (mb) {
      [].forEach.call(mb.parentNode.children, function (b) { b.setAttribute("aria-pressed", String(b === mb)); });
      card.querySelector('[data-for="targetProfit"]').hidden = mb.getAttribute("data-method") === "70";
      dealDirty(card);
      return;
    }
    var lb2 = t.closest(".seg [data-level]");
    if (lb2) {
      [].forEach.call(lb2.parentNode.children, function (b) { b.setAttribute("aria-pressed", String(b === lb2)); });
      dealDirty(card);
      return;
    }
    if (t.closest("[data-deal-save]")) { saveDeal(card); return; }
    if (t.closest("[data-x-rm]")) { t.closest("[data-xrow]").remove(); dealDirty(card); return; }

    var cp = t.closest("[data-gc-copy]");
    if (cp) {
      var inp = cp.parentNode.querySelector("input"), ok = false;
      inp.focus(); inp.select(); inp.setSelectionRange(0, inp.value.length);
      try { ok = document.execCommand("copy"); } catch (x) {}
      if (!ok && navigator.clipboard) navigator.clipboard.writeText(inp.value).catch(function () {});
      cp.textContent = "Copied"; setTimeout(function () { cp.textContent = "Copy"; }, 1500);
      return;
    }
    // Texting the GC: let Messages open, and move a new lead to "Sent to GC".
    var pv = t.closest("[data-gc-preview]");
    if (pv) {
      if (card.querySelector("[data-deal-save]").disabled) return; // nothing unsaved: the link opens as usual
      e.preventDefault();
      var w = window.open("about:blank", "_blank"), url = pv.href;
      saveDeal(card, null, function () { if (w) w.location.href = url; else window.open(url, "_blank"); });
      return;
    }
    // Unsaved rehab lines get saved too, so the GC sees them when he opens the link.
    if (t.closest("[data-gc-text]")) {
      if (card.querySelector("[data-deal-status]").value === "New") saveDeal(card, { status: "Sent to GC" });
      else if (!card.querySelector("[data-deal-save]").disabled) saveDeal(card);
    }
  });

  function todoCard(d) {
    var alloc = d.allocate || [], todos = d.todos || [];
    var openTodos = todos.filter(function (t) { return !t.done; }), doneTodos = todos.filter(function (t) { return t.done; });
    var h = '<section class="card o-todo"><h2>To-dos</h2><p class="sub">Shared between owners. Saved in the P&amp;L\'s "Owner To-dos" tab.</p>';
    if (alloc.length) {
      h += '<div class="h3">To allocate (' + money(alloc.reduce(function (t, a) { return t + a.amount; }, 0)) + ")</div>" +
        alloc.map(allocCard).join("") +
        '<p class="sub" style="margin:4px 0 0">Pick a house and tap Move: it comes out of General Business and goes into that house\'s column for the same month in the P&amp;L, with a note on both cells. Once nothing\'s left, it drops off this list.</p>';
    }
    h += '<div class="h3">Tasks</div>';
    h += openTodos.length ? openTodos.map(todoRow).join("") : '<p class="empty">Nothing open.</p>';
    h += '<form class="todo-add" id="todoForm"><input type="text" id="todoText" placeholder="Add a to-do…" maxlength="300" aria-label="New to-do">' +
      '<select id="todoWho" aria-label="For"><option value="">Anyone</option>' + teamInfo(d).names.map(function (n) { return "<option>" + esc(n) + "</option>"; }).join("") + "</select>" +
      '<input type="date" id="todoDue" aria-label="Due date"><button type="submit">Add</button></form>';
    if (doneTodos.length) h += '<details style="margin-top:10px"><summary class="linkbtn">Done (' + doneTodos.length + ")</summary>" + doneTodos.map(todoRow).join("") + "</details>";
    return h + "</section>";
  }
  // One TO ALLOCATE cell: its line items, each with a house picker, plus a box for any other amount.
  function allocCard(a) {
    var key = a.cell;
    var houses = function (sel) {
      return '<select data-alloc-col aria-label="House"><option value="">House…</option>' + (a.columns || []).map(function (c) { return "<option" + (c === sel ? " selected" : "") + ">" + esc(c) + "</option>"; }).join("") +
        '<option value="__off">Billed back / not a P&amp;L cost</option></select>';
    };
    var open = allocOpen === key;
    var h = '<details class="alloc" data-cell="' + esc(key) + '"' + (open ? " open" : "") + '><summary><span><b>' + esc(a.section.replace(/^Operating /, "").replace("Utilties", "Utilities")) + " · " + esc(a.month) + '</b><br><span class="m" style="color:var(--muted);font-size:12.5px">' + esc(a.column) + " · " + esc(a.cell) + "</span></span><span>" + money(a.amount, true) + " left</span></summary>";
    var items = a.items || [];
    if (items.length) {
      h += '<div class="alloc-items">' + items.map(function (it) {
        if (it.done) return '<div class="ai done"><span>' + esc(it.label) + '</span><span class="m">' + money(it.amount, true) + " → " + esc(it.done) + "</span></div>";
        return '<div class="ai" data-item="' + it.i + '"><span>' + esc(it.label) + ' <b>' + money(it.amount, true) + "</b></span>" + houses("") + '<button type="button" class="act primary" data-alloc-move>Move</button></div>';
      }).join("") + "</div>";
    } else if (a.detail) h += "<p>" + esc(a.detail) + "</p>";
    h += '<div class="ai other" data-item="-1"><span class="money"><span>$</span><input type="text" inputmode="decimal" data-alloc-amt placeholder="Other amount" aria-label="Amount"></span>' + houses("") + '<button type="button" class="act" data-alloc-move>Move</button></div>';
    if ((a.moved || []).length) h += '<p class="m" style="margin:8px 0 0">' + a.moved.map(esc).join("<br>") + "</p>";
    return h + "</details>";
  }
  var allocOpen = "";
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-alloc-move]");
    if (!b) return;
    var row = b.closest(".ai"), card = b.closest("details.alloc");
    var col = row.querySelector("[data-alloc-col]").value, item = +row.getAttribute("data-item");
    var amt = item < 0 ? numIn(row.querySelector("[data-alloc-amt]").value, true) : null;
    if (!col) { window.alert("Pick a house first."); return; }
    if (item < 0 && !(amt > 0)) { window.alert("Type the amount to move."); return; }
    b.disabled = true; b.textContent = "Moving…";
    allocOpen = card.getAttribute("data-cell");
    FundAPI.run.withSuccessHandler(function () { load(); }).withFailureHandler(function (err) { b.disabled = false; b.textContent = "Move"; window.alert(errText(err)); })
      .allocateCell(card.getAttribute("data-cell"), item, amt, col);
  });

  function projectsCard(d) {
    var ps = d.projects || [];
    if (!ps.length) return "";
    return '<section class="card o-todo"><h2>Work in progress</h2><p class="sub">From the P&amp;L\'s "Owner Projects" tab. Check Done there once it closes.</p>' +
      ps.map(function (p) {
        var costs = p.agent + p.concessions + p.other;
        var beforePayoff = p.price - costs;
        var gain = p.invested ? p.price - costs - p.invested : null;
        var close = parseDate(p.close);
        var days = close ? Math.round((close - new Date(new Date().toDateString())) / 864e5) : null;
        var r = function (l, v, cls) { return '<tr class="' + (cls || "") + '"><td>' + l + "</td><td>" + v + "</td></tr>"; };
        return '<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;gap:10px;align-items:baseline"><b style="font:700 17px var(--serif)">' + esc(p.name) + "</b>" +
          (close ? '<span class="pill ' + (days != null && days < 0 ? "neg" : "mid") + '">' + (days < 0 ? "Was " : "Closing ") + fmtDate(close) + "</span>" : "") + "</div>" +
          '<p class="sub" style="margin:4px 0 8px">' + esc(p.status) + "</p>" +
          '<table class="proj" style="font-size:14px"><tbody>' +
          r("Sale price", money(p.price)) +
          r("Buyer agent + concessions" + (p.other ? " + other costs" : ""), "−" + money(costs)) +
          r("To the Fund before loan payoff", money(beforePayoff), "sum") +
          (p.payoff ? r("Loan payoff", "−" + money(p.payoff)) + r("Cash to the Fund", money(beforePayoff - p.payoff), "pl") : r("Loan payoff", '<span style="color:var(--muted)">add from payoff letter</span>')) +
          (gain != null ? r("Gain vs. " + money(p.invested) + " invested", money(gain), gain < 0 ? "" : "") : "") +
          "</tbody></table>" +
          (p.other ? "" : '<p class="sub" style="margin:8px 0 0">Title fees and other closing costs aren\'t in yet, so the final numbers will be a little lower.</p>') +
          "</div>";
      }).join("") + "</section>";
  }

  function todoRow(t) {
    var due = parseDate(t.due);
    var late = due && !t.done && due < new Date(new Date().toDateString());
    return '<label class="todo' + (t.done ? " done" : "") + '"><input type="checkbox" data-row="' + t.row + '"' + (t.done ? " checked" : "") + '><span><span class="t">' + esc(t.task) + '</span><br><span class="m">' +
      [t.who ? "<b>For " + esc(t.who) + "</b>" : "", t.by ? "Added by " + esc(t.by) : "", due ? '<span style="' + (late ? "color:var(--neg);font-weight:600" : "") + '">Due ' + fmtDate(due) + "</span>" : "", t.notes ? esc(t.notes) : ""].filter(Boolean).join(" · ") + "</span></span></label>";
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-inbox-done]");
    if (!b) return;
    b.disabled = true; b.textContent = "Saving…";
    FundAPI.run.withSuccessHandler(load).withFailureHandler(function (err) { b.disabled = false; b.textContent = "Handled"; window.alert((err && err.message) || err); }).setInboxStatus(+b.getAttribute("data-inbox-done"), "Handled");
  });
  document.addEventListener("change", function (e) {
    var sel = e.target.closest && e.target.closest("select[data-note-row]");
    if (sel) {
      sel.disabled = true;
      FundAPI.run.withSuccessHandler(load).withFailureHandler(function (err) { sel.disabled = false; window.alert((err && err.message) || err); }).setRentalNoteStatus(+sel.getAttribute("data-note-row"), sel.value);
      return;
    }
    var cb = e.target.closest && e.target.closest(".todo input[type=checkbox]");
    if (!cb) return;
    cb.disabled = true;
    FundAPI.run.withSuccessHandler(load).withFailureHandler(function (err) { cb.disabled = false; cb.checked = !cb.checked; alertBox(err); }).setTodoDone(+cb.getAttribute("data-row"), cb.checked);
  });
  document.addEventListener("submit", function (e) {
    if (e.target.classList.contains("note-add")) {
      e.preventDefault();
      var inp = e.target.querySelector("input"), txt = inp.value.trim(); if (!txt) return;
      var nbtn = e.target.querySelector("button"); nbtn.disabled = true; nbtn.textContent = "Adding…";
      FundAPI.run.withSuccessHandler(load).withFailureHandler(function (err) { nbtn.disabled = false; nbtn.textContent = "Add"; window.alert((err && err.message) || err); })
        .addRentalNote(e.target.getAttribute("data-unit"), e.target.getAttribute("data-name"), txt, "Open");
      return;
    }
    if (e.target.id === "cashForm") {
      e.preventDefault();
      var v = $("cashAmt").value.replace(/[$,\s]/g, ""); if (!v) return;
      var b = e.target.querySelector("button"); b.disabled = true; b.textContent = "Saving…";
      FundAPI.run.withSuccessHandler(load).withFailureHandler(function (err) { b.disabled = false; b.textContent = "Update"; window.alert((err && err.message) || err); }).addBalance(v, "");
      return;
    }
    if (e.target.id !== "todoForm") return;
    e.preventDefault();
    var t = $("todoText").value.trim(); if (!t) return;
    var btn = e.target.querySelector("button"); btn.disabled = true; btn.textContent = "Adding…";
    FundAPI.run.withSuccessHandler(load).withFailureHandler(function (err) { btn.disabled = false; btn.textContent = "Add"; alertBox(err); }).addTodo(t, $("todoDue").value, $("todoWho") ? $("todoWho").value : "");
  });
  function alertBox(err) {
    var f = $("todoForm"); if (!f) return;
    var p = document.createElement("p"); p.className = "err"; p.style.marginTop = "8px"; p.textContent = (err && err.message) || String(err);
    f.after(p); setTimeout(function () { p.remove(); }, 6000);
  }

  var REFRESH_IC = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6"/></svg>';
  document.addEventListener("click", function (e) { if (e.target.closest && e.target.closest("[data-refresh]")) { var b = e.target.closest("[data-refresh]"); b.classList.add("spin"); load(); } });
  function kpi(label, value, hint) { return '<div class="kpi"><div class="l">' + label + '</div><div class="v">' + value + '</div><div class="h">' + hint + "</div></div>"; }

  function chart(inc, out, prof, last) {
    var W = 720, H = 260, padL = 44, padB = 44, padT = 12, n = last + 1;
    var max = Math.max.apply(null, inc.slice(0, n).concat(out.slice(0, n)).concat([1]));
    var step = Math.pow(10, Math.floor(Math.log10(max))), top = Math.ceil(max / step) * step;
    var y = function (v) { return padT + (H - padT - padB) * (1 - v / top); };
    var gw = (W - padL - 8) / n, bw = Math.min(22, gw * 0.32);
    var s = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Monthly income versus outgoing">';
    for (var t = 0; t <= 4; t++) {
      var v = top * t / 4, yy = y(v);
      s += '<line x1="' + padL + '" x2="' + W + '" y1="' + yy + '" y2="' + yy + '" stroke="#E3E5EC"/>';
      s += '<text x="' + (padL - 6) + '" y="' + (yy + 4) + '" text-anchor="end" font-size="11" fill="#8a8e9c">' + short(v) + "</text>";
    }
    for (var i = 0; i < n; i++) {
      var cx = padL + gw * i + gw / 2;
      s += '<rect x="' + (cx - bw - 1) + '" y="' + y(inc[i]) + '" width="' + bw + '" height="' + (y(0) - y(inc[i])) + '" rx="3" fill="#151A33"><title>' + MONTHS[i] + " income " + money(inc[i]) + "</title></rect>";
      s += '<rect x="' + (cx + 1) + '" y="' + y(out[i]) + '" width="' + bw + '" height="' + (y(0) - y(out[i])) + '" rx="3" fill="#B9BDCC"><title>' + MONTHS[i] + " going out " + money(out[i]) + "</title></rect>";
      s += '<text x="' + cx + '" y="' + (H - padB + 16) + '" text-anchor="middle" font-size="12" fill="#5d6273">' + MONTHS[i] + "</text>";
      s += '<text x="' + cx + '" y="' + (H - padB + 32) + '" text-anchor="middle" font-size="11.5" font-weight="700" fill="' + (prof[i] < 0 ? "#B3392C" : "#1D7A50") + '">' + short(prof[i]) + "</text>";
    }
    return s + "</svg>";
  }

  function fail(e) {
    if (e && e.auth) return; // the sign-in screen has taken over
    var api = (window.FUND_PORTAL || {}).API_URL || "";
    var net = e && e.network && api;
    $("app").innerHTML = '<div class="wrap"><div class="err" style="margin-top:32px"><b>Couldn\'t load the dashboard.</b><br>' + esc(e && e.message ? e.message : e) +
      (net ? '<br><br><a href="' + esc(api + "?ping=1") + '" target="_blank" rel="noopener" style="color:inherit;font-weight:600">Check the server</a> · <a href="" style="color:inherit;font-weight:600">Try again</a><br><small>If the check shows a Google sign-in or error page instead of “The Fund server is running,” that page is the problem.</small>' : "") +
      "</div></div>";
  }


  var cents = function (n) { return "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  // ---------- shared: who's on the team, and group texts that always include the other owners ----------
  function teamInfo(d) {
    var me = String(d.user || "").toLowerCase();
    var owners = (d.portfolio && d.portfolio.owners) || [];
    var meOwner = owners.filter(function (o) { return String(o.email).toLowerCase() === me; })[0];
    var others = owners.filter(function (o) { return o !== meOwner; });
    return {
      me: (d.team && d.team.me) || (meOwner ? firstName(meOwner.name) : firstName(me.split("@")[0])),
      names: (d.team && d.team.names) || owners.map(function (o) { return firstName(o.name); }),
      others: others,
      otherPhones: others.map(function (o) { return digits(o.phone); }).filter(Boolean),
      otherNames: joinNames(others.map(function (o) { return firstName(o.name); })),
    };
  }
  // A group text to a unit's tenants plus the other owners. "" when there's no tenant phone.
  function tenantText(d, ts, body) {
    var phones = (ts || []).map(function (t) { return digits(t.phone); }).filter(Boolean);
    return phones.length ? smsHref(phones.concat(teamInfo(d).otherPhones), body) : "";
  }
  function tenantGreeting(ts) {
    var f = (ts || []).map(function (t) { return firstName(t.name); }).filter(Boolean);
    return "Hi " + (f.length ? joinNames(f) : "there") + ", ";
  }
  function copyText(text, btn) {
    var done = function () { if (btn) { var was = btn.textContent; btn.textContent = "Copied"; setTimeout(function () { btn.textContent = was; }, 1600); } };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { window.prompt("Copy this:", text); });
    else window.prompt("Copy this:", text);
  }
  // Jump to a tab, optionally opening one rental or deal card there.
  document.addEventListener("click", function (e) {
    var g = e.target.closest && e.target.closest("[data-goto]");
    if (!g) return;
    showTab(g.getAttribute("data-goto"));
    var sel = g.getAttribute("data-open-unit") ? 'details.rent[data-unit="' + g.getAttribute("data-open-unit") + '"]'
      : g.getAttribute("data-open-deal") ? 'details.deal[data-deal="' + g.getAttribute("data-open-deal") + '"]' : g.getAttribute("data-focus");
    if (!sel) return;
    var el = document.querySelector(sel);
    if (!el) return;
    if (el.tagName === "DETAILS") { el.hidden = false; el.open = true; }
    setTimeout(function () { el.scrollIntoView({ block: "start", behavior: "smooth" }); if (el.focus && el.tagName === "INPUT") el.focus(); }, 30);
  });

  // ---------- Today: everything that needs someone, in one list ----------
  var todayWho = "all";
  try { todayWho = sessionStorage.getItem("todayWho") || "all"; } catch (e) {}
  var LEVELS = [["now", "Needs attention", "neg"], ["soon", "This week", "mid"], ["watch", "Keep an eye on", ""]];

  function todayItems(d, units, today) {
    var T = teamInfo(d), items = [];
    var tenantsBy = {}, unitBy = {};
    (d.tenants || []).forEach(function (t) { (tenantsBy[t.unitId] = tenantsBy[t.unitId] || []).push(t); });
    units.forEach(function (u) { unitBy[u.id] = u; });
    var daysTo = function (s) { var x = parseDate(String(s || "").slice(0, 10)); return x ? Math.round((x - today) / 864e5) : null; };
    var add = function (lvl, kind, title, sub, acts, extra) {
      items.push(Object.assign({ lvl: lvl, kind: kind, title: title, sub: (sub || []).filter(Boolean), acts: acts || "", order: 0 }, extra || {}));
    };
    var go = function (tabId, label, attr) { return '<button type="button" class="act" data-goto="' + tabId + '"' + (attr || "") + ">" + label + "</button>"; };

    // To-dos
    (d.todos || []).filter(function (t) { return !t.done; }).forEach(function (t) {
      var dd = daysTo(t.due);
      add(dd == null ? 2 : dd < 0 ? 0 : dd <= 7 ? 1 : 2, "To-do", t.task,
        [t.who ? "For " + t.who : "", dd == null ? "" : dd < 0 ? '<b class="late">' + Math.abs(dd) + " day" + (dd === -1 ? "" : "s") + " late</b>" : dd === 0 ? "<b>Due today</b>" : "Due " + fmtDate(parseDate(t.due)), t.by ? "added by " + esc(t.by) : ""],
        '<button type="button" class="act" data-todo-done="' + t.row + '">Done</button>', { who: t.who, order: dd == null ? 999 : dd, html: true });
    });

    // Repairs and other notes on a rental
    (d.rentalNotes || []).filter(function (n) { return n.status === "Open" || n.status === "In progress"; }).forEach(function (n) {
      var u = unitBy[n.unitId] || { address: n.unitId, id: n.unitId };
      var age = -(daysTo(n.added) || 0), ts = tenantsBy[n.unitId] || [];
      var lvl = n.status === "Open" ? (age >= 7 ? 0 : 1) : (age >= 21 ? 1 : 2);
      var sms = tenantText(d, ts, tenantGreeting(ts) + "it's " + T.me + " with The Fund" + (T.otherNames ? " (" + T.otherNames + " is on here too)" : "") + ". Following up on: " + n.text + ". ");
      var sel = '<select class="' + (n.status === "Open" ? "s-open" : "s-prog") + '" data-note-row="' + n.row + '" aria-label="Status">' + ["Open", "In progress", "Done"].map(function (st) { return "<option" + (st === n.status ? " selected" : "") + ">" + st + "</option>"; }).join("") + "</select>";
      add(lvl, n.status === "Open" ? "Repair" : "Repair · in progress", n.text,
        [esc(u.address), age > 0 ? (age >= 7 ? '<b class="late">' : "<span>") + "open " + age + " day" + (age === 1 ? "" : "s") + (age >= 7 ? "</b>" : "</span>") : "added today", n.by ? "by " + esc(n.by) : ""],
        sel + (sms ? '<a class="act" href="' + esc(sms) + '">' + IC.text + "Text tenant</a>" : "") + go("tenants", "Open", ' data-open-unit="' + esc(u.id) + '"'),
        { order: -age, html: true });
    });

    // Tenant texts, calls and voicemails from the Braun Real Estate line (filed by the Braun hub)
    (d.tenantInbox || []).filter(function (m) { return m.status !== "Handled"; }).forEach(function (m) {
      var u = unitBy[m.unitId] || { address: m.unit || m.unitId, id: m.unitId };
      var ageH = m.when ? Math.round((Date.now() - new Date(m.when).getTime()) / 36e5) : 0;
      var ago = ageH < 1 ? "just now" : ageH < 24 ? ageH + "h ago" : Math.round(ageH / 24) + "d ago";
      var hub = m.link ? '<a class="act" href="' + esc(m.link) + '" target="_blank" rel="noopener">Reply</a>' : "";
      add(m.urgent || ageH >= 24 ? 0 : 1, (m.urgent ? "URGENT · " : "") + (m.kind || "Tenant message"), (m.tenant || "Tenant") + " · " + u.address,
        [esc(m.text.length > 180 ? m.text.slice(0, 179) + "…" : m.text), ago],
        hub + '<button type="button" class="act" data-inbox-done="' + m.row + '">Handled</button>' + go("tenants", "Open", ' data-open-unit="' + esc(u.id) + '"'),
        { order: -ageH, html: true });
    });

    // Vacancies and leases
    var m2m = [], noDate = [], missing = [];
    units.forEach(function (u) {
      var ts = tenantsBy[u.id] || [];
      if (u.status !== "leased") {
        var od = daysTo(u.availableDate);
        add(od == null || od <= 14 ? 0 : 1, "Vacancy", u.address, [od == null || od <= 0 ? "Available now" : "Opens " + fmtDate(parseDate(u.availableDate)), u.askingRent ? money(u.askingRent) + "/mo" : "No asking rent set"],
          go("tenants", "Open", ' data-open-unit="' + esc(u.id) + '"'), { order: od || 0 });
        return;
      }
      if (!ts.length) missing.push(u);
      if (u.leaseEnds === "month-to-month") { m2m.push(u); return; }
      var dl = daysTo(u.leaseEnds);
      if (dl == null) { noDate.push(u); return; }
      if (dl > 90) return;
      var end = fmtDate(parseDate(u.leaseEnds));
      var renew = tenantText(d, ts, tenantGreeting(ts) + "it's " + T.me + " with The Fund" + (T.otherNames ? " (" + T.otherNames + " is on here too)" : "") + ". Your lease at " + u.address + " is up " + end + ". We'd love to have you stay. Are you planning to renew? Let us know either way so we can plan ahead. Thanks!");
      add(dl <= 30 ? 0 : dl <= 60 ? 1 : 2, "Lease ending", u.address,
        [dl < 0 ? '<b class="late">Ended ' + end + "</b>" : "Ends " + end + " (" + dl + " days)", ts.length ? esc(ts.map(function (t) { return t.name; }).join(" & ")) : "", "Renew or list?"],
        (renew ? '<a class="act" href="' + esc(renew) + '">' + IC.text + "Ask about renewing</a>" : "") + go("tenants", "Open", ' data-open-unit="' + esc(u.id) + '"'), { order: dl, html: true });
    });
    if (missing.length) add(2, "Tenants", missing.length + " leased unit" + (missing.length > 1 ? "s have" : " has") + " no tenant entered", [missing.map(function (u) { return u.address; }).join(", ")], go("tenants", "See them"));
    if (noDate.length) add(2, "Leases", noDate.length + " lease" + (noDate.length > 1 ? "s have" : " has") + " no end date on the site", [noDate.map(function (u) { return u.address; }).join(", ")], "");
    if (m2m.length) add(2, "Leases", m2m.length + " month-to-month", [m2m.map(function (u) { return u.address; }).join(", ")], "");

    // Deals
    (DEALS.list || []).forEach(function (x) {
      if (dealDone(x.status)) return;
      var M = dealMath(x), C = compCheck(x), at = ' data-open-deal="' + esc(x.id) + '"';
      var arvFlag = C.n && C.diff != null && C.diff > 0.1;
      var sub = [x.asking ? "Asking " + money(x.asking) : "", M.ready ? (M.word ? M.word + ", " : "") + (M.max > 0 ? "max " + money(M.max) : "no price works") : "", arvFlag ? "ARV " + pct(C.diff) + " over comps" : ""];
      if (x.status === "Bid in") add(0, "Bid in", (DEALS.gcName || "GC") + "'s numbers are in: " + (x.address || x.id), sub, go("deals", "Review", at), { order: 0 });
      else if (x.status === "New") add(arvFlag ? 0 : 1, arvFlag ? "New lead · ARV looks high" : "New lead", x.address || "No address yet", sub, go("deals", "Open", at), { order: 1 });
      else if (arvFlag && (x.status === "Sent to GC")) add(1, "ARV looks high", x.address || x.id, sub, go("deals", "Open", at));
    });

    // Bills and money
    var U = d.utilities || {}, waiting = (U.bills || []).filter(function (b) { return !b.status; });
    waiting.forEach(function (b) {
      if (!b.column) add(0, "Bill · account not on your list", (b.utility || "Utility") + " bill" + (b.amount ? " for " + cents(b.amount) : ""), [b.account ? "Account " + b.account : "", b.date ? fmtDate(parseDate(b.date)) : ""], go("expenses", "Match it to a house"));
      else if (b.amount == null) add(1, "Bill needs an amount", b.utility + " · " + b.column, [b.date ? fmtDate(parseDate(b.date)) : "", "Couldn't read the amount from the email"], go("expenses", "Add amount"));
      else add(1, "Bill to post", b.utility + " " + cents(b.amount) + " → " + b.column, [b.date ? "Billed " + fmtDate(parseDate(b.date)) : "", b.source],
        '<button type="button" class="act primary" data-bill-post="' + b.row + '" data-amount="' + b.amount + '">Post to P&amp;L</button><button type="button" class="act" data-bill-ignore="' + b.row + '">Ignore</button>');
    });
    if (!U.error && !(U.accounts || []).length) add(2, "Set up", "Add your utility account numbers", ["Then bills split to each house on their own"], go("expenses", "Add accounts"));
    var alloc = d.allocate || [];
    if (alloc.length) add(1, "To allocate", money(alloc.reduce(function (t, a) { return t + a.amount; }, 0)) + " in the P&L not split to a house yet", [alloc.length + " cell" + (alloc.length > 1 ? "s" : "") + " marked TO ALLOCATE"], go("todos", "See them"));
    var bs = d.balances || [], b0 = bs[bs.length - 1], bAge = b0 ? -daysTo(b0.asOf) : null;
    if (!b0 || bAge > 14) add(1, "Cash", b0 ? "Checking balance is " + bAge + " days old" : "No checking balance entered", ["Update it so cash on hand is right"], '<button type="button" class="act" data-focus-cash>Update</button>');

    items.sort(function (a, b) { return a.lvl - b.lvl || a.order - b.order; });
    return items;
  }

  function todayCard(d, items) {
    var T = teamInfo(d);
    var units = (d.portfolio && d.portfolio.units) || [];
    var counts = LEVELS.map(function (L, i) { return items.filter(function (x) { return x.lvl === i; }).length; });
    var h = '<section class="card today"><div class="today-head"><div><h2>Today</h2><p class="sub">' +
      (counts[0] ? "<b>" + counts[0] + "</b> need" + (counts[0] === 1 ? "s" : "") + " attention" : "Nothing urgent") + (counts[1] ? " · " + counts[1] + " this week" : "") + (counts[2] ? " · " + counts[2] + " to keep an eye on" : "") + ".</p></div>" +
      '<span class="seg" role="group" aria-label="Whose items"><button type="button" data-who="all" aria-pressed="' + (todayWho === "all") + '">Everyone</button><button type="button" data-who="mine" aria-pressed="' + (todayWho === "mine") + '">Mine</button></span></div>';
    // Quick add: a to-do (for anyone, or one person) or a repair at a house.
    h += '<form class="qadd" id="qaddForm"><input type="text" id="qaddText" maxlength="300" placeholder="Add a to-do or repair…" aria-label="New to-do or repair">' +
      '<select id="qaddWhere" aria-label="What kind">' +
      '<optgroup label="To-do"><option value="todo:">To-do · anyone</option>' + T.names.map(function (n) { return '<option value="todo:' + esc(n) + '"' + (n === T.me ? "" : "") + ">To-do · " + esc(n) + "</option>"; }).join("") + "</optgroup>" +
      (units.length ? '<optgroup label="Repair or note at">' + units.map(function (u) { return '<option value="unit:' + esc(u.id) + '" data-name="' + esc(u.name) + '">' + esc(u.address) + "</option>"; }).join("") + "</optgroup>" : "") +
      '</select><input type="date" id="qaddDue" aria-label="Due date (to-dos)"><button type="submit">Add</button></form>';
    if (!items.length) return h + '<p class="empty" style="margin-top:14px">All clear. Nothing open anywhere.</p></section>';
    LEVELS.forEach(function (L, i) {
      var xs = items.filter(function (x) { return x.lvl === i; });
      if (!xs.length) return;
      h += '<div class="t-group"><div class="t-label"><span class="dot ' + L[2] + '"></span>' + L[1] + " <span>" + xs.length + "</span></div>";
      h += xs.map(function (x) {
        var mine = !x.who || x.who.toLowerCase() === String(T.me).toLowerCase();
        return '<div class="ti" data-mine="' + (mine ? 1 : 0) + '"><div class="ti-main"><span class="k">' + esc(x.kind) + "</span><b>" + esc(x.title) + "</b>" +
          (x.sub.length ? '<span class="m">' + x.sub.map(function (s) { return x.html ? s : esc(s); }).join(" · ") + "</span>" : "") + "</div>" +
          (x.acts ? '<div class="ti-acts">' + x.acts + "</div>" : "") + "</div>";
      }).join("") + "</div>";
    });
    return h + "</section>";
  }
  function applyTodayFilter() {
    [].forEach.call(document.querySelectorAll(".ti"), function (x) { x.hidden = todayWho === "mine" && x.getAttribute("data-mine") !== "1"; });
    [].forEach.call(document.querySelectorAll("[data-who]"), function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-who") === todayWho)); });
  }
  document.addEventListener("click", function (e) {
    var t = e.target; if (!t.closest) return;
    var w = t.closest("[data-who]");
    if (w) { todayWho = w.getAttribute("data-who"); try { sessionStorage.setItem("todayWho", todayWho); } catch (x) {} applyTodayFilter(); return; }
    var td = t.closest("[data-todo-done]");
    if (td) { td.disabled = true; td.textContent = "…"; FundAPI.run.withSuccessHandler(load).withFailureHandler(function (err) { td.disabled = false; td.textContent = "Done"; window.alert(errText(err)); }).setTodoDone(+td.getAttribute("data-todo-done"), true); return; }
    if (t.closest("[data-focus-cash]")) { window.scrollTo({ top: 0, behavior: "smooth" }); var c = $("cashAmt"); if (c) setTimeout(function () { c.focus(); }, 300); return; }
  });
  document.addEventListener("submit", function (e) {
    if (e.target.id !== "qaddForm") return;
    e.preventDefault();
    var txt = $("qaddText").value.trim(); if (!txt) return;
    var sel = $("qaddWhere"), v = sel.value, btn = e.target.querySelector("button");
    btn.disabled = true; btn.textContent = "Adding…";
    var bad = function (err) { btn.disabled = false; btn.textContent = "Add"; window.alert(errText(err)); };
    if (v.indexOf("unit:") === 0) FundAPI.run.withSuccessHandler(load).withFailureHandler(bad).addRentalNote(v.slice(5), sel.options[sel.selectedIndex].getAttribute("data-name"), txt, "Open");
    else FundAPI.run.withSuccessHandler(load).withFailureHandler(bad).addTodo(txt, $("qaddDue").value, v.slice(5));
  });
  document.addEventListener("change", function (e) {
    if (e.target.id === "qaddWhere") { var due = $("qaddDue"); if (due) due.hidden = e.target.value.indexOf("unit:") === 0; }
  });

  // ---------- Comps: sold sales by zip, and an ARV check on every deal ----------
  var COMPS = { list: [] };
  var compDraft = null;   // pasted comps waiting to be saved: { rows, msg }
  function zipOf(addr) {
    var m = String(addr || "").match(/\b\d{5}(?:-\d{4})?\b/g) || [];
    if (!m.length) return "";
    return m.length === 1 && String(addr).trim().indexOf(m[0]) === 0 ? "" : m[m.length - 1].slice(0, 5);
  }
  function quant(a, p) { if (!a.length) return 0; var i = (a.length - 1) * p, lo = Math.floor(i); return a[lo] + (a[Math.min(a.length - 1, lo + 1)] - a[lo]) * (i - lo); }
  var ppsf = function (xs) { return xs.map(function (c) { return c.price / c.sqft; }).sort(function (a, b) { return a - b; }); };
  function compCutoff() { var c = new Date(); c.setMonth(c.getMonth() - (COMPS.months || 12)); return c.toISOString().slice(0, 10); }
  function areaName(zip) { var n = (COMPS.areaNames || {})[zip]; return n ? zip + " · " + n : zip; }

  // What similar sold houses say the ARV is. Same math as the Apps Script's compArv_:
  // same zip, last 12 months, similar size (±25%) when there are at least 3 of those,
  // priced at the renovated sales' median $/sq ft (or the top quarter of all sales if fewer than 2 are marked Renovated).
  // Miles between two points.
  function miles(aLat, aLon, bLat, bLon) {
    var r = Math.PI / 180, x = Math.sin((bLat - aLat) * r / 2), y = Math.sin((bLon - aLon) * r / 2);
    return 3958.8 * 2 * Math.asin(Math.sqrt(x * x + Math.cos(aLat * r) * Math.cos(bLat * r) * y * y));
  }
  function compCheck(d) {
    var zip = zipOf(d.address), sqft = +d.sqft || 0, list = COMPS.list || [];
    if (!zip && !(d.lat && d.lon)) return { n: 0, reason: "Put the zip on the address (saving the deal looks it up) to check it against comps." };
    if (!sqft) return { n: 0, zip: zip, reason: "Add the square footage to check it against comps." };
    var cut = compCutoff(), band = COMPS.band || 0.25;
    var recent = list.filter(function (c) { return !c.sold || c.sold >= cut; });
    // Near the house when we know where it is: within the comp radius, twice that if fewer than 3 sales. Otherwise the same zip.
    var radius = (DEALS.compRadius || 0.75), area = null, pool = [];
    if (d.lat && d.lon) {
      recent.forEach(function (c) { c.dist = c.lat && c.lon ? miles(d.lat, d.lon, c.lat, c.lon) : null; });
      pool = recent.filter(function (c) { return c.dist != null && c.dist <= radius; });
      if (pool.length < 3) { radius *= 2; pool = recent.filter(function (c) { return c.dist != null && c.dist <= radius; }); }
      if (pool.length) area = "within " + radius + " mi";
    }
    if (!area) {
      if (!zip) return { n: 0, reason: "No sold comps near this house yet." };
      pool = recent.filter(function (c) { return c.zip === zip; });
      area = "in " + areaName(zip);
    }
    var near = pool.filter(function (c) { return Math.abs(c.sqft / sqft - 1) <= band; });
    var use = near.length >= 3 ? near : pool;
    if (!use.length) return { n: 0, zip: zip, reason: "No sold comps " + (zip ? "in " + areaName(zip) : "near this house") + " yet." };
    var reno = use.filter(function (c) { return c.condition === "Renovated"; });
    var rate = reno.length >= 2 ? quant(ppsf(reno), 0.5) : quant(ppsf(use), 0.75);
    var arv = Math.round(rate * sqft / 500) * 500;
    var arvNow = +d.arv || 0;
    return {
      zip: zip, area: area, n: use.length, renoN: reno.length, rate: rate, median: quant(ppsf(use), 0.5), arv: arv,
      basis: reno.length >= 2 ? "median of " + reno.length + " renovated sales" : "top quarter of sales (mark flips Renovated for a sharper number)",
      sameSize: use === near, thin: use.length < 3, diff: arvNow ? (arvNow - arv) / arv : null,
      comps: use.slice().sort(function (a, b) { return Math.abs(a.sqft - sqft) - Math.abs(b.sqft - sqft) || (a.sold < b.sold ? 1 : -1); }).slice(0, 8),
    };
  }
  function compHtml(d) {
    var C = compCheck(d);
    var h = '<div class="h3"><span>Comps check</span><span class="m">' + (C.zip ? areaName(C.zip) : "") + "</span></div>";
    var pull = DEALS.rentcast
      ? '<div class="acts" style="margin-top:8px"><button type="button" class="act" data-pull-comps>Pull sold comps</button><span class="m" style="align-self:center">County-recorded sales near this house, last ' + (COMPS.months || 12) + " months · " + (DEALS.rentcastUsed || 0) + " of " + (DEALS.rentcastLimit || 50) + " lookups used this month</span></div>"
      : '<p class="m" style="margin:8px 0 0">Add a free RentCast key to pull county-recorded sales near any house with one tap (setup in the README).</p>';
    if (!C.n) return h + '<p class="m" style="margin:0">' + esc(C.reason) + "</p>" + pull;
    var their = +d.arv || 0, ws = +d.wsArv || 0;
    var cls = C.diff == null ? "mid" : C.diff > 0.1 ? "neg" : C.diff > 0.03 ? "mid" : "pos";
    var word = C.diff == null ? "No ARV on the deal yet." : Math.abs(C.diff) <= 0.03 ? "The ARV is in line with comps." : C.diff > 0 ? "The ARV is " + pct(C.diff) + " over what comps support." : "The ARV is " + pct(-C.diff) + " under comps (conservative).";
    h += '<div class="compbox"><div class="comp-nums"><div><span class="l">Comps ARV</span><b>' + money(C.arv) + '</b></div><div><span class="l">$/sq ft</span><b>$' + Math.round(C.rate) + '</b></div><div><span class="l">Deal ARV</span><b>' + (their ? money(their) : "—") + "</b></div>" +
      (ws && ws !== their ? '<div><span class="l">Wholesaler said</span><b>' + money(ws) + "</b></div>" : "") + "</div>" +
      '<div class="verdict ' + cls + '">' + esc(word) + "</div>" +
      '<p class="m" style="margin:8px 0 0">' + C.n + " sale" + (C.n > 1 ? "s" : "") + " " + esc(C.area) + " from the last " + (COMPS.months || 12) + " months" + (C.sameSize ? ", similar size" : ", all sizes (fewer than 3 similar-size sales)") + "; priced at the " + esc(C.basis) + "." + (C.thin ? " <b>Thin:</b> add more comps before leaning on this." : "") + "</p>";
    var showDist = C.comps.some(function (c) { return c.dist != null; });
    h += '<div class="tbl-wrap"><table class="comps-t"><thead><tr><th>Sold comp</th>' + (showDist ? "<th>Miles</th>" : "") + '<th>Sold</th><th>Price</th><th>Sq ft</th><th>$/sq ft</th><th>Condition</th></tr></thead><tbody>' +
      C.comps.map(function (c) { return '<tr title="' + esc(c.notes || "") + '"><td>' + esc(c.address.split(",")[0]) + "</td>" + (showDist ? "<td>" + (c.dist != null ? c.dist.toFixed(2) : "—") + "</td>" : "") + "<td>" + (c.sold ? esc(c.sold.slice(5).replace("-", "/") + "/" + c.sold.slice(2, 4)) : "—") + "</td><td>" + money(c.price) + "</td><td>" + c.sqft.toLocaleString("en-US") + "</td><td>$" + Math.round(c.price / c.sqft) + "</td><td>" + esc(c.condition || "—") + "</td></tr>"; }).join("") + "</tbody></table></div>";
    h += '<div class="acts">' + (their !== C.arv ? '<button type="button" class="act primary" data-use-comps="' + C.arv + '">Use comps ARV (' + short(C.arv) + ")</button>" : "") +
      (C.diff != null && C.diff > 0.03 ? '<button type="button" class="act" data-pushback>Copy pushback text</button>' : "") + "</div></div>";
    return h + pull;
  }
  // A short, friendly counter for the wholesaler, built from the comps and your max offer at the comps ARV.
  function pushbackText(d) {
    var C = compCheck(d);
    var M = dealMath(Object.assign({}, d, { arv: C.arv }));
    var addr = String(d.address || "this one").split(",")[0];
    return "Thanks for sending " + addr + ". The ARV feels high to me. Renovated houses " + C.area + " have sold around $" + Math.round(C.rate) + "/sq ft over the last " + (COMPS.months || 12) + " months (" + C.n + " sales), which puts this one (" + Number(d.sqft).toLocaleString("en-US") + " sq ft) near " + money(C.arv) + (d.arv ? ", not " + money(d.arv) : "") + "." +
      (M.max > 0 ? " At that ARV the most I can do is " + money(M.max) + ". Would the seller take that?" : " At that ARV the numbers don't work for me at this price.");
  }
  document.addEventListener("click", function (e) {
    var t = e.target; if (!t.closest) return;
    var uc = t.closest("[data-use-comps]");
    if (uc) {
      var card = uc.closest("details.deal"), id = card.getAttribute("data-deal");
      var orig = (DEALS.list || []).filter(function (x) { return x.id === id; })[0] || {};
      var inp = card.querySelector('[data-f="arv"]'); inp.value = Number(uc.getAttribute("data-use-comps")).toLocaleString("en-US");
      dealDirty(card);
      saveDeal(card, orig.wsArv == null && orig.arv ? { wsArv: orig.arv } : {});
      return;
    }
    var pc = t.closest("[data-pull-comps]");
    if (pc) {
      var pcard = pc.closest("details.deal");
      pc.disabled = true; pc.textContent = "Pulling…";
      FundAPI.run.withSuccessHandler(function (r) {
        openDeal = pcard.getAttribute("data-deal");
        window.alert(r.found ? r.found + " sales found nearby, " + r.added + " new" + (r.flips ? " (" + r.flips + " flips marked Renovated)" : "") + ". " + r.used + " of " + r.limit + " lookups used this month." : "No recorded sales nearby in the last " + (COMPS.months || 12) + " months. " + r.used + " of " + r.limit + " lookups used this month.");
        load();
      }).withFailureHandler(function (err) { pc.disabled = false; pc.textContent = "Pull sold comps"; window.alert(errText(err)); }).pullComps(pcard.getAttribute("data-deal"));
      return;
    }
    var pb = t.closest("[data-pushback]");
    if (pb) {
      var c2 = pb.closest("details.deal");
      copyText(pushbackText(collectDealFull(c2)), pb);
    }
  });
  function collectDealFull(card) {
    var id = card.getAttribute("data-deal"), orig = (DEALS.list || []).filter(function (x) { return x.id === id; })[0] || {};
    return Object.assign({}, orig, collectDeal(card).vals);
  }

  // Sold comps card: price per square foot by zip, add one, paste many.
  function compsCard() {
    var list = COMPS.list || [], cut = compCutoff();
    var h = '<section class="card" id="compsCard"><h2>Sold comps</h2><p class="sub">Sold sales you enter by hand (from Zillow, Redfin or an MLS export). Every deal\'s ARV gets checked against these, by zip. Mark flips and redone houses <b>Renovated</b>; that\'s what sets the ARV. Saved in the <b>Owner Comps</b> tab.</p>';
    if (COMPS.error) h += '<p class="err" style="margin-bottom:12px">Couldn\'t open the comps tab: ' + esc(COMPS.error) + "</p>";
    var byZip = {};
    list.forEach(function (c) { if (c.zip && (!c.sold || c.sold >= cut)) (byZip[c.zip] = byZip[c.zip] || []).push(c); });
    var zips = Object.keys(byZip).sort(function (a, b) { return byZip[b].length - byZip[a].length || (a < b ? -1 : 1); });
    if (zips.length) {
      h += '<div class="tbl-wrap"><table><thead><tr><th>Area</th><th>Sales</th><th>Median $/sq ft</th><th>Renovated $/sq ft</th><th>Median price</th><th>Latest sale</th></tr></thead><tbody>' +
        zips.map(function (z) {
          var xs = byZip[z], reno = xs.filter(function (c) { return c.condition === "Renovated"; });
          var latest = xs.map(function (c) { return c.sold; }).filter(Boolean).sort().pop();
          var prices = xs.map(function (c) { return c.price; }).sort(function (a, b) { return a - b; });
          return "<tr><td>" + esc(areaName(z)) + "</td><td>" + xs.length + "</td><td>$" + Math.round(quant(ppsf(xs), 0.5)) + "</td><td>" + (reno.length >= 2 ? "$" + Math.round(quant(ppsf(reno), 0.5)) + ' <span class="m">(' + reno.length + ")</span>" : reno.length ? '<span class="m">1 sale</span>' : "—") + "</td><td>" + money(quant(prices, 0.5)) + "</td><td>" + (latest ? fmtDate(parseDate(latest)) : "—") + "</td></tr>";
        }).join("") + "</tbody></table></div>" +
        '<p class="m" style="margin:6px 0 0">Last ' + (COMPS.months || 12) + " months only.</p>";
    } else h += '<p class="empty">No comps yet. Add a few for the zips you buy in.</p>';

    h += '<div class="h3">Add a sale</div><form class="fields comp-add" id="compAdd">' +
      '<label class="wide">Address (with zip)<input type="text" name="address" placeholder="1422 Oakland St, Fort Wayne, IN 46808" autocomplete="off"></label>' +
      '<label>Sold price<input type="text" name="price" inputmode="decimal" autocomplete="off"></label>' +
      '<label>Sq ft<input type="text" name="sqft" inputmode="numeric" autocomplete="off"></label>' +
      '<label>Sold date<input type="date" name="sold"></label>' +
      '<label>Beds<input type="text" name="beds" inputmode="numeric" autocomplete="off"></label>' +
      '<label>Baths<input type="text" name="baths" inputmode="decimal" autocomplete="off"></label>' +
      '<label>Condition<select name="condition">' + (COMPS.conditions || ["Renovated", "Average", "As-is"]).map(function (c) { return "<option>" + c + "</option>"; }).join("") + "</select></label>" +
      '<label>&nbsp;<button type="submit" class="act primary" style="justify-content:center">Add comp</button></label></form><p class="m" id="compAddMsg"></p>';

    var D = compDraft || {};
    h += '<details class="paste"' + (D.open ? " open" : "") + '><summary class="linkbtn">Paste several at once</summary>' +
      '<p class="m">Copy rows from a spreadsheet or an MLS export (with its header row) and paste them here. Columns it looks for: address, zip, sold price, sq ft, sold date, beds, baths, condition. No header? Use that order.</p>' +
      '<textarea id="compPaste" rows="5" placeholder="Address\tSold price\tSq ft\tSold date\tCondition">' + esc(D.text || "") + "</textarea>" +
      '<div class="save-bar"><button type="button" class="act" data-comp-read>Read it</button>' + (D.rows && D.rows.length ? '<button type="button" class="act primary" data-comp-save>Save ' + D.rows.length + " comp" + (D.rows.length > 1 ? "s" : "") + "</button>" : "") + '<span class="m">' + esc(D.msg || "") + "</span></div>";
    if (D.rows && D.rows.length) h += '<div class="tbl-wrap"><table class="comps-t"><thead><tr><th>Address</th><th>Zip</th><th>Price</th><th>Sq ft</th><th>Sold</th><th>Condition</th></tr></thead><tbody>' +
      D.rows.slice(0, 50).map(function (r) { return "<tr><td>" + esc(r.address) + "</td><td>" + esc(r.zip || "—") + "</td><td>" + money(r.price) + "</td><td>" + r.sqft.toLocaleString("en-US") + "</td><td>" + esc(r.sold || "—") + "</td><td>" + esc(r.condition) + "</td></tr>"; }).join("") + "</tbody></table></div>";
    h += "</details>";

    if (list.length) h += '<details class="paste"><summary class="linkbtn">All comps (' + list.length + ")</summary>" +
      '<div class="tbl-wrap"><table class="comps-t"><thead><tr><th>Address</th><th>Zip</th><th>Sold</th><th>Price</th><th>Sq ft</th><th>$/sq ft</th><th>Condition</th><th></th></tr></thead><tbody>' +
      list.slice().sort(function (a, b) { return a.sold < b.sold ? 1 : -1; }).map(function (c) {
        return '<tr class="' + (c.sold && c.sold < cut ? "old" : "") + '"><td>' + esc(c.address.split(",")[0]) + "</td><td>" + esc(c.zip || "—") + "</td><td>" + esc(c.sold || "—") + "</td><td>" + money(c.price) + "</td><td>" + c.sqft.toLocaleString("en-US") + "</td><td>$" + Math.round(c.price / c.sqft) + "</td><td>" + esc(c.condition || "—") + '</td><td><button type="button" class="x" data-comp-del="' + c.row + '" aria-label="Delete">×</button></td></tr>';
      }).join("") + "</tbody></table></div></details>";
    return h + "</section>";
  }
  function drawComps() { var el = $("compsCard"); if (el) el.outerHTML = compsCard(); }

  function normDate(s) {
    s = String(s || "").trim();
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
    if (m) return m[1] + "-" + ("0" + m[2]).slice(-2) + "-" + ("0" + m[3]).slice(-2);
    m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/.exec(s);
    if (m) { var y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; return y + "-" + ("0" + m[1]).slice(-2) + "-" + ("0" + m[2]).slice(-2); }
    var t = Date.parse(s);
    return isNaN(t) ? "" : new Date(t).toISOString().slice(0, 10);
  }
  function condOf(s) {
    s = String(s || "").toLowerCase();
    if (/renovat|rehab|flip|remodel|updated|redone|new (kitchen|bath|roof)|turnkey/.test(s)) return "Renovated";
    if (/as[- ]?is|needs|fixer|tlc|investor|distress|handyman|cash only/.test(s)) return "As-is";
    return "Average";
  }
  function splitRow(line, sep) {
    if (sep === "\t") return line.split("\t").map(function (x) { return x.trim().replace(/^"(.*)"$/, "$1").replace(/""/g, '"'); });
    var out = [], cur = "", q = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (ch === "," && !q) { out.push(cur.trim()); cur = ""; }
      else cur += ch;
    }
    out.push(cur.trim());
    return out;
  }
  function parseComps(text) {
    var lines = String(text || "").split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
    if (!lines.length) return { rows: [], msg: "Paste some rows first." };
    var sep = lines.some(function (l) { return l.indexOf("\t") >= 0; }) ? "\t" : ",";
    var first = splitRow(lines[0], sep).map(function (h) { return h.toLowerCase(); });
    var head = first.some(function (h) { return /address|street|price|sq|date|zip|bed/.test(h); }) && !first.some(function (h) { return /^\$?\d[\d,]{4,}$/.test(h); });
    var idx = {};
    if (head) {
      first.forEach(function (h, i) {
        if (idx.address == null && /address|street|location|property/.test(h) && !/city|zip/.test(h)) idx.address = i;
        else if (idx.zip == null && /zip|postal/.test(h)) idx.zip = i;
        else if (idx.city == null && /^city/.test(h)) idx.city = i;
        else if (idx.price == null && /price|sold \$|sale amount|close \$/.test(h) && !/list|orig|ask|sq|ft/.test(h)) idx.price = i;
        else if (idx.sqft == null && /sq|living|gla|finished|size|area/.test(h) && !/lot|acre|\$|price/.test(h)) idx.sqft = i;
        else if (idx.sold == null && /date|sold|closed|close/.test(h)) idx.sold = i;
        else if (idx.beds == null && /bed|^br$/.test(h)) idx.beds = i;
        else if (idx.baths == null && /bath|^ba$/.test(h)) idx.baths = i;
        else if (idx.condition == null && /condition|cond|reno|remarks|notes|comment/.test(h)) idx.condition = i;
      });
      lines = lines.slice(1);
    } else idx = { address: 0, price: 1, sqft: 2, sold: 3, beds: 4, baths: 5, condition: 6 };
    if (idx.address == null || idx.price == null || idx.sqft == null) return { rows: [], msg: "Couldn't find the address, sold price and square feet columns. Add a header row with those names." };
    var rows = [], skipped = 0;
    lines.forEach(function (l) {
      var c = splitRow(l, sep), g = function (k) { return idx[k] == null ? "" : c[idx[k]] || ""; };
      var addr = g("address"), zip = String(g("zip")).replace(/\D/g, "").slice(0, 5);
      if (addr && idx.city != null && g("city") && addr.indexOf(g("city")) < 0) addr += ", " + g("city");
      if (addr && zip && !zipOf(addr)) addr += " " + zip;
      var price = numIn(g("price")), sqft = numIn(g("sqft"));
      if (!addr || !(price > 1000) || !(sqft > 100)) { skipped++; return; }
      rows.push({ address: addr, zip: zip || zipOf(addr), price: price, sqft: sqft, sold: normDate(g("sold")), beds: numIn(g("beds")) || "", baths: numIn(g("baths"), true) || "", condition: condOf(g("condition")), source: "Pasted" });
    });
    var noZip = rows.filter(function (r) { return !r.zip; }).length;
    return { rows: rows, msg: rows.length + " ready" + (skipped ? ", " + skipped + " skipped (no address, price or square feet)" : "") + (noZip ? ". " + noZip + " have no zip and won't count toward an area" : "") + "." };
  }
  document.addEventListener("click", function (e) {
    var t = e.target; if (!t.closest) return;
    if (t.closest("[data-comp-read]")) {
      var text = $("compPaste").value, r = parseComps(text);
      compDraft = { text: text, rows: r.rows, msg: r.msg, open: true }; drawComps(); return;
    }
    var sv = t.closest("[data-comp-save]");
    if (sv) {
      sv.disabled = true; sv.textContent = "Saving…";
      FundAPI.run.withSuccessHandler(function (res) {
        compDraft = { open: true, msg: res.added + " saved" + (res.duplicates ? ", " + res.duplicates + " already in the tab" : "") + "." }; load();
      }).withFailureHandler(function (err) { sv.disabled = false; sv.textContent = "Save"; window.alert(errText(err)); }).addComps(compDraft.rows);
      return;
    }
    var del = t.closest("[data-comp-del]");
    if (del && window.confirm("Delete this comp?")) { del.disabled = true; FundAPI.run.withSuccessHandler(load).withFailureHandler(function (err) { del.disabled = false; window.alert(errText(err)); }).deleteComp(+del.getAttribute("data-comp-del")); }
  });
  document.addEventListener("submit", function (e) {
    if (e.target.id !== "compAdd") return;
    e.preventDefault();
    var f = e.target, g = function (n) { return f.elements[n].value.trim(); }, msg = $("compAddMsg");
    var row = { address: g("address"), price: numIn(g("price")), sqft: numIn(g("sqft")), sold: g("sold"), beds: numIn(g("beds")) || "", baths: numIn(g("baths"), true) || "", condition: g("condition") };
    if (!row.address || !(row.price > 1000) || !(row.sqft > 100)) { msg.textContent = "Address, sold price and square feet are needed."; return; }
    if (!zipOf(row.address)) { msg.textContent = "Put the zip on the end of the address so it counts toward an area."; return; }
    var b = f.querySelector("button"); b.disabled = true; b.textContent = "Adding…";
    FundAPI.run.withSuccessHandler(function (res) { compDraft = { msg: "" }; if (!res.added) window.alert("That sale is already in the comps tab."); load(); })
      .withFailureHandler(function (err) { b.disabled = false; b.textContent = "Add comp"; msg.textContent = errText(err); }).addComps([row]);
  });

  // ---------- Expenses: utility bills split to each house by account number ----------
  function expensesPanel(d) {
    var U = d.utilities || {}, bills = U.bills || [], accts = U.accounts || [], cols = U.columns || [];
    var waiting = bills.filter(function (b) { return !b.status; });
    var colSel = function (name, val) { return '<select name="' + name + '" aria-label="House">' + '<option value="">House…</option>' + cols.map(function (c) { return "<option" + (c === val ? " selected" : "") + ">" + esc(c) + "</option>"; }).join("") + "</select>"; };
    var h = '<section class="card" id="billsCard"><div class="today-head"><div><h2>Utility bills</h2><p class="sub">Each bill is matched to a house by its account number. Posting one adds it to that house\'s cell in the Ops tab\'s utilities block (for the bill\'s month) and leaves a note on the cell.</p></div>' +
      '<button type="button" class="act" data-scan>Scan Gmail now</button></div>';
    if (U.error) h += '<p class="err">Couldn\'t load bills: ' + esc(U.error) + "</p>";
    h += '<p class="m scanline">' + (U.scanOn ? "Gmail is scanned every morning." : "The daily Gmail scan isn't on yet: run <b>installDailyBillScan</b> once in Apps Script (README).") +
      (U.lastScan ? " Last scan " + esc(U.lastScan) + ": " + esc(U.lastScanResult || "") + "." : "") + "</p>";
    if (!U.error && !U.blockFound) h += '<p class="err" style="margin:10px 0">Couldn\'t find a utilities block on the Ops tab (a header like "Operating Utilities" with a column per house), so bills can\'t be posted yet.</p>';

    h += '<div class="h3">Waiting (' + waiting.length + ")</div>";
    h += waiting.length ? waiting.map(function (b) {
      if (!b.column) {
        return '<form class="bill unmatched" data-bill-map="' + b.row + '"><div class="ti-main"><span class="k">Account not on your list</span><b>' + esc(b.utility || "Utility") + (b.amount ? " · " + cents(b.amount) : "") + "</b>" +
          '<span class="m">' + [b.date ? fmtDate(parseDate(b.date)) : "", b.subject].filter(Boolean).map(esc).join(" · ") + "</span></div>" +
          '<div class="bill-acts"><input type="text" name="account" value="' + esc(b.account) + '" placeholder="Full account #" aria-label="Account number">' + colSel("column", "") +
          '<input type="hidden" name="utility" value="' + esc(b.utility) + '"><button type="submit" class="act primary">Save account</button><button type="button" class="act" data-bill-ignore="' + b.row + '">Not ours</button></div></form>';
      }
      return '<div class="bill"><div class="ti-main"><span class="k">' + esc(b.utility) + " · " + (b.date ? fmtDate(parseDate(b.date)) : "") + "</span><b>" + esc(b.column) + "</b>" +
        '<span class="m">' + [b.account ? "Acct " + b.account : "", b.source, b.subject].filter(Boolean).map(esc).join(" · ") + "</span></div>" +
        '<div class="bill-acts"><span class="money"><span>$</span><input type="text" inputmode="decimal" data-bill-amt="' + b.row + '" value="' + (b.amount == null ? "" : b.amount.toFixed(2)) + '" placeholder="Amount" aria-label="Amount"></span>' +
        '<button type="button" class="act primary" data-bill-post="' + b.row + '">Post to P&amp;L</button><button type="button" class="act" data-bill-ignore="' + b.row + '">Ignore</button></div></div>';
    }).join("") : '<p class="empty">Nothing waiting.</p>';

    // This month and last, by house: what's posted or waiting.
    var now = new Date(), keys = [0, 1].map(function (k) { var x = new Date(now.getFullYear(), now.getMonth() - k, 1); return x.toISOString().slice(0, 7); });
    var by = {};
    bills.forEach(function (b) { if (b.status === "Ignored" || !b.column || b.amount == null) return; var i = keys.indexOf(b.date.slice(0, 7)); if (i < 0) return; (by[b.column] = by[b.column] || [0, 0])[i] += b.amount; });
    var houses = Object.keys(by).sort();
    if (houses.length) {
      var mName = function (k) { return MONTHS[+k.slice(5) - 1]; };
      h += '<div class="h3">By house</div><div class="tbl-wrap"><table><thead><tr><th></th><th>' + mName(keys[0]) + "</th><th>" + mName(keys[1]) + "</th></tr></thead><tbody>" +
        houses.map(function (c) { return "<tr><td>" + esc(c) + "</td><td>" + (by[c][0] ? cents(by[c][0]) : "—") + "</td><td>" + (by[c][1] ? cents(by[c][1]) : "—") + "</td></tr>"; }).join("") + "</tbody></table></div>";
    }

    var posted = bills.filter(function (b) { return b.status; });
    if (posted.length) h += '<details class="paste"><summary class="linkbtn">Posted &amp; ignored (' + posted.length + ")</summary>" + posted.map(function (b) {
      return '<div class="rnote log"><span>' + esc([b.date, b.utility, b.column || b.account, b.amount != null ? cents(b.amount) : ""].filter(Boolean).join(" · ")) + '<span class="m">' + esc(b.status + (b.postedOn ? " " + b.postedOn : "")) + "</span></span>" +
        (b.status === "Ignored" ? '<button type="button" class="act" data-bill-unignore="' + b.row + '">Undo</button>' : "") + "</div>";
    }).join("") + "</details>";
    h += "</section>";

    h += '<div class="grid2 even"><div><section class="card"><h2>Utility accounts</h2><p class="sub">Account number → house. The account number is all the scan needs to split a bill. Saved in the P&amp;L\'s <b>Owner Utility Accounts</b> tab.</p>' +
      (accts.length ? '<div class="units">' + accts.map(function (a) { return '<div class="unit"><span><b>' + esc(a.utility || "Utility") + '</b><br><span class="m">Acct ' + esc(a.account) + "</span></span>" + '<span class="r">' + (a.column ? esc(a.column) : '<span class="pill mid">No house</span>') + "</span></div>"; }).join("") + "</div>" : '<p class="empty">No accounts yet.</p>') +
      '<form class="fields" id="acctAdd" style="margin-top:14px"><label>Account #<input type="text" name="account" autocomplete="off"></label><label>Utility<input type="text" name="utility" placeholder="City Utilities" autocomplete="off"></label><label>House' + colSel("column", "") + '</label><label>&nbsp;<button type="submit" class="act primary" style="justify-content:center">Save account</button></label></form>' +
      '<p class="m">Same account number again updates it. Bills already found for it get the house filled in.</p></section></div>';
    h += '<div><section class="card"><h2>Add a bill by hand</h2><p class="sub">For paper bills, or autopays you only see on the bank statement.</p>' +
      (accts.length ? '<form class="fields" id="billAdd"><label class="wide">Account<select name="account">' + accts.map(function (a) { return '<option value="' + esc(a.account) + '">' + esc((a.column || "No house") + " · " + (a.utility || "") + " · " + a.account) + "</option>"; }).join("") + "</select></label>" +
        '<label>Amount<input type="text" name="amount" inputmode="decimal" autocomplete="off"></label><label>Bill date<input type="date" name="date"></label><label>&nbsp;<button type="submit" class="act primary" style="justify-content:center">Add bill</button></label></form>'
        : '<p class="empty">Add an account first.</p>') + "</section></div></div>";
    return h;
  }
  var busy = function (b, txt) { var was = b.textContent; b.disabled = true; b.textContent = txt; return function () { b.disabled = false; b.textContent = was; }; };
  document.addEventListener("click", function (e) {
    var t = e.target; if (!t.closest) return;
    var sc = t.closest("[data-scan]");
    if (sc) {
      var undo = busy(sc, "Scanning…");
      FundAPI.run.withSuccessHandler(function (r) { undo(); window.alert(r.message || "Done."); load(); }).withFailureHandler(function (err) { undo(); window.alert(errText(err)); }).scanBillsNow();
      return;
    }
    var bp = t.closest("[data-bill-post]");
    if (bp) {
      var row = +bp.getAttribute("data-bill-post"), inp = document.querySelector('[data-bill-amt="' + row + '"]');
      var amt = inp ? numIn(inp.value, true) : +bp.getAttribute("data-amount");
      if (!(amt > 0)) { window.alert("Type the amount first."); if (inp) inp.focus(); return; }
      var u2 = busy(bp, "Posting…");
      FundAPI.run.withSuccessHandler(load).withFailureHandler(function (err) { u2(); window.alert(errText(err)); }).postBillToPnl(row, amt);
      return;
    }
    var bi = t.closest("[data-bill-ignore], [data-bill-unignore]");
    if (bi) {
      var ign = bi.hasAttribute("data-bill-ignore"), u3 = busy(bi, "…");
      FundAPI.run.withSuccessHandler(load).withFailureHandler(function (err) { u3(); window.alert(errText(err)); }).setBillStatus(+(bi.getAttribute("data-bill-ignore") || bi.getAttribute("data-bill-unignore")), ign ? "Ignored" : "");
    }
  });
  document.addEventListener("submit", function (e) {
    var f = e.target, id = f.id;
    if (id !== "acctAdd" && id !== "billAdd" && !f.hasAttribute("data-bill-map")) return;
    e.preventDefault();
    var g = function (n) { return f.elements[n] ? f.elements[n].value.trim() : ""; };
    var b = f.querySelector("button[type=submit]"), undo = busy(b, "Saving…");
    var bad = function (err) { undo(); window.alert(errText(err)); };
    if (id === "billAdd") FundAPI.run.withSuccessHandler(load).withFailureHandler(bad).addUtilBill(g("account"), g("amount").replace(/[$,]/g, ""), g("date"));
    else {
      if (!g("column") && !window.confirm("Save without a house? Bills for it won't be postable until it has one.")) { undo(); return; }
      FundAPI.run.withSuccessHandler(load).withFailureHandler(bad).addUtilAccount(g("account"), g("utility"), g("column"));
    }
  });

  function load() { FundAPI.run.withSuccessHandler(function (d) { try { render(d); } catch (e) { fail(e); } }).withFailureHandler(fail).getDashboardData(); }
  window.FundDash = { load: load };
})();
