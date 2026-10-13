# Photo Banners Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The owner edits the main banner (text and a photo) and names the sale from a new Banners tab in the admin panel; the sale banner shows photos of the pieces on sale.

**Architecture:**
- Banner settings are five new nullable columns on the existing one-row `shop_settings`.
- A Cloudflare Pages Function on `/` uses a shared rewrite in `lib/hero.js` to write slide one's text and photo into `index.html` before it is sent. The existing `/p/` function uses the same rewrite, so the banner paints with no script and Google reads the owner's headline.
- The sale slide is still built in the browser by `saleSlide()`. It now adds up to three piece photos, an owner-written headline, and an `<h2>`.

**Tech Stack:**
- Static HTML/CSS/JS, no build step.
- Supabase (Postgres, PostgREST, Storage).
- Cloudflare Pages Functions.
- Node test files that print PASS/FAIL; Playwright smoke test against `wrangler pages dev`; PGlite for SQL.

**Spec:** `docs/superpowers/specs/2026-10-13-photo-banners-design.md`

## Global Constraints

**Defaults.** These apply when a field is empty:
- small heading: `new season`
- headline: `Wrapped in softness, styled with heart`
- line: `Matching sets, abayas & kimonos designed for effortless elegance — made to move with you.`

**Limits and photos:**
- Text limits: small heading 30, headline 70, line 140, sale headline 70. The existing sale banner line stays at 60.
- No photo means slide one renders exactly as it does today, on every screen size.
- Photo upload goes to bucket `product-images`, path `banners/<stamp>-lg.webp` (1600px longest edge) and `-sm.webp` (800px), using the existing `resizeToWebp`. The stored value is the `-lg` public URL.
- The sale slide picks up to three pieces from `PRODUCTS.filter(saleAvailable)` that have a photo, biggest `discountOf` first. Ties keep `PRODUCTS` order.

**Layout:**
- Phone is `max-width:640px`.
  - Main slide: photo across the top at 175px, fading into rose over its lower half; headline 26px. The slide is at most 80px taller than the no-photo slide at 390px wide.
  - Sale slide: photos side by side across the top, a `−N%` tag top-left on each, the same fade.
- Desktop is `min-width:641px`.
  - Main slide: photo on the right 60% with a mask fade from the left.
  - Sale slide: photos flush across the right 60% with the same mask, each tagged bottom-right with the struck old price and the sale price.

**Behaviour:**
- Automatic sale headline: `Up to N% off <span class="nowrap">selected pieces</span>`. A custom headline uses `text-wrap: balance`. The sale heading is an `<h2>`.
- `/` is served `public, max-age=300, stale-while-revalidate=3600`. If Supabase can't be read, the unmodified `index.html` is served with `no-store`.
- Every value written into HTML is escaped. A `hero_image` that doesn't start with `https://` is ignored.

**Git and live steps:**
- Commit locally after each task. Never `git push`; the owner pushes once at the end.
- The owner runs SQL by hand in the Supabase SQL Editor.

## Review Focus

1. **The served page before the migration.** The column select fails, and `/` must still serve today's banner with no error page. Tested in Task 2 (`fetch failure → unmodified shell, no-store`).
2. **Hostile banner text from a compromised admin session** (`"><script>`). It must not break out of the served HTML or the live DOM. Tested in Task 2 (served) and Task 4 (DOM).
3. **A sale where every piece lacks a photo, or a single piece is on sale.** That piece keeps today's text-only slide; one piece shows one photo, not three gaps. Tested in Task 3.
4. **The owner removes the photo after uploading one.** Slide one returns to the plain rose banner, both served and live. Tested in Tasks 2 and 4.
5. **A long custom sale headline on a phone.** It must not overflow or cause sideways scroll. Tested in Task 3 (no sideways scroll at 390px with a 70-character headline).

---

## File structure

| File | Responsibility |
|---|---|
| `supabase/banner-settings.sql` (new) | 5 columns + length checks on `shop_settings` |
| `supabase/verify-banner-settings.sql` (new) | rolled-back checks: columns, limits, privileges |
| `lib/hero.js` (new) | `heroFromRow`, `renderHeroSlide`, `applyHero`, `fetchHero`, `handleHome` |
| `functions/index.js` (new) | adapter: `/` → `handleHome` |
| `public/_routes.json` | add `"/"` |
| `lib/product-page.js` | apply the hero rewrite to `/p/` pages too |
| `public/index.html` | `<!--hero:start-->` / `<!--hero:end-->` markers around slide one |
| `public/js/app.js` | settings load/save, Banners tab, banner photo upload, sale slide photos, live slide-one update |
| `public/css/styles.css` | photo layouts for both slides, phone and desktop |
| `tests/hero.test.mjs` (new) | Node tests for `lib/hero.js` against the real `index.html` |
| `tests/ui-smoke.mjs` | browser checks for both slides and the Banners tab |
| `docs/REMAINING-WORK.md` | rollout section |

---

### Task 1: Database columns

**Files:**
- Create: `supabase/banner-settings.sql`
- Create: `supabase/verify-banner-settings.sql`
- Modify: `supabase/schema.sql` (run-order header)

**Interfaces:**
- Produces: `shop_settings` columns `hero_eyebrow text`, `hero_title text`, `hero_text text`, `hero_image text`, `sale_title text`, all nullable, with named length checks `shop_settings_hero_eyebrow_len` (≤30), `shop_settings_hero_title_len` (≤70), `shop_settings_hero_text_len` (≤140), `shop_settings_hero_image_len` (≤500), `shop_settings_sale_title_len` (≤70).

- [ ] **Step 1: Write the verify script (the failing test)**

`supabase/verify-banner-settings.sql`:

```sql
-- ============================================================
-- Checks banner-settings.sql, then throws everything away.
-- Safe on the live database: one transaction ending in ROLLBACK.
-- Read the NOTICE output (or the result rows) for PASS/FAIL.
-- ============================================================
begin;

do $$
declare
  v_ok boolean;
begin
  -- 1. The five columns exist.
  select count(*) = 5 into v_ok from information_schema.columns
   where table_schema = 'public' and table_name = 'shop_settings'
     and column_name in ('hero_eyebrow','hero_title','hero_text','hero_image','sale_title');
  raise notice '%  shop_settings has the five banner columns', case when v_ok then 'PASS ' else 'FAIL ' end;

  -- 2. Values at the limit are accepted; one over is refused.
  update public.shop_settings set hero_eyebrow = repeat('a', 30), hero_title = repeat('a', 70),
    hero_text = repeat('a', 140), sale_title = repeat('a', 70) where id = 1;
  raise notice 'PASS  values at the limits are accepted';
  begin
    update public.shop_settings set hero_title = repeat('a', 71) where id = 1;
    raise notice 'FAIL  a 71-character headline was accepted';
  exception when check_violation then
    raise notice 'PASS  a 71-character headline is refused';
  end;
  begin
    update public.shop_settings set sale_title = repeat('a', 71) where id = 1;
    raise notice 'FAIL  a 71-character sale headline was accepted';
  exception when check_violation then
    raise notice 'PASS  a 71-character sale headline is refused';
  end;
end $$;

-- 3. Visitors can read the banner; only the existing admin policy writes.
select case when has_column_privilege('anon', 'public.shop_settings', 'hero_title', 'select')
            then 'PASS  anon can read the banner columns'
            else 'FAIL  anon cannot read the banner columns' end as check
union all
select case when has_table_privilege('anon', 'public.shop_settings', 'update')
            then 'FAIL  anon can update shop_settings'
            else 'PASS  anon cannot update shop_settings' end;

rollback;
```

- [ ] **Step 2: Run it against a fresh database to watch it fail**

