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

// The On Sale filter. Live data may have nothing discounted, which would let a
// broken filter pass by showing nothing — so discounts are set in-page on
// three pieces: two buyable, one sold out. Nothing is written anywhere.
const filter = await page.evaluate(() => {
  const saved = PRODUCTS.map(p => ({ d: p.discountPercent, s: p.stock }));
  PRODUCTS.forEach(p => { p.discountPercent = 0; });
  const chipWithNoSale = !!document.querySelector('.sale-chip');
  renderFilterPanel();
  const chipWhenNothingDiscounted = !!document.querySelector('.sale-chip');

  const [a, b, gone] = PRODUCTS;
  a.stock = 'in';  a.discountPercent = 20;
  b.stock = 'in';  b.discountPercent = 10;
  gone.stock = 'out'; gone.discountPercent = 50;
  renderFilterPanel(); lastGridSignature = null; renderGrid();
  const before = document.querySelectorAll('.card').length;
  const chipWhenOnSale = !!document.querySelector('.sale-chip');

  setSaleFilter(true);
  const shown = [...document.querySelectorAll('.card .card-name')].map(n => n.textContent.trim());
  const chipActive = !!document.querySelector('.sale-chip.active');
  setSaleFilter(false);
  const restored = document.querySelectorAll('.card').length;

  PRODUCTS.forEach((p, i) => { p.discountPercent = saved[i].d; p.stock = saved[i].s; });
  renderFilterPanel(); lastGridSignature = null; renderGrid();
  return { chipWhenNothingDiscounted, chipWhenOnSale, chipActive, shown,
           want: [a.name, b.name], goneName: gone.name, before, restored };
}).catch(e => ({ error: e.message }));
if (filter.error) console.log('sale filter unavailable:', String(filter.error).slice(0, 160));
check('no On Sale chip while nothing is discounted', filter.chipWhenNothingDiscounted === false);
check('an On Sale chip appears once something is', filter.chipWhenOnSale === true);
check(`the filter shows exactly the buyable discounted pieces (${(filter.shown || []).length})`,
  Array.isArray(filter.shown) && filter.shown.length === 2 &&
  filter.want.every(n => filter.shown.includes(n)));
check('a sold-out discounted piece is left out', Array.isArray(filter.shown) && !filter.shown.includes(filter.goneName));
check('the chip shows as active while filtering', filter.chipActive === true);
check('turning it off restores the full grid', filter.restored === filter.before && filter.before > 0);

// A shopper filtering to the sale who buys its last piece: markPiecesSold
// re-renders the grid, nothing is discounted and buyable any more, and the chip
// that would switch the filter off has gone. They must not be left looking at
// an empty grid with no way out.
const stranded = await page.evaluate(() => {
  const saved = PRODUCTS.map(p => ({ d: p.discountPercent, s: p.stock }));
  PRODUCTS.forEach(p => { p.discountPercent = 0; });
  const only = PRODUCTS.find(p => p.stock !== 'out');
  only.discountPercent = 30;
  renderFilterPanel(); setSaleFilter(true);
  const whileOnSale = document.querySelectorAll('.card').length;
  markPiecesSold({ items: [{ productId: only.id }] });   // the checkout path
  const afterLastSold = document.querySelectorAll('.card').length;
  const chip = !!document.querySelector('.sale-chip');
  PRODUCTS.forEach((p, i) => { p.discountPercent = saved[i].d; p.stock = saved[i].s; });
  state.saleOnly = false; renderFilterPanel(); lastGridSignature = null; renderGrid();
  return { whileOnSale, afterLastSold, chip, total: PRODUCTS.length };
}).catch(e => ({ error: e.message }));
if (stranded.error) console.log('stranded check unavailable:', String(stranded.error).slice(0, 160));
check('filtering to a one-piece sale shows that piece', stranded.whileOnSale === 1);
check(`selling the last sale piece does not strand the shopper on an empty grid (${stranded.afterLastSold} shown)`,
  stranded.afterLastSold === stranded.total);

