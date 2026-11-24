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
  function returns(properties, holdings, months, insuranceYtd, now) {
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

    var t = { income: 0, noi: 0, debtService: 0, cashFlow: 0, value: 0, balance: 0, cashIn: 0, valueNoi: 0, cocFlow: 0 };
    homes.forEach(function (x) {
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

  /** Highest rate first (avalanche); ties go to the smaller balance. Loans without a balance are left out. */
  function payoffOrder(homes) {
    return (homes || []).filter(function (x) { return x.balance > 0; }).map(function (x) {
      return { name: x.name, lender: x.lender, balance: x.balance, rate: x.rate, rateEst: x.rateEst, payment: x.payment,
        interestPerMonth: x.rate != null ? x.balance * x.rate / 12 : null };
    }).sort(function (a, b) {
      if (a.rate == null && b.rate == null) return a.balance - b.balance;
      if (a.rate == null) return 1;
      if (b.rate == null) return -1;
      return b.rate - a.rate || a.balance - b.balance;
    });
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

  var api = { RULES: RULES, pmt: pmt, impliedRate: impliedRate, monthsTo: monthsTo, returns: returns, payoffOrder: payoffOrder, reserves: reserves };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.FundFinance = api;
})(this);