Use the scratchpad PGlite runner from earlier work (`pg-fresh.mjs` pattern): stand up the Supabase roles, then run `schema.sql`, `place-order.sql`, `sale-pricing.sql`, `delivery-by-region.sql`, then `verify-banner-settings.sql`, printing notices and the result rows.

Expected: `FAIL  shop_settings has the five banner columns`, and an error on the first `update` (column does not exist).

- [ ] **Step 3: Write the migration**

`supabase/banner-settings.sql`:

```sql
-- ============================================================
-- Banner settings, 2026-10-13. Run once in the Supabase SQL Editor,
-- after sale-pricing.sql. Safe to run twice.
--
-- The main banner's text and photo, and the sale banner's headline,
-- all edited from the admin panel's Banners tab. Empty means the
-- default text, or no photo. shop_settings' existing policies (anyone
-- reads, the admin writes) and grants already cover new columns.
-- ============================================================
alter table public.shop_settings
  add column if not exists hero_eyebrow text,
  add column if not exists hero_title text,
  add column if not exists hero_text text,
  add column if not exists hero_image text,
  add column if not exists sale_title text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'shop_settings_hero_eyebrow_len') then
    alter table public.shop_settings add constraint shop_settings_hero_eyebrow_len check (char_length(hero_eyebrow) <= 30);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'shop_settings_hero_title_len') then
    alter table public.shop_settings add constraint shop_settings_hero_title_len check (char_length(hero_title) <= 70);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'shop_settings_hero_text_len') then
    alter table public.shop_settings add constraint shop_settings_hero_text_len check (char_length(hero_text) <= 140);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'shop_settings_hero_image_len') then
    alter table public.shop_settings add constraint shop_settings_hero_image_len check (char_length(hero_image) <= 500);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'shop_settings_sale_title_len') then
    alter table public.shop_settings add constraint shop_settings_sale_title_len check (char_length(sale_title) <= 70);
  end if;
end $$;
```

In `supabase/schema.sql`'s run-order header, after the `delivery-by-region.sql` lines, add:

```sql
--   banner-settings.sql         after sale-pricing.sql — banner text, photo and
--                               sale headline columns on shop_settings
```

- [ ] **Step 4: Run the verify script again, and run the migration twice**

Same runner, with `banner-settings.sql` applied twice before the verify script.

Expected: every line `PASS`; no error on the second run.

- [ ] **Step 5: Commit**

```bash
git add supabase/banner-settings.sql supabase/verify-banner-settings.sql supabase/schema.sql
git commit -m "Add banner settings columns to shop_settings"
```

---

### Task 2: Server-side banner rewrite for `/` and `/p/`

**Files:**
- Create: `lib/hero.js`
- Create: `functions/index.js`
- Create: `tests/hero.test.mjs`
- Modify: `public/index.html:117-127` (markers around slide one)
- Modify: `public/_routes.json`
- Modify: `lib/product-page.js` (`handle`, both 200 paths)

**Interfaces:**
- Consumes: Task 1's column names; `FALLBACK_URL`, `FALLBACK_KEY` exported by `lib/product-page.js`.
- Produces (all exported from `lib/hero.js`):
  - `HERO_DEFAULTS = { eyebrow, title, text }`
  - `heroFromRow(row) -> { eyebrow, title, text, image }`, where empty or missing fields take the defaults, and `image` is `''` unless it starts with `https://`.
  - `renderHeroSlide(hero) -> string`, the full slide-one markup.
  - `applyHero(html, hero) -> string`, which replaces what lies between `<!--hero:start-->` and `<!--hero:end-->`, and throws if the markers are missing.
  - `fetchHero(env) -> Promise<hero|null>`
  - `handleHome(request, env) -> Promise<Response>`
  - `smallVariant(url) -> string|null`
- Task 4 builds the same markup in the browser. The class names it relies on: `.hero-slide.has-photo`, `img.hero-photo`, `.hero-copy`.

- [ ] **Step 1: Add the markers to `public/index.html`**

Wrap the existing slide one, unchanged, so the static page still paints today's banner:

```html
        <div class="hero-track" id="heroTrack">
          <!--hero:start-->
          <div class="hero hero-slide">
            ...unchanged...
          </div>
          <!--hero:end-->
        </div>
```

- [ ] **Step 2: Write the failing test**

`tests/hero.test.mjs`:

```js
// Run: node tests/hero.test.mjs
//
// Runs against the REAL public/index.html, so a hero that changes shape fails
// here rather than silently serving the default banner forever.
import { readFile } from 'node:fs/promises';
import { HERO_DEFAULTS, heroFromRow, renderHeroSlide, applyHero, handleHome } from '../lib/hero.js';

const SHELL = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const check = (label, cond) => console.log((cond ? 'PASS  ' : 'FAIL  ') + label);
const slideOf = html => /<!--hero:start-->([\s\S]*?)<!--hero:end-->/.exec(html)[1];
const PHOTO = 'https://proj.supabase.co/storage/v1/object/public/product-images/banners/abc-lg.webp';

// --- settings
const empty = heroFromRow({});
check('empty settings take every default', empty.title === HERO_DEFAULTS.title && empty.eyebrow === HERO_DEFAULTS.eyebrow && empty.text === HERO_DEFAULTS.text && empty.image === '');
check('null row takes the defaults', heroFromRow(null).title === HERO_DEFAULTS.title);
check('blank text takes the default', heroFromRow({ hero_title: '   ' }).title === HERO_DEFAULTS.title);
check('a non-https photo is ignored', heroFromRow({ hero_image: 'javascript:alert(1)' }).image === '');

// --- the shell carries the markers, and today's banner is the default
check('index.html has the hero markers', /<!--hero:start-->[\s\S]*<!--hero:end-->/.test(SHELL));
check('the default slide matches what index.html ships',
  slideOf(applyHero(SHELL, empty)).replace(/\s+/g, ' ').includes('Wrapped in softness, styled with heart'));
check('no photo -> no photo element and no has-photo class',
  !/hero-photo/.test(renderHeroSlide(empty)) && !/has-photo/.test(renderHeroSlide(empty)));

// --- the owner's text and photo
const own = heroFromRow({ hero_eyebrow: 'autumn', hero_title: 'Made by hand, one at a time', hero_text: 'New pieces every week.', hero_image: PHOTO });
const slide = slideOf(applyHero(SHELL, own));
check('the headline is the <h1>', /<h1>Made by hand, one at a time<\/h1>/.test(slide));
check('the small heading and line are used', slide.includes('>autumn<') && slide.includes('New pieces every week.'));
check('the photo is an <img> with both sizes',
  slide.includes(`src="${PHOTO}"`) && slide.includes(PHOTO.replace('-lg.webp', '-sm.webp') + ' 800w'));
check('the slide is marked has-photo', /class="hero hero-slide has-photo"/.test(slide));
check('the photo loads first, decoratively', /fetchpriority="high"/.test(slide) && /alt=""/.test(slide));
check('the button still opens the collection', slide.includes('onclick="shopFromHero(false)"'));
check('the page keeps one <h1>', (applyHero(SHELL, own).match(/<h1[\s>]/g) || []).length === 1);

// --- hostile text cannot escape
const bad = slideOf(applyHero(SHELL, heroFromRow({ hero_title: '"><script>alert(1)</script>', hero_text: '<img src=x onerror=alert(1)>' })));
check('a hostile headline is escaped', !bad.includes('<script>') && bad.includes('&lt;script&gt;'));
check('a hostile line is escaped', !bad.includes('<img src=x') && bad.includes('&lt;img'));

// --- missing markers fail loudly
let threw = false;
try { applyHero('<html></html>', empty); } catch { threw = true; }
check('a shell without markers throws', threw);

// --- the route
let reply = { ok: true, body: [{ hero_title: 'From the route', hero_image: PHOTO }] };
let fetched = [];
globalThis.fetch = async url => {
  fetched.push(String(url));
  return reply.ok ? new Response(JSON.stringify(reply.body), { status: 200 }) : new Response('boom', { status: 400 });
};
const env = { ASSETS: { fetch: async () => new Response(SHELL, { status: 200 }) } };
const get = (method = 'GET') => handleHome(new Request('https://dinasstudio.com/', { method }), env);

const ok = await get();
const okBody = await ok.text();
check('/ returns 200 html', ok.status === 200 && ok.headers.get('content-type').includes('text/html'));
check('/ carries the saved headline', okBody.includes('<h1>From the route</h1>'));
check('/ is cached for 5 minutes', /max-age=300/.test(ok.headers.get('cache-control')));
check('/ reads only the banner columns of row 1',
  fetched[0].includes('shop_settings?id=eq.1') && fetched[0].includes('select=hero_eyebrow,hero_title,hero_text,hero_image'));

reply = { ok: false };
const down = await get();
const downBody = await down.text();
check('Supabase down (or columns missing) -> today\'s page', down.status === 200 && downBody === SHELL);
check('and it is not cached', down.headers.get('cache-control') === 'no-store');

reply = { ok: true, body: [{}] };
check('a row with no banner fields -> the default banner', (await (await get()).text()).includes('Wrapped in softness, styled with heart'));

check('POST is rejected', (await get('POST')).status === 405);
```

