-- Migration 0005 — log merchants we couldn't map to a listed entity.
-- These spends go to the fallback ETF today; reviewing the most-frequent ones
-- tells us which sellers to add to the mapping next (CLAUDE.md §6).

create table unmapped_merchants (
  merchant_key text primary key,            -- normalized merchant string
  sample_name  text not null,               -- a raw example as it appeared
  hits         bigint not null default 0,   -- how many times seen (prioritize high)
  first_seen   timestamptz not null default now(),
  last_seen    timestamptz not null default now()
);

alter table unmapped_merchants enable row level security;