// The hero carousel. Stock and discounts are set in-page so the sold-out case
// is exercised whatever the live data holds; nothing is written anywhere.
const hero = await page.evaluate(async () => {
  const saved = PRODUCTS.map(p => ({ d: p.discountPercent, s: p.stock }));
  const savedNote = saleNoteText;
  PRODUCTS.forEach(p => { p.discountPercent = 0; });
  renderHero();
  const noSale = {
    slides: document.querySelectorAll('.hero-slide').length,
    dots: document.querySelectorAll('.hero-dot').length,
    rotating: heroTimer !== null
  };

  // A sold-out piece must not set the headline for pieces still available.
  const [buyable, gone] = PRODUCTS;
  buyable.stock = 'in';  buyable.discountPercent = 20;
  gone.stock = 'out';    gone.discountPercent = 50;
  saleNoteText = '<img src=x onerror="window.__heroPwned=1">Ends Sunday';
  window.__heroPwned = 0;
  renderHero();
  await new Promise(r => setTimeout(r, 100));
  const text = document.querySelector('.hero-carousel').innerText;
  const withSale = {
    slides: document.querySelectorAll('.hero-slide').length,
    dots: document.querySelectorAll('.hero-dot').length,
    text,
    noteInjected: document.querySelectorAll('.hero-carousel img').length,
    pwned: window.__heroPwned,
    sideways: document.documentElement.scrollWidth > window.innerWidth
  };

  // "Shop the sale" switches the filter on.
  const btn = [...document.querySelectorAll('.hero-cta')].find(b => /Shop the sale/.test(b.textContent));
  if (btn) btn.click();
  const filterOn = state.saleOnly;

  PRODUCTS.forEach((p, i) => { p.discountPercent = saved[i].d; p.stock = saved[i].s; });
  saleNoteText = savedNote;
  state.saleOnly = false; renderFilterPanel(); lastGridSignature = null; renderGrid();
  renderHero();
  return { noSale, withSale, filterOn };
}).catch(e => ({ error: e.message }));
if (hero.error) console.log('hero unavailable:', String(hero.error).slice(0, 160));
const hs = hero.withSale || {}, hn = hero.noSale || {};
check('with no sale there is a single slide', hn.slides === 1);
check('and no dots', hn.dots === 0);
check('and nothing rotates', hn.rotating === false);
check('a sale adds a second slide', hs.slides === 2);
check('and dots to move between them', hs.dots === 2);
check('the headline quotes the largest buyable discount', /Up to 20% off/.test(hs.text || ''));
check('a sold-out piece does not set the headline', !/50%/.test(hs.text || ''));
check('the note is shown', /Ends Sunday/.test(hs.text || ''));
check('the note cannot inject markup', hs.noteInjected === 0 && hs.pwned === 0);
check('a running sale does not make the page scroll sideways', hs.sideways === false);
check('"Shop the sale" switches the On Sale filter on', hero.filterOn === true);

// Before sale-pricing.sql runs, shop_settings doesn't exist, and asking for it
// makes the browser log a 404 in every visitor's console. Products carry no
// discountPercent at all in that state, which is how the note request knows
// to wait. After the migration it must still be fetched.
const noteLoad = await page.evaluate(async () => {
  const real = apiService.getSaleNote;
  let calls = 0;
  apiService.getSaleNote = async () => { calls++; return 'Ends Sunday'; };
  const saved = PRODUCTS.map(p => p.discountPercent);
  const savedNote = saleNoteText;

  PRODUCTS.forEach(p => { delete p.discountPercent; });     // pre-migration rows
  saleNoteText = '';
  await loadSaleNote();
  const before = { calls, note: saleNoteText };

  PRODUCTS.forEach(p => { p.discountPercent = 0; });        // migrated rows
  await loadSaleNote();
  const after = { calls, note: saleNoteText };

  apiService.getSaleNote = real;
  PRODUCTS.forEach((p, i) => { p.discountPercent = saved[i]; });
  saleNoteText = savedNote;
  return { before, after };
}).catch(e => ({ error: e.message }));
if (noteLoad.error) console.log('note loading unavailable:', String(noteLoad.error).slice(0, 160));
check('before the migration, the note is not requested', noteLoad.before && noteLoad.before.calls === 0);
check('after it, the note is fetched', noteLoad.after && noteLoad.after.calls === 1);
check('and shown', noteLoad.after && noteLoad.after.note === 'Ends Sunday');

