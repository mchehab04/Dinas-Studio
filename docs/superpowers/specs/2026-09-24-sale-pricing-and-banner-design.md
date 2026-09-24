# Sale pricing and a rotating hero banner

**Goal:** Let the owner mark individual pieces down by a percentage, charge that reduced price everywhere it matters, and say so at the top of the shop.

Two features that only make sense together: a discount nobody is told about does no work, and a banner announcing a sale that isn't reflected in prices is worse than no banner.

## Decisions taken before designing

| Question | Chosen | Set aside |
|---|---|---|
| Sale model | Per-item, open-ended. A piece stays discounted until the owner clears it. | Campaigns with names and end dates; a single site-wide percentage. |
| Banner content | Generated from the pieces actually on sale, plus one optional line of copy. | Fully authored banners, including non-sale ones. |
| Banner placement | The hero becomes a carousel. | A thin strip above the hero; swapping the hero's contents outright. |
| Admin control | A `Sale` button per inventory row, opening an inline editor. | An always-visible number box; a separate Sale tab. |

A typical sale covers three to six pieces, which is why no bulk-edit screen is built.

## Non-goals

- Dates, scheduling or automatic expiry. A discount ends when the owner clears it.
- A site-wide percentage. Every discount is set per piece.
- Banners unrelated to a sale.
- Coupon codes, customer-specific pricing, or bundle offers.
- Bulk editing. Six pieces is six taps.

## Part 1 — Data

```sql
alter table public.products
  add column if not exists "discountPercent" int not null default 0
  check ("discountPercent" >= 0 and "discountPercent" <= 90);
```

**A percentage, not a sale price.** The original price stays the single source of truth, so clearing a sale restores it exactly and there is no second price to drift. `0` means not on sale — no nullable column, no third state.

The 90 cap is a guard against a typo turning a piece into a giveaway, not a business rule.

```sql
create table if not exists public.shop_settings (
  id int primary key default 1 check (id = 1),
  sale_note text
);
```

One row, enforced by the check constraint, holding the optional line shown under the banner headline. World-readable; admin-only to write, through the existing `is_admin()` helper. **Grant `select` to `anon` and `authenticated` explicitly** — the storefront reads this signed out, and RLS permitting a read does not by itself grant the privilege. That distinction already cost a day on `restock_requests`. It needs a `service_role` grant only if a function ever reads it — nothing does today, and the omission is deliberate rather than an oversight.

## Part 2 — Pricing

### One formula, and where it lives

```
charged = round(price × (100 − discountPercent) / 100)
```

Rounded to whole dirhams, because every price in the shop is a whole number and `AED 419.30` reads like a mistake next to `AED 599`.

Both sides must round the same way: half up. Postgres `round()` on `numeric` and JavaScript `Math.round()` agree on positive halves, which is the only case that arises here — but a verification case pins it rather than trusting that.

`place_order` applies it when it recomputes the order. It already ignores everything the browser says about money; this changes what it computes, not whether it trusts the client. The line it records carries both numbers:

```json
{ "productId": 7, "price": 419, "total": 419,
  "fullPrice": 599, "discountPercent": 30 }
```

Recording the original is what lets the owner see later what a sale actually cost, and it costs two keys.

**Subtotal, and therefore free delivery, is judged on discounted prices.** A basket reaching AED 350 after discounts ships free. That is the honest reading of "free over 350", and the alternative — charging delivery on a basket the customer was shown as AED 360 — would be indefensible.

### The duplicated formula

The storefront repeats the same arithmetic to show prices before checkout, exactly as it already repeats the shipping rules. This is a known duplication with a known failure mode: if the two drift, the estimate differs from the charge.

Three things contain it, all already established in this codebase:
- each side carries a comment naming the other,
- the confirmation screen renders the **recorded order row**, never the browser's numbers,
- `supabase/verify-place-order.sql` gains a case proving a discounted piece is charged the discounted price.

## Part 3 — What shoppers see

