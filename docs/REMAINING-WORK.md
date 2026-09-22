# Remaining work — Dina's Studio

Handoff for picking this project up in a later session. Last updated 2026-09-21.

## Where things stand

The site is live at **https://dinasstudio.com**: a static HTML/CSS/JS storefront on **Cloudflare Pages**, backed by Supabase (auth, products, orders, photo storage), with Resend sending email through a Cloudflare Pages Function.

**Live and working:** real accounts, login-gated checkout, database-backed orders and products, UAE and Lebanon checkout with dual AED/USD pricing, order notifications to the owner, order confirmations to customers, password reset, email confirmation at signup, admin photo upload, and all 17 products on WebP (a full browse fell from 4.1 MB to about 560 KB of images).

## Hosting and deploys

- **Host:** Cloudflare Pages, project `dinas-studio`, deploying `main` from GitHub. Free plan, 500 builds a month, commercial use allowed. Netlify has been deleted.
- **DNS:** Cloudflare (`jo.ns.cloudflare.com`, `rene.ns.cloudflare.com`); registrar is still Spaceship.
- **The user pushes, not Claude** — a global rule, since every push is a production build. Commit locally and say what's waiting.
- **Build settings:** no build command, output directory `public`. Only `public/` is published, so `supabase/`, `docs/`, `lib/` and `tests/` are not publicly reachable.
- **Environment variables** (Pages → Settings → Variables and Secrets, Production): `RESEND_API_KEY` and `WEBHOOK_SECRET` as secrets, `NOTIFY_TO` as text. Variables only reach deployments created after they're added — retry the latest production deployment after changing one.
- **Order webhook:** Supabase `on_order_created` posts to `https://dinas-studio.pages.dev/api/order-notification` with the `x-webhook-secret` header. The `pages.dev` address is permanent and doesn't depend on DNS.

Full migration record: [`CLOUDFLARE-MIGRATION.md`](CLOUDFLARE-MIGRATION.md).

## Supabase setup — done

- [x] `supabase/profiles-email-integrity.sql` has been run (unique `profiles.email`, kept in step with auth).
- [x] "Confirm email" is on.

## Small cleanups, post-migration

- [x] **Search Console:** old URL-prefix property for `fanciful-dragon-ec8169.netlify.app` removed.
- [x] **`public/index.html`:** stale `google-site-verification` meta tag removed. The live Domain property is verified by the DNS TXT record on `@`.
- [x] **`public/404.html` added.** Unknown paths now return a real 404 instead of the homepage with a 200.
- [x] **Favicon.** `/favicon.ico` was answered by the SPA fallback — HTML with a 200 — so Google showed a placeholder globe instead of the logo. Real `public/favicon.ico` (48/96/144px) and `public/icon-192.png` now sit at the probed paths, with root-relative link tags. Google refreshes favicons on its own schedule, days to weeks after the deploy.

## Stock, pricing and payment — live

Parts 1 and 2 of [the spec](superpowers/specs/2026-09-17-stock-and-restock-design.md) are built, deployed and rolled out; all the SQL has been run.

- **`public.place_order`** claims each piece and prices the order in one transaction, so two customers cannot buy the same one-of-a-kind piece, and the browser no longer decides what it pays. `supabase/lock-direct-order-inserts.sql` has been run, so it is the only way an order can be created — there is no direct insert path left.
- **Quantity is gone.** A piece is in the bag or it isn't; adding it twice says so. A bag that goes stale names the piece that went, drops it and reopens.
- **A sale marks the piece Sold Out immediately**, without a reload — the grid skips rebuilds while the visible ids are unchanged, so `markPiecesSold` clears the signature as well as the cached stock.
- **Revenue counts orders marked paid**, via `orders.paidAt` and a Mark paid control on each order. Payment is tracked apart from status because neither method lines up with a fulfilment step. Orders placed before this read as unpaid until marked.

To re-check any of it: `supabase/verify-place-order.sql` tests against real data inside a transaction it rolls back.

## Restock notifications — live

Part 3 of [the spec](superpowers/specs/2026-09-17-stock-and-restock-design.md), working end to end: a shopper joins a waiting list from a sold-out piece (or automatically when their bag goes stale at checkout), and setting that piece back to In Stock emails everyone on it.