// The banner and the On Sale chip have to follow stock as it changes during a
// visit, on every path that changes it — not only on a full reload.
const stale = await page.evaluate(async () => {
  const saved = PRODUCTS.map(p => ({ d: p.discountPercent, s: p.stock }));
  const realFetch = apiService.fetchProducts, realStock = apiService.updateProductStock;
  const realOrders = apiService.getOrders, realReqs = apiService.getRestockRequests;
  apiService.getOrders = async () => []; apiService.getRestockRequests = async () => [];
  // The stand-in products below carry discountPercent, which is the signal that
  // sale-pricing.sql has run; the live database this suite talks to may not have
  // run it yet, so the note is stubbed rather than requested for real.
  const realNote = apiService.getSaleNote;
  apiService.getSaleNote = async () => '';
  const headline = () => { const h = document.querySelector('.hero-sale h1'); return h ? h.textContent.trim() : '(no sale slide)'; };
  const chip = () => !!document.querySelector('.sale-chip');
  const reset = () => {
    PRODUCTS.forEach(p => { p.discountPercent = 0; p.stock = 'in'; });
    PRODUCTS[0].discountPercent = 50; PRODUCTS[1].discountPercent = 20;
    renderHero(); renderFilterPanel();
  };
  const out = {};

  // 1. A shopper buys the 50%-off piece at checkout.
  reset();
  markPiecesSold({ items: [{ productId: PRODUCTS[0].id }] });
  out.afterBuying = headline();

  // 2. The stale-bag path: the 50%-off piece went while the bag sat open.
  reset();
  apiService.fetchProducts = async () => PRODUCTS.map((p, i) => i === 0 ? { ...p, stock: 'out' } : { ...p });
  state.bag = [{ productId: PRODUCTS[0].id, size: PRODUCTS[0].sizes[0] }];
  await dropSoldOutFromBag({ message: 'sold_out:' + PRODUCTS[0].name });
  out.afterStaleBag = headline();
  closeAllSheets({ keepUrl: true });
  state.bag = [];

  // 3. The owner marks the only sale piece sold out from the admin panel.
  PRODUCTS.forEach(p => { p.discountPercent = 0; p.stock = 'in'; });
  PRODUCTS[0].discountPercent = 30;
  renderHero(); renderFilterPanel();
  apiService.updateProductStock = async (id, s) => { const p = PRODUCTS.find(x => x.id === id); p.stock = s; return p; };
  adminTab = 'inventory';
  await setProductStock(PRODUCTS[0].id, 'out');
  out.afterOwnerSoldOut = { headline: headline(), chip: chip() };

  // 4. The first load failed and the shopper tapped "Try again".
  const snapshot = PRODUCTS.map(p => ({ ...p, discountPercent: 0, stock: 'in' }));
  snapshot[0].discountPercent = 40;
  PRODUCTS = [];
  renderHero(); renderFilterPanel();
  apiService.fetchProducts = async () => snapshot.map(p => ({ ...p }));
  await retryProducts();
  out.afterRetry = { headline: headline(), chip: chip() };

  apiService.fetchProducts = realFetch; apiService.updateProductStock = realStock;
  apiService.getOrders = realOrders; apiService.getRestockRequests = realReqs;
  apiService.getSaleNote = realNote;
  PRODUCTS = await realFetch();
  PRODUCTS.forEach((p, i) => { if (saved[i]) { p.discountPercent = saved[i].d; p.stock = saved[i].s; } });
  closeAllSheets({ keepUrl: true });
  renderHero(); renderFilterPanel(); lastGridSignature = null; renderGrid();
  return out;
}).catch(e => ({ error: e.message }));
if (stale.error) console.log('stale-banner check unavailable:', String(stale.error).slice(0, 160));
check(`buying the headline piece moves the banner to the next discount ("${stale.afterBuying}")`, stale.afterBuying === 'Up to 20% off selected pieces');
check(`so does losing it from a stale bag ("${stale.afterStaleBag}")`, stale.afterStaleBag === 'Up to 20% off selected pieces');
check('the owner selling out the only sale piece removes the banner', stale.afterOwnerSoldOut && stale.afterOwnerSoldOut.headline === '(no sale slide)');
check('and the On Sale chip with it', stale.afterOwnerSoldOut && stale.afterOwnerSoldOut.chip === false);
check(`a retry after a failed first load shows the sale banner ("${stale.afterRetry && stale.afterRetry.headline}")`, stale.afterRetry && stale.afterRetry.headline === 'Up to 40% off selected pieces');
check('and the On Sale chip', stale.afterRetry && stale.afterRetry.chip === true);

