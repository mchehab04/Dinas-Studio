-- ============================================================
-- Fix: "infinite recursion detected in policy for relation profiles" (42P17)
--
-- The original policies checked admin-ness with an inline
--   exists (select 1 from public.profiles ...)
-- Reading profiles re-triggers profiles' own SELECT policy, which reads
-- profiles again. Postgres aborts with 42P17, so every admin check failed
-- (silently, on profiles/products/orders alike).
--
-- These security definer helpers read profiles with RLS bypassed, so the
-- policies can ask "is this user an admin?" without recursing.
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
