# Lebanon checkout: dual currency, country-aware address, shipping and payment

**Goal:** Make Lebanon a real destination at checkout. Today the site claims to serve UAE and Lebanon, but the checkout is UAE-only in every place it matters — the only address field is a required Emirate dropdown, the phone validator rejects Lebanese numbers, prices are hardcoded `AED`, and shipping and delivery copy assume the UAE.

**Architecture:** No new infrastructure. A `country` value chosen at checkout drives address fields, phone handling, shipping, payment options and copy. AED remains the single stored currency; USD is derived for display only.

## Non-goals

- Per-country stock. Some inventory sits in Lebanon and some in Dubai, but every product stays orderable from both for now, and UAE-only items are moved at the studio's cost. Revisit once real Lebanese order patterns exist.
- Localisation of language, dates or anything beyond currency display.
- Changing how UAE orders behave. Their fees, copy and flow are unchanged.
- A currency switcher. Both currencies show at once; the customer never picks.

## Decisions and rationale

### Currency: AED stored, both displayed

The dirham is pegged to the dollar at **3.6725 AED/USD** and has been since 1997. Because this is a fixed peg rather than a floating rate, a constant in the source will not drift, and no rate-refresh mechanism is needed.

- `AED_PER_USD = 3.6725` as a module constant.
- `formatPrice(amount)` returns both currencies: `AED 588 · $160.11`. USD is rounded to two decimals.
- Every price in the app already routes through `formatPrice`, so dual display lands everywhere from one change.
- AED stays the currency written to `orders.subtotal`, `orders.shipping` and `orders.total`. The admin dashboard, the database and existing order history therefore stay uniform, and nothing needs migrating.

USD is a presentation concern only. No USD value is ever persisted.

### Country and address

A `Country *` select sits above the address block, defaulting to United Arab Emirates. It drives which region dropdown renders:

| Country | Region field | Options |
|---|---|---|
| United Arab Emirates | Emirate | the existing seven |
| Lebanon | Governorate | Beirut, Mount Lebanon, North, Akkar, Bekaa, Baalbek-Hermel, South, Nabatieh |

The free-text street line is unchanged. Changing country re-renders the region dropdown, shipping line and payment options together, since all three depend on it.

### Phone

Validation becomes country-aware in what it *accepts*, but deliberately not strict about matching the selected country: a customer ordering to Lebanon may still carry a UAE number, and rejecting that repeats the formatting-pedantry this project just removed.

- Accept UAE forms (`+971…`, `00971…`, local `0…`) and Lebanese forms (`+961…`, `00961…`, local `0…`).
- Match on **digit length, not a prefix whitelist**: Lebanese local numbers are 8 digits including the leading zero, UAE local numbers are 9 or 10. Enumerating valid mobile prefixes would reject legitimate numbers as carriers add ranges.
- Where a bare local number is ambiguous, resolve it using the selected country; an explicit `+971`/`+961` always wins over the selection.
- Normalise to E.164 using whichever country's pattern matched.

### Shipping

The rule `subtotal >= 350 ? 0 : 25` is currently **duplicated in three places** — the bag summary, the checkout render and order creation. Country-dependent shipping would make that three divergent copies, so it is extracted first into a single `shippingFor(subtotalAed, country)` and all three call it.

| Country | Fee | Free over |
|---|---|---|
| United Arab Emirates | AED 25 | AED 350 |
| Lebanon | AED 10.98 (`$2.99`) | AED 551 (`$150`) |

Lebanon's figures were specified in USD and are converted once, at the peg, into the AED constants above. The low fee reflects domestic delivery from Lebanese stock, not an international courier.

### Payment

Lebanon orders are settled by Whish Money transfer, so **Cash on Delivery is hidden when Lebanon is selected**. If COD was already chosen and the customer then switches to Lebanon, the selection moves to Bank Transfer rather than silently submitting an unavailable method.

### Copy and order records

- Product detail currently reads "Delivery in 1–2 business days across the UAE". Country is unknown while browsing, so it becomes a both-countries line: 1–2 business days in the UAE, 3–5 in Lebanon.
- The order confirmation hardcodes `", UAE"` after the emirate. It reads the order's own country instead.
- The confirmation's delivery estimate becomes country-aware.
- The bag and checkout summary rows say "UAE Delivery"; they become just "Delivery".
- `shippingAddress` gains a `country` field. It is `jsonb`, so no schema migration is required.
- Orders written before this change have no `country`. They were all UAE orders, so a missing value is read as UAE wherever country is displayed.
- The admin order list shows the region only; it gains the country alongside it.

## Touchpoints

| Concern | Location |
|---|---|
| Currency formatting | `js/app.js:9` `formatPrice` |
| Shipping rule (×3) | `js/app.js:648`, `:695`, `:814` |
| Delivery copy | `js/app.js:513` (product detail), `:904` (confirmation) |
| Emirate field | `js/app.js:730` |
| Phone validation | `js/app.js:921` `normalizePhone`, `:930` `isValidPhone`, `:934` `phoneE164`, `:955` validator |
| Hardcoded `", UAE"` | `js/app.js:884` |
| Payment pills | `js/app.js:755` |
| Admin order row | `js/app.js:1276` |

## Error handling

Country is a select with a default, so it cannot be empty. The region dropdown likewise always has a value. The existing validation layer covers the fields that can be wrong — name, email, phone, street — and its behaviour is unchanged; only the phone rule broadens.

## Verification

No test framework exists in this project and none is introduced; verification is a Playwright pass plus manual checks, matching how the Supabase work was verified.

- Selecting Lebanon swaps Emirate for Governorate and keeps the typed street address.
- Shipping recalculates on country change, in both the checkout summary and the bag.
- A basket under each threshold shows the right fee; over it, free.
- COD disappears for Lebanon, and a pre-selected COD flips to Bank Transfer.
- `+961 3 123 456`, `03 123 456`, `+971 50 123 4567` and `050 123 4567` all validate.
- Prices show both currencies, and the USD figure matches the AED at the peg.
- A placed Lebanon order stores `country` and AED totals, and the confirmation shows Lebanon with the 3–5 day estimate.
- An order predating this change still renders, showing UAE.
