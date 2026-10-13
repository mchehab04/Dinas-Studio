-- ============================================================
-- Checks banner-settings.sql, then throws everything away.
-- Safe on the live database: one transaction ending in ROLLBACK.
-- Read the NOTICE output (or the result rows) for PASS/FAIL.
-- ============================================================
begin;

do $$
declare
  v_ok boolean;
begin
  -- 1. The five columns exist.
  select count(*) = 5 into v_ok from information_schema.columns
   where table_schema = 'public' and table_name = 'shop_settings'
     and column_name in ('hero_eyebrow','hero_title','hero_text','hero_image','sale_title');
  raise notice '%  shop_settings has the five banner columns', case when v_ok then 'PASS ' else 'FAIL ' end;

  -- 2. Values at the limit are accepted; one over is refused.
  update public.shop_settings set hero_eyebrow = repeat('a', 30), hero_title = repeat('a', 70),
    hero_text = repeat('a', 140), sale_title = repeat('a', 70) where id = 1;
  raise notice 'PASS  values at the limits are accepted';
  begin
    update public.shop_settings set hero_title = repeat('a', 71) where id = 1;
    raise notice 'FAIL  a 71-character headline was accepted';
  exception when check_violation then
    raise notice 'PASS  a 71-character headline is refused';
  end;
  begin
    update public.shop_settings set sale_title = repeat('a', 71) where id = 1;
    raise notice 'FAIL  a 71-character sale headline was accepted';
  exception when check_violation then
    raise notice 'PASS  a 71-character sale headline is refused';
  end;
end $$;

-- 3. Visitors can read the banner; only the existing admin policy writes.
select case when has_column_privilege('anon', 'public.shop_settings', 'hero_title', 'select')
            then 'PASS  anon can read the banner columns'
            else 'FAIL  anon cannot read the banner columns' end as check
union all
select case when has_table_privilege('anon', 'public.shop_settings', 'update')
            then 'FAIL  anon can update shop_settings'
            else 'PASS  anon cannot update shop_settings' end;

rollback;
