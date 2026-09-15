# Real authentication, accounts, orders, and product storage (Supabase)

## Goals

1. Protect the admin panel with real authentication (today it's an unauthenticated `#admin` route).
2. Let customers create real accounts (persisted across devices/browsers, not just localStorage).
3. Require an account before an order can be placed.
4. Fix the existing bug where `placeOrder()` only writes to `localStorage` — orders currently never reach the store owner. Orders become real, shared, database rows.
5. Move product inventory into the same database so admin edits (stock, price, new pieces) actually take effect for every visitor, instead of only affecting the editor's own browser cache.

## Non-goals (v1)

- Email verification on signup.
- Password reset flow (Supabase supports it, but it needs email sending configured — deferred).
- Order notifications (email/SMS/webhook when a new order lands). Owner checks the admin dashboard instead.
- Any change to cart/wishlist storage — these stay in `localStorage`, browsable without login.
- A build step / bundler / npm dependency. The site stays plain HTML/CSS/JS; Supabase is loaded via a CDN `<script>` tag.
- Multi-admin invite system. There is exactly one store owner; they self-promote via the Supabase table editor (see "Bootstrapping the first admin" below).

## Architecture

Supabase (hosted Postgres + Auth) is the only new infrastructure. The browser talks to Supabase directly using the public **anon key** — this key is meant to be public; all access control is enforced server-side by Postgres Row-Level Security (RLS), not by keeping the key secret. No custom backend/serverless code is introduced in v1.

The Supabase JS client is loaded via `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js` (or the project's preferred CDN), matching the existing no-build-tool setup.

## Data model

### `profiles`
| column | type | notes |
|---|---|---|
| `id` | uuid, PK | = `auth.users.id` |
| `email` | text | copied from auth at signup |
| `name` | text | |
| `phone` | text | |
| `role` | text | `'customer'` (default) or `'admin'` |
| `created_at` | timestamptz | default `now()` |

A Postgres trigger on `auth.users` insert creates the matching `profiles` row with `role = 'customer'`. This is the standard Supabase pattern for extending auth users with app-specific fields.

### `products`
Mirrors the current `data/products.json` shape: `id`, `name`, `cat`, `price`, `sizes`, `images`, `stock`, `description`, plus `updated_at`. Exact column list follows whatever fields `products.json` / the admin "Add Piece" form already use — no new fields invented here.

### `orders`
| column | type | notes |
|---|---|---|
| `id` | uuid/text, PK | |
| `user_id` | uuid | → `auth.users.id` |
| `customer` | jsonb | name/email/phone **snapshot** at order time |
| `shipping_address` | jsonb | |
| `payment_method` | text | |
| `items` | jsonb | product/qty/price snapshot at order time |
| `subtotal`, `shipping`, `total` | numeric | |
| `status` | text | e.g. `pending`, mirrors current admin order statuses |
| `created_at` | timestamptz | default `now()` |

Snapshotting customer + item data at order time (rather than joining live `profiles`/`products` rows) keeps historical orders accurate even if a profile or product changes later.

## Row-Level Security

- **profiles**: a user can `SELECT`/`UPDATE` only their own row (`id = auth.uid()`). Admin can `SELECT` all rows (policy checks the requester's own `profiles.role = 'admin'`).
- **products**: `SELECT` allowed for everyone (including anonymous/`anon` role), so the public catalog keeps working without login. `INSERT`/`UPDATE`/`DELETE` require the requester's `profiles.role = 'admin'`.
- **orders**: `INSERT` allowed for an authenticated user only for `user_id = auth.uid()`. `SELECT` allowed for the owning user (own orders only) or an admin (all orders). `UPDATE` (status changes) admin-only.

These are enforced in Postgres itself. A non-admin calling the API directly (e.g. from devtools) cannot write products or read another customer's orders, regardless of what the UI shows.

## Auth flows

- **Signup**: email + password + name + phone → `supabase.auth.signUp()`. No email confirmation step; the account is usable immediately.
- **Login**: `supabase.auth.signInWithPassword()`.
- **Session persistence**: handled automatically by the Supabase client (refresh token in localStorage); survives page reloads.
- **Sign out**: `supabase.auth.signOut()`.
- `state.user` (currently populated from `storageService.getUser()` / localStorage) is replaced by the live Supabase session + the matching `profiles` row.

## Checkout gating

- Cart and wishlist require no login, unchanged from today.
- At checkout: if there's no active Supabase session, show the sign-in/signup form before the checkout form (satisfies "an account must be created before ordering").
- `placeOrder()` inserts into the `orders` table via the Supabase client instead of `storageService.saveOrder()`.
- **Bug fix bundled in**: today the cart is cleared unconditionally right after `placeOrder()` is called. Once order creation is a real network call that can fail (expired session, offline, RLS rejection), the cart must only clear after the insert actually succeeds. On failure, show a retry-able error and leave the cart intact.

## Admin

- The unauthenticated `#admin` hash route is removed. Reaching admin UI requires an active session.
- After login, the app checks the signed-in user's `profiles.role`. Only `'admin'` renders the admin UI at all; RLS independently blocks admin-only reads/writes for anyone else regardless of what the client renders.
- **Bootstrapping the first admin**: sign up through the normal customer flow once, then manually set that one row's `profiles.role` to `'admin'` in the Supabase dashboard's table editor. One-time, by hand — no admin-invite system is built.

## Error handling

- Login/signup failures (wrong password, duplicate email, weak password, offline) surface as an inline form error, following the existing `showToast`/inline-message patterns already in `app.js`.
- Order insert failure mid-checkout: show a retry-able error; cart is preserved (see above).
- Supabase unreachable: auth and order operations are inherently online-only and fail with a clear message. Product reads keep the existing offline-tolerant fallback-to-cache behavior already in `apiService.fetchProducts()`, now reading from Supabase instead of `data/products.json` as the network source.

## Migration notes

- Existing `localStorage` keys (`dinas_user`, `dinas_orders`, `dinas_products`, etc.) held fake/prototype data with no real backing. No migration of this data is needed or attempted — it's discarded in favor of real accounts/orders/products.
- `data/products.json` stops being the live data source once products move to Supabase; it may be kept as the seed data used to populate the initial `products` table, then left unused (or removed).

## Setup steps (one-time, human)

1. Create a Supabase project.
2. Create the `profiles`, `products`, `orders` tables and the auth-trigger for `profiles`.
3. Apply the RLS policies above.
4. Seed `products` from the current `data/products.json`.
5. Put the project URL + anon key into the site's client config (public values — safe to ship in client JS given RLS is what actually protects data).
6. Sign up once as a normal customer, then flip that row to `role = 'admin'` in the table editor.

## Testing / verification (manual — no test framework in this project)

- Signup → login → logout.
- Checkout attempt without a session → redirected to sign-in, not allowed through.
- Checkout with a session → order appears in the `orders` table and in the admin dashboard.
- Non-admin account cannot see or reach the admin UI.
- Admin account sees real orders across all customers and can edit a product; a second (incognito) browser session sees the product change without any local cache tricks.
- Direct API check (devtools): a non-admin session's attempt to write to `products` or read another user's `orders` is rejected by Postgres, not just hidden by the UI.
