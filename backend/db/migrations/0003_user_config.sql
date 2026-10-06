-- Migration 0003 — per-user config (round-up rule + fallback choice)
-- The in-memory store held this in RAM; persist it on the users row.

alter table users
  add column rule_type        text   not null default 'round_up_nearest',
  add column rule_value_paise bigint not null default 1000, -- ₹10
  add column fallback_symbol  text   not null default 'NIFTYBEES',
  add column fallback_name    text   not null default 'Nifty 50 ETF (fallback)';

alter table users
  add constraint users_rule_type_chk check (rule_type in ('round_up_nearest', 'fixed')),
  add constraint users_rule_value_chk check (rule_value_paise > 0);
