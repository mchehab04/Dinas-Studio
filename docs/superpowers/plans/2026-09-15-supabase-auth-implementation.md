# Supabase Auth, Accounts, Products & Orders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the site's fake, browser-only "auth" with real Supabase-backed accounts, gate the admin panel and checkout behind real login, and move orders + products off `localStorage` into a real database so orders actually reach the store owner and admin edits actually persist for every visitor.

**Architecture:** Supabase (Postgres + Auth + Row-Level Security), called directly from the browser via the Supabase JS client loaded from a CDN `<script>` tag. No build step, no custom server code — every permission boundary (who can read/write what) is enforced by Postgres RLS policies, not by client-side checks alone.

**Tech Stack:** Vanilla HTML/CSS/JS (existing), Supabase JS client v2 (new, via CDN), Supabase Postgres + Auth (new backend).

**Spec:** [docs/superpowers/specs/2026-09-15-supabase-auth-design.md](../specs/2026-09-15-supabase-auth-design.md)

**Supabase project:**
- URL: `https://ciwahcmsjcywakwhtsle.supabase.co`
- Anon/publishable key: `sb_publishable_OU2KGlmbJd2yLqJEL4vZUA_HYunKZ-K`
(Both are meant to be public client-side values — RLS is what actually protects the data.)

## Global Constraints

