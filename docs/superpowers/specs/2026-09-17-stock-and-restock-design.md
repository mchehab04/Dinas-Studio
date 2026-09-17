# One-of-a-kind stock, server-side pricing, and restock notifications

**Goal:** Stop two customers buying the same piece, stop order totals being trusted from the browser, and make "Notify Me" actually notify.

Every piece is one of a kind. A sale marks it sold out; there are no quantities. Pieces are never deleted.

## Why these ship together

Nothing is sold out today, so the broken "Notify Me" button is unreachable. The first sale under enforced stock changes that — the button goes live on a real product at the same moment. The stale-bag case also wants Notify Me: a piece bought by someone else is really only *reserved*, and returns to stock if the transfer never arrives, which is exactly when a customer who missed it wants to hear.

## Non-goals

- Quantities or partial stock. One of a kind means sold or not.
- Order cancellation. An unpaid order stays `pending`; the owner flips the piece back to In Stock by hand, as today.
- Automated WhatsApp or SMS. Phone requests surface in the admin panel as `wa.me` links for the owner to message herself — no Business API, no per-message cost.
- Reworking order IDs. They stay client-generated `DS-####`.

## Part 1 — Atomic checkout

### The race

Two shoppers load the page, both see "In Stock", both check out. Any check in the browser passes for both. It can only be prevented as one atomic step in the database.

### `public.place_order(...)`

A Postgres function that, in a single transaction:

1. Rejects the call if there is no signed-in user.
2. Locks each ordered product row `FOR UPDATE`, **in ascending id order** so two concurrent orders sharing pieces cannot deadlock.
3. If any piece is missing or already `out`, raises `sold_out:<name>|<name>` and inserts nothing.
4. Rejects any line whose quantity is not 1.
5. **Recomputes every price from the `products` table**, ignoring anything the client sent, then subtotal, shipping and total.
6. Marks each piece `stock = 'out'`, `soldOut = sizes`.
7. Inserts the order with `userId = auth.uid()`, never a client-supplied id.
8. Returns the inserted row.

The client sends only what it cannot be trusted to price: the order id, display date, customer details, shipping address, payment method, and `[{ productId, size }]`.

**`security definer`**, because customers cannot update `products` under RLS — the same pattern as `is_admin()`. That makes it security-sensitive, so it is deliberately narrow: it touches only the pieces in the order being placed, and only for the caller.

Postgres grants `EXECUTE` on new functions to `PUBLIC` by default, so the function explicitly revokes that and grants only to `authenticated`.

### Shipping is authoritative in the database

Shipping rules move into the function as the source of truth for what is charged:

| Country | Fee | Free over |
|---|---|---|
| `AE` | 25 | 350 |
| `LB` | 10.98 | 551 |

The storefront's `COUNTRIES` constants stay, for the estimate shown before checkout. That is a deliberate duplication with a known failure mode — if the two drift, the pre-checkout estimate can differ from the charge — so each side carries a comment naming the other, and **the confirmation screen shows the returned order row, not the client's numbers.** What the customer sees on confirmation is always what was recorded.

### Closing the bypass

`place_order` is only meaningful if it is the *only* way to create an order. Today `orders_insert_own` lets any signed-in user insert directly — which would let a tampered request skip the stock check and price recomputation entirely. So direct inserts are revoked.

**This must happen after the new client is live.** The currently deployed checkout inserts directly; revoking first breaks checkout for every customer until the next deploy. See "Rollout".

### Stale bags

`place_order` raising `sold_out` means someone else got there first. Checkout removes those pieces from the bag and says so by name — *"Sorry — Silk Jacquard Set was just bought by someone else"* — then offers Notify Me for them, pre-filled from the signed-in customer.

## Part 2 — One of a kind in the UI

- Product detail loses its quantity stepper.
- The bag loses its +/− buttons; each line keeps Remove.
- Adding a piece already in the bag says *"Already in your bag"* instead of silently incrementing.
- The grid's quick-add toast no longer says "Choose your quantity".
- A sold-out piece cannot be added to the bag at all.

## Part 3 — Restock notifications

### `public.restock_requests`

| column | type | notes |
|---|---|---|
| `id` | bigint identity | |
| `product_id` | bigint → `products.id` | cascade on delete |
| `email` | text, nullable | |
| `phone` | text, nullable | E.164, normalised as at checkout |
| `user_id` | uuid, nullable | set when signed in |
| `created_at` | timestamptz | |
| `notified_at` | timestamptz, nullable | set once contacted |

A check constraint requires at least one of `email` or `phone`.

**RLS:** anyone may insert — a shopper need not be signed in to ask — but only admins may read, update or delete. The table is a list of customer contact details and must not be readable by other customers.

Partial unique indexes on `(product_id, email)` and `(product_id, phone)`, scoped to un-notified rows, stop the same person being queued twice for one piece.

### Asking to be notified

The `prompt()` dialog is replaced by a small form, because a single prompt cannot take two fields: email and an optional phone, both pre-filled when signed in, at least one required. It reuses the existing validation layer and phone normalisation.

Reachable from a sold-out product, and from the stale-bag message at checkout.

### Sending

A second Supabase Database Webhook, on **`public.products` UPDATE**, posts to a new function `netlify/functions/restock-notification.mjs`. It acts only when `old_record.stock = 'out'` and `record.stock <> 'out'` — every other product edit (price, photos) is ignored.

For that piece's un-notified requests:

- **email** — sent through Resend automatically, then `notified_at` set.
- **phone only** — left for the owner, since there is no messaging API.

The function authenticates the same way as the order one, with a shared-secret header, and reads requests using a **service-role key** — the table is admin-only under RLS and the webhook has no user session. That key bypasses RLS entirely, so it lives only in Netlify's environment and is marked secret.

It carries its own small `send` helper rather than refactoring the working order function to share one. The duplication is a dozen lines; touching a function that currently works, to save them, is not worth the risk.

### Admin waiting list

Inventory shows a count of people waiting on each piece. Opening it lists them: emailed requests show when they were sent; phone requests show a `wa.me` link and a **Mark contacted** button that sets `notified_at`.

## Rollout

Order matters, because deploys are paused until Netlify credits reset and the live site keeps running the old checkout until then.

1. **Now, safe on the live site:** run `supabase/stock-and-restock.sql`. It only *adds* — the function, the table, its policies. The deployed checkout keeps inserting directly and is unaffected.
2. **When credits reset:** deploy the batched client changes.
3. **Immediately after that deploy:** run `supabase/lock-direct-order-inserts.sql`. Doing this before step 2 breaks live checkout.
4. Add `SUPABASE_SERVICE_ROLE_KEY` to Netlify, marked secret.
5. Create the webhook `on_product_restocked` on `products` UPDATE, pointing at the restock function with the `x-webhook-secret` header.

## Verification

- Two concurrent `place_order` calls for the same piece: exactly one succeeds, the other raises `sold_out`.
- A call with a tampered price records the database price, not the sent one.
- A call with quantity 2 is rejected.
- After step 3, a direct insert into `orders` is rejected for a signed-in customer.
- A stale bag removes the taken piece, names it, and offers Notify Me.
- Anyone can create a restock request; a non-admin cannot read the table back.
- Flipping a piece out → in emails its waiting list once and sets `notified_at`; flipping it again does not re-send.
- Changing a sold-out piece's price or photos sends nothing.
- A phone-only request appears in the admin list with a working `wa.me` link.
