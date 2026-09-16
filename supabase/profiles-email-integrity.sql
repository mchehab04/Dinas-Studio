-- ============================================================
-- Make profiles.email trustworthy.
--
-- Supabase already guarantees one account per address in auth.users, so
-- duplicate signups were never possible. The problem was the copy: profiles
-- .email had no unique constraint, and the signup trigger only fires on INSERT,
-- so if anyone changed their email the copy silently went stale while still
-- looking authoritative.
--
-- Safe to re-run. Run in Supabase Dashboard > SQL Editor > New query > Run.
-- ============================================================

-- Fail loudly and legibly if duplicates somehow exist, rather than letting the
-- constraint below error with just "could not create unique index".
do $$
declare dupes text;
begin
  select string_agg(email, ', ') into dupes
  from (select email from public.profiles group by email having count(*) > 1) d;
  if dupes is not null then
    raise exception 'Duplicate emails in profiles, resolve these first: %', dupes;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_email_unique'
  ) then
    alter table public.profiles add constraint profiles_email_unique unique (email);
  end if;
end $$;

-- Keep the copy in step with auth. security definer so it can write to profiles
-- regardless of who triggered the change.
create or replace function public.sync_profile_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = new.email where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute procedure public.sync_profile_email();