// A sale can end while a shopper is at checkout. place_order charges the
// database's price, so without a re-check at the moment of ordering the button
// could say AED 419 and the order be recorded at AED 599 — and a cash-on-
// delivery customer would meet a courier asking for more than she agreed to.
const priceGuard = await page.evaluate(async () => {
  const saved = PRODUCTS.map(p => ({ d: p.discountPercent, s: p.stock }));
  const realFetch = apiService.fetchProducts, realCreate = apiService.createOrder;
  const piece = PRODUCTS.find(p => p.stock !== 'out');
  PRODUCTS.forEach(p => { p.discountPercent = 0; });
  let created = 0;
  apiService.createOrder = async payload => {
    created++;
    return { id: 'DS-TEST', paymentMethod: 'cod', customer: payload.customer,
             shippingAddress: payload.shippingAddress, subtotal: 1, shipping: 0, total: 1,
             items: [{ productId: piece.id, name: piece.name, size: piece.sizes[0], qty: 1, total: 1 }] };
  };
  const fill = () => {
    const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
    set('coName', 'Test Shopper'); set('coEmail', 'shopper@example.com');
    set('coPhone', '050 123 4567'); set('coAddress', 'Villa 14, Al Wasl Road');
  };
  const run = async (shownPct, serverPct) => {
    created = 0;
    piece.discountPercent = shownPct; piece.stock = 'in';
    state.country = 'AE'; state.paymentMethod = 'cod';
    state.bag = [{ productId: piece.id, size: piece.sizes[0] }];
    renderCheckout(); openSheet('checkoutSheet'); fill();
    const shownLabel = document.getElementById('coSubmit').textContent.trim();
    apiService.fetchProducts = async () => PRODUCTS.map(p => p.id === piece.id ? { ...p, discountPercent: serverPct } : { ...p });
    await placeOrder();
    const after = document.getElementById('coSubmit');
    return { created, shownLabel,
             labelAfter: after ? after.textContent.trim() : '(checkout closed)',
             nameKept: document.getElementById('coName') ? document.getElementById('coName').value : null,
             toast: document.getElementById('toast').textContent };
  };
  const up = await run(30, 0);      // the sale ended: the price went up
  const down = await run(0, 30);    // a sale started: the price went down

  apiService.fetchProducts = realFetch; apiService.createOrder = realCreate;
  PRODUCTS = await realFetch();
  PRODUCTS.forEach((p, i) => { if (saved[i]) { p.discountPercent = saved[i].d; p.stock = saved[i].s; } });
  state.bag = []; closeAllSheets({ keepUrl: true });
  lastGridSignature = null; renderGrid(); refreshSale();
  return { up, down, full: piece.price };
}).catch(e => ({ error: e.message }));
if (priceGuard.error) console.log('price guard unavailable:', String(priceGuard.error).slice(0, 160));
const pu = priceGuard.up || {}, pd = priceGuard.down || {};
check('an order is not placed when its price rose since it was shown', pu.created === 0);
check(`the shopper is told why ("${pu.toast}")`, /price|changed/i.test(pu.toast || ''));
check(`the button now shows the new total ("${pu.labelAfter}")`, (pu.labelAfter || '').includes(`AED ${priceGuard.full}`));
check('and what they typed is kept', pu.nameKept === 'Test Shopper');
check('an order whose price fell since it was shown goes through', pd.created === 1);

