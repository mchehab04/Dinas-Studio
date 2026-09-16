-- ============================================================
-- Two fixes for the originally-provisioned schema.
--
-- 1. "infinite recursion detected in policy for relation profiles" (42P17)
--    The original policies checked admin-ness with an inline
--      exists (select 1 from public.profiles ...)
--    Reading profiles re-triggers profiles' own SELECT policy, which reads
--    profiles again. Postgres aborts with 42P17. Because the products policy
--    is FOR ALL, its USING clause ran on SELECT too, so this took the public
--    storefront down as well, not just the admin paths.
--    The security definer helpers below read profiles with RLS bypassed, so
--    the policies can ask "is this user an admin?" without recursing.
--
-- 2. "permission denied for table products" (42501)
--    RLS narrows which rows a role may touch, but the role still needs plain
--    SQL privileges on the table first. Tables created through the SQL editor
--    don't always inherit Supabase's default grants, so they're explicit here.
--
-- Safe to re-run. Run in Supabase Dashboard > SQL Editor > New query > Run.
-- ============================================================

create or replace function public.current_profile_role()
returns text
language sql
security definer
set search_path = public
stable
as $$ select role from public.profiles where id = auth.uid() $$;

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$ select coalesce(public.current_profile_role() = 'admin', false) $$;

-- ---------- profiles ----------
drop policy if exists "profiles_select_own_or_admin" on public.profiles;
create policy "profiles_select_own_or_admin"
  on public.profiles for select
  using (auth.uid() = id or public.is_admin());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id and role = public.current_profile_role());

-- ---------- products ----------
drop policy if exists "products_write_admin_only" on public.products;
create policy "products_write_admin_only"
  on public.products for all
  using (public.is_admin())
  with check (public.is_admin());

-- ---------- orders ----------
drop policy if exists "orders_select_own_or_admin" on public.orders;
create policy "orders_select_own_or_admin"
  on public.orders for select
  using (auth.uid() = "userId" or public.is_admin());

drop policy if exists "orders_update_admin_only" on public.orders;
create policy "orders_update_admin_only"
  on public.orders for update
  using (public.is_admin());

-- ---------- table privileges ----------
-- PostgREST connects as `anon` when signed out and `authenticated` when signed
-- in. RLS still decides which rows each may see; these only open the door.
grant usage on schema public to anon, authenticated;

grant select on public.products to anon, authenticated;
grant insert, update on public.products to authenticated;

grant select, update on public.profiles to authenticated;

grant select, insert, update on public.orders to authenticated;
