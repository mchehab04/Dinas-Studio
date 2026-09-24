// Run: node tests/sale-rounding.test.mjs
//
// The discount is applied in three places, in two languages: the database
// (what the customer is charged), the storefront (what they are shown first)
// and the product-page function (what Google and WhatsApp are told). A
// one-dirham disagreement means the price shown is not the price charged.
//
// This pins one model of the formula and checks every real implementation
// against it. The database's own rounding is proven in real Postgres by check
// 2c in supabase/verify-place-order.sql.
const check = (label, cond) => console.log((cond ? 'PASS  ' : 'FAIL  ') + label);

// The formula as the spec states it: round(price × (100 − pct) / 100), half up,
// to whole dirhams. Postgres round() on numeric rounds half away from zero,
// which for the positive prices here is the same thing.
const model = (price, pct) => Math.floor(price * (100 - pct) / 100 + 0.5);

const PRICES = [199, 220, 259, 380, 399, 449, 459, 549, 588, 599, 659];
const PERCENTS = [0, 5, 10, 15, 20, 25, 30, 33, 40, 50, 66, 75, 90];

// --- the model itself, against cases worked by hand
check('0% is a no-op', PRICES.every(p => model(p, 0) === p));
check('599 at 30% is 419 (419.3 rounds down)', model(599, 30) === 419);
check('220 at 33% is 147 (147.4 rounds down)', model(220, 33) === 147);
// The case that separates half-up from floor and from banker's rounding, and
// the same one check 2c runs in the database.
check('599 at 50% is 300 (299.5 rounds up)', model(599, 50) === 300);
check('659 at 50% is 330 (329.5 rounds up)', model(659, 50) === 330);
check('every result is a whole dirham',
  PRICES.every(p => PERCENTS.every(c => Number.isInteger(model(p, c)))));


// --- the storefront's real implementation, pulled out of public/js/app.js
// app.js is a classic browser script with no exports, so the two functions
// are read out of the file and evaluated here. That is what lets this test
// fail when app.js changes — a copy defined in this file never could.
import { readFileSync } from 'node:fs';
const appSrc = readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');
// From the declaration to the first closing brace at the start of a line.
// Plain string search rather than a regex, so there is no escaping to get wrong.
const grab = name => {
  const start = appSrc.indexOf(`function ${name}(p){`);
  if (start < 0) return null;
  const end = appSrc.indexOf('\n}', start);
  return end < 0 ? null : appSrc.slice(start, end + 2);
};
const appCode = [grab('discountOf'), grab('chargedPrice')];
check('app.js defines discountOf and chargedPrice', appCode.every(Boolean));
if (appCode.every(Boolean)) {
  const appCharged = new Function(`${appCode.join('\n')}\nreturn chargedPrice;`)();
  const drift = [];
  for (const price of PRICES) for (const pct of PERCENTS) {
    const got = appCharged({ price, discountPercent: pct });
    if (got !== model(price, pct)) drift.push(`${price} @ ${pct}%: app.js ${got}, model ${model(price, pct)}`);
  }
  check(`app.js agrees with the model on all ${PRICES.length * PERCENTS.length} combinations`, drift.length === 0);
  if (drift.length) console.log(drift.join('\n'));
  check('app.js treats a row with no discountPercent as full price', appCharged({ price: 599 }) === 599);
  check('app.js ignores an out-of-range discount rather than giving it away', appCharged({ price: 599, discountPercent: 95 }) === 599);
}

// --- the product-page function's copy, which is what Google and WhatsApp see
const lib = await import('../lib/product-page.js');
check('lib/product-page.js exports chargedPrice', typeof lib.chargedPrice === 'function');
if (typeof lib.chargedPrice === 'function') {
  const drift = [];
  for (const price of PRICES) for (const pct of PERCENTS) {
    const got = lib.chargedPrice({ price, discountPercent: pct });
    if (got !== model(price, pct)) drift.push(`${price} @ ${pct}%: lib ${got}, model ${model(price, pct)}`);
  }
  check(`lib agrees with the model on all ${PRICES.length * PERCENTS.length} combinations`, drift.length === 0);
  if (drift.length) console.log(drift.join('\n'));
  check('lib treats a row with no discountPercent as full price', lib.chargedPrice({ price: 599 }) === 599);
  // PostgREST sends price as a JSON number today, but the function coerces it,
  // so a string from any other caller can't turn "599" into string arithmetic.
  check('lib copes with the price arriving as a string', lib.chargedPrice({ price: '599', discountPercent: 30 }) === 419);
}