- No build step / bundler / npm dependency is introduced. Supabase JS is loaded via CDN `<script>`, same pattern as Google Fonts already in `index.html`.
- No test framework exists in this project and none is introduced. Every task's "test" is a manual browser check, per the spec's own testing section.
- Postgres columns that mirror multi-word JS object keys are created as quoted camelCase (`"soldOut"`, `"paletteIndex"`, `"userId"`, `"shippingAddress"`, `"paymentMethod"`, `"displayDate"`, `"createdAt"`) specifically so `select('*')` rows already match the shape the existing render code expects — no field-name mapping layer is introduced.
- Currency/locale stays `AED` / `en-AE`, unchanged from today.
- Cart and wishlist stay in `localStorage`, unchanged — only accounts, products, and orders move to Supabase.
- The fake "Continue with Google" button (`mockGoogleAuth`) is removed, not preserved — it currently fabricates a session with a hardcoded fake user, which is exactly the behavior this plan replaces. Real Google OAuth is a possible fast-follow, not part of this plan.
- `seedSampleOrders()` (the admin dashboard's "Load Sample Orders" preview button) is removed — it wrote directly to `localStorage`, which no longer matches how orders are stored, and it has no admin-bypass insert policy in the new RLS rules.
- `apiService.deleteProduct()` is removed — dead code, unused by any UI element today, and would be misleading to update-in-place without a caller.

---

## Task 1: Database schema, RLS policies, and seed data

**Files:**
- Already created: `supabase/schema.sql` (tables, trigger, RLS policies)
- Already created: `supabase/seed.sql` (inserts the current 17 products from `data/products.json`)

These two files exist in the repo already (written during planning). This task is running them against the actual Supabase project — there is no Supabase database tool available to this agent, so this step is manual.

- [ ] **Step 1: Run the schema**

In the Supabase dashboard for this project, open **SQL Editor > New query**, paste the full contents of `supabase/schema.sql`, and click **Run**.

Expected: query succeeds with no errors. This creates `profiles`, `products`, `orders`, the `handle_new_user` trigger, and RLS policies on all three tables.

- [ ] **Step 2: Verify RLS is enabled**

In **Table Editor**, open each of `profiles`, `products`, `orders`. Each should show a "RLS enabled" indicator (a lock icon or badge next to the table name).

Expected: all three tables show RLS enabled — if any doesn't, re-run the corresponding `alter table ... enable row level security;` line from `schema.sql`.

- [ ] **Step 3: Run the seed**

Back in **SQL Editor > New query**, paste the full contents of `supabase/seed.sql`, and click **Run**.

Expected: 17 rows inserted, no errors.

- [ ] **Step 4: Verify the seed**

In **Table Editor > products**, confirm there are 17 rows, ids 1–17, matching the names in `data/products.json` (e.g. id 1 = "Black Cotton Set", id 17 = "Summer Kimono — Sunset Paisley").

- [ ] **Step 5: Disable email confirmation (so signup works immediately)**

In **Authentication > Sign In / Providers > Email**, turn **off** "Confirm email". (Per the spec's non-goals: no email-verification step in v1.)

Expected: the toggle is off. If your dashboard version puts this under **Authentication > Settings** instead, look there.

- [ ] **Step 6: Commit the schema files**

```bash
git add supabase/schema.sql supabase/seed.sql
git commit -m "Add Supabase schema, RLS policies, and product seed data"
```

---

## Task 2: Wire the Supabase client into the site

**Files:**
- Create: `js/supabaseClient.js`
- Modify: `index.html:358` (script tag order)

**Interfaces:**
- Produces: a global `supabaseClient` object (the initialized Supabase client) that every later task's code calls directly, e.g. `supabaseClient.auth.signInWithPassword(...)`, `supabaseClient.from('products').select('*')`.

- [ ] **Step 1: Create the client config file**

Create `js/supabaseClient.js`:

```js
const SUPABASE_URL = 'https://ciwahcmsjcywakwhtsle.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_OU2KGlmbJd2yLqJEL4vZUA_HYunKZ-K';

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
```

(The global `supabase` here comes from the CDN script loaded in `index.html` in the next step — it's the SDK namespace; `supabaseClient` is our actual client instance, named differently so nothing shadows the SDK global.)

- [ ] **Step 2: Load the CDN script and the new file, before `app.js`**

In `index.html`, replace:

```html
  <script src="js/app.js"></script>
</body>
```

with:

```html
  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/dist/umd/supabase.js"
    integrity="sha384-iLddHTLokph6Omwoyid4XKxHaWa6w41BnoEj0q5oOrzmYPpHIKt1wyjReA7s//pP"
    crossorigin="anonymous"></script>
  <script src="js/supabaseClient.js"></script>
  <script src="js/app.js"></script>
</body>
```

The version is pinned (not a floating `@2` tag) and the `integrity` hash is a real SHA-384 of that exact file — if jsDelivr or its CDN were ever compromised and served different content, the browser refuses to run it instead of silently executing tampered code. Bumping the Supabase SDK later means updating both the version number and this hash together (recompute with `curl -s <url> | openssl dgst -sha384 -binary | openssl base64 -A`), never one without the other.

- [ ] **Step 3: Manually verify the client loads**

Open `index.html` in a browser (e.g. via a local static server — see the project's `run` skill, or just open the file directly). Open the browser devtools console and run:

```js
supabaseClient.auth.getSession()
```

Expected: a resolved Promise logging `{ data: { session: null }, error: null }` (no one is signed in yet) — not a `ReferenceError`, which would mean the script tags aren't loading in order.

- [ ] **Step 4: Commit**

```bash
git add index.html js/supabaseClient.js
git commit -m "Wire up the Supabase JS client"
```

---

## Task 3: Real signup, login, logout, and session restore

**Files:**
- Modify: `js/app.js` (state init, `renderAccount`, replace `mockGoogleAuth`/`mockManualAuth`/`signOut`, `initApp`)

**Interfaces:**
- Consumes: `supabaseClient` (Task 2).
- Produces: `state.user` — either `null`, or `{ id, email, name, phone, role }` where `role` is `'customer'` or `'admin'`. Later tasks (checkout gating, admin gating) read `state.user` and `state.user.role`.
- Produces: `async function loadCurrentUser()` — refreshes `state.user` from the live Supabase session. Later tasks call this after sign-in/sign-up.
- Produces: `let postAuthRedirect` — `null`, `'checkout'`, or `'admin'`. Task 4 and Task 6 set this before sending an unauthenticated user to sign in, so they land back where they intended after logging in.

- [ ] **Step 1: Stop seeding `state.user` from localStorage**

In `js/app.js`, find the `state` object (around line 222):

```js
let state = {
  category: "All",
  sort: "popularity",
  sortLabel: "Popularity",
  search: "",
  wishlist: new Set(storageService.getWishlist()),
  bag: storageService.getCart(),
  user: storageService.getUser(),
  filterAvail: new Set(),
  filtersOpen: false,
  tab: "shop",
  paymentMethod: "cod"
};
```

Replace the `user: storageService.getUser(),` line with `user: null,` and add a redirect flag right after the object:

```js
let state = {
  category: "All",
  sort: "popularity",
  sortLabel: "Popularity",
  search: "",
  wishlist: new Set(storageService.getWishlist()),
  bag: storageService.getCart(),
  user: null,
  filterAvail: new Set(),
  filtersOpen: false,
  tab: "shop",
  paymentMethod: "cod"
};

let postAuthRedirect = null; // null | 'checkout' | 'admin' — set before sending someone to sign in
```

- [ ] **Step 2: Remove the now-dead `getUser`/`saveUser` from `storageService`**

In `storageService` (around line 75), delete these two methods entirely:

```js
  getUser() {
    try {
      const data = localStorage.getItem('dinas_user');
      return data ? JSON.parse(data) : null;
    } catch(e) { return null; }
  },
  saveUser(user) {
    try {
      if(user) localStorage.setItem('dinas_user', JSON.stringify(user));
      else localStorage.removeItem('dinas_user');
    } catch(e){}
  },
```

- [ ] **Step 3: Add `loadCurrentUser()`**

Add this new function right after the `storageService`/`apiService` block, before `/* ========================= STATE ========================= */` (i.e. just above line 221):

```js
async function loadCurrentUser() {
  const { data: { user } } = await supabaseClient.auth.getUser();
  if(!user) { state.user = null; return; }
  const { data: profile } = await supabaseClient.from('profiles').select('*').eq('id', user.id).single();
  state.user = {
    id: user.id,
    email: user.email,
    name: (profile && profile.name) || user.email.split('@')[0],
    phone: profile ? profile.phone : null,
    role: (profile && profile.role) || 'customer'
  };
}
```

- [ ] **Step 4: Replace the mock auth UI and handlers**

In `renderAccount()` (around line 941), replace:

```js
      <button class="google-btn" onclick="mockGoogleAuth()">
        <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.9 32.6 29.4 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l6-6C34 5.1 29.3 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21 21-9.4 21-21c0-1.4-.1-2.7-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.8 1.1 8 3l6-6C34 5.1 29.3 3 24 3 16.3 3 9.7 7.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 45c5.2 0 9.9-2 13.5-5.2l-6.2-5.3C29.3 36.4 26.8 37 24 37c-5.3 0-9.8-3.4-11.4-8.1l-6.5 5C9.6 40.6 16.2 45 24 45z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.2 5.7l6.2 5.3C40.9 36.6 44 30.9 44 24c0-1.4-.1-2.7-.4-3.5z"/></svg>
        Continue with Google
      </button>
      <div class="divider-row"><div class="line"></div><span>OR</span><div class="line"></div></div>
      ${authTab==='signup' ? `
      <div class="field"><label>Full Name</label><input id="authName" placeholder="Dina Amari"></div>
      ` : ``}
      <div class="field"><label>Email</label><input id="authEmail" type="email" placeholder="you@email.com"></div>
      <div class="field"><label>Password</label><input id="authPass" type="password" placeholder="••••••••"></div>
      <button class="primary-btn" style="width:100%;" onclick="mockManualAuth()">${authTab==='signin' ? 'Sign In' : 'Create Account'}</button>
```

with:

```js
      ${authTab==='signup' ? `
      <div class="field"><label>Full Name</label><input id="authName" placeholder="Dina Amari"></div>
      ` : ``}
      <div class="field"><label>Email</label><input id="authEmail" type="email" placeholder="you@email.com"></div>
      <div class="field"><label>Password</label><input id="authPass" type="password" placeholder="••••••••"></div>
      <button class="primary-btn" style="width:100%;" onclick="handleAuthSubmit()">${authTab==='signin' ? 'Sign In' : 'Create Account'}</button>
```

(The whole `google-btn` block and the `divider-row` above it are deleted — there's no real Google OAuth wired up, so the button is gone rather than left non-functional.)

- [ ] **Step 5: Replace `mockGoogleAuth`/`mockManualAuth`/`signOut` with real auth calls**

Replace the three functions (around lines 962–985):

```js
function mockGoogleAuth(){
  state.user = {name:"Dina Amari", email:"dina@gmail.com"};
  storageService.saveUser(state.user);
  renderAccount();
  showToast("Signed in as Dina Amari ✓");
}

function mockManualAuth(){
  const emailEl = document.getElementById('authEmail');
  const nameEl = document.getElementById('authName');
  const email = emailEl ? emailEl.value.trim() : "";
  if(!email){ showToast("Enter an email to continue"); return; }
  const name = (nameEl && nameEl.value.trim()) ? nameEl.value.trim() : email.split('@')[0];
  state.user = {name, email};
  storageService.saveUser(state.user);
  renderAccount();
  showToast(authTab==='signin' ? "Welcome back ✓" : "Account created ✓");
}

function signOut(){
  state.user = null;
  storageService.saveUser(null);
  renderAccount();
  showToast("Signed out");
}
```

with:

```js
async function handleAuthSubmit(){
  const emailEl = document.getElementById('authEmail');
  const passEl = document.getElementById('authPass');
  const nameEl = document.getElementById('authName');
  const email = emailEl.value.trim();
  const password = passEl.value;

  if(!email || !password){ showToast("Enter an email and password"); return; }

  if(authTab === 'signup'){
    if(password.length < 6){ showToast("Password must be at least 6 characters"); return; }
    const name = (nameEl && nameEl.value.trim()) ? nameEl.value.trim() : email.split('@')[0];
    const { error } = await supabaseClient.auth.signUp({
      email, password, options: { data: { name } }
    });
    if(error){ showToast(error.message); return; }
    await loadCurrentUser();
    showToast("Account created ✓");
  } else {
    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if(error){ showToast(error.message); return; }
    await loadCurrentUser();
    showToast("Welcome back ✓");
  }

  await resolvePostAuthRedirect();
}

async function resolvePostAuthRedirect(){
  const redirect = postAuthRedirect;
  postAuthRedirect = null;
  if(redirect === 'checkout'){
    openCheckout();
  } else if(redirect === 'admin'){
    if(state.user.role === 'admin') await openAdmin();
    else showToast("Not authorized");
  } else {
    await renderAccount();
  }
}

async function signOut(){
  await supabaseClient.auth.signOut();
  state.user = null;
  await renderAccount();
  showToast("Signed out");
}
```

- [ ] **Step 6: Make `renderAccount` and its callers async**

`renderAccount()` currently reads `apiService.getCustomerOrders(state.user.email)` synchronously. Task 4 redefines `getCustomerOrders` to be `async` and keyed by user id instead of email, and updates this exact call site — so for this task, only add the `await` and make the surrounding functions `async`; leave the argument as `.email` for now (Task 4 changes it to `.id` in the same edit that changes the method's signature, keeping caller and callee in sync):

Change:
```js
function renderAccount(){
```
to:
```js
async function renderAccount(){
```

And change:
```js
    const myOrders = apiService.getCustomerOrders(state.user.email);
```
to:
```js
    const myOrders = await apiService.getCustomerOrders(state.user.email);
```

Then update the two direct callers, `openAccount` and `setAuthTab` (around lines 885–889):

```js
function openAccount(){
  renderAccount();
  openSheet('accountSheet');
}
function setAuthTab(t){ authTab = t; renderAccount(); }
```

to:

```js
async function openAccount(){
  await renderAccount();
  openSheet('accountSheet');
}
async function setAuthTab(t){ authTab = t; await renderAccount(); }
```

- [ ] **Step 7: Restore session on page load**

In `initApp()` (around line 1329), add a call to `loadCurrentUser()` before anything else runs:

```js
async function initApp() {
  await loadCurrentUser();
  try {
    PRODUCTS = await apiService.fetchProducts();
  } catch (e) {
    console.error('Failed to load products', e);
  }
  renderTopTabs();
  renderFilterPanel();
  renderGrid();
  updateBagBadge();
  // Admin isn't linked from customer-facing UI; the store owner reaches it via #admin.
  if(location.hash === '#admin') openAdmin();
}
```

(The `#admin` branch itself is rewired in Task 6 — leave it calling `openAdmin()` for now.)

- [ ] **Step 8: Manual verification**

Serve the site locally (the project's `run` skill, or any static file server) and in a browser:
1. Click the account icon, switch to "Create Account", enter a name/email/password (6+ chars), submit.
   Expected: toast "Account created ✓", the account sheet now shows "My Account" with your name/email.
2. In the Supabase dashboard, **Table Editor > profiles**: confirm a new row exists with your email and `role = customer`.
3. Click "Sign Out". Expected: toast "Signed out", account sheet reverts to the sign-in/sign-up tabs.
4. Sign back in with the same email/password. Expected: "Welcome back ✓", account view shown again.
5. Reload the page (F5). Expected: account icon still shows you as signed in (session restored) without signing in again.

- [ ] **Step 9: Commit**

```bash
git add js/app.js
git commit -m "Replace mock auth with real Supabase signup/login/logout"
```

---

## Task 4: Require an account at checkout; orders persist to Supabase

**Files:**
- Modify: `js/app.js` (`openCheckout`, `placeOrder`, `apiService.createOrder`/`getOrders`/`getCustomerOrders`/`updateOrderStatus`, `storageService` cleanup)

**Interfaces:**
- Consumes: `state.user`, `postAuthRedirect`, `resolvePostAuthRedirect()` (Task 3).
- Produces: `apiService.createOrder(orderPayload)` now returns a Promise resolving to the created order (or throws); `apiService.getOrders()` and `apiService.getCustomerOrders(userId)` are now `async` and return Promises of order arrays; `apiService.updateOrderStatus(orderId, status)` is now `async`.

- [ ] **Step 1: Gate `openCheckout()` on having a session**

Replace (around line 675):

```js
function openCheckout() {
  if(state.bag.length === 0) {
    showToast("Your bag is empty");
    return;
  }
  closeAllSheets();
  renderCheckout();
  openSheet('checkoutSheet');
}
```

with:

```js
function openCheckout() {
  if(state.bag.length === 0) {
    showToast("Your bag is empty");
    return;
  }
  if(!state.user) {
    closeAllSheets();
    postAuthRedirect = 'checkout';
    setAuthTab('signin');
    openAccount();
    showToast("Please sign in to checkout");
    return;
  }
  closeAllSheets();
  renderCheckout();
  openSheet('checkoutSheet');
}
```

- [ ] **Step 2: Rewrite `apiService.createOrder` to insert into Supabase**

Replace (around line 197):

```js
  async createOrder(orderPayload) {
    const randomNum = Math.floor(1000 + Math.random() * 9000);
    const order = {
      id: `DS-${randomNum}`,
      date: new Date().toISOString(),
      displayDate: new Date().toLocaleDateString('en-AE', { day:'numeric', month:'short', year:'numeric' }),
      status: 'pending',
      ...orderPayload
    };
    storageService.saveOrder(order);
    return order;
  },
  getOrders() {
    return storageService.getOrders();
  },
  getCustomerOrders(email) {
    if(!email) return [];
    return storageService.getOrders().filter(o => o.customer && o.customer.email.toLowerCase() === email.toLowerCase());
  },
  updateOrderStatus(orderId, status) {
    storageService.updateOrderStatus(orderId, status);
  }
```

with:

```js
  async createOrder(orderPayload) {
    const { data: { user } } = await supabaseClient.auth.getUser();
    const randomNum = Math.floor(1000 + Math.random() * 9000);
    const order = {
      id: `DS-${randomNum}`,
      userId: user.id,
      displayDate: new Date().toLocaleDateString('en-AE', { day:'numeric', month:'short', year:'numeric' }),
      status: 'pending',
      ...orderPayload
    };
    const { data, error } = await supabaseClient.from('orders').insert(order).select().single();
    if(error) throw error;
    return data;
  },
  async getOrders() {
    const { data, error } = await supabaseClient.from('orders').select('*').order('date', { ascending: false });
    if(error) { console.error(error); return []; }
    return data;
  },
  async getCustomerOrders(userId) {
    if(!userId) return [];
    const { data, error } = await supabaseClient.from('orders').select('*').eq('userId', userId).order('date', { ascending: false });
    if(error) { console.error(error); return []; }
    return data;
  },
  async updateOrderStatus(orderId, status) {
    const { error } = await supabaseClient.from('orders').update({ status }).eq('id', orderId);
    if(error) console.error(error);
  }
```

`getCustomerOrders` now takes a user id, not an email — update its one call site, in `renderAccount()` (Task 3, Step 6 left this as `.email`):

```js
    const myOrders = await apiService.getCustomerOrders(state.user.email);
```

to:

```js
    const myOrders = await apiService.getCustomerOrders(state.user.id);
```

- [ ] **Step 3: Remove the now-dead order methods from `storageService`**

Delete `getOrders`, `saveOrder`, and `updateOrderStatus` from `storageService` (around lines 87–110):

```js
  getOrders() {
    try {
      const data = localStorage.getItem('dinas_orders');
      return data ? JSON.parse(data) : [];
    } catch(e) { return []; }
  },
  saveOrder(order) {
    try {
      const orders = storageService.getOrders();
      orders.unshift(order);
      localStorage.setItem('dinas_orders', JSON.stringify(orders));
      return order;
    } catch(e) { return null; }
  },
  updateOrderStatus(orderId, newStatus) {
    try {
      const orders = storageService.getOrders();
      const order = orders.find(o => o.id === orderId);
      if(order) {
        order.status = newStatus;
        localStorage.setItem('dinas_orders', JSON.stringify(orders));
      }
    } catch(e){}
  },
```

- [ ] **Step 4: Fix `placeOrder()` to only clear the cart on success, and surface failures**

Replace (around line 775):

```js
async function placeOrder() {
  const name = document.getElementById('coName').value.trim();
  const email = document.getElementById('coEmail').value.trim();
  const phone = document.getElementById('coPhone').value.trim();
  const emirate = document.getElementById('coEmirate').value;
  const address = document.getElementById('coAddress').value.trim();
  const notes = document.getElementById('coNotes') ? document.getElementById('coNotes').value.trim() : "";

  if(!name || !email || !phone || !address) {
    showToast("Please fill in all required fields *");
    return;
  }

  let subtotal = 0;
  const items = state.bag.map(item => {
    const p = PRODUCTS.find(x => x.id === item.productId);
    const itemSub = (p ? p.price : 0) * item.qty;
    subtotal += itemSub;
    return {
      productId: item.productId,
      name: p ? p.name : 'Custom Piece',
      cat: p ? p.cat : 'Collection',
      size: item.size,
      qty: item.qty,
      price: p ? p.price : 0,
      total: itemSub
    };
  });

  const shipping = subtotal >= 350 ? 0 : 25;
  const total = subtotal + shipping;

  const orderPayload = {
    customer: { name, email, phone },
    shippingAddress: { emirate, address, notes },
    paymentMethod: state.paymentMethod,
    items,
    subtotal,
    shipping,
    total
  };

  const order = await apiService.createOrder(orderPayload);

  state.bag = [];
  storageService.saveCart([]);
  updateBagBadge();

  closeAllSheets();
  renderOrderSuccess(order);
  openSheet('orderSuccessSheet');
}
```

with:

```js
async function placeOrder() {
  const name = document.getElementById('coName').value.trim();
  const email = document.getElementById('coEmail').value.trim();
  const phone = document.getElementById('coPhone').value.trim();
  const emirate = document.getElementById('coEmirate').value;
  const address = document.getElementById('coAddress').value.trim();
  const notes = document.getElementById('coNotes') ? document.getElementById('coNotes').value.trim() : "";

  if(!name || !email || !phone || !address) {
    showToast("Please fill in all required fields *");
    return;
  }

  let subtotal = 0;
  const items = state.bag.map(item => {
    const p = PRODUCTS.find(x => x.id === item.productId);
    const itemSub = (p ? p.price : 0) * item.qty;
    subtotal += itemSub;
    return {
      productId: item.productId,
      name: p ? p.name : 'Custom Piece',
      cat: p ? p.cat : 'Collection',
      size: item.size,
      qty: item.qty,
      price: p ? p.price : 0,
      total: itemSub
    };
  });

  const shipping = subtotal >= 350 ? 0 : 25;
  const total = subtotal + shipping;

  const orderPayload = {
    customer: { name, email, phone },
    shippingAddress: { emirate, address, notes },
    paymentMethod: state.paymentMethod,
    items,
    subtotal,
    shipping,
    total
  };

  let order;
  try {
    order = await apiService.createOrder(orderPayload);
  } catch(e) {
    showToast("Couldn't place your order — please try again");
    return;
  }

  state.bag = [];
  storageService.saveCart([]);
  updateBagBadge();

  closeAllSheets();
  renderOrderSuccess(order);
  openSheet('orderSuccessSheet');
}
```

(Only change: the `createOrder` call is wrapped in try/catch, and everything from `state.bag = []` onward only runs on success.)

- [ ] **Step 5: Manual verification**

1. While signed out, add an item to the bag and click "Proceed to Checkout".
   Expected: redirected to the sign-in view with toast "Please sign in to checkout", not the checkout form.
2. Sign in (or create an account). Expected: automatically lands on the checkout form (not the account page) — this is `resolvePostAuthRedirect` from Task 3 kicking in.
3. Fill in the checkout form and place the order. Expected: order success screen appears, showing the same order details as before.
4. In Supabase **Table Editor > orders**, confirm a new row exists with your `userId`, correct `items`/`total`, and `status = pending`.
5. Reload, open "My Account". Expected: the order you just placed appears under "My Placed Orders".

- [ ] **Step 6: Commit**

```bash
git add js/app.js
git commit -m "Gate checkout behind login and persist orders to Supabase"
```

---

## Task 5: Products backed by Supabase

**Files:**
- Modify: `js/app.js` (`apiService.fetchProducts`/`updateProductStock`/`addProduct`, remove `deleteProduct`, remove now-dead `storageService` stamp methods, `saveNewProduct` guard)

**Interfaces:**
- Produces: `apiService.fetchProducts()` — unchanged signature, now Supabase-backed with localStorage as an offline-only fallback (no more freshness-stamp comparison).
- Produces: `apiService.updateProductStock(id, stockStatus)` and `apiService.addProduct(productData)` — unchanged signatures, now return `null` on failure (callers must check).

- [ ] **Step 1: Simplify `fetchProducts` to read from Supabase**

Replace (around line 128):

```js
  async fetchProducts() {
    // Always read the source catalogue so edits to products.json actually reach
    // returning visitors. The local cache only survives while the source is unchanged
    // (it exists to hold admin stock edits, not to shadow a new catalogue forever).
    let source = null;
    try {
      const res = await fetch('data/products.json', { cache: 'no-store' });
      if(res.ok) source = await res.json();
    } catch(e) { /* offline: fall through to whatever we cached */ }

    const sourceStamp = source ? JSON.stringify(source) : null;
    const cached = storageService.getProducts();

    if(cached && cached.length > 0 && (!sourceStamp || sourceStamp === storageService.getProductsStamp())) {
      let updated = false;
      cached.forEach(p => {
        if(!p.fabric) {
          p.fabric = getProductFabric(p);
          updated = true;
        }
      });
      if(updated) storageService.saveProducts(cached);
      return cached;
    }

    if(!source) throw new Error('Failed to load products');
    storageService.saveProducts(source);
    storageService.saveProductsStamp(sourceStamp);
    return source;
  },
```

with:

```js
  async fetchProducts() {
    try {
      const { data, error } = await supabaseClient.from('products').select('*').order('id', { ascending: true });
      if(error) throw error;
      storageService.saveProducts(data);
      return data;
    } catch(e) {
      const cached = storageService.getProducts();
      if(cached && cached.length > 0) return cached;
      throw e;
    }
  },
```

- [ ] **Step 2: Remove the now-dead freshness-stamp methods from `storageService`**

Delete `getProductsStamp` and `saveProductsStamp` (around line 51):

```js
  getProductsStamp() {
    try { return localStorage.getItem('dinas_products_stamp'); } catch(e) { return null; }
  },
  saveProductsStamp(stamp) {
    try { localStorage.setItem('dinas_products_stamp', stamp); } catch(e){}
  },
```

- [ ] **Step 3: Rewrite `updateProductStock` to write through Supabase**

Replace (around line 158):

```js
  async updateProductStock(id, stockStatus) {
    const p = PRODUCTS.find(x => x.id === id);
    if(p) {
      p.stock = stockStatus;
      if(stockStatus === "out") {
        p.soldOut = [...p.sizes];
      } else {
        p.soldOut = [];
      }
      storageService.saveProducts(PRODUCTS);
      return p;
    }
    return null;
  },
```

with:

```js
  async updateProductStock(id, stockStatus) {
    const existing = PRODUCTS.find(x => x.id === id);
    if(!existing) return null;
    const soldOut = stockStatus === 'out' ? [...existing.sizes] : [];
    const { data, error } = await supabaseClient
      .from('products')
      .update({ stock: stockStatus, soldOut })
      .eq('id', id)
      .select()
      .single();
    if(error) { console.error(error); return null; }
    const idx = PRODUCTS.findIndex(x => x.id === id);
    if(idx !== -1) PRODUCTS[idx] = data;
    storageService.saveProducts(PRODUCTS);
    return data;
  },
```

- [ ] **Step 4: Rewrite `addProduct` to insert through Supabase (id is DB-assigned)**

Replace (around line 172):

```js
  async addProduct(productData) {
    const maxId = PRODUCTS.length > 0 ? Math.max(...PRODUCTS.map(p => p.id)) : 0;
    const newProduct = {
      id: maxId + 1,
      name: productData.name,
      cat: productData.cat,
      price: Number(productData.price),
      stock: productData.stock || "in",
      sizes: ["One Size"],
      soldOut: productData.stock === "out" ? ["One Size"] : [],
      desc: productData.desc || "Handcrafted with premium fabrics and finished with signature tailoring.",
      fabric: productData.fabric || "Premium Crepe / Silk Blend",
      pop: 85,
      paletteIndex: productData.paletteIndex !== undefined ? productData.paletteIndex : (maxId + 1) % PALETTES.length,
      nw: true
    };
    PRODUCTS.unshift(newProduct);
    storageService.saveProducts(PRODUCTS);
    return newProduct;
  },
  async deleteProduct(id) {
    PRODUCTS = PRODUCTS.filter(p => p.id !== id);
    storageService.saveProducts(PRODUCTS);
    return true;
  },
```

with:

```js
  async addProduct(productData) {
    const { data, error } = await supabaseClient
      .from('products')
      .insert({
        name: productData.name,
        cat: productData.cat,
        price: Number(productData.price),
        stock: productData.stock || "in",
        sizes: ["One Size"],
        soldOut: productData.stock === "out" ? ["One Size"] : [],
        desc: productData.desc || "Handcrafted with premium fabrics and finished with signature tailoring.",
        fabric: productData.fabric || "Premium Crepe / Silk Blend",
        pop: 85,
        paletteIndex: productData.paletteIndex,
        nw: true
      })
      .select()
      .single();
    if(error) { console.error(error); return null; }
    PRODUCTS.unshift(data);
    storageService.saveProducts(PRODUCTS);
    return data;
  },
```

(`deleteProduct` is deleted entirely — it was unused by any UI element.)

- [ ] **Step 5: Guard `saveNewProduct()` and `setProductStock()` against failure**

Replace (around line 1217):

```js
  const newP = await apiService.addProduct({
    name,
    cat,
    price,
    stock,
    fabric,
    desc,
    paletteIndex: newProductPaletteIndex
  });

  showToast(`"${name}" published to storefront ✓`);
  setAdminTab('inventory');
  renderGrid();
```

with:

```js
  const newP = await apiService.addProduct({
    name,
    cat,
    price,
    stock,
    fabric,
    desc,
    paletteIndex: newProductPaletteIndex
  });

  if(!newP) { showToast("Failed to publish — please try again"); return; }
  showToast(`"${name}" published to storefront ✓`);
  await setAdminTab('inventory');
  renderGrid();
```

Replace (around line 1205):

```js
async function setProductStock(productId, stockStatus) {
  await apiService.updateProductStock(productId, stockStatus);
  const p = PRODUCTS.find(x => x.id === productId);
  showToast(`Updated "${p.name}" to ${stockStatus.toUpperCase()} ✓`);
  renderAdmin();
  renderGrid();
  if(currentProduct && currentProduct.id === productId) {
    currentProduct.stock = stockStatus;
    renderProductDetail();
  }
}
```

with:

```js
async function setProductStock(productId, stockStatus) {
  const updated = await apiService.updateProductStock(productId, stockStatus);
  if(!updated) { showToast("Failed to update stock"); return; }
  showToast(`Updated "${updated.name}" to ${stockStatus.toUpperCase()} ✓`);
  await renderAdmin();
  renderGrid();
  if(currentProduct && currentProduct.id === productId) {
    currentProduct.stock = stockStatus;
    renderProductDetail();
  }
}
```

(`renderAdmin` becomes `async` in Task 6 — these `await renderAdmin()` calls are why.)

- [ ] **Step 6: Manual verification**

1. Load the site. Expected: the shop grid shows the same 17 products as before (now served from Supabase).
2. Turn off your network (devtools > Network > Offline), reload. Expected: products still show (from the `localStorage` fallback cache) rather than a blank grid.
3. Turn network back on.

(Admin-side verification of `updateProductStock`/`addProduct` happens in Task 7, once Task 6 makes the admin panel reachable again.)

- [ ] **Step 7: Commit**

```bash
git add js/app.js
git commit -m "Move product catalog reads and admin writes to Supabase"
```

---

## Task 6: Admin gated by real role, reading real orders

**Files:**
- Modify: `js/app.js` (`openAdmin`, `setAdminTab`, `updateStatus`, `renderAdmin`, `initApp`'s `#admin` branch, remove `seedSampleOrders`)
- Modify: `index.html` (remove the two "Load Sample Orders" buttons' markup is inline in `app.js`, not `index.html` — no HTML changes needed here)

**Interfaces:**
- Consumes: `state.user.role`, `postAuthRedirect`, `resolvePostAuthRedirect()` (Task 3); `apiService.getOrders()` (Task 4, now async).

- [ ] **Step 1: Make `openAdmin`/`setAdminTab`/`updateStatus`/`renderAdmin` async**

Replace (around line 992):

```js
function openAdmin() {
  closeAllSheets();
  renderAdmin();
  openSheet('adminSheet');
}

function setAdminTab(tab) {
  adminTab = tab;
  renderAdmin();
}
```

with:

```js
async function openAdmin() {
  closeAllSheets();
  await renderAdmin();
  openSheet('adminSheet');
}

async function setAdminTab(tab) {
  adminTab = tab;
  await renderAdmin();
}
```

Replace (around line 1003):

```js
function renderAdmin() {
  const el = document.getElementById('adminContent');
  const orders = apiService.getOrders();
```

with:

```js
async function renderAdmin() {
  const el = document.getElementById('adminContent');
  const orders = await apiService.getOrders();
```

Replace (around line 1245):

```js
function updateStatus(orderId, newStatus) {
  apiService.updateOrderStatus(orderId, newStatus);
  showToast(`Order ${orderId} updated to ${newStatus} ✓`);
  renderAdmin();
}
```

with:

```js
async function updateStatus(orderId, newStatus) {
  await apiService.updateOrderStatus(orderId, newStatus);
  showToast(`Order ${orderId} updated to ${newStatus} ✓`);
  await renderAdmin();
}
```

- [ ] **Step 2: Remove `seedSampleOrders` and its two buttons**

Delete the whole `seedSampleOrders` function (around lines 1251–1289):

```js
function seedSampleOrders() {
  const sampleOrders = [
    // ... the two sample order objects ...
  ];

  sampleOrders.forEach(o => storageService.saveOrder(o));
  showToast("Sample orders loaded ✓");
  renderAdmin();
}
```

In `renderAdmin()`'s `orders` tab body (around lines 1039–1052), remove the two buttons that call it:

Replace:
```js
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <h3 style="font-size:15px; margin:0;">Customer Orders (${orders.length})</h3>
        ${orders.length === 0 ? `
          <button class="filter-btn" onclick="seedSampleOrders()" style="font-size:11.5px; padding:5px 10px;">+ Load Sample Orders</button>
        ` : ''}
      </div>

      ${orders.length === 0 ? `
        <div class="order-summary-box" style="text-align:center; padding:30px 14px;">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#D97C8B" stroke-width="1.5" style="margin:0 auto 10px; display:block;"><path d="M6 8h12l-1 12H7L6 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>
          <div style="font-weight:700; font-size:14px; margin-bottom:4px;">No customer orders yet</div>
          <p style="font-size:12px; color:var(--ink-soft); margin-bottom:14px;">Orders placed on the website will automatically appear here.</p>
          <button class="primary-btn" style="font-size:12px; padding:8px 16px;" onclick="seedSampleOrders()">Load Sample Orders to Preview</button>
        </div>
      ` : `
```

with:
```js
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <h3 style="font-size:15px; margin:0;">Customer Orders (${orders.length})</h3>
      </div>

      ${orders.length === 0 ? `
        <div class="order-summary-box" style="text-align:center; padding:30px 14px;">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#D97C8B" stroke-width="1.5" style="margin:0 auto 10px; display:block;"><path d="M6 8h12l-1 12H7L6 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>
          <div style="font-weight:700; font-size:14px; margin-bottom:4px;">No customer orders yet</div>
          <p style="font-size:12px; color:var(--ink-soft); margin-bottom:14px;">Orders placed on the website will automatically appear here.</p>
        </div>
      ` : `
```

- [ ] **Step 3: Gate the `#admin` entry point on session + role**

Replace, in `initApp()` (around line 1339):

```js
  // Admin isn't linked from customer-facing UI; the store owner reaches it via #admin.
  if(location.hash === '#admin') openAdmin();
```

with:

```js
  // Admin isn't linked from customer-facing UI; the store owner reaches it via #admin.
  if(location.hash === '#admin') {
    if(!state.user) {
      postAuthRedirect = 'admin';
      setAuthTab('signin');
      openAccount();
    } else if(state.user.role === 'admin') {
      openAdmin();
    } else {
      showToast("Not authorized");
    }
  }
```

- [ ] **Step 4: Manual verification — non-admin is blocked**

1. Sign in as the customer account created in Task 3 (role still `customer`).
2. Navigate to `<your-local-url>/#admin` (or reload with that hash).
   Expected: toast "Not authorized" — the admin sheet never opens, and (checking devtools Network tab) no `orders`/`products` write requests are attempted.

- [ ] **Step 5: Promote yourself to admin**

In Supabase **Table Editor > profiles**, find your row and change `role` from `customer` to `admin`. Save.

- [ ] **Step 6: Manual verification — admin works end-to-end**

1. Sign out and back in (so the client picks up the fresh profile), or just reload while signed in — `loadCurrentUser()` runs on every page load.
2. Navigate to `#admin`. Expected: the admin dashboard opens, "Orders & Stats" tab shows the real order(s) placed in Task 4's verification (not a "load sample orders" prompt).
3. Go to "Inventory & Stock", change a product's stock to "Sold Out". Expected: toast confirms, and reloading the site (even in a private/incognito window, signed out) shows that product as sold out — proving the write actually reached the shared database, not just your own browser.
4. Go to "+ Add Piece", fill in a new product, publish. Expected: it appears in "Inventory & Stock" and in the public shop grid.
5. Back in "Orders & Stats", change an order's status via the dropdown. Expected: toast confirms; reopening "My Account" as that customer shows the updated status.

- [ ] **Step 7: Commit**

```bash
git add js/app.js
git commit -m "Gate admin panel behind real login and role, drop fake sample orders"
```

---

## Task 7: End-to-end verification and RLS spot-check

No code changes — this task is the spec's full manual verification pass, run once all six tasks are merged together, plus the two devtools checks that confirm RLS (not just the UI) is what's blocking unauthorized access.

- [ ] **Step 1: Full flow, one signed-out visitor**

Open the site in a fresh/incognito window. Browse the catalog, add to bag and wishlist without signing in (should work, per the spec — cart/wishlist require no login). Attempt checkout — should be redirected to sign in. Create an account, get redirected back into checkout automatically, place an order, see the confirmation screen with correct totals.

- [ ] **Step 2: Direct RLS check — non-admin cannot write products**

While signed in as a non-admin customer, open the browser devtools console and run:

```js
await supabaseClient.from('products').update({ price: 1 }).eq('id', 1)
```

Expected: `{ data: [], error: null }` with zero rows affected (RLS silently filters it out) — the price does not actually change. Confirm in Table Editor that product 1's price is unchanged.

- [ ] **Step 3: Direct RLS check — non-admin cannot read another customer's orders**

Still signed in as that same non-admin customer, with at least one order placed by a *different* account existing in the `orders` table (e.g. the admin account's own test order from Task 6, or a second test signup), run:

```js
await supabaseClient.from('orders').select('*')
```

Expected: only your own order(s) come back, never another customer's, even though no `.eq('userId', ...)` filter was added to the query — RLS is doing the filtering, not the client code.

- [ ] **Step 4: Confirm the admin-only paths reject writes for the same non-admin session**

```js
await supabaseClient.from('orders').update({ status: 'shipped' }).eq('id', 'some-existing-order-id')
```

Expected: zero rows affected for an order that isn't this user's own.

- [ ] **Step 5: No remaining references to the removed mock/local auth**

```bash
grep -n "mockGoogleAuth\|mockManualAuth\|seedSampleOrders\|dinas_user\|dinas_orders\|dinas_products_stamp" js/app.js
```

Expected: no output (everything from the old fake-auth/local-order/stamp-cache system has been removed).

- [ ] **Step 6: Final commit (if step 5 needed cleanup, otherwise skip)**

```bash
git add -A
git commit -m "Final cleanup pass after Supabase auth migration"
```
