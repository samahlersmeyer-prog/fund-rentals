// node tests/finance.test.js — checks the dashboard's returns/debt/reserve math against numbers worked by hand.
// Made-up homes only: this repo is public. (The real-data hand check is done outside the repo.)
const assert = require("assert");
const F = require("../dashboard/finance.js");
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= (tol || 0.01), msg + ": got " + a + ", want " + b);
const now = new Date(2026, 10, 24);

// pmt: $100,000 at 7.5% over 240 months is $805.59 (standard amortization table); impliedRate inverts it.
near(F.pmt(100000, 0.075, 240), 805.59, 0.01, "pmt");
near(F.impliedRate(100000, 805.59, 240), 0.075, 0.0001, "impliedRate");
assert.strictEqual(F.impliedRate(100000, 100, 240), null, "payment too small to ever pay off");
assert.strictEqual(F.monthsTo("2045", now), 228);
assert.strictEqual(F.monthsTo("2045-02-18", now), 219);

// "Oak St", 10 months of P&L: income 12,000; costs 5,000 of which loans 3,000 → other 2,000; tax for the year 1,500.
//   NOI = (12,000 − 2,000) × 1.2 − 1,500 = 10,500. Debt service = 3,000/10 × 12 = 3,600. Cash flow 6,900.
//   Value 120,000 → cap 8.75%. DSCR 2.9167. Balance 60,000 → equity 60,000, LTV 50%. Cash in 25,000 → CoC 27.6%.
// "Elm Ave": income 18,000; costs = loans = 12,000; tax 2,400; payment given 1,100/mo at 7%.
//   NOI = 18,000 × 1.2 − 2,400 = 19,200. DS 13,200. Cash flow 6,000. Value 200,000 → cap 9.6%. DSCR 1.4545.
const props = { names: ["Oak St", "Elm Ave", "Sold Ln", "General Business"], income: [12000, 18000, 4000, 900], costs: [5000, 12000, 100, 9000],
  loans: [3000, 12000, 0, 0], taxes: [1500, 2400, 0, 0] };
const hold = { rows: [
  { name: "Oak St", units: ["oak"], value: 120000, valueAsOf: "2025-09-05", balance: 60000, balanceAsOf: "2025-09-05", rate: null, payment: null, maturity: "2050", cashIn: 25000 },
  { name: "Elm Ave", units: ["elm"], value: 200000, valueAsOf: "2026-10-01", balance: 150000, balanceAsOf: "2026-10-01", rate: 0.07, payment: 1100, maturity: "2045", cashIn: null },
] };
const R = F.returns(props, hold, 10, 0, now);
const O = R.homes[0], E = R.homes[1];
near(O.noi, 10500, 0.01, "Oak NOI");
near(O.debtService, 3600, 0.01, "Oak debt service");
near(O.cashFlow, 6900, 0.01, "Oak cash flow");
near(O.cap, 0.0875, 0.00001, "Oak cap");
near(O.dscr, 2.91667, 0.0001, "Oak DSCR");
near(O.equity, 60000, 0.01, "Oak equity");
near(O.ltv, 0.5, 0.00001, "Oak LTV");
near(O.coc, 0.276, 0.00001, "Oak CoC");
assert.ok(O.rateEst && O.rate > 0.03 && O.rate < 0.035, "Oak rate is estimated from its payment: " + O.rate);
assert.ok(O.flags.some((f) => /value is \d+ months old/.test(f)), "stale value flagged");
near(E.noi, 19200, 0.01, "Elm NOI");
near(E.cashFlow, 6000, 0.01, "Elm cash flow");
near(E.cap, 0.096, 0.00001, "Elm cap");
near(E.dscr, 1.45455, 0.0001, "Elm DSCR");
assert.strictEqual(E.coc, null, "no cash in → no cash-on-cash");
assert.ok(E.flags.indexOf("cash in") >= 0, "missing cash in flagged");
assert.deepStrictEqual(R.unmatched, ["Sold Ln"], "P&L homes with rent but no Owner Properties row are listed");
// Portfolio: NOI 29,700 on 320,000 → cap 9.28%; owed 210,000 → LTV 65.6%; CoC only over homes with cash in.
near(R.total.noi, 29700, 0.01, "total NOI");
near(R.total.cap, 0.0928125, 0.000001, "portfolio cap");
near(R.total.ltv, 0.65625, 0.000001, "portfolio LTV");
near(R.total.coc, 0.276, 0.00001, "portfolio CoC");

// Insurance spread by rent share: 3,000 over 12,000 + 18,000 → Oak gets 1,200 YTD, 1,440 a year.
const RI = F.returns(props, hold, 10, 3000, now);
near(RI.homes[0].insurance, 1440, 0.01, "Oak insurance share");
near(RI.homes[0].noi, 10500 - 1440, 0.01, "NOI after insurance");

// Avalanche: highest rate first; ties to the smaller balance; unknown rate last; paid-off loans dropped.
const order = F.payoffOrder([{ name: "A", balance: 50000, rate: 0.07 }, { name: "B", balance: 90000, rate: 0.09 }, { name: "C", balance: 10000, rate: null }, { name: "D", balance: 20000, rate: 0.09 }, { name: "E", balance: 0, rate: 0.12 }]);
assert.deepStrictEqual(order.map((x) => x.name), ["D", "B", "A", "C"]);
near(order[0].interestPerMonth, 150, 0.001, "monthly interest");

// Reserves: 3 months of $10,000 + 10 doors × $1,500 = $45,000; $60,000 cash leaves $15,000 free (6 months covered).
const res = F.reserves(60000, 10000, 10);
assert.strictEqual(res.target, 45000);
assert.strictEqual(res.free, 15000);
near(res.months, 6, 0.0001, "months of costs covered");
console.log("finance tests: all passed");