// "Shop the sale" is the banner's one call to action. A shopper who already
// has a category chosen, an availability chip on and something typed in the
// search box must still land on exactly the sale pieces, not "No pieces match".
const cta = await page.evaluate(() => {
  const saved = PRODUCTS.map(p => ({ d: p.discountPercent, s: p.stock }));
  PRODUCTS.forEach(p => { p.discountPercent = 0; });
  const onSale = PRODUCTS.filter(p => p.stock !== 'out').slice(0, 2);
  onSale.forEach(p => { p.discountPercent = 25; });
  const otherCat = CATEGORIES.find(c => c !== 'All' && !onSale.some(p => p.cat === c)) || 'Accessories';
  renderHero(); renderFilterPanel();
  setCategory(otherCat);
  state.filterAvail = new Set(['out']);
  document.getElementById('searchInput').value = 'zzz-nothing-matches';
  lastGridSignature = null; renderGrid();

  shopFromHero(true);
  const shown = [...document.querySelectorAll('.card .card-name')].map(n => n.textContent.trim());
  const out = { shown, want: onSale.map(p => p.name),
                category: state.category, avail: state.filterAvail.size,
                search: document.getElementById('searchInput').value };

  PRODUCTS.forEach((p, i) => { p.discountPercent = saved[i].d; p.stock = saved[i].s; });
  state.saleOnly = false; state.filterAvail = new Set(); setCategory('All');
  document.getElementById('searchInput').value = '';
  lastGridSignature = null; renderGrid(); renderHero();
  return out;
}).catch(e => ({ error: e.message }));
if (cta.error) console.log('shop-the-sale check unavailable:', String(cta.error).slice(0, 160));
check(`"Shop the sale" lands on exactly the sale pieces despite other filters (${(cta.shown || []).length} shown)`,
  Array.isArray(cta.shown) && cta.shown.length === cta.want.length && cta.want.every(n => cta.shown.includes(n)));
check('it resets the category, availability chips and search', cta.category === 'All' && cta.avail === 0 && cta.search === '');

// The first slide's "Shop the collection" is the way back: after "Shop the
// sale" it has to show every piece again, not leave the sale filter on.
const back = await page.evaluate(() => {
  const saved = PRODUCTS.map(p => p.discountPercent);
  PRODUCTS.forEach(p => { p.discountPercent = 0; });
  PRODUCTS.find(p => p.stock !== 'out').discountPercent = 25;
  renderHero(); renderFilterPanel();
  shopFromHero(true);
  const onSale = document.querySelectorAll('.card').length;
  setCategory(CATEGORIES.find(c => c !== 'All') || 'All');
  shopFromHero(false);
  const out = { onSale, shown: document.querySelectorAll('.card').length, total: PRODUCTS.length,
                saleOnly: state.saleOnly, category: state.category };
  PRODUCTS.forEach((p, i) => { p.discountPercent = saved[i]; });
  lastGridSignature = null; renderGrid(); renderHero(); renderFilterPanel();
  return out;
}).catch(e => ({ error: e.message }));
if (back.error) console.log('shop-the-collection check unavailable:', String(back.error).slice(0, 160));
check(`"Shop the collection" after "Shop the sale" shows every piece again (${back.onSale} -> ${back.shown} of ${back.total})`,
  back.shown === back.total && back.saleOnly === false && back.category === 'All');
