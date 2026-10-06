-- Migration 0004 — store the human-readable entity name alongside balances/holdings
-- so the portfolio can show "Devyani International" without re-resolving it.

alter table accumulation_balances add column name text not null default '';
alter table holdings add column name text not null default '';