- [ ] **Step 3: Run it to verify it fails**

Run: `node tests/hero.test.mjs`
Expected: a crash on the import (`Cannot find module '../lib/hero.js'`).

- [ ] **Step 4: Write `lib/hero.js`**

```js
// The main banner (slide one) as the owner set it in the admin panel's Banners
// tab, written into index.html before it is sent. Doing it here rather than in
// the browser means the banner paints with no script, with no flash of the
// default text, and the owner's headline is what Google reads.
//
// Shared by GET / (functions/index.js) and GET /p/<slug> (lib/product-page.js),
// which both serve the same shell. public/js/app.js builds the same markup to
// update the slide in place after the owner saves; the class names below are
// what its CSS and that code rely on.
import { FALLBACK_URL, FALLBACK_KEY } from './product-page.js';

export const HERO_DEFAULTS = {
  eyebrow: 'new season',
  title: 'Wrapped in softness, styled with heart',
  text: 'Matching sets, abayas & kimonos designed for effortless elegance — made to move with you.'
};

const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const ARROW = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>`;

const filled = v => (typeof v === 'string' && v.trim()) ? v.trim() : '';

export function heroFromRow(row) {
  const r = row || {};
  const image = filled(r.hero_image);
  return {
    eyebrow: filled(r.hero_eyebrow) || HERO_DEFAULTS.eyebrow,
    title: filled(r.hero_title) || HERO_DEFAULTS.title,
    text: filled(r.hero_text) || HERO_DEFAULTS.text,
    // Only an https URL becomes an <img src>; anything else is ignored rather
    // than written into the page.
    image: /^https:\/\//.test(image) ? image : ''
  };
}

// Banner photos are stored as a -lg/-sm pair, like product photos.
export function smallVariant(url) {
  return /-lg\.webp($|\?)/.test(url) ? url.replace('-lg.webp', '-sm.webp') : null;
}

export function renderHeroSlide(hero) {
  const sm = hero.image && smallVariant(hero.image);
  const photo = hero.image
    ? `<img class="hero-photo" src="${esc(hero.image)}"${sm ? ` srcset="${esc(sm)} 800w, ${esc(hero.image)} 1600w" sizes="(max-width:640px) 100vw, 60vw"` : ''} alt="" fetchpriority="high">`
    : '';
  return `
          <div class="hero hero-slide${hero.image ? ' has-photo' : ''}">
            ${photo}
            <div class="hero-copy">
            <div class="eyebrow">${esc(hero.eyebrow)}</div>
            <h1>${esc(hero.title)}</h1>
            <p>${esc(hero.text)}</p>
            <button class="hero-cta" onclick="shopFromHero(false)">
              Shop the collection
              ${ARROW}
            </button>
            </div>
          </div>
          `;
}

export function applyHero(html, hero) {
  const re = /<!--hero:start-->[\s\S]*?<!--hero:end-->/;
  if (!re.test(html)) throw new Error('hero markers not found in index.html');
  return html.replace(re, () => `<!--hero:start-->${renderHeroSlide(hero)}<!--hero:end-->`);
}

// null when the settings can't be read (Supabase down, or banner-settings.sql
// not run yet, so the columns don't exist): callers serve the page unchanged.
export async function fetchHero(env = {}) {
  const base = env.SUPABASE_URL || FALLBACK_URL;
  const key = env.SUPABASE_ANON_KEY || FALLBACK_KEY;
  try {
    const res = await fetch(`${base}/rest/v1/shop_settings?id=eq.1&select=hero_eyebrow,hero_title,hero_text,hero_image`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` }
    });
    if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 160)}`);
    return heroFromRow((await res.json())[0]);
  } catch (e) {
    console.error('Could not load banner settings -', e.message);
    return null;
  }
}

const htmlResponse = (body, cache) => new Response(body, {
  status: 200,
  headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': cache }
});

export async function handleHome(request, env = {}) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405 });
  }
  const url = new URL(request.url);
  const shell = await (await env.ASSETS.fetch(new Request(new URL('/index.html', url.origin), { method: 'GET' }))).text();
  const hero = await fetchHero(env);
  if (!hero) return htmlResponse(shell, 'no-store');
  return htmlResponse(applyHero(shell, hero), 'public, max-age=300, stale-while-revalidate=3600');
}
```

`functions/index.js`:

```js
// Cloudflare Pages route: GET /
// Every file in functions/ becomes a route, so this holds only the adapter; the
// logic and its test live in lib/.
import { handleHome } from '../lib/hero.js';

export const onRequest = ({ request, env }) => handleHome(request, env);
```

`public/_routes.json`:

```json
{"version":1,"include":["/","/p/*","/sitemap.xml","/api/*"],"exclude":[]}
```

- [ ] **Step 5: Apply the rewrite on product pages**

In `lib/product-page.js`, add the import at the top:

```js
import { fetchHero, applyHero } from './hero.js';
```

The two modules import each other. That's safe because neither uses the other's exports at load time; Task 2 Step 6 proves it.

In `handle`, start the banner read alongside the product read, and apply it on both 200 paths:

```js
  const heroP = fetchHero(env);   // in parallel with the product read below
```

Place this immediately before `let product;`. Then, on the Supabase-outage fallback path:

```js
    const shell = await asset('/index.html');
    const hero = await heroP;
    const text = await shell.text();
    return htmlResponse(hero ? applyHero(text, hero) : text, 200, 'no-store');
```

On the success path:

```js
  const shell = await asset('/index.html');
  const hero = await heroP;
  let html = renderHead(await shell.text(), product, url.origin);
  if (hero) html = applyHero(html, hero);
