-- Migration 0002 — waitlist (for the pre-launch "coming soon" landing page)
-- Anonymous visitors can INSERT their email only. Nobody (anon) can SELECT the
-- list — emails stay private, readable only via the service role / dashboard.

create table waitlist (
  id          uuid primary key default gen_random_uuid(),
  email       text not null unique,
  name        text,
  source      text not null default 'landing',
  created_at  timestamptz not null default now()
);

alter table waitlist enable row level security;

-- Allow the public (anon role, used by the landing page's publishable key) to
-- join the waitlist, but not to read it.
create policy "anon can join waitlist"
  on waitlist for insert
  to anon
  with check (true);

grant insert on table waitlist to anon;