check('the first slide\'s button calls it',
  await page.evaluate(() => /shopFromHero\(false\)/.test(document.querySelector('#heroTrack .hero-cta').getAttribute('onclick'))));

// Low stock is still a piece you can buy: there is no separate chip for it,
// and "In Stock" includes it.
const avail = await page.evaluate(() => {
  const chips = [...document.querySelectorAll('#availRow .chip')].map(c => c.textContent.trim());
  const piece = PRODUCTS.find(p => p.stock !== 'out');
  const was = piece.stock; piece.stock = 'low';
  state.filterAvail = new Set(['in']);
  lastGridSignature = null; renderGrid();
  const shown = [...document.querySelectorAll('.card .card-name')].some(n => n.textContent.trim() === piece.name);
  piece.stock = was; state.filterAvail = new Set();
  lastGridSignature = null; renderGrid(); renderFilterPanel();
  return { chips, shown };
}).catch(e => ({ error: e.message }));
check(`no "Low Stock" availability chip (${(avail.chips || []).join(', ')})`,
  Array.isArray(avail.chips) && !avail.chips.includes('Low Stock') && avail.chips.includes('In Stock'));
check('"In Stock" includes low-stock pieces', avail.shown === true);

// The hero must paint before any script runs. It used to be static HTML; if it
// is built by JavaScript, the space above the grid is blank until the user and
// product requests finish, then the hero pops in and shoves the grid down —
// and the storefront's <h1> is missing from the HTML crawlers read, including
// every /p/ page served from the same shell.
const rawHome = await (await fetch(BASE + '/')).text();
const track = /id="heroTrack"[^>]*>([\s\S]*?)<div class="hero-dots"/.exec(rawHome);
check('the hero headline is in the served HTML', !!track && track[1].includes('Wrapped in softness'));
check('as the page\'s <h1>', !!track && /<h1>Wrapped in softness/.test(track[1]));
const firstPiecePath = await page.evaluate(() => productPath(PRODUCTS[0]));
const rawProduct = await (await fetch(BASE + firstPiecePath)).text();
check('and in the HTML served for a product page', /<h1>Wrapped in softness/.test(rawProduct));
{
  const noJs = await browser.newContext({ javaScriptEnabled: false });
  const nj = await noJs.newPage();
  await nj.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  const box = await nj.locator('.hero-slide').first().boundingBox().catch(() => null);
  check(`with JavaScript off, the hero is on screen (${box ? Math.round(box.height) + 'px tall' : 'absent'})`, !!box && box.height > 150);
  await noJs.close();
}