- **Cards and product detail:** the original struck through, the sale price beside it, and a small `−30%` tag.
- **Bag and checkout:** discounted line prices and a discounted subtotal.
- **A sold-out piece keeps its discount.** It reads Sold Out as usual, and the discount is still there when it is restocked.
- **The grid gains an On Sale filter**, alongside the existing availability filters. This is what the banner's button switches on.

## Part 4 — The banner

The hero becomes a carousel.

**Slide one is today's hero, unchanged** — same eyebrow, headline, copy and button.

**Slide two appears whenever a piece that can actually be bought is discounted:** "Up to N% off selected pieces", where N is the largest percentage among pieces **not sold out**. A 50%-off piece that has already gone must not set the headline for pieces still available at 20% — the shopper would follow the banner and find nothing matching it. The On Sale filter likewise lists only pieces still for sale. the `sale_note` beneath it when set, and a button that applies the On Sale filter and scrolls to the grid. Because N is read from the pieces themselves, the banner cannot contradict what is actually on sale.

**With no sale running there is one slide, no dots, and no rotation — visually identical to today.** This is the state the shop is in most of the time, and it must not regress.

Behaviour:
- advances every 6 seconds,
- swipeable, reusing the scroll-snap pattern the product gallery already uses rather than inventing a second carousel,
- dots that jump to a slide,
- pauses while touched, hovered, or focused,
- **never auto-advances under `prefers-reduced-motion`** — the site already honours that setting globally and this must not be the exception.

## Part 5 — Admin

A `Sale` button in each inventory row. Tapping it replaces that row's button group with an inline editor: a number field, **Save**, and **Clear**. No new sheet, and the edit happens where the owner is already looking.

Once set, the button reads `Sale 30%` in a distinct colour, so which pieces are discounted is visible at a glance without opening anything.

The percentage is validated through the existing validation layer — whole number, 1 to 90 — and Save stays disabled until it is valid, matching every other form in the shop. **Clear** sets it to 0.

The `sale_note` gets a single field at the top of the inventory tab, saved explicitly, with placeholder text making clear it is optional.

## Part 6 — Everywhere else a price appears

- **`lib/product-page.js`:** the JSON-LD `offers.price` and the meta description carry the **sale** price, so Google and WhatsApp show what is actually charged.
- **Order emails:** already render the recorded line totals, so they follow with no change. The owner's copy gains the original and the percentage beside the charged price, since that is the copy used to fulfil.
- **`lib/restock-notification.js`:** quotes the sale price when the restocked piece is discounted — currently it prints `product.price` directly.

## Rollout

Nothing here can break checkout, and the two steps are safe in either order — but this one is cleaner:

1. **Run `supabase/sale-pricing.sql`.** Adds the column, the settings table and its policies, and replaces `place_order`. Safe on the live site: every existing piece gets `discountPercent = 0`, so nothing changes until a piece is marked down.
2. **Deploy.**

If the deploy landed first, a missing column reads as `undefined` in the client, which is treated as no discount — the shop behaves exactly as it does today. That is the intended failure mode, not luck.

## Verification

- A discounted piece is charged the discounted price by `place_order`, and the recorded line carries `fullPrice` and `discountPercent`.
- Rounding matches between the storefront and the database for every piece currently in the shop.
- Free delivery triggers on the discounted subtotal.
- Clearing a discount restores the original price everywhere, with no residue.
- A percentage outside 1–90 cannot be saved, from the admin panel or by a direct write.
- With no piece on sale: one slide, no dots, no rotation, and the hero is pixel-identical to today.
- With a sale on: the slide states the largest discount, shows the note when set, and its button filters the grid to exactly the discounted pieces.
- The carousel does not auto-advance under `prefers-reduced-motion`.
- A product page's JSON-LD and meta description quote the sale price.
- A restocked piece that is on sale quotes the sale price in its email.
- The existing suites still pass: `order-notification`, `restock-notification`, `product-page`, and `ui-smoke`.
