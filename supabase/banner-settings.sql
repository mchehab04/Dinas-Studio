-- ============================================================
-- Banner settings, 2026-10-13. Run once in the Supabase SQL Editor,
-- after sale-pricing.sql. Safe to run twice.
--
-- The main banner's text and photo, and the sale banner's headline,
-- all edited from the admin panel's Banners tab. Empty means the
-- default text, or no photo. shop_settings' existing policies (anyone
-- reads, the admin writes) and grants already cover new columns.
-- ============================================================
alter table public.shop_settings
  add column if not exists hero_eyebrow text,
  add column if not exists hero_title text,
  add column if not exists hero_text text,
  add column if not exists hero_image text,
  add column if not exists sale_title text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'shop_settings_hero_eyebrow_len') then
    alter table public.shop_settings add constraint shop_settings_hero_eyebrow_len check (char_length(hero_eyebrow) <= 30);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'shop_settings_hero_title_len') then
    alter table public.shop_settings add constraint shop_settings_hero_title_len check (char_length(hero_title) <= 70);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'shop_settings_hero_text_len') then
    alter table public.shop_settings add constraint shop_settings_hero_text_len check (char_length(hero_text) <= 140);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'shop_settings_hero_image_len') then
    alter table public.shop_settings add constraint shop_settings_hero_image_len check (char_length(hero_image) <= 500);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'shop_settings_sale_title_len') then
    alter table public.shop_settings add constraint shop_settings_sale_title_len check (char_length(sale_title) <= 70);
  end if;
end $$;
