-- Migration 0001 — core accumulation schema
-- Foundation for the accumulation engine (CLAUDE.md §1, §6, §8).
-- Money rule: ALL amounts are integer paise, stored as BIGINT. Never floats.
-- Security: RLS enabled + no policies = deny-all to anon/authenticated roles.
--           Only the backend's privileged (service) connection touches these tables.

-- ---------- Enums ----------

-- How a merchant maps to an investable target (drives the eligibility tree, §6).
create type listing_status as enum ('india_listed', 'abroad_listed', 'unlisted');

-- What a set-aside amount is ultimately invested into.
create type target_kind as enum (
  'india_stock',            -- core model: buy 1 whole share of the Indian listed entity
  'india_index_etf',        -- fallback: unlisted-anywhere -> user-chosen index ETF
  'us_stock'                -- Phase 2: abroad-only listed -> US fractional (deferred)
);

create type order_status as enum ('pending', 'placed', 'filled', 'failed', 'cancelled');

create type ledger_direction as enum ('credit', 'debit');

-- ---------- users ----------
create table users (
  id          uuid primary key default gen_random_uuid(),
  status      text not null default 'active',
  created_at  timestamptz not null default now()
);

-- ---------- merchant -> listed-entity mapping (routing source of truth) ----------
create table merchant_company_map (
  id              uuid primary key default gen_random_uuid(),
  merchant_key    text not null unique,          -- normalized merchant name / MCC / VPA key
  display_name    text not null,
  listing         listing_status not null,
  -- Filled when listing = 'india_listed' (the Indian entity/operator we actually buy):
  symbol          text,                           -- NSE/BSE symbol, e.g. 'JUBLFOOD'
  entity_name     text,                           -- e.g. 'Jubilant FoodWorks'
  -- Filled when listing = 'abroad_listed':
  foreign_symbol  text,                           -- e.g. 'AMZN'
  confidence      numeric(4,3) not null default 1.000,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ---------- detected spends ----------
create table transactions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  merchant_key  text not null,                    -- may or may not exist in the map yet
  amount_paise  bigint not null check (amount_paise > 0),
  occurred_at   timestamptz not null,
  source        text not null,                    -- e.g. 'account_aggregator', 'card', 'manual'
  -- Idempotency: the same external transaction must never be ingested twice.
  external_ref  text not null,
  created_at    timestamptz not null default now(),
  unique (user_id, source, external_ref)
);

-- ---------- per-transaction set-aside + resolved target ----------
create table roundups (
  id              uuid primary key default gen_random_uuid(),
  transaction_id  uuid not null unique references transactions(id) on delete cascade,
  user_id         uuid not null references users(id) on delete cascade,
  amount_paise    bigint not null check (amount_paise > 0),
  rule            text not null,                  -- e.g. 'round_up_nearest_10', 'fixed_20'
  target_kind     target_kind not null,
  target_symbol   text not null,                  -- resolved stock/ETF symbol at set-aside time
  created_at      timestamptz not null default now()
);

-- ---------- running accumulation balance per (user, target) ----------
create table accumulation_balances (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references users(id) on delete cascade,
  target_kind    target_kind not null,
  target_symbol  text not null,
  balance_paise  bigint not null default 0 check (balance_paise >= 0),
  updated_at     timestamptz not null default now(),
  unique (user_id, target_symbol)
);

-- ---------- immutable double-entry audit for every balance change ----------
create table ledger_entries (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  target_symbol text not null,
  direction     ledger_direction not null,        -- credit = money added, debit = money used to buy
  amount_paise  bigint not null check (amount_paise > 0),
  -- Idempotency key so a retried operation never double-posts.
  idempotency_key text not null unique,
  reason        text not null,                    -- e.g. 'roundup', 'buy_share', 'reversal'
  roundup_id    uuid references roundups(id),
  created_at    timestamptz not null default now()
);

-- ---------- buy orders (whole share, or ETF units) ----------
create table orders (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id) on delete cascade,
  target_kind     target_kind not null,
  symbol          text not null,
  qty             integer not null check (qty > 0),
  cost_paise      bigint not null check (cost_paise >= 0),  -- amount used from accumulation
  status          order_status not null default 'pending',
  idempotency_key text not null unique,
  broker_ref      text,                             -- partner-broker order id
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ---------- resulting positions ----------
create table holdings (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  symbol      text not null,
  qty         integer not null default 0 check (qty >= 0),
  updated_at  timestamptz not null default now(),
  unique (user_id, symbol)
);

-- ---------- helpful indexes ----------
create index idx_transactions_user on transactions(user_id);
create index idx_roundups_user on roundups(user_id);
create index idx_ledger_user_symbol on ledger_entries(user_id, target_symbol);
create index idx_orders_user_status on orders(user_id, status);

-- ---------- RLS: deny-all by default (server-only access via service role) ----------
alter table users                  enable row level security;
alter table merchant_company_map   enable row level security;
alter table transactions           enable row level security;
alter table roundups               enable row level security;
alter table accumulation_balances  enable row level security;
alter table ledger_entries         enable row level security;
alter table orders                 enable row level security;
alter table holdings               enable row level security;
