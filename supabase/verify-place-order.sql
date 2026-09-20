-- ============================================================
-- Checks place_order against real data, then throws everything away.
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

  -- 5. A size the piece does not come in.
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
