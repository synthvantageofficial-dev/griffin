/**
 * PostgreSQL connection pool (Supabase-hosted, Mumbai/ap-south-1).
 * We talk to Postgres directly via `pg` using DATABASE_URL — Supabase is just
 * the managed host. Schema is owned by our SQL migrations in db/migrations/.
 */
import pg from 'pg';
import { env } from '../config/env.js';

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not configured');
  }
  if (!pool) {
    pool = new pg.Pool({
      connectionString: env.DATABASE_URL,
      max: 10,
      // Supabase requires TLS; its pooler cert chain isn't in the default store.
      ssl: { rejectUnauthorized: false },
    });
  }
  return pool;
}

/** Lightweight connectivity check used by the /health/db route. */
export async function pingDb(): Promise<boolean> {
  const res = await getPool().query('select 1 as ok');
  return res.rows[0]?.ok === 1;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
