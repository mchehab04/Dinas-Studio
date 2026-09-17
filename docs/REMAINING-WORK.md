# Remaining work — Dina's Studio

Handoff for picking this project up in a later session. Written 2026-09-17.

## Where things stand

The site is live at **https://dinasstudio.com**: a static HTML/CSS/JS storefront on Netlify, backed by Supabase (auth, products, orders, photo storage), with Resend sending email through a Netlify function.

**Live and working:** real accounts, login-gated checkout, database-backed orders and products, UAE and Lebanon checkout with dual AED/USD pricing, order notifications to the owner, order confirmations to customers, password reset, email confirmation at signup, admin photo upload, and all 17 products migrated to WebP (a full browse fell from 4.1 MB to about 560 KB of images).

## Blocker: Netlify deploys are paused

Netlify's monthly credits ran out. **The site stays up and serves the current build; only new deploys are blocked.**

The cause was development churn, not traffic: 35 pushes to `main` in one session, each triggering a production deploy that draws credits. Until this is resolved, **commit locally and do not push** — every push to `main` is a deploy.

Options being weighed: upgrade Netlify, or move to Cloudflare Pages or Vercel. See the hosting note at the end.

## Unpushed local commits

| Commit | What |
|---|---|
| `1f9eb4f` | Design spec for one-of-a-kind stock and restock notifications |

## Setup steps asked for but not confirmed done

Check each of these; none can be verified from outside.

- [ ] **Run `supabase/profiles-email-integrity.sql`** — adds the unique constraint on `profiles.email` and the trigger that keeps it in step with auth.
- [ ] **Supabase → Authentication → Sign In / Providers → Email → turn ON "Confirm email".** The client handling is already deployed, but signup behaves the old way until this is on.

## Next up: stock, pricing and restock notifications

Fully designed, not built. Spec: [`docs/superpowers/specs/2026-09-17-stock-and-restock-design.md`](superpowers/specs/2026-09-17-stock-and-restock-design.md).

In short:

- A `place_order` Postgres function makes checkout atomic, so two customers cannot buy the same one-of-a-kind piece. It marks pieces sold out on order and **recomputes prices server-side**, since totals are currently trusted from the browser.
- The quantity stepper is removed from product detail and the bag — every piece is one of a kind.
- "Notify Me" becomes real: a `restock_requests` table taking email and/or phone, automatic emails when a piece comes back in stock, and an admin waiting list with `wa.me` links for phone-only requests.
- A bag that goes stale at checkout names the piece someone else bought and offers Notify Me.

### Rollout order is critical

Getting this wrong breaks live checkout for every customer.

1. Run the **additive** SQL (function, table, policies). Safe on the live site.
2. Deploy the client changes — needs the Netlify blocker resolved.
3. **Only after that deploy**, run the SQL that revokes direct inserts into `orders`. The currently deployed checkout inserts directly; revoking first breaks it.
4. Add `SUPABASE_SERVICE_ROLE_KEY` to the host's environment, marked secret. This key bypasses RLS entirely.
5. Create the webhook `on_product_restocked` on `products` UPDATE.

## Remaining concerns after that

| Item | Notes |
|---|---|
| **Per-product URLs** | The site is one page, so 17 products produce one indexable URL and nothing can rank individually. The largest remaining job, and the main SEO ceiling. |
| **Admin shopping** | Decided to leave as is. Admins can place orders; no security issue, but test orders land among real revenue. |
| **Orphaned photo uploads** | Accepted. If publishing fails after photos upload, the files remain in storage. |

## Things worth knowing before changing anything

- **Never put non-function files in `netlify/functions/`.** Netlify bundles everything there as a deployable function; a test file placed there once broke the build. Tests live in `tests/`.
- **Run the function test with** `node tests/order-notification.test.mjs` (37 checks, no framework).
- **Resend DNS records live in Netlify DNS.** If DNS ever moves hosts, the SPF/DKIM records for `dinasstudio.com` must be recreated first, or order notifications, confirmations and password resets all stop sending.
- **The Search Console verification TXT record must stay in DNS permanently** — deleting it un-verifies the property.
- **The Supabase publishable key in `js/supabaseClient.js` is meant to be public.** Row-level security is what protects the data; this was verified from outside.
- Design specs for every major feature are in `docs/superpowers/specs/`.

## Hosting decision

**Moving to Cloudflare Pages** — free, commercial use allowed, 500 builds a month. Vercel was ruled out because its free plan forbids commercial use.

The code is prepared (site in `public/`, function in `functions/api/` + `lib/`). Follow [`CLOUDFLARE-MIGRATION.md`](CLOUDFLARE-MIGRATION.md) phase by phase — **freeze Netlify builds before pushing**, or the next Netlify build publishes a site with no `index.html`.

After the move, the Netlify-specific notes above no longer apply: functions live in `functions/`, where Cloudflare turns every file into a route, so the same rule holds — keep tests and shared code out of it.