- **Table:** `public.restock_requests` — email and/or phone, either alone is enough. Anyone may insert; only admins may read it back. Partial unique indexes stop one person queueing twice for a piece.
- **Function:** `lib/restock-notification.js` behind `functions/api/restock-notification.js`, on the Supabase webhook `on_product_restocked` (`public.products` UPDATE). It acts only on out → in stock; price edits, new photos and pieces going out of stock all arrive there too and send nothing.
- **Config:** `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are Pages variables, the second a secret. The table is granted to `service_role` — needed separately from RLS.
- **Phone-only requests** can't be emailed, so they show in the admin inventory under **Waiting (n)** with a `wa.me` link and a Mark contacted button.

Gmail may file the email under Important rather than Primary. That is a per-recipient judgement based on the recipient's own history and is not something worth engineering against.

## Per-product URLs — built, waiting to be deployed

[Spec](superpowers/specs/2026-09-22-per-product-urls-design.md). Every piece has its own address: `/p/<slug>-<id>`, e.g. `/p/black-cotton-set-1`.

- **`functions/p/[slug].js`** (logic in `lib/product-page.js`) serves the ordinary shop shell with the head rewritten for that piece — title, description, `og:image`, canonical and Product JSON-LD — plus a marker telling the app which piece to open. Social scrapers never run JavaScript, so this is the whole reason a WhatsApp preview can work at all.
- **The id at the end resolves the piece**, the words in front are decoration. A renamed piece keeps working, and a stale slug 301s to the canonical URL. No `slug` column, no migration.
- **`/sitemap.xml` is generated** from the product list (`functions/sitemap.xml.js`); the static `public/sitemap.xml` was deleted so there is no question which answers.
- **Cards are real `<a href>`** with clicks intercepted for the SPA feel. Back and Forward move between the shop and a piece.
- **No new secrets.** Products are world-readable, so it uses the publishable key, with `SUPABASE_URL`/`SUPABASE_ANON_KEY` as optional overrides.

### After deploying

1. Open two or three pieces and confirm the address bar follows.
2. Paste a product link into WhatsApp — the preview should show that piece, not the logo.
3. Search Console → resubmit `https://dinasstudio.com/sitemap.xml` so the new URLs are discovered.
4. Watch Coverage over the following weeks. Pages indexed without content is the signal to server-render the body text — deliberately deferred until there's evidence it's needed.

## Remaining concerns after that

| Item | Notes |
|---|---|
| **Admin shopping** | Decided to leave as is. Admins can place orders; no security issue, but test orders land among real revenue. |
| **Orphaned photo uploads** | Accepted. If publishing fails after photos upload, the files remain in storage. |
| **Payment links** | Deferred, not now. For the UAE, Ziina or Mamo send a link over WhatsApp with no site integration; Lebanon realistically stays on Whish. |
| **Replies from orders@** | Cloudflare Email Routing forwards `orders@dinasstudio.com` to a personal inbox — set up, delivery not yet confirmed. Replies to a customer still go out from the personal address unless Gmail's "Send mail as" is pointed at Resend's SMTP. The customer confirmation already sets `Reply-To` to `NOTIFY_TO`, so replies land whether or not this works. |

## Things worth knowing before changing anything

- **A service-role key bypasses RLS but still needs table grants.** They are separate mechanisms, and a missing `grant ... to service_role` fails as `42501 permission denied` with a perfectly valid key. Any new table a Pages function reads needs that grant, and Postgres names it in the error hint — read that before doubting the key.
- **Escape anything a customer typed before it reaches `innerHTML`** — use `escHtml()` in `public/js/app.js`. The admin panel is the sharp case: anyone at all can insert a restock request, so an unescaped email or phone number would run as script in the owner's session, with the owner's privileges. `tests/ui-smoke.mjs` has a regression check that was confirmed to fail without the escaping.
- **Every file in `functions/` becomes a route.** Keep tests and shared code out of it — logic lives in `lib/`, and `functions/api/` holds only thin adapters. The Netlify equivalent of this mistake once broke a build.
- **Functions read `env`, not `process.env`.** Workers have no `process.env`; `lib/order-notification.js` takes `env` as an argument.
- **Test locally on Cloudflare's runtime before pushing:** `npx wrangler pages dev public --binding RESEND_API_KEY=test NOTIFY_TO=a@x.com WEBHOOK_SECRET=test`. A pass under plain Node once hid a real bundling failure.
- **Run the function tests with** `node tests/order-notification.test.mjs` (41 checks) and `node tests/restock-notification.test.mjs` (33 checks). No framework, no dependencies.
- **`tests/ui-smoke.mjs`** drives the real storefront in a browser for the bag, the stale-bag path and the admin's paid accounting, Notify Me, the waiting list and an XSS regression check (41 checks). It needs a local static server and Playwright; the header says how. Playwright is deliberately not a project dependency.
- **Resend's DNS records now live in Cloudflare DNS:** TXT and MX on `send`, TXT on `resend._domainkey`, TXT on `_dmarc`. Cloudflare's import skipped the `send` records at first. If DNS ever moves again, recreate them before switching nameservers, or every email stops with nothing visibly wrong.
- **Keep email-related DNS records grey (DNS only).**
- **The Search Console TXT record on `@` must stay permanently** — deleting it un-verifies the property.
- **Resend keys, one job each:** `cloudflare-orders` (Pages function) and `supabase-auth` (Supabase SMTP). The original Netlify key has been revoked.
- **The Supabase publishable key in `public/js/supabaseClient.js` is meant to be public.** Row-level security is what protects the data; this was verified from outside.
- Design specs for every major feature are in `docs/superpowers/specs/`.
