# Sale Pricing and Rotating Hero Banner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the owner mark individual pieces down by a percentage, charge that reduced price everywhere, and announce it in a rotating hero banner.

**Architecture:** A single integer column `products."discountPercent"` (0 = not on sale) is the only stored fact. `place_order` applies the discount when it recomputes the order, so the discount is *charged*, not merely displayed. The storefront repeats the same rounding formula for its pre-checkout estimate — a deliberate duplication, contained the same way the shipping rules already are. The hero becomes a scroll-snap carousel whose sale slide is generated from the pieces actually on sale.

**Tech Stack:** Static HTML/CSS/JS with no build step; Supabase Postgres + PostgREST; Cloudflare Pages Functions (Workers runtime); plain-Node test files with no framework; Playwright for browser checks.

**Spec:** `docs/superpowers/specs/2026-09-24-sale-pricing-and-banner-design.md`

## Global Constraints

- **No build step.** `public/js/app.js` is a classic script. Nothing may require bundling, and `lib/` modules cannot be imported by it.
- **Every file in `functions/` becomes a route.** Logic lives in `lib/`; `functions/` holds thin adapters only.
- **Functions read `env`, not `process.env`.** Workers have no `process.env`.
- **Escape all customer-supplied text before `innerHTML`** using `escHtml()` in `public/js/app.js`.
- **`public/index.html` asset paths stay root-relative** (`/css/...`, `/js/...`) — they load from `/p/<slug>-<id>` too.
- **The rounding formula is `round(price × (100 − discountPercent) / 100)`, half up, to whole dirhams.** Identical on both sides.
- **`discountPercent` is an integer 0–90.** 0 means not on sale.
- **Prices display through `formatPrice()`** (`public/js/app.js:72`), which renders `AED N · $M`.
- **The user pushes, never Claude.** Commit locally; report what is waiting.
- **Run browser checks against Cloudflare's runtime**, not a static server: `npx wrangler pages dev public --port 8790`.

## Review Focus

1. **`discountPercent = 0` must be indistinguishable from no sale** — no strikethrough, no `−0%` tag, no banner slide, no On Sale filter match. Covered in Task 2 Step 1 and Task 4 Step 1.
2. **A discount on a sold-out piece must not set the banner headline** — a shopper following "up to 50% off" must find a 50%-off piece they can buy. Covered in Task 4 Step 1.
3. **Client and database rounding must agree for every price actually in the shop** — a one-dirham gap between the price shown and the price charged. Covered in Task 1 Step 6 and Task 2 Step 1.
4. **Clearing a discount must leave no residue** — including a bag that already holds the piece at its sale price. Covered in Task 5 Step 5.
5. **A single-slide carousel must not rotate, show dots, or auto-advance under `prefers-reduced-motion`** — this is the state the shop is in most of the time. Covered in Task 4 Steps 1 and 8.

---

### Task 1: Database — the column, the settings row, and discounted checkout

**Files:**
- Create: `supabase/sale-pricing.sql`
- Modify: `supabase/schema.sql` (fold the column and table into the fresh-install script)
- Modify: `supabase/verify-place-order.sql` (add the discount cases)

**Interfaces:**
- Consumes: nothing.
- Produces: `products."discountPercent"` (int, 0–90, default 0); `public.shop_settings` single row with `sale_note text`; `place_order` charging `round(price * (100 - "discountPercent") / 100)` and recording `fullPrice` and `discountPercent` on each item.

- [ ] **Step 1: Write `supabase/sale-pricing.sql`**

```sql
-- ============================================================
-- Per-piece sale pricing.
--
-- Safe on the live site: every existing piece gets discountPercent = 0, so
-- nothing changes until a piece is marked down.
-- ============================================================

alter table public.products
  add column if not exists "discountPercent" int not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'products_discount_range') then
    -- 90 is a guard against a typo turning a piece into a giveaway.
    alter table public.products add constraint products_discount_range
      check ("discountPercent" >= 0 and "discountPercent" <= 90);
  end if;
end $$;

-- One row, enforced by the check: the optional line under the banner headline.
create table if not exists public.shop_settings (
  id int primary key default 1 check (id = 1),
  sale_note text
);

insert into public.shop_settings (id, sale_note) values (1, null)
  on conflict (id) do nothing;

alter table public.shop_settings enable row level security;

drop policy if exists "shop_settings_select_all" on public.shop_settings;
create policy "shop_settings_select_all"
  on public.shop_settings for select using (true);

drop policy if exists "shop_settings_write_admin" on public.shop_settings;
create policy "shop_settings_write_admin"
  on public.shop_settings for all
  using (public.is_admin()) with check (public.is_admin());

-- RLS permitting a read does not by itself grant the privilege. The storefront
-- reads this signed out; omitting this is what cost a day on restock_requests.
grant select on public.shop_settings to anon, authenticated;
grant insert, update on public.shop_settings to authenticated;
```

- [ ] **Step 2: Append the discounted `place_order` to the same file**

Copy `supabase/place-order.sql` in full into `supabase/sale-pricing.sql` below the above, changing only the pricing select and adding the discount helper. The changed block:

```sql
  -- Prices come from the table, and the discount with them. Whatever the
  -- browser said about money is ignored entirely.
  select jsonb_agg(jsonb_build_object(
           'productId', p.id,
           'name',      p.name,
           'cat',       p.cat,
           'size',      elem->>'size',
           'qty',       1,
           'price',     round(p.price * (100 - p."discountPercent") / 100.0),
           'total',     round(p.price * (100 - p."discountPercent") / 100.0),
           'fullPrice', p.price,
           'discountPercent', p."discountPercent"
         ) order by p.id),
         sum(round(p.price * (100 - p."discountPercent") / 100.0))
    into v_items, v_subtotal
    from jsonb_array_elements(p_items) elem
    join public.products p on p.id = (elem->>'productId')::bigint;
```

Everything else in the function — the lock, the sold-out check, the size check, shipping, the insert — is unchanged. `v_subtotal` now carries discounted money, so the free-delivery threshold is judged on it with no further edit.

- [ ] **Step 3: Fold the same changes into `supabase/schema.sql`**

In the `products` table definition, after `images jsonb not null default '[]'`:

```sql
  -- 0 means not on sale. See sale-pricing.sql.
  "discountPercent" int not null default 0
    check ("discountPercent" >= 0 and "discountPercent" <= 90),
```

And add to the header's run-order list, after `place-order.sql`:

```
--   sale-pricing.sql            per-piece discounts + shop_settings
```

- [ ] **Step 4: Add the discount cases to `supabase/verify-place-order.sql`**

Inside the `do $$` block, after the existing check 2 (priced from the table), before check 3:

```sql
  -- 2b. A discount is charged, not merely displayed.
  update public.products set "discountPercent" = 25 where id = v_id;
  select t.subtotal, t.items->0->>'price', t.items->0->>'fullPrice'
    into v_sub, v_charged, v_full
    from public.place_order('VERIFY-2b', '1 Jan 2026', v_cust, v_addr, 'cod', v_items) t;
  raise notice '%  a 25%% discount is charged: % (was %)',
    case when v_sub = round(v_price * 0.75) then 'PASS ' else 'FAIL ' end, v_sub, v_price;
  raise notice '%  the order records what was given away',
    case when v_charged::numeric = round(v_price * 0.75) and v_full::numeric = v_price
         then 'PASS ' else 'FAIL ' end;
  update public.products set "discountPercent" = 0, stock = 'in', "soldOut" = '[]' where id = v_id;
```

Declare the two new variables at the top of the block alongside `v_sub`:

```sql
  v_charged text;
  v_full text;
```

- [ ] **Step 5: Check the SQL parses**

There is no local Postgres. Read the file end to end and confirm: every `$$` is paired, every `do` block has a matching `end $$;`, and the `place_order` body is complete from `declare` to the final `end;`.

Run: `node -e "const s=require('fs').readFileSync('supabase/sale-pricing.sql','utf8'); const d=(s.match(/\\\$\\\$/g)||[]).length; console.log('dollar-quote markers:', d, d%2===0?'(paired)':'(UNPAIRED - fix)')"`
Expected: an even number.

- [ ] **Step 6: Write the rounding-agreement check**

Create `tests/sale-rounding.test.mjs`:

```javascript
// Run: node tests/sale-rounding.test.mjs
//
// The storefront and the database each apply the discount, in different
// languages. A one-dirham disagreement means the price shown is not the price
// charged, so this pins the two formulas against every price in the shop.
const check = (label, cond) => console.log((cond ? 'PASS  ' : 'FAIL  ') + label);

// The client's formula, copied from public/js/app.js. If this copy and the one
// in app.js ever differ, that is the bug this file exists to catch.
const clientCharged = (price, pct) => Math.round(price * (100 - pct) / 100);

// What Postgres `round(p.price * (100 - pct) / 100.0)` produces. Both round
// half away from zero, and every price here is positive.
const dbCharged = (price, pct) => {
  const exact = price * (100 - pct) / 100;
  return Math.sign(exact) * Math.round(Math.abs(exact));
};

const PRICES = [199, 220, 259, 380, 399, 449, 459, 549, 588, 599, 659];
const PERCENTS = [0, 5, 10, 15, 20, 25, 30, 33, 40, 50, 66, 75, 90];

let mismatches = [];
for (const price of PRICES) {
  for (const pct of PERCENTS) {
    if (clientCharged(price, pct) !== dbCharged(price, pct)) {
      mismatches.push(`${price} @ ${pct}% -> client ${clientCharged(price, pct)}, db ${dbCharged(price, pct)}`);
    }
  }
}
check(`client and database agree on all ${PRICES.length * PERCENTS.length} combinations`, mismatches.length === 0);
if (mismatches.length) console.log(mismatches.join('\n'));

check('0% is a no-op', PRICES.every(p => clientCharged(p, 0) === p));
check('a whole-dirham result stays whole', Number.isInteger(clientCharged(599, 30)));
check('599 at 30% is 419', clientCharged(599, 30) === 419);
check('220 at 33% is 147', clientCharged(220, 33) === 147);
```

- [ ] **Step 7: Run it**