```

The banner read now starts before the product read. In `tests/product-page.test.mjs`, the check that assumes the product is the first URL fetched must look for it among the fetches instead:

```js
check('the piece is read by id', fetched.some(u => u.includes('products?id=eq.7')));
```

- [ ] **Step 6: Run the tests**

Run: `node tests/hero.test.mjs` and `node tests/product-page.test.mjs`
Expected: every line PASS in both. In `product-page.test.mjs`, the stub returns the product row for the banner read too, which `heroFromRow` treats as having no banner fields, so its existing assertions hold.

- [ ] **Step 7: Commit**

```bash
git add lib/hero.js functions/index.js tests/hero.test.mjs public/index.html public/_routes.json lib/product-page.js
git commit -m "Serve the main banner from shop_settings on / and product pages"
```

---

### Task 3: Sale slide with piece photos and the owner's headline

**Files:**
- Modify: `public/js/app.js` (`saleSlide`, new `salePicks`, new `saleTitleText`)
- Modify: `public/css/styles.css` (hero section)
- Modify: `tests/ui-smoke.mjs` (hero block ~line 494; stale-banner block ~line 590)

**Interfaces:**
- Consumes: `saleAvailable(p)`, `discountOf(p)`, `chargedPrice(p)`, `escHtml(v)`, `smallVariant(src)` (all existing in `app.js`).
- Produces:
  - `let saleTitleText = ''`, which Task 4 sets from settings;
  - `salePicks() -> product[]` (≤3);
  - sale slide markup `.hero-slide.hero-sale` with `.sale-photos > .sale-photo` (each with an `img` and a `.sale-photo-tag`), and an `<h2>` heading.

- [ ] **Step 1: Update the existing tests that the change legitimately breaks**

- In the hero block, `noteInjected` counts every `<img>` in the carousel; the sale slide now has photos. Change it to `document.querySelectorAll('.hero-carousel img[onerror], .hero-carousel img[src="x"]').length`.
- In the stale-banner block: `document.querySelector('.hero-sale h1')` → `document.querySelector('.hero-sale h2')`.

- [ ] **Step 2: Write the failing tests**

Add after the hero block's checks:

```js
// The sale slide shows the pieces themselves: up to three with a photo, biggest
// discount first. The owner can name the sale; otherwise the automatic headline
// keeps "selected pieces" together. Its heading is an <h2>: one <h1> per page.
const salePhotos = await page.evaluate(async () => {
  const saved = PRODUCTS.map(p => ({ d: p.discountPercent, s: p.stock, i: p.images }));
  const savedTitle = saleTitleText;
  const withPhoto = PRODUCTS.filter(p => (p.images || []).length);
  const res = {};
  try {
    PRODUCTS.forEach(p => { p.discountPercent = 0; p.stock = 'in'; });
    const [a, b, c, d] = withPhoto;
    a.discountPercent = 10; b.discountPercent = 30; c.discountPercent = 20; d.discountPercent = 25;
    const noPhoto = PRODUCTS.find(p => !withPhoto.includes(p)) || null;
    if (noPhoto) noPhoto.discountPercent = 40;   // biggest discount, but no photo
    saleTitleText = '';
    renderHero();
    const slide = () => document.querySelector('.hero-sale');
    const tiles = () => [...slide().querySelectorAll('.sale-photo')];
    res.count = tiles().length;
    res.order = tiles().map(t => t.dataset.id).join(',');
    res.want = [b, d, c].map(p => String(p.id)).join(',');
    res.tag = tiles()[0].querySelector('.sale-photo-tag').textContent.replace(/\s+/g, ' ').trim();
    res.wantTag = `AED ${b.price}`;
    res.h2 = !!slide().querySelector('h2') && !slide().querySelector('h1');
    res.nowrap = !!slide().querySelector('h2 .nowrap') && slide().querySelector('h2 .nowrap').textContent === 'selected pieces';
    res.h1s = document.querySelectorAll('h1').length;

    // Only one piece on sale -> one photo.
    PRODUCTS.forEach(p => { p.discountPercent = 0; });
    a.discountPercent = 15; renderHero();
    res.single = tiles().length;

    // Every sale piece lacks a photo -> today's text-only slide.
    PRODUCTS.forEach(p => { p.discountPercent = 0; });
    if (noPhoto) { noPhoto.discountPercent = 15; renderHero(); res.textOnly = !!slide() && tiles().length === 0 && !slide().classList.contains('has-photos'); }
    else res.textOnly = true;

    // The owner's headline wins, escaped, balanced; cleared, the automatic one returns.
    PRODUCTS.forEach(p => { p.discountPercent = 0; });
    a.discountPercent = 15;
    saleTitleText = 'End of summer: short sets, 15% off <img src=x onerror=1>';
    renderHero();
    res.custom = slide().querySelector('h2').textContent.trim();
    res.customSafe = !slide().querySelector('h2 img');
    // A 70-character headline on a phone must not push the page sideways.
    saleTitleText = 'Our end of summer sale on every short set, linen and silk, 15% off now';
    renderHero();
    res.longNoScroll = document.documentElement.scrollWidth <= window.innerWidth;
    saleTitleText = '';
    renderHero();
    res.auto = slide().querySelector('h2').textContent.replace(/\s+/g, ' ').trim();
  } finally {
    PRODUCTS.forEach((p, i) => { p.discountPercent = saved[i].d; p.stock = saved[i].s; p.images = saved[i].i; });
    saleTitleText = savedTitle;
    renderHero();
  }
  return res;
}).catch(e => ({ error: e.message }));
if (salePhotos.error) console.log('sale photo checks unavailable:', String(salePhotos.error).slice(0, 200));
check(`the sale slide shows three photos (${salePhotos.count})`, salePhotos.count === 3);
check(`biggest discount first, photo-less pieces skipped (${salePhotos.order} vs ${salePhotos.want})`, salePhotos.order === salePhotos.want);
check(`each photo carries its sale price ("${salePhotos.tag}")`, (salePhotos.tag || '').includes(salePhotos.wantTag));
check('the sale heading is an <h2>, leaving one <h1> on the page', salePhotos.h2 === true && salePhotos.h1s === 1);
check('"selected pieces" stays together', salePhotos.nowrap === true);
check('one piece on sale shows one photo', salePhotos.single === 1);
check('a sale with no photos keeps the text-only slide', salePhotos.textOnly === true);
check(`the owner's sale headline is used ("${salePhotos.custom}")`, (salePhotos.custom || '').startsWith('End of summer: short sets, 15% off'));
check('and cannot inject markup', salePhotos.customSafe === true);
check('a 70-character sale headline does not scroll sideways', salePhotos.longNoScroll === true);
check(`cleared, the automatic headline returns ("${salePhotos.auto}")`, salePhotos.auto === 'Up to 15% off selected pieces');
```

The page runs at 1280px wide here. Add a phone check after the existing "with JavaScript off" block, in a 390px context:

```js
{
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pp = await phone.newPage();
  await pp.goto(BASE + '/', { waitUntil: 'networkidle' });
  await pp.waitForSelector('.card, .grid-message', { timeout: 25000 });
  const sideways = await pp.evaluate(() => {
    PRODUCTS.forEach(p => { p.discountPercent = 0; p.stock = 'in'; });
    PRODUCTS.filter(p => (p.images || []).length).slice(0, 3).forEach(p => { p.discountPercent = 15; });
    renderHero(); heroGo(1);
    return document.documentElement.scrollWidth > window.innerWidth;
  });
  check('on a phone, the sale slide with photos does not scroll sideways', sideways === false);
  await phone.close();
}
```

- [ ] **Step 3: Run the smoke test to watch the new checks fail**

Run the local server, then the smoke test with its `BASE`:

```bash
<scratchpad>/node_modules/.bin/wrangler pages dev public --port 8791
BASE=http://127.0.0.1:8791 node <scratchpad>/ui-smoke.mjs
```

Copy `tests/ui-smoke.mjs` into the scratchpad first, so the scratchpad's Playwright resolves.

Expected: the new sale-photo checks FAIL (`count` 0, no `h2`, `saleTitleText is not defined`). Everything else passes.

- [ ] **Step 4: Implement**

In `app.js`, beside `let saleNoteText = '';`:

```js
let saleTitleText = '';   // the owner's sale headline; '' means the automatic one
```

Replace `saleSlide()`:

```js
// Up to three pieces to show on the sale slide: on sale, buyable and with a
// photo, biggest discount first. Ties keep the shop's own order.
function salePicks(){
  return PRODUCTS.filter(p => saleAvailable(p) && (p.images || []).length)
    .map((p, i) => ({ p, i }))
    .sort((x, y) => discountOf(y.p) - discountOf(x.p) || x.i - y.i)
    .slice(0, 3).map(x => x.p);
}

