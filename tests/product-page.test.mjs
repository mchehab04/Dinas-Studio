// Run: node tests/product-page.test.mjs
//
// Runs against the REAL public/index.html, so if the head changes shape the
// rewrite fails here rather than silently serving shop-wide tags on every
// product page. Supabase and the asset store are stubbed; nothing is fetched.
import { readFile } from 'node:fs/promises';
import { handle, renderHead, slugify, productPath, idFromSlug } from '../lib/product-page.js';

const SHELL = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const NOT_FOUND = await readFile(new URL('../public/404.html', import.meta.url), 'utf8');

const PRODUCT = {
  id: 7,
  name: 'Silk Jacquard Set — Offwhite',
  cat: 'Matching Sets',
  price: 599,
  stock: 'in',
  desc: 'Softly structured jacquard with a relaxed drape.',
  images: ['https://cdn.example/7/abc-lg.webp']
};

const check = (label, cond) => console.log((cond ? 'PASS  ' : 'FAIL  ') + label);

// --- slugs
check('slug is lowercase and hyphenated', slugify('Silk Jacquard Set — Offwhite') === 'silk-jacquard-set-offwhite');
check('slug strips accents', slugify('Crème Abaya') === 'creme-abaya');
check('slug survives a name of only punctuation', slugify('!!!') === 'piece');
check('path carries the id', productPath(PRODUCT) === '/p/silk-jacquard-set-offwhite-7');
check('id is read back from the path', idFromSlug('silk-jacquard-set-offwhite-7') === 7);
check('a renamed slug still resolves', idFromSlug('completely-different-name-7') === 7);
check('a path with no id resolves to nothing', idFromSlug('no-number-here') === null);

// --- the head rewrite, against the real shell
const html = renderHead(SHELL, PRODUCT, 'https://dinasstudio.com');
check('title names the piece', /<title>Silk Jacquard Set — Offwhite \| Dina's Studio<\/title>/.test(html));
check('only one title survives', (html.match(/<title>/g) || []).length === 1);
check('description is the piece, not the shop',
  /<meta name="description" content="Softly structured jacquard[^"]*AED 599[^"]*">/.test(html));
check('og:image is the piece\'s own photo', html.includes('content="https://cdn.example/7/abc-lg.webp"'));
check('og:url and canonical agree',
  html.includes('<meta property="og:url" content="https://dinasstudio.com/p/silk-jacquard-set-offwhite-7">') &&
  html.includes('<link rel="canonical" href="https://dinasstudio.com/p/silk-jacquard-set-offwhite-7">'));
check('og:type becomes product', html.includes('<meta property="og:type" content="product">'));
check('the shop-wide description is gone', !html.includes('modest fashion matching sets, abayas and kimonos, handmade'));
check('the app is told which piece to open', html.includes('window.__OPEN_PRODUCT__ = 7;'));

const ld = JSON.parse(/<script type="application\/ld\+json">(\{"@context":"https:\/\/schema\.org","@type":"Product"[\s\S]*?)<\/script>/.exec(html)[1]);
check('product JSON-LD carries the price', ld.offers.price === '599.00' && ld.offers.priceCurrency === 'AED');
check('product JSON-LD says in stock', ld.offers.availability === 'https://schema.org/InStock');
check('the shop Organization block is left alone', html.includes('"@type": "Organization"'));

const soldOut = renderHead(SHELL, { ...PRODUCT, stock: 'out' }, 'https://dinasstudio.com');
check('a sold-out piece reports OutOfStock', soldOut.includes('https://schema.org/OutOfStock'));

const noPhoto = renderHead(SHELL, { ...PRODUCT, images: [] }, 'https://dinasstudio.com');
check('a piece with no photo falls back to the logo', noPhoto.includes('content="https://dinasstudio.com/Logo.jpeg"'));

const relImg = renderHead(SHELL, { ...PRODUCT, images: ['data/images/black.jpg'] }, 'https://dinasstudio.com');
check('a relative photo path is made absolute for social',
  relImg.includes('content="https://dinasstudio.com/data/images/black.jpg"'));

const hostile = renderHead(SHELL, { ...PRODUCT, name: '"><script>alert(1)</script>' }, 'https://dinasstudio.com');
check('a hostile name cannot break out of the head',
  !hostile.includes('"><script>alert(1)') && hostile.includes('&quot;&gt;&lt;script&gt;'));
check('a hostile name cannot break out of the JSON-LD', !/<\/script>alert/.test(hostile));

// --- the route
let queue = [PRODUCT];
let readOk = true;
let fetched = [];
globalThis.fetch = async url => {
  fetched.push(String(url));
  if (!readOk) return new Response('boom', { status: 500 });
  return new Response(JSON.stringify(queue), { status: 200 });
};
const env = {
  SUPABASE_URL: 'https://proj.supabase.co',
  SUPABASE_ANON_KEY: 'anon',
  ASSETS: { fetch: async req => new Response(new URL(req.url).pathname === '/404.html' ? NOT_FOUND : SHELL, { status: 200 }) }
};
const get = (path, method = 'GET') =>
  handle(new Request('https://dinasstudio.com' + path, { method }), env);

const ok = await get('/p/silk-jacquard-set-offwhite-7');
check('a canonical URL returns 200', ok.status === 200);
check('it is served as html', ok.headers.get('content-type').includes('text/html'));
check('it is cached briefly, not forever', /max-age=300/.test(ok.headers.get('cache-control')));
check('the body is the rewritten shell', (await ok.text()).includes('window.__OPEN_PRODUCT__ = 7;'));
check('the piece is read by id', fetched[0].includes('products?id=eq.7'));

const moved = await get('/p/an-old-name-7');
check('a stale slug redirects', moved.status === 301);
check('it redirects to the canonical path', moved.headers.get('location') === '/p/silk-jacquard-set-offwhite-7');

const withQuery = await get('/p/an-old-name-7?utm_source=whatsapp');
check('a redirect keeps the query string',
  withQuery.headers.get('location') === '/p/silk-jacquard-set-offwhite-7?utm_source=whatsapp');

queue = [];
const missing = await get('/p/does-not-exist-999');
check('an unknown piece is a real 404', missing.status === 404);
check('the 404 page is served, not the shop', (await missing.text()).includes('This page went missing'));

const noId = await get('/p/no-number-here');
check('a path with no id is a 404', noId.status === 404);

queue = [PRODUCT];
readOk = false;
const broken = await get('/p/silk-jacquard-set-offwhite-7');
check('a Supabase outage still serves the shop', broken.status === 200);
check('and is not cached', broken.headers.get('cache-control') === 'no-store');
readOk = true;

check('POST is rejected', (await get('/p/silk-jacquard-set-offwhite-7', 'POST')).status === 405);