Run: `node tests/sale-rounding.test.mjs`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add supabase/sale-pricing.sql supabase/schema.sql supabase/verify-place-order.sql tests/sale-rounding.test.mjs
git commit -m "Charge per-piece discounts in place_order"
```

---

### Task 2: Storefront prices

**Files:**
- Modify: `public/js/app.js` (add helpers near `formatPrice` at line 72; card at ~494; product detail at ~623; bag at ~834; checkout subtotal)
- Modify: `public/css/styles.css` (after `.card-price` at line 305)
- Modify: `tests/ui-smoke.mjs`

**Interfaces:**
- Consumes: `products."discountPercent"` from Task 1.
- Produces: `chargedPrice(p)` → number; `isOnSale(p)` → boolean; `priceHtml(p)` → string of escaped HTML showing either one price or the struck original plus the sale price.

- [ ] **Step 1: Write the failing browser checks**

Add to `tests/ui-smoke.mjs`, before the final `check('no console errors', ...)`:

```javascript
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
});
check('a piece with no discount charges its price', sale.plainCharged === 599);
check('a 30% discount charges 419', sale.cutCharged === 419);
check('a row with no discountPercent at all is not on sale', sale.legacyOnSale === false && sale.legacyCharged === 599);
check('0% is not on sale', sale.plainOnSale === false);
check('30% is on sale', sale.cutOnSale === true);
check('an undiscounted price renders without a strikethrough', !/sale-was|sale-tag/.test(sale.plainHtml));
check('a discounted price shows the original struck through', /sale-was/.test(sale.cutHtml) && sale.cutHtml.includes('599'));
check('and the new price', sale.cutHtml.includes('419'));
check('and the percentage off', /−30%|-30%/.test(sale.cutHtml));
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx wrangler pages dev public --port 8790` in one shell, then `node tests/ui-smoke.mjs`
Expected: FAIL — `chargedPrice is not defined`.

- [ ] **Step 3: Add the helpers**

In `public/js/app.js`, immediately after `formatPrice` (line 72):

```javascript
// Mirrors the discount arithmetic in supabase/sale-pricing.sql, which is what
// the customer is actually charged. If the two ever drift, the database wins
// and the confirmation screen shows its numbers, not these.
// tests/sale-rounding.test.mjs pins them together.
function discountOf(p){
  const pct = Number(p && p.discountPercent) || 0;
  return pct > 0 && pct <= 90 ? pct : 0;
}
function isOnSale(p){ return discountOf(p) > 0; }
function chargedPrice(p){
  const pct = discountOf(p);
  return pct ? Math.round(p.price * (100 - pct) / 100) : p.price;
}

// One price, or the original struck through beside the new one.
function priceHtml(p){
  if(!isOnSale(p)) return formatPrice(p.price);
  return `<span class="sale-was">${formatPrice(p.price)}</span>` +
         `<span class="sale-now">${formatPrice(chargedPrice(p))}</span>` +
         `<span class="sale-tag">−${discountOf(p)}%</span>`;
}
```

- [ ] **Step 4: Use it at the four display sites**

Every site, by line number. **Display** sites take `priceHtml(p)`; **arithmetic** and **accessibility-label** sites take `chargedPrice(p)` — a screen reader should hear the price being charged, not two prices.

| Line | Now | Becomes |
|---|---|---|
| 489 | `aria-label="View ${p.name}, ${formatPrice(p.price)}"` | `${formatPrice(chargedPrice(p))}` |
| 494 | `<span class="card-price" …>${formatPrice(p.price)}</span>` | `${priceHtml(p)}` |
| 495 | `aria-label="Choose quantity for ${p.name}, ${formatPrice(p.price)}"` | `${formatPrice(chargedPrice(p))}` |
| 562 | `<span class="bag-price">${formatPrice(p.price)}</span>` (saved items) | `${priceHtml(p)}` |
| 623 | `<div class="pd-price">${formatPrice(p.price)}</div>` | `${priceHtml(p)}` |
| 653 | `` `Add to Bag · ${formatPrice(p.price)}` `` | `${formatPrice(chargedPrice(p))}` |
| 826 | `subtotal += p.price;` (bag) | `subtotal += chargedPrice(p);` |
| 834 | `<span class="bag-price">${formatPrice(p.price)}</span>` | `${priceHtml(p)}` |
| 911 | `if(p) subtotal += p.price;` (checkout) | `if(p) subtotal += chargedPrice(p);` |

Lines 436–437 (`price-asc` / `price-desc` sorting) also change, so a discounted piece sorts by what it costs:

```javascript
    case "price-asc": list.sort((a,b)=>chargedPrice(a)-chargedPrice(b)); break;
    case "price-desc": list.sort((a,b)=>chargedPrice(b)-chargedPrice(a)); break;
```

Leave lines 1479 and 1870 alone — those render `o.total` from a recorded order, which is already the charged amount.

- [ ] **Step 5: Add the styles**

`public/css/styles.css`, after `.card-price` (line 305):

```css
  .sale-was{ text-decoration:line-through; color:var(--ink-faint); font-weight:600; margin-right:6px; }
  .sale-now{ color:var(--primary); font-weight:800; }
  .sale-tag{
    display:inline-block; margin-left:6px; padding:1px 6px; border-radius:999px;
    background:var(--primary); color:#fff; font-size:10.5px; font-weight:800;
    vertical-align:middle; white-space:nowrap;
  }
