// Drives the real storefront in a browser: the one-of-a-kind bag (no
// quantities anywhere, a piece can only be in it once, and a piece bought out
// from under a shopper leaves it with the reason named), and the admin panel's
// paid/unpaid accounting.
//
// Run:
//   1. npx wrangler pages dev public --port 8790
//      (Cloudflare's runtime, not a plain static server: /p/<slug>-<id> is
//      served by a Function, so a static server cannot answer it at all.)
//   2. npx playwright install chromium-headless-shell  (first time only)
//   3. node tests/ui-smoke.mjs
//
// Playwright is deliberately not a project dependency; this is an occasional
// check, not part of a build. The page reads live products from Supabase and
// writes nothing — the sold-out path is driven by handing the real handler the
// error the database raises, so no order is ever placed.
import { chromium } from 'playwright';

// Override with BASE=http://127.0.0.1:<port> when the default port is busy.
const BASE = process.env.BASE || 'http://127.0.0.1:8790';

const errors = [];
const out = [];
const check = (label, cond) => out.push((cond ? 'PASS  ' : 'FAIL  ') + label);

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));

await page.goto(BASE + '/', { waitUntil: 'networkidle' });
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

// Stored XSS: anyone can insert a restock request, signed in or not, and the
// admin panel renders it in the owner's session. A hostile value must come out
// as text, never as markup.
const xss = await page.evaluate(async () => {
  const p = PRODUCTS[0];
  const PAYLOAD = '<img src=x onerror="window.__pwned=1">';
  window.__pwned = 0;
  const realOrders = apiService.getOrders;
  const realReqs = apiService.getRestockRequests;
  apiService.getOrders = async () => ([{
    id: 'DS-9', total: 1, status: 'pending', paymentMethod: 'cod', paidAt: null,
    customer: { name: PAYLOAD, email: 'x@x.com', phone: PAYLOAD },
    shippingAddress: { country: 'AE', region: 'Dubai', address: PAYLOAD },
    items: [{ name: PAYLOAD, size: PAYLOAD, qty: 1, total: 1 }]
  }]);
  apiService.getRestockRequests = async () => ([
    { id: 1, product_id: p.id, email: PAYLOAD, phone: PAYLOAD, created_at: '2026-09-20T09:00:00Z', notified_at: null }
  ]);

  waitingProduct = p; adminTab = 'waiting'; await renderAdmin();
  const waitingEl = document.getElementById('adminContent');
  const res = {
    waitingInjected: waitingEl.querySelectorAll('img').length,
    waitingShowsText: waitingEl.innerText.includes(PAYLOAD)
  };

  adminTab = 'orders'; await renderAdmin();
  const ordersEl = document.getElementById('adminContent');
  res.ordersInjected = ordersEl.querySelectorAll('img').length;
  res.ordersShowText = ordersEl.innerText.includes(PAYLOAD);

  apiService.getOrders = realOrders;
  apiService.getRestockRequests = realReqs;
  await new Promise(r => setTimeout(r, 150));
  res.pwned = window.__pwned;
  return res;
});
check('a hostile restock request injects no markup', xss.waitingInjected === 0);
check('it is shown to the owner as plain text', xss.waitingShowsText);
check('a hostile order injects no markup', xss.ordersInjected === 0);
check('the order is shown as plain text', xss.ordersShowText);
check('nothing executed in the owner session', xss.pwned === 0);