// The sale slide is generated from the pieces on sale, so it can never
// advertise a discount that is not actually available. It reads saleAvailable,
// the same definition the On Sale filter uses, so the button on this slide
// always opens a filter showing what the headline promised. '' when nothing
// is on sale. Its heading is an <h2>: slide one's <h1> is the page's headline.
function saleSlide(){
  const onSale = PRODUCTS.filter(saleAvailable);
  if(!onSale.length) return '';
  const top = Math.max(...onSale.map(discountOf));
  const title = saleTitleText
    ? escHtml(saleTitleText)
    : `Up to ${top}% off <span class="nowrap">selected pieces</span>`;
  const picks = salePicks();
  const photos = picks.length ? `
      <div class="sale-photos">
        ${picks.map(p => {
          const src = p.images[0], sm = smallVariant(src);
          return `<a class="sale-photo" data-id="${p.id}" href="${productPath(p)}" onclick="event.preventDefault(); openProduct(${p.id});" aria-label="${escHtml(p.name)}">
            <img src="${sm || src}" alt="" loading="lazy">
            <span class="sale-photo-tag"><s>AED ${p.price}</s> <span class="sale-photo-now">AED ${chargedPrice(p)}</span><span class="sale-photo-pct">−${discountOf(p)}%</span></span>
          </a>`;
        }).join('')}
      </div>` : '';
  return `
    <div class="hero hero-slide hero-sale${picks.length ? ' has-photos' : ''}">
      ${photos}
      <div class="hero-copy">
      <div class="eyebrow">sale</div>
      <h2>${title}</h2>
      ${saleNoteText ? `<p>${escHtml(saleNoteText)}</p>` : ''}
      <button class="hero-cta" onclick="shopFromHero(true)">Shop the sale ${HERO_ARROW}</button>
      </div>
    </div>`;
}
```

In `styles.css`, after `.hero-cta{...}`, add the slide-photo layouts. These are shared by slide one with a photo (Task 4) and the sale slide:

```css
  /* ----- Banner photos -----
     Slide one with the owner's photo, and the sale slide with the pieces on
     sale. Desktop: the copy keeps the left; the photos take the right 60% and
     fade in through a mask, so there is no seam against the rose gradient.
     Phone: the photos run across the top and fade into the rose; the copy sits
     below, never over the busy part of the picture. */
  .hero h2{
    color:#fff; font-size:32px; line-height:1.08; margin-top:4px;
    position:relative; z-index:2; max-width:280px; text-wrap:balance;
  }
  .nowrap{ white-space:nowrap; }
  .hero-copy{ position:relative; z-index:2; }
  .hero-photo, .sale-photos{
    position:absolute; top:0; right:0; bottom:0; width:60%;
    -webkit-mask-image:linear-gradient(90deg, transparent 0%, #000 26%);
            mask-image:linear-gradient(90deg, transparent 0%, #000 26%);
  }
  .hero-photo{ height:100%; object-fit:cover; object-position:right center; }
  .hero-slide.has-photo:before, .hero-slide.has-photo:after,
  .hero-sale.has-photos:before, .hero-sale.has-photos:after{ display:none; }
  .hero-slide.has-photo .hero-copy, .hero-sale.has-photos .hero-copy{ max-width:44%; }
  .sale-photos{ display:flex; }
  .sale-photo{ position:relative; flex:1; overflow:hidden; display:block; }
  .sale-photo + .sale-photo{ border-left:2px solid rgba(255,255,255,.45); }
  .sale-photo img{ position:absolute; inset:0; width:100%; height:100%; object-fit:cover; object-position:center 20%; }
  .sale-photo-tag{
    position:absolute; right:10px; bottom:12px; z-index:2; background:#fff; color:var(--primary);
    font-weight:800; font-size:12px; padding:4px 9px; border-radius:10px; white-space:nowrap;
  }
  .sale-photo-tag s{ color:var(--ink-soft); font-weight:600; }
  .sale-photo-pct{ display:none; }
  @media (max-width:640px){
    .hero-slide.has-photo, .hero-sale.has-photos{
      padding:0 20px 20px;
      background:linear-gradient(180deg, var(--primary) 0%, var(--primary) 40%, var(--primary-tint) 80%, var(--accent-deep) 100%);
    }
    .hero-photo, .sale-photos{
      position:relative; display:block; width:auto; height:175px; margin:0 -20px -26px;
      -webkit-mask-image:linear-gradient(180deg, #000 45%, transparent 100%);
              mask-image:linear-gradient(180deg, #000 45%, transparent 100%);
    }
    .hero-photo{ width:calc(100% + 40px); }
    .sale-photos{ display:flex; }
    .hero-slide.has-photo .hero-copy, .hero-sale.has-photos .hero-copy{ max-width:none; }
    .hero-slide.has-photo h1, .hero-sale.has-photos h2{ font-size:26px; line-height:1.15; max-width:none; }
    .sale-photo-tag{ top:8px; left:8px; right:auto; bottom:auto; font-size:11px; padding:3px 7px; }
    .sale-photo-tag s, .sale-photo-now{ display:none; }
    .sale-photo-pct{ display:inline; }
  }
  @media (min-width:640px){ .hero h2{ max-width:420px; font-size:36px; } }
  @media (min-width:900px){ .hero h2{ max-width:560px; font-size:46px; } }
```

On phones the photo fades into the slide's own rose through a mask, rather than through a colour overlay that has to match the gradient. That's the seam fix from the mock-up iterations.

- [ ] **Step 5: Run the smoke test**

Same commands as Step 3.
Expected: every line PASS, including the existing hero, stale-banner, rotation and first-paint checks.

- [ ] **Step 6: Screenshot the sale slide**

At 1280×800 and 390×844, using the scratchpad `shot-sale2-nb.mjs` pattern but with the real markup: no injected CSS; set three photo pieces to 15% off and call `heroGo(1)`. Compare with `mock-sale-desktop.png` and `mock-sale-phone.png`: tags bottom-right on desktop and `−N%` top-left on phone, the fade with no seam, and "selected pieces" on line two.

- [ ] **Step 7: Commit**

```bash
git add public/js/app.js public/css/styles.css tests/ui-smoke.mjs
git commit -m "Show the pieces on sale in the sale banner, with the owner's headline"
```

---

### Task 4: Banners tab and the live slide-one update

**Files:**
- Modify: `public/js/app.js`:
  - `apiService.getSaleNote` / `saveSaleNote` → `getShopSettings` / `saveShopSettings`;
  - `loadSaleNote` → `loadShopSettings`;
  - `saveSaleNote()` removed;
  - the sale-note row removed from Inventory;
  - new `adminTab === 'banners'`;
  - `uploadPhoto` takes a sizes argument;
  - new `heroSettings`, `applyHeroSettings`, `saveMainBanner`, `saveSaleBanner`, `pickBannerPhoto`, `removeBannerPhoto`.
- Modify: `public/css/styles.css` (Banners form).
- Modify: `tests/ui-smoke.mjs` (note-loading block ~line 553; stale-banner block ~line 588; new Banners block).

**Interfaces:**
- Consumes: Task 1's columns; Task 3's `saleTitleText` and `saleSlide()`; Task 2's markup contract (`.has-photo`, `img.hero-photo`, `.hero-copy`).
- Produces:
  - `apiService.getShopSettings() -> Promise<object>`: the `shop_settings` row, or `{}` on PGRST205 or any error.
  - `apiService.saveShopSettings(fields) -> Promise<boolean>`.
  - `heroSettings`, a raw-column object.
  - `loadShopSettings()`, which sets `saleNoteText`, `saleTitleText` and `heroSettings`.
  - `applyHeroSettings()`, which rewrites slide one in place from `heroSettings`.
  - `BANNER_DEFAULTS`, mirroring `HERO_DEFAULTS` in `lib/hero.js`.

- [ ] **Step 1: Update the tests that rename**

In the note-loading block (~line 553) and the stale-banner block (~line 588), `apiService.getSaleNote = async () => X` becomes `apiService.getShopSettings = async () => ({ sale_note: X })`. Do the same for the saved and restored reference, and `loadSaleNote()` becomes `loadShopSettings()`. The assertions are unchanged.

- [ ] **Step 2: Write the failing tests**

Add before `check('a sale carousel advances on its own', ...)`:

```js
// The Banners tab: the main banner's text and photo, and the sale banner's
// headline and line. Saving updates slide one on the page at once.
const banners = await page.evaluate(async () => {
  const realFrom = supabaseClient.from, realStorage = supabaseClient.storage;
  const realOrders = apiService.getOrders, realReqs = apiService.getRestockRequests;
  apiService.getOrders = async () => []; apiService.getRestockRequests = async () => [];
  const savedSettings = { ...heroSettings }, savedNote = saleNoteText, savedTitle = saleTitleText;
  const writes = [], uploads = [];
  supabaseClient.from = table => ({
    update(v){ writes.push({ table, v }); return this; },
    eq: async () => ({ error: null })
  });
  supabaseClient.storage = { from: () => ({
    upload: async (path, blob) => { uploads.push(path); return { error: null }; },
    getPublicUrl: path => ({ data: { publicUrl: 'https://example.supabase.co/storage/v1/object/public/product-images/' + path } })
  }) };
  const res = {};
  const slide1 = () => document.querySelector('#heroTrack .hero-slide');
  try {
    adminTab = 'banners'; await renderAdmin();
    const c = document.getElementById('adminContent');
    res.tab = !!c.querySelector('#bnTitle') && !!c.querySelector('#bnSaleTitle') && !!c.querySelector('#bnSaleNote');
    res.placeholder = c.querySelector('#bnTitle').placeholder === 'Wrapped in softness, styled with heart';
    const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };

    // Text: saved, then shown on slide one straight away, escaped.
    set('bnEyebrow', 'autumn'); set('bnTitle', 'Made by hand <b>one</b> at a time'); set('bnText', 'New pieces every week.');
    await saveMainBanner();
    res.wrote = writes.at(-1) && writes.at(-1).table === 'shop_settings' && writes.at(-1).v.hero_title === 'Made by hand <b>one</b> at a time';
    res.live = slide1().querySelector('h1').textContent === 'Made by hand <b>one</b> at a time' && !slide1().querySelector('h1 b');
    res.liveEyebrow = slide1().querySelector('.eyebrow').textContent === 'autumn';

    // A field too long can't be saved.
    adminTab = 'banners'; await renderAdmin();
    set('bnTitle', 'x'.repeat(71));
    res.tooLongBlocked = document.getElementById('bnSaveMain').disabled === true;
    set('bnTitle', 'Made by hand');

    // Photo: two sizes uploaded under banners/, stored as the -lg URL, shown on slide one.
    const canvas = document.createElement('canvas'); canvas.width = 40; canvas.height = 20;
    const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
    await pickBannerPhoto(new File([blob], 'desk.png', { type: 'image/png' }));
    await saveMainBanner();
    res.uploads = uploads.slice();
    res.storedLg = /\/banners\/[^/]+-lg\.webp$/.test(writes.at(-1).v.hero_image || '');
    res.photoShown = slide1().classList.contains('has-photo') && !!slide1().querySelector('img.hero-photo');
    // At 1280px the photo takes the right of the slide; the copy keeps the left.
    const sr = slide1().getBoundingClientRect(), pr = slide1().querySelector('img.hero-photo').getBoundingClientRect();
    res.photoRight = pr.left >= sr.left + sr.width * 0.35 && Math.abs(pr.right - sr.right) < 2;

    // Remove: back to the plain banner.
    adminTab = 'banners'; await renderAdmin();
    removeBannerPhoto();
    await saveMainBanner();
    res.removedNull = writes.at(-1).v.hero_image === null;
    res.plainAgain = !slide1().classList.contains('has-photo') && !slide1().querySelector('img');

    // Sale headline and line, saved together; the Inventory tab no longer has the line.
    saleNoteText = 'Kept from before';
    adminTab = 'banners'; await renderAdmin();
    res.notePrefilled = document.getElementById('bnSaleNote').value === 'Kept from before';
    set('bnSaleTitle', 'End of summer: short sets'); set('bnSaleNote', 'Ends Sunday');
    await saveSaleBanner();
    res.saleWrote = writes.at(-1).v.sale_title === 'End of summer: short sets' && writes.at(-1).v.sale_note === 'Ends Sunday';
    res.saleState = saleTitleText === 'End of summer: short sets' && saleNoteText === 'Ends Sunday';
    adminTab = 'inventory'; await renderAdmin();
    res.noteMoved = !document.getElementById('saleNoteInput');

    // Clearing every main field brings the defaults back.
    adminTab = 'banners'; await renderAdmin();
    set('bnEyebrow', ''); set('bnTitle', ''); set('bnText', '');
    await saveMainBanner();
    res.defaultsBack = slide1().querySelector('h1').textContent === 'Wrapped in softness, styled with heart'
      && writes.at(-1).v.hero_title === null;
  } finally {
    supabaseClient.from = realFrom; supabaseClient.storage = realStorage;
    apiService.getOrders = realOrders; apiService.getRestockRequests = realReqs;
    heroSettings = savedSettings; saleNoteText = savedNote; saleTitleText = savedTitle;
    applyHeroSettings(); renderHero(); closeAllSheets({ keepUrl: true });
  }
  return res;
}).catch(e => ({ error: e.message }));
if (banners.error) console.log('Banners tab checks unavailable:', String(banners.error).slice(0, 200));
check('the admin panel has a Banners tab with both banners\' fields', banners.tab === true);
check('empty fields show the default text as a hint', banners.placeholder === true);
check('saving the main banner writes shop_settings', banners.wrote === true);
check('and slide one shows it at once, as text', banners.live === true && banners.liveEyebrow === true);
check('a 71-character headline cannot be saved', banners.tooLongBlocked === true);
check(`a banner photo is uploaded in two sizes under banners/ (${(banners.uploads || []).join(', ')})`,
  (banners.uploads || []).length === 2 && banners.uploads.every(p => /^banners\//.test(p)));
check('and stored as the -lg URL', banners.storedLg === true);
check('and shown on slide one', banners.photoShown === true);
check('on a computer, the photo is on the right of the banner', banners.photoRight === true);
check('the sale line keeps its saved value in the Banners tab', banners.notePrefilled === true);
check('removing the photo stores nothing', banners.removedNull === true);
check('and slide one is the plain banner again', banners.plainAgain === true);
check('the sale headline and line save together', banners.saleWrote === true && banners.saleState === true);
check('the sale line has moved out of Inventory', banners.noteMoved === true);
check('cleared fields bring the default banner back', banners.defaultsBack === true);
```

Add a phone height check after Task 3's phone block, in the same 390px context pattern:

```js
{
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pp = await phone.newPage();
  await pp.goto(BASE + '/', { waitUntil: 'networkidle' });
  await pp.waitForSelector('.card, .grid-message', { timeout: 25000 });
  const heights = await pp.evaluate(async () => {
    const h = () => document.querySelector('#heroTrack .hero-slide').getBoundingClientRect().height;
    heroSettings = { ...heroSettings, hero_image: null }; applyHeroSettings();
    const plain = h();
    const photo = PRODUCTS.find(p => (p.images || []).length).images[0];
    heroSettings = { ...heroSettings, hero_image: photo }; applyHeroSettings();
    await new Promise(r => setTimeout(r, 300));
    return { plain: Math.round(plain), photo: Math.round(h()) };
  });
  check(`on a phone, the photo banner is at most 80px taller (${heights.plain} -> ${heights.photo}px)`,
    heights.photo - heights.plain <= 80 && heights.photo > heights.plain);
  await phone.close();
}
```

The live slide-one rebuild uses `applyHeroSettings`, which only accepts an https URL. A product photo is an https Supabase URL, except for seeded repo images. If `photo` is relative, pick the first product whose `images[0]` starts with `https://`.

- [ ] **Step 3: Run the smoke test to watch the new checks fail**

Same commands as Task 3 Step 3.
Expected: the Banners checks fail (`saveMainBanner is not defined`), and so does the phone-height check (`applyHeroSettings is not defined`).

- [ ] **Step 4: Implement the settings layer**

Replace `apiService.getSaleNote` and `saveSaleNote` with:

```js
  // The one shop_settings row: the sale banner line and headline, and the main
  // banner's text and photo. Read signed out by every visitor, written only by
  // an admin. PGRST205 is "no such table": the site deployed before
  // sale-pricing.sql ran, so there is nothing to show and nothing worth logging.
  async getShopSettings() {
    const { data, error } = await supabaseClient
      .from('shop_settings').select('*').eq('id', 1).single();
    if(error){ if(error.code !== 'PGRST205') console.error(error); return {}; }
    return data || {};
  },
  async saveShopSettings(fields) {
    const { error } = await supabaseClient
      .from('shop_settings').update(fields).eq('id', 1);
    if(error) { console.error(error); return false; }
    return true;
  },
```

Replace `loadSaleNote` (keep its comment and guard) with:

```js
let heroSettings = {};   // the raw shop_settings row, for slide one and the Banners tab
async function loadShopSettings(){
  if(!PRODUCTS.some(p => 'discountPercent' in p)) return;
  try {
    heroSettings = await apiService.getShopSettings();
    saleNoteText = heroSettings.sale_note || '';
    saleTitleText = heroSettings.sale_title || '';
  } catch(_){}
}
```

Rename both call sites (`initApp`, `retryProducts`) to `loadShopSettings()`.

Add slide one's in-page rebuild. It mirrors `lib/hero.js`'s `renderHeroSlide`, and the class names are the contract:

```js
// Mirrors HERO_DEFAULTS in lib/hero.js, which writes slide one into the page
// before it is sent. This copy only rebuilds it in place after the owner
// saves, so she sees her change without waiting for the 5-minute cache.
const BANNER_DEFAULTS = {
  eyebrow: 'new season',
  title: 'Wrapped in softness, styled with heart',
  text: 'Matching sets, abayas & kimonos designed for effortless elegance — made to move with you.'
};
function applyHeroSettings(){
  const slide = document.querySelector('#heroTrack .hero-slide');
  if(!slide) return;
  const s = heroSettings || {};
  const pick = (v, d) => (typeof v === 'string' && v.trim()) ? v.trim() : d;
  const image = /^https:\/\//.test(s.hero_image || '') ? s.hero_image : '';
  const sm = image && smallVariant(image);
  slide.className = 'hero hero-slide' + (image ? ' has-photo' : '');
  slide.innerHTML = `
    ${image ? `<img class="hero-photo" src="${escHtml(image)}"${sm ? ` srcset="${escHtml(sm)} 800w, ${escHtml(image)} 1600w" sizes="(max-width:640px) 100vw, 60vw"` : ''} alt="">` : ''}
    <div class="hero-copy">
      <div class="eyebrow">${escHtml(pick(s.hero_eyebrow, BANNER_DEFAULTS.eyebrow))}</div>
      <h1>${escHtml(pick(s.hero_title, BANNER_DEFAULTS.title))}</h1>
      <p>${escHtml(pick(s.hero_text, BANNER_DEFAULTS.text))}</p>
      <button class="hero-cta" onclick="shopFromHero(false)">Shop the collection ${HERO_ARROW}</button>
    </div>`;
}
```

`smallVariant` already exists in `app.js` (the product photo -sm/-lg helper), so reuse it.

- [ ] **Step 5: Implement the Banners tab**

Let `uploadPhoto` take the sizes as a third argument, defaulting to the product sizes:

```js
async function uploadPhoto(file, folder, sizes = PHOTO_SIZES){
  ...
  for(const { suffix, edge, quality } of sizes){
```

Beside `PHOTO_SIZES`:

```js
// A banner is wide and shown up to full width, so it gets its own pair.
const BANNER_SIZES = [
  { suffix: 'sm', edge: 800,  quality: 0.80 },
  { suffix: 'lg', edge: 1600, quality: 0.82 }
];
```

Add the tab button to the admin nav, after `+ Add Piece`:

```js
      <button class="admin-tab ${adminTab==='banners'?'active':''}" onclick="setAdminTab('banners')">Banners</button>
```

Delete the `sale-note-row` block from the inventory tab, and the `saveSaleNote()` function.

Add the tab body before the `} else if(adminTab === 'photos')` branch:

```js
  } else if(adminTab === 'banners') {
    const s = heroSettings || {};
    const photo = bannerDraft === undefined ? (s.hero_image || '') : (bannerDraft ? bannerDraft.preview : '');
    bodyContent = `
      <div class="banner-form">
        <h3>Main banner</h3>
        <p class="banner-hint">Empty fields use the default text shown in grey. The photo sits on the right on a computer and across the top on a phone, so keep its subject on the right half.</p>
        <label class="form-label" for="bnEyebrow">Small heading</label>
        <input class="form-input" id="bnEyebrow" maxlength="30" placeholder="${escHtml(BANNER_DEFAULTS.eyebrow)}" value="${escHtml(s.hero_eyebrow || '')}">
        <label class="form-label" for="bnTitle">Headline</label>
        <input class="form-input" id="bnTitle" data-max="70" placeholder="${escHtml(BANNER_DEFAULTS.title)}" value="${escHtml(s.hero_title || '')}">
        <label class="form-label" for="bnText">Line under the headline</label>
        <textarea class="form-input" id="bnText" rows="2" maxlength="140" placeholder="${escHtml(BANNER_DEFAULTS.text)}">${escHtml(s.hero_text || '')}</textarea>
        <label class="form-label">Photo</label>
        <div class="banner-photo">
          ${photo ? `<img src="${escHtml(photo)}" alt="Current banner photo">` : `<span class="banner-photo-empty">No photo: the banner shows the rose background</span>`}
          <div class="banner-photo-actions">
            <label class="stock-toggle-btn">${photo ? 'Replace' : 'Choose photo'}<input type="file" accept="image/*" hidden onchange="pickBannerPhoto(this.files[0])"></label>
            ${photo ? `<button class="stock-toggle-btn" onclick="removeBannerPhoto()">Remove</button>` : ''}
          </div>
        </div>
        <button class="primary-btn" id="bnSaveMain" onclick="saveMainBanner()">Save main banner</button>

        <h3>Sale banner</h3>
        <p class="banner-hint">Shown only while something is on sale. Its photos are the pieces on sale, biggest discount first.</p>
        <label class="form-label" for="bnSaleTitle">Sale headline</label>
        <input class="form-input" id="bnSaleTitle" data-max="70" placeholder="Up to N% off selected pieces" value="${escHtml(s.sale_title || '')}">
        <label class="form-label" for="bnSaleNote">Line under it</label>
        <input class="form-input" id="bnSaleNote" maxlength="60" placeholder="e.g. Ends Sunday" value="${escHtml(saleNoteText)}">
        <button class="primary-btn" id="bnSaveSale" onclick="saveSaleBanner()">Save sale banner</button>
      </div>`;
```

The headline fields use `data-max` rather than `maxlength`, so an over-long paste is visible and blocked instead of silently cut. After `el.innerHTML = ...` at the end of `renderAdmin`, wire it up:

```js
  if(adminTab === 'banners') wireBannerForm();
```

Then add:

```js
// undefined: no change to the photo. null: removed. { file, preview }: a new one.
let bannerDraft = undefined;

function wireBannerForm(){
  const guard = (fieldIds, btnId) => {
    const btn = document.getElementById(btnId);
    const refresh = () => {
      btn.disabled = fieldIds.some(id => {
        const el = document.getElementById(id);
        return el && el.dataset.max && el.value.trim().length > Number(el.dataset.max);
      });
      fieldIds.forEach(id => {
        const el = document.getElementById(id);
        if(el && el.dataset.max) el.classList.toggle('invalid', el.value.trim().length > Number(el.dataset.max));
      });
    };
    fieldIds.forEach(id => document.getElementById(id).addEventListener('input', refresh));
    refresh();
  };
  guard(['bnEyebrow', 'bnTitle', 'bnText'], 'bnSaveMain');
  guard(['bnSaleTitle', 'bnSaleNote'], 'bnSaveSale');
}

async function pickBannerPhoto(file){
  if(!file) return;
  const problem = photoRejection(file);
  if(problem){ showToast(problem); return; }
  if(bannerDraft && bannerDraft.preview) URL.revokeObjectURL(bannerDraft.preview);
  bannerDraft = { file, preview: URL.createObjectURL(file) };
  await renderAdmin();
}

function removeBannerPhoto(){
  if(bannerDraft && bannerDraft.preview) URL.revokeObjectURL(bannerDraft.preview);
  bannerDraft = null;
  renderAdmin();
}

async function saveMainBanner(){
  const val = id => document.getElementById(id).value.trim();
  const fields = { hero_eyebrow: val('bnEyebrow') || null, hero_title: val('bnTitle') || null, hero_text: val('bnText') || null };
  if((fields.hero_title || '').length > 70){ showToast('Keep the headline to 70 characters'); return; }
  const btn = document.getElementById('bnSaveMain');
  if(btn) btn.disabled = true;
  try {
    if(bannerDraft === null) fields.hero_image = null;
    else if(bannerDraft) fields.hero_image = await uploadPhoto(bannerDraft.file, 'banners', BANNER_SIZES);
  } catch(e){
    console.error(e);
    showToast(e.message || 'Upload failed — please try again', 8000);
    if(btn) btn.disabled = false;
    return;
  }
  const ok = await apiService.saveShopSettings(fields);
  if(ok){
    heroSettings = { ...heroSettings, ...fields };
    if(bannerDraft && bannerDraft.preview) URL.revokeObjectURL(bannerDraft.preview);
    bannerDraft = undefined;
    applyHeroSettings();
  }
  showToast(ok ? 'Main banner saved ✓ — visitors see it within 5 minutes' : "Couldn't save that — please try again");
  await renderAdmin();
}

async function saveSaleBanner(){
  const title = document.getElementById('bnSaleTitle').value.trim();
  const note = document.getElementById('bnSaleNote').value.trim();
  if(title.length > 70){ showToast('Keep the sale headline to 70 characters'); return; }
  const ok = await apiService.saveShopSettings({ sale_title: title || null, sale_note: note || null });
  if(ok){ saleTitleText = title; saleNoteText = note; heroSettings = { ...heroSettings, sale_title: title || null, sale_note: note || null }; }
  showToast(ok ? 'Sale banner saved ✓' : "Couldn't save that — please try again");
  renderHero();
  await renderAdmin();
}
```

In `setAdminTab`, leaving the Banners tab discards an unsaved photo pick, as the product photo picker does. Next to the existing `photoDraft` clean-up:

```js
  if(tab !== 'banners' && bannerDraft){
    if(bannerDraft.preview) URL.revokeObjectURL(bannerDraft.preview);
    bannerDraft = undefined;
  }
```

In `styles.css`, after `.inv-back{...}`:

```css
/* Banners tab */
.banner-form{ display:flex; flex-direction:column; gap:6px; background:var(--surface); border:1px solid var(--line); border-radius:var(--radius-md); padding:16px; }
.banner-form h3{ font-size:16px; margin:10px 0 2px; color:var(--ink); }
.banner-form h3:first-child{ margin-top:0; }
.banner-hint{ font-size:12.5px; color:var(--ink-soft); margin:0 0 6px; }
.banner-form .primary-btn{ align-self:flex-start; flex:0 0 auto; padding:10px 18px; font-size:13px; margin-top:8px; }
.banner-photo{ display:flex; gap:12px; align-items:center; flex-wrap:wrap; }
.banner-photo img{ width:220px; max-width:100%; aspect-ratio:16/7; object-fit:cover; border-radius:var(--radius-sm); border:1px solid var(--line); }
.banner-photo-empty{ font-size:12.5px; color:var(--ink-soft); }
.banner-photo-actions{ display:flex; gap:6px; }
.banner-photo-actions label{ cursor:pointer; }
.form-input.invalid{ border-color:var(--danger); }
```

- [ ] **Step 6: Run the smoke test**

Same commands as Task 3 Step 3.
Expected: every line PASS, including the renamed note-loading and stale-banner checks, and both phone checks.

- [ ] **Step 7: Screenshot the Banners tab and slide one with a photo**

At 1280×800 and 390×844, set `heroSettings.hero_image` to the stand-in illustration. Use the scratchpad's `atelier.svg` served as a data URL; `applyHeroSettings` needs `https://`, so for the screenshot only, set the `img` `src` directly. Compare with `mock-desktop.png` and `mock-phone-f.png`. Check: the copy on the left over rose on desktop, the photo on the right with no seam; on the phone, the photo on top fading into rose, with the headline on two lines.

- [ ] **Step 8: Commit**

```bash
git add public/js/app.js public/css/styles.css tests/ui-smoke.mjs
git commit -m "Add a Banners tab to edit the main banner and name the sale"
```

---

### Task 5: Rollout notes and the whole-suite run

**Files:**
- Modify: `docs/REMAINING-WORK.md`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Document the rollout**

Add a section before `## Remaining concerns after that`:

```markdown
## Photo banners — built, waiting to be rolled out

The Banners tab edits the main banner's small heading, headline, line and photo, and the sale banner's headline and line. The sale banner shows up to three of the pieces on sale, biggest discount first.

- **Rollout:** run `supabase/banner-settings.sql`, then push. Either order is safe: before the SQL, `/` serves the default banner (the column read fails and the page is sent unchanged, uncached).
- **Check:** `supabase/verify-banner-settings.sql` (rolls back; result rows say PASS/FAIL).
- **How it is served:** `functions/index.js` → `lib/hero.js` writes slide one into `index.html` on `/` and `/p/`, cached 5 minutes. `public/js/app.js` mirrors the markup only to update the slide in place after a save; `BANNER_DEFAULTS` there and `HERO_DEFAULTS` in `lib/hero.js` must match.
- **Photo:** stored in `product-images/banners/`, 1600px and 800px WebP. Subject on the right half: desktop crops from the right, phone shows the top strip.
```

- [ ] **Step 2: Run every suite**

```bash
node tests/hero.test.mjs
node tests/product-page.test.mjs
node tests/order-notification.test.mjs
node tests/restock-notification.test.mjs
node tests/describe.test.mjs
node tests/sale-rounding.test.mjs
BASE=http://127.0.0.1:8791 node <scratchpad>/ui-smoke.mjs
```

Plus the PGlite run of `verify-banner-settings.sql` from Task 1.
Expected: zero FAIL lines anywhere and no console errors. The smoke test ends with `no console errors`.

- [ ] **Step 3: Commit**

```bash
git add docs/REMAINING-WORK.md
git commit -m "Document the photo banner rollout"
```