```

- [ ] **Step 6: Run the checks**

Run: `node tests/ui-smoke.mjs`
Expected: all PASS, including `no console errors`.

- [ ] **Step 7: Commit**

```bash
git add public/js/app.js public/css/styles.css tests/ui-smoke.mjs
git commit -m "Show sale prices across the storefront"
```

---

### Task 3: The On Sale filter

**Files:**
- Modify: `public/js/app.js` (`renderFilterPanel` line 383, `toggleAvail` line 405, `getFiltered` line 428)
- Modify: `tests/ui-smoke.mjs`

**Interfaces:**
- Consumes: `isOnSale(p)` from Task 2.
- Produces: `state.saleOnly` (boolean); `setSaleFilter(on)` which sets it, re-renders the filter panel and grid, and is what the banner button calls.

- [ ] **Step 1: Write the failing check**

Add to `tests/ui-smoke.mjs` before `check('no console errors', ...)`:

```javascript
const filter = await page.evaluate(() => {
  const before = document.querySelectorAll('.card').length;
  setSaleFilter(true);
  const onSaleShown = document.querySelectorAll('.card').length;
  const expected = PRODUCTS.filter(p => isOnSale(p)).length;
  setSaleFilter(false);
  return { before, onSaleShown, expected, restored: document.querySelectorAll('.card').length };
});
check('the On Sale filter shows exactly the discounted pieces', filter.onSaleShown === filter.expected);
check('turning it off restores the full grid', filter.restored === filter.before);
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/ui-smoke.mjs`
Expected: FAIL — `setSaleFilter is not defined`.

- [ ] **Step 3: Add the state field**

`public/js/app.js`, in the `state` object beside `filterAvail` (line 318):

```javascript
  saleOnly: false,
```

- [ ] **Step 4: Filter on it**

In `getFiltered()` (line 428), after the existing `filterAvail` line:

```javascript
    if(state.saleOnly && !isOnSale(p)) return false;
```

- [ ] **Step 5: Add the chip and its setter**

In `renderFilterPanel()`, after the `availRow` block:

```javascript
  const saleRow = document.getElementById('availRow');
  if(saleRow && PRODUCTS.some(isOnSale)){
    // Only offered when something is actually discounted — a filter that can
    // only ever return nothing is worse than no filter.
    saleRow.insertAdjacentHTML('beforeend',
      `<button class="chip sale-chip ${state.saleOnly ? 'active' : ''}" onclick="setSaleFilter(${!state.saleOnly})">On Sale</button>`);
  }
```

Next to `toggleAvail` (line 405):

```javascript
function setSaleFilter(on){
  state.saleOnly = !!on;
  renderFilterPanel();
  lastGridSignature = null;   // stock is unchanged, so the id list may be too
  renderGrid();
}
```

- [ ] **Step 6: Run the checks**

Run: `node tests/ui-smoke.mjs`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add public/js/app.js tests/ui-smoke.mjs
git commit -m "Add an On Sale filter to the grid"
```

---

### Task 4: The hero carousel

**Files:**
- Modify: `public/index.html` (the `<div class="hero">` block)
- Modify: `public/js/app.js` (`renderHero()`, called from `initApp` at ~2217)
- Modify: `public/css/styles.css` (near `.hero` line 151 and the `prefers-reduced-motion` block at line 35)
- Modify: `tests/ui-smoke.mjs`

**Interfaces:**
- Consumes: `isOnSale(p)`, `discountOf(p)` from Task 2; `setSaleFilter(on)` from Task 3.
- Produces: `renderHero()` which rebuilds the slides and restarts rotation; `heroSlides()` returning the slide array; `apiService.getSaleNote()` → string; `apiService.saveSaleNote(text)` → boolean; the module-level `saleNoteText`.

**Built before the admin task on purpose:** the admin panel re-renders the hero after a discount changes, so `renderHero` has to exist first.

- [ ] **Step 1: Write the failing checks**

Add to `tests/ui-smoke.mjs` before `check('no console errors', ...)`:

```javascript
const hero = await page.evaluate(async () => {
  const saved = PRODUCTS.map(p => p.discountPercent);
  PRODUCTS.forEach(p => { p.discountPercent = 0; });
  renderHero();
  const noSale = {
    slides: document.querySelectorAll('.hero-slide').length,
    dots: document.querySelectorAll('.hero-dot').length
  };

  // A sold-out piece must not set the headline for pieces still available.
  const buyable = PRODUCTS.find(p => p.stock !== 'out');
  const gone = PRODUCTS.find(p => p.stock === 'out');
  if(buyable) buyable.discountPercent = 20;
  if(gone) gone.discountPercent = 50;
  renderHero();
  const withSale = {
    slides: document.querySelectorAll('.hero-slide').length,
    dots: document.querySelectorAll('.hero-dot').length,
    text: document.querySelector('.hero-carousel').innerText
  };

  PRODUCTS.forEach((p, i) => { p.discountPercent = saved[i]; });
  renderHero();
  return { noSale, withSale, hadGone: !!gone, hadBuyable: !!buyable };
});
check('with no sale there is a single slide', hero.noSale.slides === 1);
check('and no dots', hero.noSale.dots === 0);
check('a sale adds a second slide', hero.withSale.slides === 2);
check('and dots to move between them', hero.withSale.dots === 2);
check('the headline quotes the largest buyable discount',
  !hero.hadBuyable || /20%/.test(hero.withSale.text));
check('a sold-out piece does not set the headline',
  !hero.hadGone || !/50%/.test(hero.withSale.text));
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/ui-smoke.mjs`
Expected: FAIL — `renderHero is not defined`.

- [ ] **Step 3: Replace the hero markup**

