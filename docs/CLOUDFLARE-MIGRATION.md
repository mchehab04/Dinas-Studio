# Moving dinasstudio.com from Netlify to Cloudflare Pages

The code is already prepared: the site lives in `public/`, and the order-notification function is at `functions/api/order-notification.js` with its logic in `lib/`. Verified locally on Cloudflare's runtime with `wrangler pages dev`.

Do the phases in order. The ordering is what keeps the live shop and its emails working throughout.

## Phase 0 — Freeze Netlify (before pushing anything)

Netlify → your project → **Project configuration → Build & deploy → Continuous deployment → Stop builds**.

**Why this comes first:** the new commits move `index.html` into `public/`. Netlify publishes the repo root, so if it ever built them — for instance when credits reset — `dinasstudio.com` would return 404 and the old notification function would disappear. Stopping builds keeps the current working build live until Cloudflare takes over.

## Phase 1 — Create the Cloudflare Pages project

1. Push the waiting commits to GitHub.
2. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git** → GitHub → `Dinas-Studio`, production branch `main`.
3. Build settings:
   - Framework preset: **None**
   - Build command: **leave empty**
   - Build output directory: **`public`**
4. Before deploying, open **Environment variables** and add, for Production:

   | Name | Value | Type |
   |---|---|---|
   | `RESEND_API_KEY` | a **new** Resend key, sending access only | Secret |
   | `WEBHOOK_SECRET` | a new random value | Secret |
   | `NOTIFY_TO` | the notification address(es), comma-separated | Plain text |

   New values rather than copies: Netlify's secret variables are write-only, and the move is a natural point to rotate them.
5. Deploy. Note the `https://<project>.pages.dev` address.

If the variables were added after the first deploy, trigger a redeploy — they only take effect on a new deployment.

## Phase 2 — Verify on pages.dev, then move notifications

Nothing here touches DNS, so the live site is unaffected.

1. Open `https://<project>.pages.dev` — products should load.
2. Open `https://<project>.pages.dev/api/order-notification` — it should say **Method not allowed**. That means the function deployed.
3. Supabase → **Database → Webhooks → `on_order_created`** → edit:
   - URL: `https://<project>.pages.dev/api/order-notification`
   - Header `x-webhook-secret`: the new `WEBHOOK_SECRET`
4. Place a test order on `dinasstudio.com`. Both the owner notification and the customer confirmation should arrive.

The `pages.dev` address is permanent and independent of DNS, so notifications now run on Cloudflare and no longer depend on the nameserver switch going smoothly.

## Phase 3 — Stage DNS in Cloudflare (don't switch yet)

1. Cloudflare → **Add a domain** → `dinasstudio.com` → Free plan.
2. Cloudflare scans the current records. **Check every one of these exists and matches exactly**; add any it missed:

   | Type | Name | Content |
   |---|---|---|
   | TXT | `@` | `google-site-verification=EbVb-oze-my6o7gxqk3DvNgwOS4g8d22oVSEy8cjN2A` |
   | TXT | `send` | `v=spf1 ip4:52.3.252.119 ip4:44.222.39.36 ip4:199.249.231.0/24 ~all` |
   | MX | `send` | `feedback.forge.rmta.net`, priority 10 |
   | TXT | `resend._domainkey` | the full DKIM key from Netlify's DNS panel |
   | TXT | `_dmarc` | `v=DMARC1; p=none;` |

   Copy the DKIM key from Netlify's DNS panel rather than retyping it — it is long and a single wrong character fails verification.
3. Any imported A or CNAME records for `dinasstudio.com` or `www` still point at Netlify. **Leave them, but set them to DNS only (grey cloud).** They keep the site reachable through the nameserver switch; Phase 5 replaces them.

**If the Resend records don't come across, order notifications, customer confirmations, password resets and signup confirmations all stop sending** — with nothing visibly wrong on the site.

## Phase 4 — Switch nameservers

1. Cloudflare shows two nameservers for the domain.
2. Spaceship → `dinasstudio.com` → **Nameservers → Custom** → replace Netlify's four with Cloudflare's two.
3. Wait for Cloudflare's email saying the domain is active. Usually under an hour.

The site stays up throughout: Netlify still serves it via the records kept in Phase 3.

## Phase 5 — Point the domain at Pages

1. Pages project → **Custom domains → Set up a custom domain** → `dinasstudio.com`. Cloudflare replaces the Netlify record with one pointing at Pages.
2. Repeat for `www.dinasstudio.com`.
3. **Redirect `www` to the root.** Netlify did this automatically; Cloudflare needs a rule: **Rules → Redirect Rules** → the "Redirect from WWW to root" template, status 301.
4. **SSL/TLS → Overview → Full**, and **Edge Certificates → Always Use HTTPS: On**.

## Phase 6 — Confirm everything

- [ ] `https://dinasstudio.com` loads with a valid certificate
- [ ] `https://www.dinasstudio.com` redirects to the root
- [ ] `http://dinasstudio.com` redirects to `https://`
- [ ] Place an order — both emails arrive
- [ ] Request a password reset — the email arrives (this proves the Resend records survived)
- [ ] Resend → Domains → `dinasstudio.com` still **Verified**
- [ ] Search Console property still verified
- [ ] `https://dinasstudio.com/supabase/schema.sql` shows the homepage, not the SQL

## Phase 7 — Retire Netlify

Only after every box in Phase 6 is ticked:

1. Resend → revoke the **old** API key that Netlify used.
2. Netlify → delete the project.

Optionally, move the webhook URL from `pages.dev` to `https://dinasstudio.com/api/order-notification`. Not required — the `pages.dev` address keeps working.

## If something goes wrong

- **Site down after the nameserver switch:** in Cloudflare DNS, confirm the root record exists and isn't pointing somewhere stale.
- **Emails stop:** compare Cloudflare's DNS against the table in Phase 3; check Resend's domain status.
- **Full rollback:** at Spaceship, put Netlify's four nameservers back. The frozen Netlify build is still there, so the site returns as it was.
