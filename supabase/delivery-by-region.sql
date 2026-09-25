-- ============================================================
-- Delivery priced by area, 2026-09-25. Run once in the Supabase SQL
-- Editor, after sale-pricing.sql.
--
--   UAE:     Dubai AED 25, Sharjah AED 40, every other emirate AED 50
--   Lebanon: Beirut $5, Mount Lebanon $10, anywhere else agreed on
--            WhatsApp (nothing charged at checkout)
--
-- Free delivery over AED 350 / $150 is gone. Replaces place_order from
-- sale-pricing.sql; only the delivery block differs.
-- ============================================================

create or replace function public.place_order(
  p_id text,
  p_display_date text,
  p_customer jsonb,
  p_shipping_address jsonb,
  p_payment_method text,
  p_items jsonb          -- [{ "productId": 3, "size": "One Size" }]
)
returns public.orders
language plpgsql
-- security definer because customers cannot update products under RLS. That
-- makes it security-sensitive, so it stays narrow: it touches only the pieces
-- in this order, only for the caller, and trusts the client for nothing that
-- decides money.
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_ids bigint[];
  v_sold text;
  v_items jsonb;
  v_subtotal numeric;
  v_shipping numeric;
  v_region text := p_shipping_address->>'region';
  v_order public.orders;
begin
  if v_user is null then
    raise exception 'not_signed_in';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'empty_order';
  end if;

  -- Every piece is one of a kind, so quantity is always 1 and is never sent.
  -- The same piece listed twice would be two sales of one object.
  select array_agg(distinct (elem->>'productId')::bigint)
    into v_ids
    from jsonb_array_elements(p_items) elem;

  if array_length(v_ids, 1) <> jsonb_array_length(p_items) then
    raise exception 'duplicate_item';
  end if;

  -- Lock in ascending id order, so two orders sharing pieces queue up instead
  -- of each holding what the other needs.
  perform 1 from public.products where id = any(v_ids) order by id for update;

  if (select count(*) from public.products where id = any(v_ids)) <> array_length(v_ids, 1) then
    raise exception 'product_missing';
  end if;

  -- Read AFTER the lock: whoever committed first is visible here, which is the
  -- whole point — this is the only place the race can be settled.
  select string_agg(name, '|' order by id) into v_sold
    from public.products where id = any(v_ids) and stock = 'out';
  if v_sold is not null then
    raise exception 'sold_out:%', v_sold;
  end if;

  if exists (
    select 1
      from jsonb_array_elements(p_items) elem
      join public.products p on p.id = (elem->>'productId')::bigint
     where elem->>'size' is null or not (p.sizes ? (elem->>'size'))
  ) then
    raise exception 'bad_size';
  end if;

  -- Prices come from the table, and the discount with them. Whatever the
  -- browser said about money is ignored entirely, which is the second reason
  -- this function exists.
  --
  -- A discounted price is rounded to whole dirhams, half up; an undiscounted
  -- one is charged exactly as listed, since that is how the shop displays it.
  -- public/js/app.js and lib/product-page.js repeat this for display;
  -- tests/sale-rounding.test.mjs pins all three.
  -- fullPrice and discountPercent are recorded so an order says what a sale
  -- actually gave away.
  select jsonb_agg(jsonb_build_object(
           'productId',       p.id,
           'name',            p.name,
           'cat',             p.cat,
           'size',            elem->>'size',
           'qty',             1,
           'price',           case when p."discountPercent" > 0 then round(p.price * (100 - p."discountPercent") / 100.0) else p.price end,
           'total',           case when p."discountPercent" > 0 then round(p.price * (100 - p."discountPercent") / 100.0) else p.price end,
           'fullPrice',       p.price,
           'discountPercent', p."discountPercent"
         ) order by p.id),
         sum(case when p."discountPercent" > 0 then round(p.price * (100 - p."discountPercent") / 100.0) else p.price end)
    into v_items, v_subtotal
    from jsonb_array_elements(p_items) elem
    join public.products p on p.id = (elem->>'productId')::bigint;

  -- Delivery is charged from here, priced by area, with no free-delivery
  -- threshold. This mirrors COUNTRIES in public/js/app.js, which shows the
  -- same figure at checkout; if the two ever drift, this one is what the
  -- customer is actually charged.
  --
  -- Lebanon's rates are $5 and $10, stored in dirhams at the 3.6725 peg like
  -- every other amount. Anywhere else in Lebanon is agreed with the customer on
  -- WhatsApp, so nothing is charged for it here. An emirate this doesn't name
  -- pays the top UAE rate.
  if coalesce(p_shipping_address->>'country', 'AE') = 'LB' then
    v_shipping := case v_region when 'Beirut' then 5 * 3.6725
                                when 'Mount Lebanon' then 10 * 3.6725
                                else 0 end;
  else
    v_shipping := case v_region when 'Dubai' then 25
                                when 'Sharjah' then 40
                                else 50 end;
  end if;

  update public.products
     set stock = 'out', "soldOut" = sizes
   where id = any(v_ids);

  insert into public.orders (
    id, "userId", "displayDate", status, customer,
    "shippingAddress", "paymentMethod", items, subtotal, shipping, total
  ) values (
    p_id, v_user, p_display_date, 'pending', p_customer,
    p_shipping_address, p_payment_method, v_items, v_subtotal, v_shipping,
    v_subtotal + v_shipping
  )
  returning * into v_order;

  return v_order;
end;
$$;

-- Postgres grants EXECUTE on new functions to PUBLIC. A signed-out visitor
-- must never reach a security definer function that writes orders.
revoke all on function public.place_order(text, text, jsonb, jsonb, text, jsonb) from public;
grant execute on function public.place_order(text, text, jsonb, jsonb, text, jsonb) to authenticated;