In `public/index.html`, replace the whole `<div class="hero">…</div>` block with:

```html
      <!-- ===== Hero carousel (slide 1 is the shop; a sale adds slide 2) ===== -->
      <div class="hero-carousel" id="heroCarousel">
        <div class="hero-track" id="heroTrack"></div>
        <div class="hero-dots" id="heroDots"></div>
      </div>
```

- [ ] **Step 4: Add the settings API methods**

In `apiService`, after `updateProductStock`:

```javascript
  async getSaleNote() {
    const { data, error } = await supabaseClient
      .from('shop_settings').select('sale_note').eq('id', 1).single();
    if(error) { console.error(error); return ''; }
    return (data && data.sale_note) || '';
  },
  async saveSaleNote(text) {
    const { error } = await supabaseClient
      .from('shop_settings').update({ sale_note: text || null }).eq('id', 1);
    if(error) { console.error(error); return false; }
    return true;
  },
```

- [ ] **Step 5: Build the slides**

`public/js/app.js`, near `renderGrid`:

```javascript
/* ========================= HERO ========================= */
let saleNoteText = '';
let heroTimer = null;
let heroIndex = 0;

// The sale slide is generated from the pieces on sale, so it can never
// advertise a discount that is not actually available. Sold-out pieces are
// excluded: a shopper following "up to 50% off" must find a 50%-off piece.
function heroSlides(){
  const slides = [`
    <div class="hero-slide">
      <div class="eyebrow">new season</div>
      <h1>Wrapped in softness, styled with heart</h1>
      <p>Matching sets, abayas &amp; kimonos designed for effortless elegance — made to move with you.</p>
      <button class="hero-cta" onclick="scrollToShop()">Shop the collection
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
      </button>
    </div>`];

  const buyable = PRODUCTS.filter(p => isOnSale(p) && p.stock !== 'out');
  if(buyable.length){
    const top = Math.max(...buyable.map(discountOf));
    slides.push(`
      <div class="hero-slide hero-sale">
        <div class="eyebrow">sale</div>
        <h1>Up to ${top}% off selected pieces</h1>
        ${saleNoteText ? `<p>${escHtml(saleNoteText)}</p>` : ''}
        <button class="hero-cta" onclick="setSaleFilter(true); scrollToShop();">Shop the sale
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
        </button>
      </div>`);
  }
  return slides;
}

function renderHero(){
  const track = document.getElementById('heroTrack');
  const dots = document.getElementById('heroDots');
  if(!track || !dots) return;
  const slides = heroSlides();
  track.innerHTML = slides.join('');
  // One slide is the shop's usual state: no dots, no rotation, nothing to swipe.
  dots.innerHTML = slides.length > 1
    ? slides.map((_, i) => `<span class="hero-dot ${i === 0 ? 'active' : ''}" onclick="heroGo(${i})"></span>`).join('')
    : '';
  heroIndex = 0;
  startHeroRotation(slides.length);
}

function heroGo(i){
  const track = document.getElementById('heroTrack');
  if(!track) return;
  heroIndex = i;
  track.scrollTo({ left: i * track.clientWidth, behavior: 'smooth' });
  document.querySelectorAll('.hero-dot').forEach((d, idx) => d.classList.toggle('active', idx === i));
}

function startHeroRotation(count){
  clearInterval(heroTimer);
  heroTimer = null;
  if(count < 2) return;
  // Someone who has asked their system to reduce motion gets the slides and the
  // dots, but nothing moves on its own.
  if(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  heroTimer = setInterval(() => heroGo((heroIndex + 1) % count), 6000);
}

function pauseHero(){ clearInterval(heroTimer); heroTimer = null; }
function resumeHero(){ startHeroRotation(document.querySelectorAll('.hero-slide').length); }
```

- [ ] **Step 6: Wire it up**

In `initApp()` (~line 2217), after `renderGrid();`:

```javascript
  try { saleNoteText = await apiService.getSaleNote(); } catch(_){}
  renderHero();
  const carousel = document.getElementById('heroCarousel');
  if(carousel){
    ['mouseenter','touchstart','focusin'].forEach(e => carousel.addEventListener(e, pauseHero));
    ['mouseleave','touchend','focusout'].forEach(e => carousel.addEventListener(e, resumeHero));
    const track = document.getElementById('heroTrack');
    track.addEventListener('scroll', () => {
      if(!track.clientWidth) return;
      const i = Math.round(track.scrollLeft / track.clientWidth);
      if(i !== heroIndex){
        heroIndex = i;
        document.querySelectorAll('.hero-dot').forEach((d, idx) => d.classList.toggle('active', idx === i));
      }
    });
  }
```

- [ ] **Step 7: Style it**

`public/css/styles.css`, beside `.hero` (line 151), reusing the scroll-snap approach `.pd-track` already uses:

```css
  .hero-carousel{ position:relative; }
  .hero-track{
    display:flex; overflow-x:auto; scroll-snap-type:x mandatory;
    scrollbar-width:none; -webkit-overflow-scrolling:touch;
  }
  .hero-track::-webkit-scrollbar{ display:none; }
  .hero-slide{ flex:0 0 100%; scroll-snap-align:start; }
  .hero-dots{ display:flex; gap:6px; justify-content:center; margin:6px 0 0; }
  .hero-dot{ width:6px; height:6px; border-radius:50%; background:var(--line); cursor:pointer; transition:background .2s, transform .2s; }
  .hero-dot.active{ background:var(--primary); transform:scale(1.25); }
```

