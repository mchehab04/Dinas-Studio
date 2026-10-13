# Photo banners and banner editing — design

**Date:** 2026-10-13
**Status:** approved in conversation, awaiting written review

## What the owner asked for

- Edit the main banner from the admin panel instead of asking for a code change.
- Banners that show imagery instead of the same flat rose background on every slide.
- Main banner: a photo from the designer (notebook, pen, a sketch). Not available yet, so the banner keeps working without one.
- Sale banner: show the pieces actually on sale. Sales are usually a theme ("short sets now that summer is over"), so the owner writes the sale headline.
- Phone layout must not take the whole first screen; the first products should still show.

Mock-ups approved in conversation: desktop split (text left, photo right, rose fading into the photo); phone mock-up "F" (photo across the top, a short fade into rose, text below, headline on two lines, about 60px taller than today's banner); sale banner with up to three piece photos.

## Behaviour

### Main banner (slide one)

| Field | Admin input | Default when empty |
|---|---|---|
| Small heading | text, max 30 | `new season` |
| Headline | text, max 70 | `Wrapped in softness, styled with heart` |
| Line under it | text, max 140 | `Matching sets, abayas & kimonos designed for effortless elegance — made to move with you.` |
| Photo | upload one image, or remove it | no photo: today's rose banner exactly |

- Desktop (≥ 641px): text on the left over rose; the photo fills the right side, with the rose fading into it from the left (mock-up). The photo is cropped from its right side, so the subject should be on the right half.
- Phone (≤ 640px): the photo across the top at 175px tall, fading into rose over its lower half; text below; headline 26px. Total height no more than 80px above today's banner at 390px wide.
- Without a photo, slide one renders exactly as it does today on both sizes.

### Sale banner (slide two, only while something is on sale and buyable)

- Headline: the owner's sale headline if set, otherwise today's automatic `Up to N% off selected pieces`, with "selected pieces" kept together so it breaks as `Up to N% off` / `selected pieces` on phone and desktop. A custom headline is balanced across its lines (`text-wrap: balance`).
- Line under it: the existing sale banner line, unchanged.
- Photos: up to three pieces from `PRODUCTS.filter(saleAvailable)` that have a photo, biggest discount first, then the default sort order. Desktop shows them side by side, flush, across the right ~60% at full banner height, with the photos themselves fading in from the left (a mask, so no seam against the rose), each tagged in its bottom-right corner with the struck old price and the sale price; phone shows them side by side across the top with a `−N%` tag, fading into rose like slide one.
- Its heading becomes an `<h2>`, so the page keeps a single `<h1>`. This fixes a deferred minor from the sale-pricing work.
- No photos available (every sale piece is photo-less) → today's sale slide, text only.

### Admin

A new **Banners** tab beside Orders & Stats / Inventory & Stock / + Add Piece:

- **Main banner:** the three text fields, a photo picker showing the current photo with Replace / Remove, and Save. Empty text fields fall back to the defaults above, shown as placeholders.
- **Sale banner:** sale headline and the sale banner line (moved here from the Inventory tab), and Save. A note says the banner only appears while something is on sale.
- Save updates the banner on the page immediately for the admin. Visitors see the change on their next visit, within 5 minutes.

## How it fits together

- **Storage:** `supabase/banner-settings.sql` adds nullable columns to the existing one-row `shop_settings`: `hero_eyebrow`, `hero_title`, `hero_text`, `hero_image`, `sale_title`, with length checks matching the limits above. Existing RLS (anyone reads, the admin writes) and grants already cover it.
- **Photo upload:** the existing `product-images` bucket (admin-only writes), path `banners/<uuid>-lg.webp` and `-sm.webp` at 1600px and 800px wide, using the existing `resizeToWebp`. A replaced photo gets a new name, so no stale cache.
- **Served HTML:** a Cloudflare Function on `/` (added to `_routes.json`) reads `shop_settings` and rewrites slide one's text and photo into `index.html` before it is sent, so the headline and photo paint before any script, and Google reads the owner's headline. `/p/<slug>` pages share the same shell and get the same rewrite. The rewrite lives in `lib/hero.js` and is used by both routes; all values are HTML-escaped.
- **Failure:** if Supabase can't be read, `/` serves today's static banner, uncached (`no-store`), just as `/p/` does today. Product pages are unaffected beyond the banner.
- **Caching:** `/` is cached for 5 minutes (`max-age=300`), like `/p/`.
- **Client:** `renderHero()` builds the sale slide's photos and headline. After the admin saves, the client updates slide one in place. Rotation, dots and reduced-motion behaviour are unchanged.

## Testing

- `tests/hero.test.mjs` (Node): the rewrite against the real `index.html` covers the defaults, each field, the photo element and srcset, escaping of hostile text, the single `<h1>`, and Supabase being down.
- SQL (PGlite): the columns exist, length limits are refused, anon can read, a non-admin can't write.
- `tests/ui-smoke.mjs` covers:
  - the Banners tab saves each field and updates slide one;
  - Remove photo restores the plain banner;
  - the sale slide picks at most three photo pieces, biggest discount first, and skips photo-less and sold-out ones;
  - the sale headline overrides the automatic headline and falls back to it when cleared;
  - the phone banner is at most 80px taller than the no-photo banner at 390px;
  - the photo is on the right half on desktop;
  - no sideways scroll;
  - the sale note moved without losing its value.
- Visual check: screenshots at 390, 900 and 1280 with and without a photo, compared with the approved mock-ups.

## Out of scope

- Adding, removing or reordering slides (a third slide, a "new collection" slide).
- A button label or link per slide.
- Separate photos for phone and desktop.
- Detecting a sale's theme automatically. Categories don't capture "short sets", so the owner writes the headline.
