// Drives the real storefront in a browser: the one-of-a-kind bag (no
// quantities anywhere, a piece can only be in it once, and a piece bought out
// from under a shopper leaves it with the reason named), and the admin panel's
// paid/unpaid accounting.
//
// Run:
//   1. python -m http.server 8790 --bind 127.0.0.1   (from public/)
//   2. npx playwright install chromium-headless-shell  (first time only)
//   3. npx --yes playwright@1.63 node tests/ui-smoke.mjs
//      — or, with playwright already installed: node tests/ui-smoke.mjs
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

// A piece sold must read Sold Out straight away. The grid skips rebuilds when
// the visible ids haven't changed, so a stock change that doesn't clear the
// signature would sit there looking In Stock until a reload.
const sold = await page.evaluate(() => {
  const p = PRODUCTS.find(x => x.stock !== 'out');
  if (!p) return { skip: true };
  markPiecesSold({ items: [{ productId: p.id }] });
  const card = [...document.querySelectorAll('.card')].find(c => c.innerText.includes(p.name));
  const tag = card && card.querySelector('.stock-tag');
  return { name: p.name, stock: p.stock, soldOut: (p.soldOut || []).length,
           tag: tag ? tag.textContent.trim() : '(no card)' };
});
if (sold.skip) {
  check('SKIP  every piece is already sold out', true);
} else {
  check(`the sold piece flips to out (${sold.name})`, sold.stock === 'out');
  check('its sizes are marked sold', sold.soldOut > 0);
  check(`the grid says so without a reload (tag: "${sold.tag}")`, sold.tag === 'Sold Out');
}

// Admin accounting: revenue counts what has been paid for, not what has been
// ordered. Driven with stand-in orders so nothing real is read or written.
const admin = await page.evaluate(async () => {
  const one = (id, total, paidAt) => ({
    id, total, paidAt, status: 'pending', paymentMethod: 'transfer',
    customer: { name: 'A', email: `${id}@x.com`, phone: '+971500000000' },
    shippingAddress: { country: 'AE', region: 'Dubai', address: 'x' }, items: []
  });
  const real = apiService.getOrders;
  apiService.getOrders = async () => [one('DS-0001', 100, null), one('DS-0002', 250, '2026-09-20T10:00:00Z')];
  adminTab = 'orders';
  await renderAdmin();
  apiService.getOrders = real;
  const el = document.getElementById('adminContent');
  return {
    text: el.innerText,
    markedPaid: el.querySelectorAll('.paid-toggle.is-paid').length,
    toggles: el.querySelectorAll('.paid-toggle').length
  };
});
check('revenue counts only the paid order (AED 250)', /Revenue \(Paid\)[\s\S]{0,40}AED 250/i.test(admin.text));
check('the unpaid order is shown as awaiting payment (AED 100)', /Awaiting Payment[\s\S]{0,40}AED 100/i.test(admin.text));
check('every order gets a paid control', admin.toggles === 2);
check('only the paid one reads as paid', admin.markedPaid === 1);
check('the unpaid one offers Mark paid', /Mark paid/.test(admin.text));

// Notify Me: a real form in place of the prompt(), where either contact
// detail will do but neither alone is demanded.
const notify = await page.evaluate(async () => {
  const out = {};
  const p = PRODUCTS[0];
  openNotifyMe(p.id);
  const sub = document.getElementById('nmSubmit');
  out.opened = !!document.getElementById('nmEmail') && !!document.getElementById('nmPhone');
  out.startsDisabled = sub.disabled;

  const email = document.getElementById('nmEmail');
  const phone = document.getElementById('nmPhone');
  const type = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };

  type(email, 'not-an-email');
  out.badEmailBlocks = sub.disabled;
  type(email, 'someone@example.com');
  out.emailAloneEnables = !sub.disabled;

  type(email, '');
  type(phone, '050 123 4567');
  out.phoneAloneEnables = !sub.disabled;

  type(phone, '123');
  out.badPhoneBlocks = sub.disabled;

  // What actually gets sent, without writing to the database.
  type(phone, '050 123 4567');
  type(email, 'someone@example.com');
  let sent = null;
  const real = apiService.createRestockRequest;
  apiService.createRestockRequest = async payload => { sent = payload; return 'ok'; };
  await submitNotifyRequest();
  apiService.createRestockRequest = real;
  out.sent = sent;
  out.toast = document.getElementById('toast').textContent;
  return out;
});
check('Notify Me opens a form with both fields', notify.opened);
check('it starts disabled with nothing filled in', notify.startsDisabled);
check('an invalid email blocks it', notify.badEmailBlocks);
check('an email alone is enough', notify.emailAloneEnables);
check('a phone alone is enough', notify.phoneAloneEnables);
check('an invalid phone blocks it', notify.badPhoneBlocks);
check(`the phone is sent in E.164 (${notify.sent && notify.sent.phone})`,
  notify.sent && notify.sent.phone === '+971501234567');
check('the email is sent as typed', notify.sent && notify.sent.email === 'someone@example.com');
check(`the shopper is told ("${notify.toast}")`, /let you know when it's back/i.test(notify.toast));

// The admin waiting list, driven with stand-in requests.
const adminWaiting = await page.evaluate(async () => {
  const p = PRODUCTS[0];
  const realOrders = apiService.getOrders;
  const realReqs = apiService.getRestockRequests;
  apiService.getOrders = async () => [];
  apiService.getRestockRequests = async () => ([
    { id: 1, product_id: p.id, email: 'mail@x.com', phone: null, created_at: '2026-09-20T09:00:00Z', notified_at: null },
    { id: 2, product_id: p.id, email: null, phone: '+971501234567', created_at: '2026-09-20T09:00:00Z', notified_at: null }
  ]);
  waitingProduct = p;
  adminTab = 'waiting';
  await renderAdmin();
  const el = document.getElementById('adminContent');
  const res = {
    text: el.innerText,
    waLink: (el.querySelector('.waiting-contact a') || {}).href,
    byHand: el.querySelectorAll('.waiting-tag').length,
    markButtons: [...el.querySelectorAll('button')].filter(b => /Mark contacted/.test(b.textContent)).length
  };
  adminTab = 'inventory';
  await renderAdmin();
  res.inventoryText = document.getElementById('adminContent').innerText;
  apiService.getOrders = realOrders;
  apiService.getRestockRequests = realReqs;
  return res;
});
check('the waiting list shows both people', /mail@x\.com/.test(adminWaiting.text) && /\+971501234567/.test(adminWaiting.text));
check(`the number is a WhatsApp link (${adminWaiting.waLink})`, adminWaiting.waLink === 'https://wa.me/971501234567');
check('only the phone-only one is flagged to message by hand', adminWaiting.byHand === 1);
check('each waiting person can be marked contacted', adminWaiting.markButtons === 2);
check('inventory shows the count', /Waiting \(2\)/.test(adminWaiting.inventoryText));

check('no console errors', errors.length === 0);
console.log(out.join('\n'));
if (errors.length) console.log('\nconsole errors:\n' + errors.join('\n'));
await browser.close();
process.exit(out.some(l => l.startsWith('FAIL')) ? 1 : 0);