Then change every existing `.hero` selector to `.hero-slide` so the padding, gradient and type carry over unchanged — including the three at lines 151–181 and the two responsive overrides at lines 384 and 398.

- [ ] **Step 8: Check the reduced-motion case**

Add to `tests/ui-smoke.mjs`, at the end of the hero block:

```javascript
const reduced = await browser.newContext({ reducedMotion: 'reduce' });
const rp = await reduced.newPage();
await rp.goto(BASE + '/', { waitUntil: 'networkidle' });
await rp.waitForSelector('.card', { timeout: 20000 });
const rotates = await rp.evaluate(() => {
  PRODUCTS.forEach(p => { if(p.stock !== 'out') p.discountPercent = 20; });
  renderHero();
  return heroTimer !== null;
});
check('reduced motion stops the carousel auto-advancing', rotates === false);
await reduced.close();
```

- [ ] **Step 9: Run the checks and screenshot**

Run: `node tests/ui-smoke.mjs`
Expected: all PASS. Then screenshot the hero at 390px with no sale and with a sale, and confirm the no-sale hero is visually unchanged from before this task.

- [ ] **Step 10: Commit**

```bash
git add public/index.html public/js/app.js public/css/styles.css tests/ui-smoke.mjs
git commit -m "Turn the hero into a carousel with a generated sale slide"
```

---

### Task 5: Admin — the Sale button and the note field

**Files:**
- Modify: `public/js/app.js` (inventory row `stock-btn-group` at ~1900; `setProductStock` at ~2069 for the sibling pattern; `apiService`)
- Modify: `public/css/styles.css`
- Modify: `tests/ui-smoke.mjs`

**Interfaces:**
- Consumes: `discountOf(p)`, `isOnSale(p)` from Task 2; `renderHero()`, `apiService.getSaleNote()`, `apiService.saveSaleNote(text)`, `saleNoteText` from Task 4.
- Produces: `apiService.setProductDiscount(id, percent)` → updated row or null; `openSaleEditor(productId)`, `saveSaleEditor(productId)`, `clearSale(productId)`, `afterSaleChange(productId)`.

- [ ] **Step 1: Add the discount API method**

In `apiService`, after `updateProductStock`:

```javascript
  // 0 clears the sale. The range is enforced by a check constraint too, so a
  // bad value fails at the database rather than being silently stored.
  async setProductDiscount(id, percent) {
    const pct = Math.max(0, Math.min(90, Math.round(Number(percent) || 0)));
    const { data, error } = await supabaseClient
      .from('products').update({ discountPercent: pct }).eq('id', id).select().single();
    if(error) { console.error(error); return null; }
    const idx = PRODUCTS.findIndex(x => x.id === id);
    if(idx !== -1) PRODUCTS[idx] = data;
    storageService.saveProducts(PRODUCTS);
    return data;
  },
```

- [ ] **Step 2: Add the button to the inventory row**

`public/js/app.js` at the end of the `stock-btn-group` (~line 1900), after the Waiting button:

```javascript
              <button class="stock-toggle-btn ${isOnSale(p) ? 'sale-set' : ''}" onclick="openSaleEditor(${p.id})">
                ${isOnSale(p) ? `Sale ${discountOf(p)}%` : 'Sale'}
              </button>
```

- [ ] **Step 3: Add the inline editor**

Next to `setProductStock` (~line 2069):

```javascript
// The row's buttons are replaced in place rather than opening a sheet: the
// edit happens where the owner is already looking, and there is no new markup
// to keep in step.
function openSaleEditor(productId){
  const p = PRODUCTS.find(x => x.id === productId);
  const row = document.getElementById('invRow' + productId);
  if(!p || !row) return;
  row.innerHTML = `
    <input class="form-input sale-input" id="salePct${productId}" type="number" min="1" max="90"
           value="${discountOf(p) || ''}" placeholder="% off" inputmode="numeric">
    <button class="stock-toggle-btn" onclick="saveSaleEditor(${productId})">Save</button>
    <button class="stock-toggle-btn" onclick="clearSale(${productId})">Clear</button>
    <button class="stock-toggle-btn" onclick="renderAdmin()">Cancel</button>`;
  const input = document.getElementById('salePct' + productId);
  input.focus();
  input.addEventListener('keydown', e => { if(e.key === 'Enter') saveSaleEditor(productId); });
}

async function saveSaleEditor(productId){
  const input = document.getElementById('salePct' + productId);
  const pct = Math.round(Number(input && input.value));
  if(!Number.isFinite(pct) || pct < 1 || pct > 90){
    showToast('Enter a whole number between 1 and 90');
    return;
  }
  const updated = await apiService.setProductDiscount(productId, pct);
  showToast(updated ? `"${updated.name}" is ${pct}% off ✓` : "Couldn't save that — please try again");
  await afterSaleChange(productId);
}

async function clearSale(productId){
  const updated = await apiService.setProductDiscount(productId, 0);
  showToast(updated ? `Sale cleared on "${updated.name}"` : "Couldn't save that — please try again");
  await afterSaleChange(productId);
}

// A discount changes prices on the grid, in the hero, and on any open sheet, so
// everything that renders a price is refreshed from one place.
async function afterSaleChange(productId){
  await renderAdmin();
  renderFilterPanel();
  lastGridSignature = null;
  renderGrid();
  renderHero();
  if(currentProduct && currentProduct.id === productId){
    currentProduct = PRODUCTS.find(x => x.id === productId) || currentProduct;
    renderProductDetail();
  }
  if(state.bag.length) renderBag();
}
```

