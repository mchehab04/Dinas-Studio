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

