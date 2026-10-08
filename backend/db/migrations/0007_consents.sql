-- Migration 0007 — DPDP consent records (append-only audit trail).
-- Every grant/withdraw is a new row; current state = latest row per (user, type).
-- Separate, explicit consent per purpose (CLAUDE.md Golden Rule #6).

create table consent_records (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  consent_type text not null check (consent_type in ('terms', 'kyc', 'txn_data', 'marketing')),
  action       text not null check (action in ('grant', 'withdraw')),
  version      text not null default 'v1',
  created_at   timestamptz not null default now()
);

create index idx_consent_user_type on consent_records (user_id, consent_type, created_at desc);

alter table consent_records enable row level security;