Give the button group a stable id so the editor can find it — in the inventory row markup, change `<div class="stock-btn-group">` to:

```javascript
            <div class="stock-btn-group" id="invRow${p.id}">
```

- [ ] **Step 4: Add the note field and styles**

At the top of the `adminTab === 'inventory'` branch, inside the header flex row, add a second line below it:

```javascript
      <div class="sale-note-row">
        <input class="form-input" id="saleNoteInput" maxlength="60"
               placeholder="Optional banner line, e.g. Ends Sunday" value="${escHtml(saleNote)}">
        <button class="stock-toggle-btn" onclick="saveSaleNote()">Save note</button>
      </div>
```

Load it alongside the waiting list in `renderAdmin()`:

```javascript
  const saleNote = (adminTab === 'inventory') ? await apiService.getSaleNote() : '';
```

And the handler, next to `clearSale`:

```javascript
async function saveSaleNote(){
  const input = document.getElementById('saleNoteInput');
  if(!input) return;
  const ok = await apiService.saveSaleNote(input.value.trim());
  if(ok) saleNoteText = input.value.trim();   // the hero renders from this copy
  showToast(ok ? 'Banner note saved ✓' : "Couldn't save that — please try again");
  renderHero();
}
```

`public/css/styles.css`, after `.stock-toggle-btn` (line 1174):

```css
.stock-toggle-btn.sale-set{ border-color:var(--gold); color:var(--gold); font-weight:800; }
.sale-input{ width:92px; padding:6px 10px; font-size:12px; }
.sale-note-row{ display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-bottom:14px; }
.sale-note-row .form-input{ flex:1; min-width:180px; }
```

- [ ] **Step 5: Write the clearing-residue check**

Add to `tests/ui-smoke.mjs` before `check('no console errors', ...)`:

```javascript
// Clearing a discount must leave nothing behind — including in a bag that is
// already holding the piece at its sale price.
const cleared = await page.evaluate(async () => {
  const p = PRODUCTS[0];
  const original = p.discountPercent;
  p.discountPercent = 40;
  state.bag = [{ productId: p.id, size: p.sizes[0] }];
  const saleHtml = priceHtml(p);
  p.discountPercent = 0;
  const plainHtml = priceHtml(p);
  const out = {
    saleShowedStrike: /sale-was/.test(saleHtml),
    clearedHasNoStrike: !/sale-was/.test(plainHtml),
    clearedCharges: chargedPrice(p),
    fullPrice: p.price,
    stillOnSale: isOnSale(p)
  };
  p.discountPercent = original;
  state.bag = [];
  return out;
});
check('a discount shows a strikethrough while set', cleared.saleShowedStrike);
check('clearing it removes the strikethrough', cleared.clearedHasNoStrike);
check('clearing it restores the full price', cleared.clearedCharges === cleared.fullPrice);
check('and the piece is no longer on sale', cleared.stillOnSale === false);
```

- [ ] **Step 6: Run the checks**

Run: `node tests/ui-smoke.mjs`
Expected: all PASS.

- [ ] **Step 7: Screenshot the inventory row at 360px**

The inventory row already wraps on a phone and this adds a sixth button. Capture `.inventory-item` at 360px wide and confirm nothing is clipped and the editor is usable.

- [ ] **Step 8: Commit**

```bash
git add public/js/app.js public/css/styles.css tests/ui-smoke.mjs
git commit -m "Set a per-piece discount from the inventory row"
```

---

### Task 6: Sale prices in the product page and restock email

**Files:**
- Modify: `lib/product-page.js` (description tail line 47; JSON-LD price line 66)
- Modify: `lib/restock-notification.js` (price line 39)
- Modify: `lib/order-notification.js` (`itemsTable`, `buildOwnerHtml`)
- Modify: `tests/product-page.test.mjs`, `tests/restock-notification.test.mjs`, `tests/order-notification.test.mjs`

**Interfaces:**
- Consumes: `products."discountPercent"` from Task 1.
- Produces: `chargedPrice(product)` exported from `lib/product-page.js` and imported by `lib/restock-notification.js`.

- [ ] **Step 1: Write the failing tests**

In `tests/product-page.test.mjs`, after the existing JSON-LD checks:

```javascript
const onSale = renderHead(SHELL, { ...PRODUCT, discountPercent: 30 }, 'https://dinasstudio.com');
const saleLd = JSON.parse(/<script type="application\/ld\+json">(\{"@context":"https:\/\/schema\.org","@type":"Product"[\s\S]*?)<\/script>/.exec(onSale)[1]);
check('a discounted piece quotes the sale price to Google', saleLd.offers.price === '419.00');
check('and in its meta description', /AED 419/.test(onSale));
check('an undiscounted piece is unaffected', ld.offers.price === '599.00');
```

In `tests/restock-notification.test.mjs`, after `body carries the price`:

```javascript
reset([{ id: 51, email: 'a@x.com' }]);
await run({ secret: 's3cret', record: { ...PRODUCT, discountPercent: 30 } });
check('a restocked piece on sale quotes the sale price', sends()[0].body.html.includes('AED 419.00'));
check('and shows what it was', sends()[0].body.html.includes('599'));
```

- [ ] **Step 2: Run to verify they fail**

Run: `node tests/product-page.test.mjs && node tests/restock-notification.test.mjs`
Expected: FAIL — the price is still 599.

- [ ] **Step 3: Add and export the helper in `lib/product-page.js`**

Above `description`:

```javascript
// Mirrors the discount arithmetic in supabase/sale-pricing.sql and in
// public/js/app.js. Three copies, one formula; tests/sale-rounding.test.mjs
// pins them together.
export function chargedPrice(p) {
  const pct = Number(p && p.discountPercent) || 0;
  const price = Number(p.price);
  return pct > 0 && pct <= 90 ? Math.round(price * (100 - pct) / 100) : price;
}
```

Then line 47 becomes:

```javascript
  const tail = ` AED ${chargedPrice(p).toFixed(0)} · delivered across the UAE and Lebanon.`;
```

and line 66:

```javascript
      price: chargedPrice(p).toFixed(2),
```

- [ ] **Step 4: Use it in `lib/restock-notification.js`**

At the top:

```javascript
import { chargedPrice } from './product-page.js';
```

Then line 39 becomes:

```javascript
      ${Number.isFinite(price) ? `<div style="margin-top:8px;font-size:15px;font-weight:700;">AED ${chargedPrice(product).toFixed(2)}${Number(product.discountPercent) > 0 ? ` <span style="color:#8A6B63;text-decoration:line-through;font-weight:600;font-size:13px;">AED ${price.toFixed(2)}</span>` : ''}</div>` : ''}
```

- [ ] **Step 5: Show the discount on the owner's order email**

`itemsTable(o)` in `lib/order-notification.js` is shared by both copies, so it
takes a flag rather than being duplicated. The customer sees what they paid;
the owner also sees what was given away, because that is the copy used to
fulfil and to reconcile takings.

Change the signature and the price cell:

```javascript
function itemsTable(o, showDiscount = false) {
  const rows = (o.items || []).map(i => `
    <tr>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;">${esc(i.name)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;">${esc(i.size)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:center;">${esc(i.qty)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;">
        ${money(i.total)}${showDiscount && Number(i.discountPercent) > 0
          ? `<br><span style="color:#8A6B63;font-size:11.5px;">was ${money(i.fullPrice)} · −${esc(i.discountPercent)}%</span>`
          : ''}
      </td>
    </tr>`).join('');
```

The rest of the function is unchanged. In `buildOwnerHtml`, the call becomes
`${itemsTable(o, true)}`; `buildCustomerHtml` keeps `${itemsTable(o)}`.

Add to `tests/order-notification.test.mjs`, after the existing owner checks:

```javascript
reset();
await handler(new Request('https://x/', { method: 'POST', headers: { 'x-webhook-secret': 's3cret' },
  body: JSON.stringify({ record: { ...ORDER,
    items: [{ name: 'Silk Jacquard Set', size: 'One Size', qty: 1, total: 419, fullPrice: 599, discountPercent: 30 }] } }) }));
check('owner: sees what a discount gave away', ownerMail().html.includes('was AED 599.00') && ownerMail().html.includes('−30%'));
check('customer: is not shown the discount arithmetic', !customerMail().html.includes('was AED 599.00'));
```

- [ ] **Step 6: Run the tests**

Run: `node tests/product-page.test.mjs && node tests/restock-notification.test.mjs && node tests/order-notification.test.mjs`
Expected: all PASS.

- [ ] **Step 7: Run every suite**

Run: `node tests/sale-rounding.test.mjs && node tests/order-notification.test.mjs && node tests/restock-notification.test.mjs && node tests/product-page.test.mjs && node tests/ui-smoke.mjs`
Expected: no FAIL lines anywhere.

- [ ] **Step 8: Commit**

```bash
git add lib/product-page.js lib/restock-notification.js lib/order-notification.js tests/product-page.test.mjs tests/restock-notification.test.mjs tests/order-notification.test.mjs
git commit -m "Quote sale prices on product pages and in emails"
```

---

### Task 7: Documentation and rollout note

**Files:**
- Modify: `docs/REMAINING-WORK.md`

- [ ] **Step 1: Record the feature and its rollout**

Add a section before "Remaining concerns after that":

```markdown
## Sale pricing — built, waiting to be rolled out

[Spec](superpowers/specs/2026-09-24-sale-pricing-and-banner-design.md). Per-piece discounts set from the inventory row, charged by `place_order`, announced in a generated hero slide.

### Rollout

1. **Run `supabase/sale-pricing.sql`.** Adds `products."discountPercent"`, the `shop_settings` row, and replaces `place_order`. Safe on the live site: every piece starts at 0, so nothing changes until one is marked down.
2. **Deploy.**

Either order works — a missing column reads as no discount — but the SQL first means the first piece marked down is charged correctly straight away.

**The rounding formula lives in three places** (`supabase/sale-pricing.sql`, `public/js/app.js`, `lib/product-page.js`). `tests/sale-rounding.test.mjs` pins them together; if you change one, run it.
```

- [ ] **Step 2: Commit**

```bash
git add docs/REMAINING-WORK.md
git commit -m "Document the sale pricing rollout"
```
