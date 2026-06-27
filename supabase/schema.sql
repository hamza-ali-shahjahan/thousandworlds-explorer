-- =====================================================================
-- ThousandWorlds Explorer — accounts schema (Phase 1)
-- Run this once in the Supabase dashboard: SQL Editor → New query → paste → Run.
-- Safe to re-run (idempotent).
-- =====================================================================

-- 1) Admin allowlist — emails that become admins automatically on sign-up.
--    Real emails are NOT committed to this public repo. Seed them privately:
--    run `supabase/admins.local.sql` (git-ignored) in the SQL Editor, or paste
--    the inserts straight into the Supabase dashboard. Format:
--      insert into public.admin_emails (email) values ('you@example.com') on conflict do nothing;
create table if not exists public.admin_emails ( email text primary key );

-- 2) profiles — one row per user (display name + admin flag).
create table if not exists public.profiles (
  id          uuid primary key references auth.users on delete cascade,
  email       text,
  display_name text,
  is_admin    boolean not null default false,
  created_at  timestamptz not null default now()
);

-- 3) creations — a saved Finding / Built World / pinned Estimate.
--    payload (jsonb) stores the full creation object from the app.
create table if not exists public.creations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade,
  type        text not null check (type in ('finding','world','estimate')),
  title       text,
  payload     jsonb not null default '{}'::jsonb,
  is_public   boolean not null default false,
  share_slug  text unique,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists creations_user_idx   on public.creations(user_id);
create index if not exists creations_public_idx  on public.creations(is_public) where is_public;

-- 4) events — lightweight activity log (runs / saves / shares) for the dashboard.
create table if not exists public.events (
  id          bigint generated always as identity primary key,
  user_id     uuid references auth.users on delete set null,
  type        text not null,
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists events_created_idx on public.events(created_at desc);

-- 5) Auto-create a profile on sign-up; admin set from the allowlist; log the signup.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, is_admin)
  values (new.id, new.email, exists (select 1 from public.admin_emails a where a.email = new.email))
  on conflict (id) do nothing;
  insert into public.events (user_id, type) values (new.id, 'signup');
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 6) is_admin() — used by the policies below (security definer avoids RLS recursion).
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

-- 7) Row-Level Security.
-- admin_emails is read ONLY by handle_new_user() (security definer, bypasses RLS).
-- Enable RLS with no policy => the public anon/authenticated API cannot read it,
-- so the admins' email addresses stay private even though the anon key is public.
alter table public.admin_emails enable row level security;
alter table public.profiles  enable row level security;
alter table public.creations enable row level security;
alter table public.events    enable row level security;

drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_update on public.profiles;
create policy profiles_select on public.profiles for select
  using (id = auth.uid() or public.is_admin());
create policy profiles_update on public.profiles for update
  using (id = auth.uid());

drop policy if exists creations_select on public.creations;
drop policy if exists creations_insert on public.creations;
drop policy if exists creations_update on public.creations;
drop policy if exists creations_delete on public.creations;
create policy creations_select on public.creations for select
  using (is_public or user_id = auth.uid() or public.is_admin());
create policy creations_insert on public.creations for insert
  with check (user_id = auth.uid());
create policy creations_update on public.creations for update
  using (user_id = auth.uid());
create policy creations_delete on public.creations for delete
  using (user_id = auth.uid());

drop policy if exists events_insert on public.events;
drop policy if exists events_select on public.events;
create policy events_insert on public.events for insert
  with check (user_id = auth.uid());
create policy events_select on public.events for select
  using (public.is_admin());

-- Done. Existing users (if any) won't get a profile retroactively — re-run is fine
-- for new sign-ups. To promote someone later:
--   update public.profiles set is_admin = true where email = 'ed@example.com';
