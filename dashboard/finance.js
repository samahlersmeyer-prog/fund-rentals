/*
 * The Fund · returns, debt and reserves math for the owner dashboard. Pure functions, no DOM.
 * Loaded in the page as window.FundFinance; tested in node (tests/finance.test.js).
 *
 * Inputs come from getDashboardData:
 *   properties  P&L "Totals Rental Ops": year-to-date income, costs (loans + other), loans, and the year's property tax per home
 *   holdings    the "Owner Properties" tab: value, balance, rate, payment, cash in per home
 *   months      how many months of rent are entered this year (YTD → a year is × 12 / months)
 *   insuranceYtd  portfolio insurance this year; the P&L books it to General Business, so it's spread by rent share here
 */
(function (root) {
  var RULES = {
    RESERVE_MONTHS: 3,      // months of all-in costs (loans, tax, insurance, utilities, repairs) kept in the bank
    RESERVE_PER_DOOR: 1500, // plus this per unit for big-ticket replacements (roof, furnace, water heater)
    STALE_DAYS: 183,        // a value or loan balance older than this is flagged for an update
    MARKET_GROWTH: 0.03,    // a year, for growing an appraisal to today. Fort Wayne ran +2.6% (Zillow, Jun 2026) to
                            // +4.2% (Redfin, spring 2026) a year; the low end keeps borrowing decisions safe.
  };

  function num(x) { return typeof x === "number" && isFinite(x) ? x : null; }
  function days(fromYmd, now) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fromYmd || "");
    if (!m) return null;
    return Math.floor((now - new Date(+m[1], +m[2] - 1, +m[3])) / 864e5);
  }

  /** Monthly payment on a fully amortizing loan. */
  function pmt(balance, annualRate, months) {
    if (!balance || !months) return 0;
    var r = annualRate / 12;
    return r ? balance * r / (1 - Math.pow(1 + r, -months)) : balance / months;
  }

  /** The rate that makes `payment` pay off `balance` in `months` (bisection). null if it can't. */
  function impliedRate(balance, payment, months) {
    if (!(balance > 0 && payment > 0 && months > 0) || payment * months <= balance) return null;
    var lo = 0, hi = 0.5;
    for (var i = 0; i < 100; i++) {
      var mid = (lo + hi) / 2;
      if (pmt(balance, mid, months) < payment) lo = mid; else hi = mid;
    }
    return Math.round(((lo + hi) / 2) * 10000) / 10000;
  }

  /** Months from `now` to a maturity given as a year ("2045") or a date ("2045-02-18"). */
  function monthsTo(maturity, now) {
    var s = String(maturity || ""), m = /^(\d{4})(?:-(\d{2}))?/.exec(s);
    if (!m) return null;
    var y = +m[1], mo = m[2] ? +m[2] - 1 : now.getMonth();
    return Math.max(0, (y - now.getFullYear()) * 12 + (mo - now.getMonth()));
  }

  /**
   * Per-home returns and debt, plus portfolio totals and what data is missing.
   * Returns { homes: [...], total: {...}, missing: [...], unmatched: [...] }.
   */
  function returns(properties, holdings, months, insuranceYtd, now, rentByUnit) {
    now = now || new Date();
    var P = properties || {}, H = (holdings && holdings.rows) || [];
    var names = P.names || [];
    var k = months > 0 ? 12 / months : 0;
    var idx = {}; names.forEach(function (n, i) { idx[n.toLowerCase()] = i; });
    // Insurance sits in General Business on the P&L; spread it over the homes by their share of rent.
    var rentHomes = H.map(function (h) { var i = idx[h.name.toLowerCase()]; return i == null ? 0 : (P.income || [])[i] || 0; });
    var rentAll = rentHomes.reduce(function (a, b) { return a + b; }, 0);

    var homes = H.map(function (h, j) {
      var i = idx[h.name.toLowerCase()], has = i != null;
      var inc = has ? (P.income || [])[i] || 0 : 0;
      var loansYtd = has ? (P.loans || [])[i] || 0 : 0;
      var other = has ? ((P.costs || [])[i] || 0) - loansYtd : 0;
      var tax = has ? (P.taxes || [])[i] || 0 : 0; // already the whole year's bill
      var ins = rentAll ? (insuranceYtd || 0) * rentHomes[j] / rentAll : 0;
      var noi = has ? (inc - other - ins) * k - tax : null;
      var payment = num(h.payment) || (loansYtd && months ? loansYtd / months : null);
      var ds = payment ? payment * 12 : (h.balance ? null : 0);
      var left = monthsTo(h.maturity, now);
      var rate = num(h.rate), rateEst = false;
      if (rate == null && h.balance > 0 && payment && left) { rate = impliedRate(h.balance, payment, left); rateEst = rate != null; }
      var x = {
        name: h.name, units: h.units, lender: h.lender, notes: h.notes, inPnl: has,
        income: has ? inc * k : null, other: has ? other * k : null, insurance: ins * k, tax: has ? tax : null,
        noi: noi, debtService: ds, cashFlow: noi != null && ds != null ? noi - ds : null,
        value: num(h.value), balance: num(h.balance), cashIn: num(h.cashIn), cost: num(h.cost),
        rate: rate, rateEst: rateEst, payment: payment, monthsLeft: left,
        valueAge: days(h.valueAsOf, now), balanceAge: days(h.balanceAsOf, now),
      };
      // Fully rented: today's rents for a whole year in place of what actually came in (other costs, tax, loan unchanged).
      var roll = (h.units || []).reduce(function (a, u) { return a + ((rentByUnit || {})[u] || 0); }, 0) * 12;
      x.rentRoll = roll || null;
      x.vacancy = roll && x.income != null ? Math.max(0, roll - x.income) : null;
      x.fullNoi = roll && x.noi != null ? x.noi + (roll - x.income) : null;
      x.fullCashFlow = x.fullNoi != null && ds != null ? x.fullNoi - ds : null;
      x.fullDscr = x.fullNoi != null && ds ? x.fullNoi / ds : null;
      x.cap = x.noi != null && x.value ? x.noi / x.value : null;
      x.dscr = x.noi != null && x.debtService ? x.noi / x.debtService : null;
      x.coc = x.cashFlow != null && x.cashIn ? x.cashFlow / x.cashIn : null;
      x.equity = x.value != null && x.balance != null ? x.value - x.balance : null;
      x.ltv = x.value && x.balance != null ? x.balance / x.value : null;
      x.flags = [];
      if (!has) x.flags.push("not found in the P&L's Ops summary (check the name)");
      if (x.value == null) x.flags.push("value");
      else if (x.valueAge > RULES.STALE_DAYS) x.flags.push("value is " + Math.round(x.valueAge / 30) + " months old");
      if (x.balance == null) x.flags.push("loan balance");
      else if (x.balanceAge > RULES.STALE_DAYS) x.flags.push("balance is " + Math.round(x.balanceAge / 30) + " months old");
      if (x.balance > 0 && num(h.rate) == null) x.flags.push(rateEst ? "rate (estimated from payment)" : "rate");
      if (x.cashIn == null) x.flags.push("cash in");
      return x;
    });

    var t = { income: 0, noi: 0, debtService: 0, cashFlow: 0, value: 0, balance: 0, cashIn: 0, valueNoi: 0, cocFlow: 0, fullCashFlow: 0, vacancy: 0 };
    homes.forEach(function (x) {
      t.fullCashFlow += x.fullCashFlow != null ? x.fullCashFlow : x.cashFlow || 0;
      t.vacancy += x.vacancy || 0;
      if (x.noi != null) { t.income += x.income; t.noi += x.noi; }
      if (x.debtService != null) t.debtService += x.debtService;
      if (x.cashFlow != null) t.cashFlow += x.cashFlow;
      if (x.value != null) { t.value += x.value; if (x.noi != null) t.valueNoi += x.noi; }
      if (x.balance != null && x.value != null) t.balance += x.balance;
      if (x.cashIn != null && x.cashFlow != null) { t.cashIn += x.cashIn; t.cocFlow += x.cashFlow; }
    });
    t.cap = t.value ? t.valueNoi / t.value : null;
    t.dscr = t.debtService ? t.noi / t.debtService : null;
    t.ltv = t.value ? t.balance / t.value : null;
    t.equity = t.value - t.balance;
    t.coc = t.cashIn ? t.cocFlow / t.cashIn : null;
    t.homesWithValue = homes.filter(function (x) { return x.value != null; }).length;
    t.homesWithCash = homes.filter(function (x) { return x.cashIn != null; }).length;

    var missing = {};
    homes.forEach(function (x) { x.flags.forEach(function (f) { (missing[f] = missing[f] || []).push(x.name); }); });
    var held = H.map(function (h) { return h.name.toLowerCase(); });
    var unmatched = names.filter(function (n, i) {
      return !/general business/i.test(n) && held.indexOf(n.toLowerCase()) < 0 && ((P.income || [])[i] || 0) > 0;
    });
    return { homes: homes, total: t, missing: Object.keys(missing).map(function (f) { return { what: f, homes: missing[f] }; }), unmatched: unmatched };
  }

  /**
   * Highest rate first (avalanche); ties go to the smaller balance. Loans without a balance are left out.
   * `others` are the balance sheet's other debts (cards, partner loans, notes), so a 29% card outranks a 7% mortgage.
   */
  function payoffOrder(homes, others) {
    var loans = (homes || []).filter(function (x) { return x.balance > 0; }).map(function (x) {
      return { name: x.name, lender: x.lender, balance: x.balance, rate: x.rate, rateEst: x.rateEst, payment: x.payment };
    }).concat((others || []).filter(function (r) { return r.kind === "debt" && r.amount > 0; }).map(function (r) {
      return { name: r.item, lender: "", balance: r.amount, rate: r.rate, rateEst: false, payment: null, other: true };
    }));
    loans.forEach(function (o) { o.interestPerMonth = o.rate != null ? o.balance * o.rate / 12 : null; });
    return loans.sort(function (a, b) {
      if (a.rate == null && b.rate == null) return a.balance - b.balance;
      if (a.rate == null) return 1;
      if (b.rate == null) return -1;
      return b.rate - a.rate || a.balance - b.balance;
    });
  }

  /**
   * Balance sheet: what the Fund owns and owes today (homes at market value) next to the 2025 return (cost less
   * depreciation). Rows come from the Owner Balance Sheet tab. A row left without an Amount is filled in: "cash"
   * from the latest bank balance, "home"/"propert" from Owner Properties values, "mortgage" from their balances.
   */
  function balanceSheet(sheet, homes, cash) {
    var rows = (sheet && sheet.rows) || [];
    var sum = function (k) { return (homes || []).reduce(function (a, x) { return a + (x[k] || 0); }, 0); };
    var fill = function (r) {
      if (r.amount != null) return { now: r.amount, auto: false };
      if (/cash|bank/i.test(r.item)) return { now: cash, auto: true };
      if (/home|propert/i.test(r.item)) return { now: sum("value"), auto: true };
      if (/mortgage/i.test(r.item)) return { now: sum("balance"), auto: true };
      return { now: null, auto: false };
    };
    var out = { assets: [], debts: [], deposits: [] };
    rows.forEach(function (r) {
      var f = fill(r), line = { item: r.item, now: f.now, auto: f.auto, book: r.book, rate: r.rate, asOf: r.asOf, notes: r.notes };
      (r.kind === "asset" ? out.assets : r.kind === "deposit" ? out.deposits : out.debts).push(line);
    });
    var tot = function (list, k) { return list.reduce(function (a, x) { return a + (x[k] || 0); }, 0); };
    var owe = out.debts.concat(out.deposits);
    out.total = { assets: tot(out.assets, "now"), owed: tot(owe, "now"), assetsBook: tot(out.assets, "book"), owedBook: tot(owe, "book") };
    out.total.equity = out.total.assets - out.total.owed;
    out.total.equityBook = out.total.assetsBook - out.total.owedBook;
    out.total.debtRatio = out.total.assets ? out.total.owed / out.total.assets : null;
    out.missing = out.assets.concat(owe).filter(function (x) { return x.now == null; }).map(function (x) { return x.item; });
    return out;
  }

  /**
   * How much cash to keep and how much is free to use.
   * monthlyCosts: everything going out in a normal month, with property tax spread over 12.
   */
  function reserves(cash, monthlyCosts, doors, rules) {
    rules = rules || RULES;
    var operating = monthlyCosts * rules.RESERVE_MONTHS, capex = doors * rules.RESERVE_PER_DOOR, target = operating + capex;
    return { cash: cash, operating: operating, capex: capex, target: target, free: cash == null ? null : cash - target,
      months: cash == null || !monthlyCosts ? null : cash / monthlyCosts };
  }

  /**
   * Today's value of a home. `appraised` + `asOf` = the Owner Properties value and its date; `est` = the comps estimate
   * ({ value, comps, miss }) or null. Returns the appraisal grown by the market since its date ("indexed"), the estimate,
   * the value to use for net worth (the estimate when it rests on 3+ comps and a miss of 10% or less, else indexed) and a
   * conservative value for borrowing (the lower of the two).
   */
  function valueNow(appraised, asOf, est, now, rules) {
    rules = rules || RULES;
    if (appraised == null && !(est && est.value)) return null;
    var age = days(asOf, now), years = age == null ? 0 : Math.max(0, age) / 365.25;
    var indexed = appraised == null ? null : Math.round(appraised * Math.pow(1 + rules.MARKET_GROWTH, years) / 1000) * 1000;
    var good = !!(est && est.value && est.comps >= 3 && est.miss <= 0.1);
    var use = good ? est.value : indexed != null ? indexed : est.value;
    var low = [indexed, est && est.value].filter(function (v) { return v != null; });
    return { appraised: appraised, asOf: asOf, indexed: indexed, est: est && est.value || null, good: good, value: use,
      low: Math.min.apply(null, low), source: good ? "comps" : indexed != null ? "indexed" : "comps (thin)" };
  }

  var api = { RULES: RULES, pmt: pmt, impliedRate: impliedRate, monthsTo: monthsTo, returns: returns, payoffOrder: payoffOrder, balanceSheet: balanceSheet, valueNow: valueNow, reserves: reserves };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.FundFinance = api;
})(this);
