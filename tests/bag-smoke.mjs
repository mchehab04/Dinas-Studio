// Drives the real storefront in a browser to check the one-of-a-kind bag:
// no quantities anywhere, a piece can only be in the bag once, and a piece
// bought out from under a shopper leaves the bag with the reason named.
//
// Run:
//   1. python -m http.server 8790 --bind 127.0.0.1   (from public/)
//   2. npx playwright install chromium-headless-shell  (first time only)
//   3. npx --yes playwright@1.63 node tests/bag-smoke.mjs
//      — or, with playwright already installed: node tests/bag-smoke.mjs
//
// Playwright is deliberately not a project dependency; this is an occasional
// check, not part of a build. The page reads live products from Supabase and
// writes nothing — the sold-out path is driven by handing the real handler the
// error the database raises, so no order is ever placed.
import { chromium } from 'playwright';

const errors = [];
const out = [];
const check = (label, cond) => out.push((cond ? 'PASS  ' : 'FAIL  ') + label);

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));

await page.goto('http://127.0.0.1:8790/', { waitUntil: 'networkidle' });
await page.waitForSelector('.card, .grid-message', { timeout: 25000 });

const cards = await page.locator('.card').count();
if (!cards) console.log('GRID:', await page.locator('#productGrid').innerText());
check(`grid rendered (${cards} products)`, cards > 0);

await page.locator('.card-link').first().click();
await page.waitForSelector('#pdSheet.open, .pd-body', { timeout: 10000 });

const pdText = await page.locator('#pdContent').innerText();
check('product detail has no Quantity section', !/Quantity/i.test(pdText));
check('no +/- stepper on the product', await page.locator('.qty-row, .qty-btn').count() === 0);

const addBtn = page.locator('.pd-footer .primary-btn');
const addLabel = (await addBtn.innerText()).trim();
check(`add button reads sensibly ("${addLabel.split('·')[0].trim()}")`, /Add to Bag|Notify Me/.test(addLabel));

if (/Add to Bag/.test(addLabel)) {
  await addBtn.click();
  await page.waitForTimeout(600);
  const badge = (await page.locator('#bagBadge').innerText().catch(() => '')) ||
                (await page.locator('#navBagBadge').innerText().catch(() => ''));
  check(`bag badge counts 1 piece (got "${badge}")`, badge.trim() === '1');

  // Adding the same piece again must say so rather than silently incrementing.
  await page.locator('.card-link').first().click();
  await page.waitForTimeout(400);
  await page.locator('.pd-footer .primary-btn').click();
  await page.waitForTimeout(400);
  const toast = await page.locator('#toast').innerText().catch(() => '');
  check(`second add says "Already in your bag" (got "${toast}")`, /Already in your bag/i.test(toast));

  const badge2 = (await page.locator('#bagBadge').innerText().catch(() => '')) ||
                 (await page.locator('#navBagBadge').innerText().catch(() => ''));
  check(`bag still holds 1 piece (got "${badge2}")`, badge2.trim() === '1');

  await page.evaluate(() => { closeAllSheets(); openBag(); });
  await page.waitForTimeout(500);
  check('bag has no quantity buttons', await page.locator('.bag-qty').count() === 0);
  check('bag keeps Remove', await page.locator('.remove-x').count() > 0);
  check('bag shows a total', /Total/i.test(await page.locator('#bagContent').innerText()));

  // The stale bag: place_order refuses the whole order, the piece that went
  // leaves the bag, and the shopper is told which one by name.
  const stale = await page.evaluate(async () => {
    const taken = PRODUCTS.find(p => p.id === state.bag[0].productId);
    const realFetch = apiService.fetchProducts;
    apiService.fetchProducts = async () =>
      PRODUCTS.map(p => p.id === taken.id ? { ...p, stock: 'out' } : p);
    const handled = await dropSoldOutFromBag({ message: `sold_out:${taken.name}` });
    apiService.fetchProducts = realFetch;
    return { handled, left: state.bag.length, toast: document.getElementById('toast').textContent, name: taken.name };
  });
  check('sold-out refusal is recognised', stale.handled === true);
  check('the taken piece leaves the bag', stale.left === 0);
  check(`the shopper is told which piece ("${stale.toast}")`,
    stale.toast.includes(stale.name) && /just bought by someone else/.test(stale.toast));
}

check('no console errors', errors.length === 0);
console.log(out.join('\n'));
if (errors.length) console.log('\nconsole errors:\n' + errors.join('\n'));
await browser.close();
process.exit(out.some(l => l.startsWith('FAIL')) ? 1 : 0);
