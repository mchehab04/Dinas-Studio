# Per-product URLs

**Goal:** Give every piece its own address that works on its own — so a piece can be shared as itself, and so Google has 17 things to rank instead of one.

Today the whole shop is one document. Cards are `href="#"` with `preventDefault()`, `openProduct(id)` swaps a sheet, and the address bar never changes. The sitemap has a single entry.

## What this is really worth

**Sharing is the immediate win.** A link pasted into WhatsApp or Instagram currently previews the logo and the shop tagline whatever piece you meant. Social scrapers do not run JavaScript, so this can only be fixed by serving real tags per URL.

**Search is the slow one.** Per-product URLs are necessary to rank individual pieces but not sufficient: invented names like "Silk Jacquard Set — Offwhite" have no search volume, and the terms that do — "modest matching sets Dubai" — are competitive with a domain this new. Worth doing, worth not expecting much from for months.

## Non-goals

- Server-rendering the whole shop. The grid stays a client-rendered SPA.
- A separate product page design. Visitors land on the shop they already know, with that piece open.
- Per-category or per-collection URLs. Later, if products earn it.
- Removing the hash routing that `#admin` uses.

## Part 1 — The URL

```
/p/silk-jacquard-set-offwhite-7
```

**Slug plus id.** The trailing id is what resolves the product; the words in front are decoration for humans and for search. This means **no `slug` column and no migration** — the slug is derived from `name` at render time — and renaming a piece can never break an existing link.

A request whose slug text doesn't match the current name **301s to the canonical form**, so one piece never accumulates several indexable URLs.

`/p/` rather than bare `/silk-jacquard-set-7`, because a root-level catch-all would have to be careful of every static path the site might ever add. Prettiness isn't worth that.

## Part 2 — What the function serves

`functions/p/[slug].js`, logic in `lib/product-page.js`, following the pattern the notification functions already use.

It fetches the product from Supabase with the **publishable key** — products are world-readable, so this needs no new secret and no service-role access. It then returns `index.html` **with the head rewritten**: `<title>`, `meta description`, `og:title`, `og:description`, `og:image` (the piece's own `-lg` photo), `canonical`, and a `Product` JSON-LD block carrying price, currency and availability.

The body is the ordinary shop shell. A small injected marker tells `app.js` which piece to open on load, so the visitor lands on the shop with that piece already open rather than on a page that then jumps.

**Why rewrite the shell rather than render a standalone page:** one template, one design, no second copy of the product layout to keep in step. Crawlers get correct tags without running JavaScript, which is the part that actually matters — social scrapers never run it, and Google renders the rest.

**Deliberately deferred:** server-rendering the product's text into the body. Google renders JavaScript for a site this size, and the tags are what social needs. If Search Console later shows these pages indexed thin, add a server-rendered summary block then — and not before.

**Caching:** `Cache-Control: public, max-age=300, stale-while-revalidate=3600`. Stock and price changes surface within five minutes, and a crawl of 17 pieces doesn't become 17 Supabase reads every time.

**A piece that doesn't exist** returns `404.html` with a real 404. Pieces are never deleted, so this is for mistyped and stale links.

**Sold-out pieces keep their URL** and report `OutOfStock` in the JSON-LD. The page still sells the brand, and the waiting list is right there.

## Part 3 — The client

- Cards become real `<a href="/p/...">`. Crawlers follow links; they don't read `onclick`.
- A click is intercepted for the SPA feel: `openProduct(id)` plus `history.pushState` to that URL.
- Closing the sheet `pushState`s back to `/`; `popstate` opens or closes the right piece, so Back behaves.
- On load, the injected marker opens that piece.
- `#admin` hash routing is untouched — different mechanism, no overlap.

Every one of these paths has to work with JavaScript failing to load, because the URL is now the thing being shared. The link must resolve to something sensible on its own, which the rewritten head already guarantees.

## Part 4 — Sitemap

`/sitemap.xml` becomes a function listing the homepage plus every piece at its canonical URL, cached for an hour. **Delete `public/sitemap.xml`** so there is no ambiguity about which one answers.

`robots.txt` stays static and unchanged.

Add `_routes.json` excluding static paths, so the CSS, JS and images are served straight from the edge without invoking a function.

## Rollout

Less fragile than the stock work — nothing here can break checkout.

1. Deploy. The new URLs start working; nothing else changes behaviour.
2. Check three or four pieces resolve, and that a wrong slug 301s to the right one.
3. Paste a product link into WhatsApp and confirm the preview shows that piece.
4. Search Console → submit `https://dinasstudio.com/sitemap.xml` again so the new URLs are discovered.
5. Watch Coverage over the following weeks. Pages indexed without content is the signal to add server-rendered body text.

## Verification

- A piece's URL returns 200 with that piece's title, description and image in the head.
- The same piece under a stale slug 301s to the canonical URL, preserving the query string.
- A nonexistent id returns 404, not the homepage with a 200.
- The JSON-LD validates, and a sold-out piece reports `OutOfStock`.
- Clicking a card updates the address bar without a page load; Back closes the piece; Forward reopens it.
- Loading a product URL directly opens the shop with that piece open.
- `/sitemap.xml` lists the homepage and every piece, and nothing else.
- With JavaScript blocked, a product URL still serves a page carrying that piece's tags.
- The existing suites still pass: `node tests/order-notification.test.mjs`, `node tests/restock-notification.test.mjs`, `tests/ui-smoke.mjs`.