// Rotation: a sale's two slides advance on their own for most visitors, and
// never for someone who has asked their system to reduce motion.
const rotation = async reducedMotion => {
  const ctx = await browser.newContext(reducedMotion ? { reducedMotion: 'reduce' } : {});
  const pg = await ctx.newPage();
  await pg.goto(BASE + '/', { waitUntil: 'networkidle' });
  await pg.waitForSelector('.card', { timeout: 20000 });
  const running = await pg.evaluate(() => {
    const p = PRODUCTS.find(x => x.stock !== 'out');
    p.discountPercent = 20;                 // in this page only
    renderHero();
    return heroTimer !== null;
  });
  await ctx.close();
  return running;
};
// Admin: the Sale button and its inline editor. supabaseClient.from is swapped
// for a fake query builder, so the real setProductDiscount still runs — its
// clamping and its PRODUCTS sync — without anything reaching the database.
const saleAdmin = await page.evaluate(async () => {
  const realFrom = supabaseClient.from;
  const realOrders = apiService.getOrders, realReqs = apiService.getRestockRequests;
  apiService.getOrders = async () => [];
  apiService.getRestockRequests = async () => [];
  const writes = [];
  supabaseClient.from = table => {
    const q = { v: null,
      update(v){ this.v = v; return this; }, eq(){ return this; }, select(){ return this; },
      single: async function(){
        writes.push({ table, v: this.v });
        const p = PRODUCTS.find(x => x.id === target.id);
        return { data: { ...p, ...this.v }, error: null };
      } };
    return q;
  };
  const saved = PRODUCTS.map(p => ({ d: p.discountPercent, s: p.stock }));
  PRODUCTS.forEach(p => { p.discountPercent = 0; });
  const target = PRODUCTS.find(p => p.stock !== 'out');
  const out = {};

  adminTab = 'inventory';
  await renderAdmin();
  const btn = () => [...document.querySelectorAll(`#invRow${target.id} .stock-toggle-btn`)].find(b => /^Sale/.test(b.textContent.trim()));
  out.buttonBefore = btn() && btn().textContent.trim();

  openSaleEditor(target.id);
  const input = document.getElementById('salePct' + target.id);
  const save = [...document.querySelectorAll(`#invRow${target.id} button`)].find(b => b.textContent.trim() === 'Save');
  const type = v => { input.value = v; input.dispatchEvent(new Event('input', { bubbles: true })); };
  out.saveDisabledEmpty = save.disabled;
  type('95');   out.saveDisabled95 = save.disabled;
  type('12.5'); out.saveDisabledDecimal = save.disabled;
  type('0');    out.saveDisabledZero = save.disabled;
  type('30');   out.saveEnabled30 = !save.disabled;

  // Put the piece in the bag first: clearing must not leave it at sale price.
  state.bag = [{ productId: target.id, size: target.sizes[0] }];
  await saveSaleEditor(target.id);
  out.written = writes.at(-1) && writes.at(-1).v;
  out.buttonAfter = btn() && btn().textContent.trim();
  out.charged = chargedPrice(PRODUCTS.find(p => p.id === target.id));
  renderBag();
  out.bagDuringSale = document.getElementById('bagContent').innerHTML.includes('sale-was');

  await clearSale(target.id);
  out.cleared = writes.at(-1) && writes.at(-1).v;
  out.buttonCleared = btn() && btn().textContent.trim();
  out.bagAfterClear = document.getElementById('bagContent').innerHTML;
  out.fullPrice = target.price;

  // The clamp inside the real API method, independent of the editor's guard.
  await apiService.setProductDiscount(target.id, 95);
  out.clamped = writes.at(-1).v.discountPercent;

  supabaseClient.from = realFrom;
  apiService.getOrders = realOrders; apiService.getRestockRequests = realReqs;
  PRODUCTS.forEach((p, i) => { p.discountPercent = saved[i].d; p.stock = saved[i].s; });
  state.bag = [];
  return out;
}).catch(e => ({ error: e.message }));
if (saleAdmin.error) console.log('saleAdmin sale editor unavailable:', String(saleAdmin.error).slice(0, 160));
check(`the row offers a Sale button ("${saleAdmin.buttonBefore}")`, saleAdmin.buttonBefore === 'Sale');
check('Save is disabled while the field is empty', saleAdmin.saveDisabledEmpty === true);
check('and for 95%', saleAdmin.saveDisabled95 === true);
check('and for a decimal', saleAdmin.saveDisabledDecimal === true);
check('and for 0%', saleAdmin.saveDisabledZero === true);
check('and enabled for 30%', saleAdmin.saveEnabled30 === true);
check('saving writes 30 to the piece', saleAdmin.written && saleAdmin.written.discountPercent === 30);
check(`the button then reads "${saleAdmin.buttonAfter}"`, saleAdmin.buttonAfter === 'Sale 30%');
check('the piece is charged the discounted price', saleAdmin.charged === Math.round((saleAdmin.fullPrice || 0) * 0.7));
check('a bag holding it shows the sale price', saleAdmin.bagDuringSale === true);
check('clearing writes 0', saleAdmin.cleared && saleAdmin.cleared.discountPercent === 0);
check('the button goes back to "Sale"', saleAdmin.buttonCleared === 'Sale');
check('the bag drops the strikethrough', typeof saleAdmin.bagAfterClear === 'string' && !saleAdmin.bagAfterClear.includes('sale-was'));
check('and shows the full price again', typeof saleAdmin.bagAfterClear === 'string' && saleAdmin.bagAfterClear.includes(`AED ${saleAdmin.fullPrice}`));
check('the API itself clamps 95 to 90', saleAdmin.clamped === 90);

