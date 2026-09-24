-- ============================================================
-- Checks place_order against real data, then throws everything away.
--
-- Run after sale-pricing.sql: the discount case needs its column.
--
-- Safe to run on the live database: every statement is inside one transaction
-- that ends in ROLLBACK, so the test order and the sold-out flags it sets are
-- never committed. Read the NOTICE output for PASS/FAIL lines.
--
-- The one thing this cannot test in a single session is the race itself.
-- For that, open two SQL editor tabs and in each run BEGIN, then
-- place_order for the SAME piece, and commit the first: the second must
-- raise sold_out. Roll both back afterwards.
-- ============================================================

begin;

do $$
declare
  v_user uuid;
  v_id bigint;
  v_price numeric;
  v_size text;
  v_total numeric;
  v_ship numeric;
  v_sub numeric;
  v_charged text;
  v_full text;
  v_addr jsonb := '{"country":"AE","region":"Dubai","address":"Verify"}';
  v_cust jsonb := '{"name":"Verify","email":"verify@example.com","phone":"+971500000000"}';
  v_items jsonb;
begin
  select id into v_user from auth.users order by created_at limit 1;
  select id, price, sizes->>0 into v_id, v_price, v_size
    from public.products where stock <> 'out' order by id limit 1;

  if v_user is null or v_id is null then
    raise notice 'SKIP  no signed-up user or no in-stock product to test with';
    return;
  end if;

  -- auth.uid() reads this; without it every call is rejected as not_signed_in.
  perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);
  v_items := jsonb_build_array(jsonb_build_object('productId', v_id, 'size', v_size));

  -- 1. A signed-out caller gets nothing.
  perform set_config('request.jwt.claims', '', true);
  begin
    perform public.place_order('VERIFY-1', '1 Jan 2026', v_cust, v_addr, 'cod', v_items);
    raise notice 'FAIL  signed-out call was accepted';
  exception when others then
    raise notice '%  signed-out call rejected (%)',
      case when sqlerrm = 'not_signed_in' then 'PASS ' else 'FAIL ' end, sqlerrm;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);

  -- The owner may have this piece marked down on the live site. Check 2 is
  -- about undiscounted pricing, so take the discount off for the duration —
  -- the whole script rolls back, so this never reaches the real row.
  update public.products set "discountPercent" = 0 where id = v_id;

  -- 2. Prices come from the table, not the caller. Nothing about money is even
  --    accepted as an argument, so the strongest check is that the recorded
  --    total matches the table price plus the table's own shipping rule.
  select t.subtotal, t.shipping, t.total into v_sub, v_ship, v_total
    from public.place_order('VERIFY-2', '1 Jan 2026', v_cust, v_addr, 'cod', v_items) t;
  raise notice '%  priced from the table: subtotal % = product price %',
    case when v_sub = v_price then 'PASS ' else 'FAIL ' end, v_sub, v_price;
  raise notice '%  shipping charged by the database: % (AE, %)',
    case when v_ship = (case when v_price >= 350 then 0 else 25 end) then 'PASS ' else 'FAIL ' end,
    v_ship, case when v_price >= 350 then 'free over 350' else 'under 350' end;
  raise notice '%  total = subtotal + shipping (%)',
    case when v_total = v_sub + v_ship then 'PASS ' else 'FAIL ' end, v_total;

  -- 2b. A discount is charged, not merely displayed. Check 2 has just sold the
  --     piece, so it goes back in stock with the discount set before ordering
  --     again. Afterwards only the discount is cleared: the piece stays sold, so
  --     check 3 still has an 'out' to observe.
  update public.products
     set stock = 'in', "soldOut" = '[]', "discountPercent" = 25
   where id = v_id;
  select t.subtotal, t.items->0->>'price', t.items->0->>'fullPrice'
    into v_sub, v_charged, v_full
    from public.place_order('VERIFY-2b', '1 Jan 2026', v_cust, v_addr, 'cod', v_items) t;
  raise notice '%  a 25%% discount is charged: % (was %)',
    case when v_sub = round(v_price * 0.75) then 'PASS ' else 'FAIL ' end, v_sub, v_price;
  raise notice '%  the order records what was given away (charged %, full %)',
    case when v_charged::numeric = round(v_price * 0.75) and v_full::numeric = v_price
         then 'PASS ' else 'FAIL ' end, v_charged, v_full;
  update public.products set "discountPercent" = 0 where id = v_id;

  -- 2c. Free delivery is judged on what the customer pays, not the full price.
  --     Priced so the full price clears the AED 350 threshold and the
  --     discounted one does not. 599 at 50% is 299.5, so this is also the case
  --     that pins half-up rounding inside the database itself.
  update public.products
     set stock = 'in', "soldOut" = '[]', price = 599, "discountPercent" = 50
   where id = v_id;
  select t.subtotal, t.shipping into v_sub, v_ship
    from public.place_order('VERIFY-2c', '1 Jan 2026', v_cust, v_addr, 'cod', v_items) t;
  raise notice '%  the database rounds half up: 599 at 50%% charges %',
    case when v_sub = 300 then 'PASS ' else 'FAIL ' end, v_sub;
  raise notice '%  delivery is judged on the discounted subtotal: % charged on %',
    case when v_ship = 25 then 'PASS ' else 'FAIL ' end, v_ship, v_sub;
  update public.products set "discountPercent" = 0 where id = v_id;

  -- 3. That order marked the piece sold, so the next one must be refused.
  raise notice '%  the sale marked the piece sold out',
    case when (select stock from public.products where id = v_id) = 'out' then 'PASS ' else 'FAIL ' end;
  begin
    perform public.place_order('VERIFY-3', '1 Jan 2026', v_cust, v_addr, 'cod', v_items);
    raise notice 'FAIL  a sold-out piece was sold twice';
  exception when others then
    raise notice '%  second buyer refused (%)',
      case when sqlerrm like 'sold_out:%' then 'PASS ' else 'FAIL ' end, sqlerrm;
  end;

  -- 4. The same piece twice in one order is two sales of one object.
  begin
    perform public.place_order('VERIFY-4', '1 Jan 2026', v_cust, v_addr, 'cod',
      v_items || v_items);
    raise notice 'FAIL  duplicate line accepted';
  exception when others then
    raise notice '%  duplicate line rejected (%)',
      case when sqlerrm = 'duplicate_item' then 'PASS ' else 'FAIL ' end, sqlerrm;
  end;

  -- 5. A size the piece does not come in. The piece was sold above, and
  --    place_order refuses a sold piece before it ever looks at the size — so
  --    without putting it back in stock this check can only see sold_out.
  update public.products set stock = 'in', "soldOut" = '[]' where id = v_id;

  begin
    perform public.place_order('VERIFY-5', '1 Jan 2026', v_cust, v_addr, 'cod',
      jsonb_build_array(jsonb_build_object('productId', v_id, 'size', 'Tampered')));
    raise notice 'FAIL  unknown size accepted';
  exception when others then
    raise notice '%  unknown size rejected (%)',
      case when sqlerrm = 'bad_size' then 'PASS ' else 'FAIL ' end, sqlerrm;
  end;

  -- 6. A product that does not exist.
  begin
    perform public.place_order('VERIFY-6', '1 Jan 2026', v_cust, v_addr, 'cod',
      jsonb_build_array(jsonb_build_object('productId', -1, 'size', v_size)));
    raise notice 'FAIL  missing product accepted';
  exception when others then
    raise notice '%  missing product rejected (%)',
      case when sqlerrm = 'product_missing' then 'PASS ' else 'FAIL ' end, sqlerrm;
  end;
end $$;

-- Privileges: signed-out visitors must not be able to call it at all.
select case when has_function_privilege('anon', 'public.place_order(text,text,jsonb,jsonb,text,jsonb)', 'execute')
            then 'FAIL  anon can execute place_order'
            else 'PASS  anon cannot execute place_order' end as check
union all
select case when has_function_privilege('authenticated', 'public.place_order(text,text,jsonb,jsonb,text,jsonb)', 'execute')
            then 'PASS  authenticated can execute place_order'
            else 'FAIL  authenticated cannot execute place_order' end
union all
-- Before lock-direct-order-inserts.sql this is expected to say "still open".
select case when exists (select 1 from pg_policies
                          where schemaname = 'public' and tablename = 'orders'
                            and policyname = 'orders_insert_own')
            then 'NOTE  direct inserts still open (run lock-direct-order-inserts.sql after the deploy)'
            else 'PASS  direct inserts into orders are closed' end;

rollback;
