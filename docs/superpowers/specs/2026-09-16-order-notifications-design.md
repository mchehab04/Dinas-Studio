# Order notifications

**Goal:** Tell the store owner when an order arrives. Today orders are written to `public.orders` and nothing else happens — the only way to learn of a sale is to open the admin dashboard and look. The site is live and taking real orders, so an order can sit unseen indefinitely.

**Architecture:** A Supabase Database Webhook fires on `INSERT` into `public.orders` and POSTs the new row to a Netlify Function, which formats it and sends an email through Resend.

## Non-goals

- Customer-facing email. No order confirmation to the shopper; they already get the on-screen confirmation. Sending to customers arrives with password reset, which this work unblocks but does not deliver.
- Retry or queueing. See "Failure handling".
- Notifications for status changes, cancellations, or anything other than a new order.
- Any change to how orders are created or stored.

## Why the database, not the browser

The notification must fire from Postgres, not from `placeOrder()` after a successful insert. A browser-side send fails in exactly the cases that matter most: the customer closes the tab immediately after paying, their connection drops, or someone writes to the API directly. A database webhook fires from the row being written, so it cannot be skipped by the client.

This also means a notification failure can never roll back or block an order. The insert has already committed by the time the webhook runs.

## Components

### Supabase Database Webhook

- Table `public.orders`, event `INSERT` only.
- Method `POST` to the function URL.
- Custom header `x-webhook-secret: <random value>`.
- Payload is Supabase's standard shape: `{ type, table, schema, record, old_record }`. The order is in `record`.

### Netlify Function — `netlify/functions/order-notification.js`

No npm dependency and no bundler: Node 18+ provides global `fetch`, and Resend is a plain HTTPS call, so the site's no-build-step property is preserved.

Order of operations:

1. Reject anything that is not `POST`.
2. Compare `x-webhook-secret` against `WEBHOOK_SECRET`. Mismatch returns 401 and nothing else runs.
3. Read `record` from the body; if absent, return 400.
4. Format the order as HTML.
5. POST to `https://api.resend.com/emails` with the Resend key.
6. Return 200.

**Why the secret:** the function URL is public and unauthenticated by default. Without the check, anyone who discovers it could POST fabricated orders — filling the inbox with junk and, worse, burying a real order among them. The comparison is a plain string match; this guards against nuisance traffic, not a determined attacker, and that is the appropriate bar for the consequence.

### Secrets

Set as Netlify environment variables, never committed:

| Variable | Purpose |
|---|---|
| `RESEND_API_KEY` | Resend API key |
| `NOTIFY_TO` | Address that receives order notifications |
| `WEBHOOK_SECRET` | Shared secret matching the Supabase webhook header |

The function reads all three from `process.env`. If any is missing it returns 500 and logs which one, rather than failing silently.

## Email contents

Subject: `New order DS-1234 — AED 588` (id and total, so the inbox list alone is useful).

Body:

- Order id, date, status, payment method
- Customer name, email, phone — the phone matters, since bank transfer details are sent over WhatsApp to that number
- Country, region, street address, and delivery notes if present
- Each item: name, size, quantity, line total
- Subtotal, shipping, total

Amounts are AED, matching what is stored. USD is a display concern of the storefront and is not recomputed here.

## Failure handling

If Resend is unavailable when the webhook fires, that notification is lost — Supabase webhooks do not retry. This is accepted rather than engineered around:

- The order itself is already committed and safe.
- The admin dashboard remains the authoritative list of orders.
- At this volume, retry infrastructure costs more than the failure it prevents.

The function logs failures so they are visible in Netlify's function log, and never logs the full customer record.

## Setup steps (one-time, human)

1. Create a Resend account.
2. Add `dinasstudio.com` as a sending domain and add the DNS records Resend gives you — in **Netlify**, which holds DNS for the domain.
3. Create an API key.
4. In Netlify, set `RESEND_API_KEY`, `NOTIFY_TO` and `WEBHOOK_SECRET` as environment variables.
5. In Supabase, create the Database Webhook on `public.orders` INSERT, pointing at the deployed function URL, with the `x-webhook-secret` header set to the same value.

## Verification

- POST to the function with no secret, and with a wrong secret: both rejected, no email sent.
- POST a representative order payload with the correct secret: email arrives with every field populated and correct.
- A Lebanon order shows Lebanon and its governorate, not a UAE default.
- Place a real order through the site end to end and confirm the email arrives unprompted.
- Confirm the function log contains no customer personal data.
