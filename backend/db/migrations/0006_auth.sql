-- Migration 0006 — auth: email + hashed password on users.
-- Password is stored as a scrypt hash ("scrypt$<salt>$<hash>"), never plaintext.

alter table users
  add column email         text unique,
  add column password_hash text;