// Housekeeping: the colour picker, the Accessories category and the made-up
// popularity score for new pieces are gone; S-M / M-L are explained.
const tidy = await page.evaluate(async () => {
  const realOrders = apiService.getOrders, realReqs = apiService.getRestockRequests, realFrom = supabaseClient.from;
  apiService.getOrders = async () => []; apiService.getRestockRequests = async () => [];
  adminTab = 'add'; await renderAdmin();
  const form = document.getElementById('adminContent');
  const res = {
    picker: /Color Theme/.test(form.innerText) || !!form.querySelector('.palette-swatch'),
    adminCats: [...form.querySelectorAll('#npCat option')].map(o => o.value),
    chips: [...document.querySelectorAll('#categoryRow .chip')].map(c => c.textContent.trim())
  };
  let inserted;
  supabaseClient.from = () => ({ insert(v){ inserted = v; return this; }, select(){ return this; },
    single: async () => ({ data: { id: -1, ...inserted }, error: null }) });
  await apiService.addProduct({ name: 'x', cat: 'Kimonos', price: 100, stock: 'in', images: [] });
  PRODUCTS.shift(); storageService.saveProducts(PRODUCTS);
  supabaseClient.from = realFrom; apiService.getOrders = realOrders; apiService.getRestockRequests = realReqs;
  res.insertedKeys = Object.keys(inserted || {});

  const noteFor = p => { if(!p) return undefined; openProduct(p.id, false);
    const n = document.querySelector('#pdSheet .size-note'); const t = n ? n.textContent.trim() : '';
    closeAllSheets(); return t; };
  res.smNote = noteFor(PRODUCTS.find(p => (p.sizes || []).includes('S-M')));
  res.mlNote = noteFor(PRODUCTS.find(p => (p.sizes || []).includes('M-L')));
  res.oneNote = noteFor(PRODUCTS.find(p => (p.sizes || []).includes('One Size')));
  return res;
}).catch(e => ({ error: e.message }));
if (tidy.error) console.log('housekeeping checks unavailable:', String(tidy.error).slice(0, 160));
check('the Add Item form has no colour picker', tidy.picker === false);
check(`no Accessories in the shop filters (${(tidy.chips || []).join(', ')})`,
  Array.isArray(tidy.chips) && !tidy.chips.includes('Accessories') && tidy.chips.includes('Abayas'));
check('or in the Add Item category list', Array.isArray(tidy.adminCats) && !tidy.adminCats.includes('Accessories'));
check(`a new piece is saved without a made-up popularity or colour (${(tidy.insertedKeys || []).join(',')})`,
  Array.isArray(tidy.insertedKeys) && tidy.insertedKeys.includes('name') &&
  !tidy.insertedKeys.includes('pop') && !tidy.insertedKeys.includes('paletteIndex'));
check(`an S-M piece explains its fit ("${tidy.smNote}")`, /one size/i.test(tidy.smNote || '') && /\bS\b/.test(tidy.smNote) && /\bM\b/.test(tidy.smNote));
check(`and an M-L piece ("${tidy.mlNote}")`, /one size/i.test(tidy.mlNote || '') && /\bL\b/.test(tidy.mlNote));
check('a One Size piece gets no note', tidy.oneNote === '');

check('a sale carousel advances on its own', await rotation(false) === true);
check('but not for a visitor who asked to reduce motion', await rotation(true) === false);

check('no console errors', errors.length === 0);
console.log(out.join('\n'));
if (errors.length) console.log('\nconsole errors:\n' + errors.join('\n'));
await browser.close();
process.exit(out.some(l => l.startsWith('FAIL')) ? 1 : 0);
