-- ============================================================
-- Storage bucket for product photos.
-- Run once in Supabase Dashboard > SQL Editor > New query > Run.
-- Safe to re-run.
-- ============================================================

-- Public read: these are storefront photos, so plain URLs beat signed ones.
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do update set public = true;

-- Writes are admin-only, reusing the same is_admin() helper the table policies
-- use, so "who is an admin" has exactly one definition in the database.
drop policy if exists "product_images_read_all" on storage.objects;
create policy "product_images_read_all"
  on storage.objects for select
  using (bucket_id = 'product-images');

drop policy if exists "product_images_write_admin" on storage.objects;
create policy "product_images_write_admin"
  on storage.objects for all
  using (bucket_id = 'product-images' and public.is_admin())
  with check (bucket_id = 'product-images' and public.is_admin());
