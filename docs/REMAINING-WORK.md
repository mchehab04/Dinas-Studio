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

## Stock and pricing — built, waiting to be rolled out

Part 1 and Part 2 of [the spec](superpowers/specs/2026-09-17-stock-and-restock-design.md) are written and tested locally. **Nothing is live until the steps below are done, in this order.**

What changed: `public.place_order` claims each piece and prices the order inside one transaction, so two customers cannot buy the same one-of-a-kind piece and the browser can no longer decide what it pays. Quantity is gone from the product page and the bag — a piece is in the bag or it isn't. A bag that goes stale names the piece that went and drops it.

### Rollout — the order matters

1. **Now, safe on the live site:** run `supabase/place-order.sql`. It only adds a function; the deployed checkout keeps inserting directly and is unaffected.
2. **Optional, also safe:** run `supabase/verify-place-order.sql`. It tests against real data inside a transaction it rolls back, and prints PASS/FAIL notices.
3. **Deploy** the client changes (push — one build).
4. **Only after that deploy is live**, run `supabase/lock-direct-order-inserts.sql`. It revokes direct inserts into `orders`. Run before step 3 and live checkout breaks for every customer until the next deploy.

To confirm step 3 landed before doing step 4: place a real test order. If the piece flips to Sold Out on its own, `place_order` is in use.

### Still to build — Part 3, restock notifications

"Notify Me" still only writes to `localStorage`, so nothing is ever sent. Unreachable until the first piece actually sells out, which is why it was left for second. Needs: the `restock_requests` table, a form in place of the `prompt()`, a `functions/api/restock-notification.js` on a `products` UPDATE webhook, `SUPABASE_SERVICE_ROLE_KEY` as a Pages secret, and the admin waiting list. Full detail in the spec.

## Remaining concerns after that

| Item | Notes |
|---|---|
| **Per-product URLs** | The site is one page, so 17 products produce one indexable URL and nothing can rank individually. The largest remaining job, and the main SEO ceiling. |
| **Admin shopping** | Decided to leave as is. Admins can place orders; no security issue, but test orders land among real revenue. |
| **Orphaned photo uploads** | Accepted. If publishing fails after photos upload, the files remain in storage. |

## Things worth knowing before changing anything

- **Every file in `functions/` becomes a route.** Keep tests and shared code out of it — logic lives in `lib/`, and `functions/api/` holds only thin adapters. The Netlify equivalent of this mistake once broke a build.
- **Functions read `env`, not `process.env`.** Workers have no `process.env`; `lib/order-notification.js` takes `env` as an argument.
- **Test locally on Cloudflare's runtime before pushing:** `npx wrangler pages dev public --binding RESEND_API_KEY=test NOTIFY_TO=a@x.com WEBHOOK_SECRET=test`. A pass under plain Node once hid a real bundling failure.
- **Run the function test with** `node tests/order-notification.test.mjs` (37 checks, no framework).
- **`tests/bag-smoke.mjs`** drives the real storefront in a browser for the bag and stale-bag behaviour (17 checks). It needs a local static server and Playwright; the header says how. Playwright is deliberately not a project dependency.
- **Resend's DNS records now live in Cloudflare DNS:** TXT and MX on `send`, TXT on `resend._domainkey`, TXT on `_dmarc`. Cloudflare's import skipped the `send` records at first. If DNS ever moves again, recreate them before switching nameservers, or every email stops with nothing visibly wrong.
- **Keep email-related DNS records grey (DNS only).**
- **The Search Console TXT record on `@` must stay permanently** — deleting it un-verifies the property.
- **Resend keys, one job each:** `cloudflare-orders` (Pages function) and `supabase-auth` (Supabase SMTP). The original Netlify key has been revoked.
- **The Supabase publishable key in `public/js/supabaseClient.js` is meant to be public.** Row-level security is what protects the data; this was verified from outside.
- Design specs for every major feature are in `docs/superpowers/specs/`.