// Closing sheets, and a form the browser filled in for you.
const closing = await page.evaluate(async () => {
  const out = {};
  // Every sheet must close, including ones added after closeAllSheets was
  // written — the Notify Me sheet was unclosable because it wasn't on a list.
  const ids = [...document.querySelectorAll('.sheet')].map(s => s.id);
  out.leftOpen = [];
  for (const id of ids) {
    openSheet(id);
    closeAllSheets();
    if (document.getElementById(id).classList.contains('open')) out.leftOpen.push(id);
  }
  out.overlayClosed = !document.getElementById('overlay').classList.contains('open');

  // Signed in, so the email arrives pre-filled: the button must start usable.
  state.user = { id:'u1', email:'owner@example.com', name:'O', phone:null };
  openNotifyMe(PRODUCTS[0].id);
  out.enabledWhenPrefilled = !document.getElementById('nmSubmit').disabled;

  // Autofill: value set with no `input` event, the way Chrome can do it.
  state.user = null;
  openNotifyMe(PRODUCTS[0].id);
  const email = document.getElementById('nmEmail');
  out.disabledBeforeAutofill = document.getElementById('nmSubmit').disabled;
  email.value = 'autofilled@example.com';
  await new Promise(r => setTimeout(r, 700));
  out.enabledAfterAutofillSweep = !document.getElementById('nmSubmit').disabled;
  closeAllSheets();
  state.user = null;
  return out;
});
check(`every sheet closes (${closing.leftOpen.length ? 'stuck: ' + closing.leftOpen.join(', ') : 'none stuck'})`,
  closing.leftOpen.length === 0);
check('the overlay closes with them', closing.overlayClosed);
check('a pre-filled form is usable straight away', closing.enabledWhenPrefilled);
check('an empty form still starts disabled', closing.disabledBeforeAutofill);
check('a browser-autofilled form becomes usable', closing.enabledAfterAutofillSweep);

// Editing a product's photos. Storage is stubbed, so nothing is uploaded — what
// matters is the paths chosen and the order of the URLs handed back.
const photos = await page.evaluate(async () => {
  const uploaded = [];
  const realStorage = supabaseClient.storage;
  supabaseClient.storage = {
    from: () => ({
      upload: async (path) => { uploaded.push(path); return { error: null }; },
      getPublicUrl: (path) => ({ data: { publicUrl: 'https://cdn.example/' + path } })
    })
  };

  // A real 1x1 image, so the resize and WebP encode actually run.
  const cv = document.createElement('canvas');
  cv.width = cv.height = 8;
  cv.getContext('2d').fillRect(0, 0, 8, 8);
  const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
  const file = (n) => new File([blob], n, { type: 'image/png' });

  // The reported case: delete the first of two, add two new ones, keep the old
  // second — so the kept one ends up last.
  const KEPT = 'https://cdn.example/7/1-lg.webp';
  photoDraft = [
    { file: file('new_1.png'), preview: '' },
    { file: file('new_2.png'), preview: '' },
    { url: KEPT }
  ];
  const urls = await commitPhotos('7');
  photoDraft = [];
  supabaseClient.storage = realStorage;

  return {
    urls,
    uploaded,
    keptLast: urls[2] === KEPT,
    allDistinct: new Set(urls).size === urls.length,
    noneReuseKept: urls.slice(0, 2).every(u => u !== KEPT),
    bothVariants: uploaded.filter(p => p.endsWith('-sm.webp')).length === 2
                  && uploaded.filter(p => p.endsWith('-lg.webp')).length === 2,
    smallVariantStillWorks: smallVariant(urls[0]) === urls[0].replace('-lg.webp', '-sm.webp')
  };
});
check(`re-editing photos yields ${photos.urls.length} distinct URLs`, photos.allDistinct);
check('a new photo never overwrites a kept one', photos.noneReuseKept);
check('the kept photo stays in its new position', photos.keptLast);
check('both sizes are uploaded for each new photo', photos.bothVariants);
check('the -sm/-lg pairing still resolves', photos.smallVariantStillWorks);
check(`paths are no longer named by position (${photos.uploaded[0]})`,
  !/\/(0|1|2|3)-(sm|lg)\.webp$/.test(photos.uploaded[0]));

// Per-product URLs: the address bar has to follow what's on screen, and a
// shared link has to open the right piece on its own.
const first = await page.evaluate(() => ({ id: PRODUCTS[0].id, name: PRODUCTS[0].name, path: productPath(PRODUCTS[0]) }));

// The client builds these paths and the Function serving them builds its own;
// they must agree, or every shared link takes a redirect on the way in.
// redirect:'manual' reports 0 for a 301, so 200 means already canonical.
const canonical = await page.evaluate(async p => {
  const res = await fetch(p, { redirect: 'manual' });
  return res.status;
}, first.path);
check(`the client's path is already canonical (${first.path})`, canonical === 200);

