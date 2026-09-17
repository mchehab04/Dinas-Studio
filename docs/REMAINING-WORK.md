# Remaining work — Dina's Studio

Handoff for picking this project up in a later session. Last updated 2026-09-17, after the move to Cloudflare Pages.

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

## Next up: stock, pricing and restock notifications

Fully designed, not built. Spec: [`docs/superpowers/specs/2026-09-17-stock-and-restock-design.md`](superpowers/specs/2026-09-17-stock-and-restock-design.md).

In short:

- A `place_order` Postgres function makes checkout atomic, so two customers cannot buy the same one-of-a-kind piece. It marks pieces sold out on order and **recomputes prices server-side**, since totals are currently trusted from the browser.
- The quantity stepper is removed from product detail and the bag — every piece is one of a kind.
- "Notify Me" becomes real: a `restock_requests` table taking email and/or phone, automatic emails when a piece comes back in stock, and an admin waiting list with `wa.me` links for phone-only requests.
- A bag that goes stale at checkout names the piece someone else bought and offers Notify Me.

The spec was written while the site was on Netlify. Two things change on Cloudflare: the restock function goes in `functions/api/` with its logic in `lib/`, and `SUPABASE_SERVICE_ROLE_KEY` goes into Pages' environment variables as a secret.

### Rollout order is critical

Getting this wrong breaks live checkout for every customer.

1. Run the **additive** SQL (function, table, policies). Safe on the live site.
2. Deploy the client changes.
3. **Only after that deploy is live**, run the SQL that revokes direct inserts into `orders`. The currently deployed checkout inserts directly; revoking first breaks it.
4. Add `SUPABASE_SERVICE_ROLE_KEY` to Pages as a secret. This key bypasses RLS entirely.
5. Create the webhook `on_product_restocked` on `products` UPDATE.

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
- **Resend's DNS records now live in Cloudflare DNS:** TXT and MX on `send`, TXT on `resend._domainkey`, TXT on `_dmarc`. Cloudflare's import skipped the `send` records at first. If DNS ever moves again, recreate them before switching nameservers, or every email stops with nothing visibly wrong.
- **Keep email-related DNS records grey (DNS only).**
- **The Search Console TXT record on `@` must stay permanently** — deleting it un-verifies the property.
- **Resend keys, one job each:** `cloudflare-orders` (Pages function) and `supabase-auth` (Supabase SMTP). The original Netlify key has been revoked.
- **The Supabase publishable key in `public/js/supabaseClient.js` is meant to be public.** Row-level security is what protects the data; this was verified from outside.
- Design specs for every major feature are in `docs/superpowers/specs/`.