await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await page.waitForSelector('.card', { timeout: 20000 });

await page.locator('.card-link').first().click();
await page.waitForTimeout(400);
check(`clicking a piece puts it in the address bar (${new URL(page.url()).pathname})`,
  new URL(page.url()).pathname === first.path);
check('the card is a real link a crawler can follow',
  (await page.locator('.card-link').first().getAttribute('href')) === first.path);

await page.evaluate(() => closeAllSheets());
await page.waitForTimeout(300);
check('closing the piece returns to the shop', new URL(page.url()).pathname === '/');

await page.goBack();
await page.waitForTimeout(400);
check('Back reopens the piece', new URL(page.url()).pathname === first.path);
check('and the sheet is open again', await page.locator('#pdSheet.open').count() === 1);

await page.goForward();
await page.waitForTimeout(400);
check('Forward closes it again', new URL(page.url()).pathname === '/');

// Landing straight on a shared link.
const landed = await page.goto(BASE + first.path, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
check('a shared link serves 200', landed.status() === 200);
check('and opens that piece on arrival', await page.locator('#pdSheet.open').count() === 1);
check('with that piece in the title', (await page.title()).startsWith(first.name));
const shown = await page.locator('#pdContent .pd-title').innerText().catch(() => '');
check(`the piece shown is the one asked for ("${shown}")`, shown === first.name);

// Sale pricing. Driven against the real helpers with stand-in products, so
// nothing in the database is touched.
const sale = await page.evaluate(() => {
  const plain = { id: 901, name: 'Plain', cat: 'Abayas', price: 599, discountPercent: 0, stock: 'in', sizes: ['One Size'], soldOut: [], images: [] };
  const cut   = { ...plain, id: 902, name: 'Cut', discountPercent: 30 };
  const legacy = { id: 903, name: 'Legacy', cat: 'Abayas', price: 599, stock: 'in', sizes: ['One Size'], soldOut: [], images: [] };
  return {
    plainCharged: chargedPrice(plain),
    cutCharged: chargedPrice(cut),
    legacyCharged: chargedPrice(legacy),
    plainOnSale: isOnSale(plain),
    cutOnSale: isOnSale(cut),
    legacyOnSale: isOnSale(legacy),
    plainHtml: priceHtml(plain),
    cutHtml: priceHtml(cut)
  };
}).catch(e => ({ error: e.message }));
if (sale.error) console.log('sale helpers unavailable:', String(sale.error).slice(0, 160));
check('a piece with no discount charges its price', sale.plainCharged === 599);
check('a 30% discount charges 419', sale.cutCharged === 419);
check('a row with no discountPercent at all is not on sale', sale.legacyOnSale === false && sale.legacyCharged === 599);
check('0% is not on sale', sale.plainOnSale === false);
check('30% is on sale', sale.cutOnSale === true);
check('an undiscounted price renders without a strikethrough', typeof sale.plainHtml === 'string' && !/sale-was|sale-tag/.test(sale.plainHtml));
check('a discounted price shows the original struck through', /sale-was/.test(sale.cutHtml || '') && (sale.cutHtml || '').includes('599'));
check('and the new price', (sale.cutHtml || '').includes('419'));
check('and the percentage off', /−30%|-30%/.test(sale.cutHtml || ''));
// The struck original is a reference point, not a second full quote. Carrying
// its own dollar figure, it ran straight into the sale price on a phone card
// ("$163.10 AED 419") and read as one number.
const was = /<span class="sale-was">([^<]*)<\/span>/.exec(sale.cutHtml || '');
check(`the struck original is dirhams only (${was ? was[1] : 'missing'})`, !!was && was[1] === 'AED 599');

check('no console errors', errors.length === 0);
console.log(out.join('\n'));
if (errors.length) console.log('\nconsole errors:\n' + errors.join('\n'));
await browser.close();
process.exit(out.some(l => l.startsWith('FAIL')) ? 1 : 0);
