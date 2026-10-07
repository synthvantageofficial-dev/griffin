/**
 * AccumulationStore — the persistence boundary for the core loop.
 *
 * Two implementations behind one async interface:
 *   - InMemoryStore (this file) — dev/tests, lost on restart.
 *   - PgStore (pgStore.ts)       — Supabase Postgres, durable + atomic.
 *
 * The per-transaction logic lives in the store (not the routes) because the
 * Postgres version must run it inside a single DB transaction for atomicity.
 */
import { randomUUID } from 'node:crypto';
import type { PriceProvider } from '../prices/priceProvider.js';
import { resolveMerchant, normalize } from '../mapping/resolveMerchant.js';
import {
  applyTransaction,
  newLoopState,
  type LoopState,
  type SimConfig,
  type SimEvent,
  type SampleTxn,
} from '../simulation/runSimulation.js';

export interface UnmappedMerchant {
  readonly merchantKey: string;
  readonly sample: string;
  readonly hits: number;
}

export interface ProcessResult {
  readonly event: SimEvent;
  readonly duplicate: boolean;
}

export interface Portfolio {
  readonly userId: string;
  readonly holdings: Array<{ symbol: string; name: string; qty: number }>;
  readonly accumulating: Array<{ symbol: string; name: string; balancePaise: number }>;
}

export interface AccumulationStore {
  createUser(config: SimConfig): Promise<string>;
  getUserConfig(userId: string): Promise<SimConfig | null>;
  /** Process one spend atomically. Returns null if the user does not exist. */
  processTransaction(userId: string, txn: SampleTxn): Promise<ProcessResult | null>;
  getPortfolio(userId: string): Promise<Portfolio | null>;
  /** Most-frequent merchants we couldn't map (to prioritize adding to the mapping). */
  topUnmapped(limit: number): Promise<UnmappedMerchant[]>;
}

interface MemUser {
  readonly config: SimConfig;
  readonly state: LoopState;
  readonly processed: Map<string, SimEvent>;
}

export class InMemoryStore implements AccumulationStore {
  private readonly users = new Map<string, MemUser>();
  private readonly unmapped = new Map<string, { sample: string; hits: number }>();

  constructor(private readonly prices: PriceProvider) {}

  private recordUnmapped(rawMerchant: string): void {
    const key = normalize(rawMerchant);
    if (!key) return;
    const existing = this.unmapped.get(key);
    this.unmapped.set(key, { sample: rawMerchant, hits: (existing?.hits ?? 0) + 1 });
  }

  async topUnmapped(limit: number): Promise<UnmappedMerchant[]> {
    return [...this.unmapped.entries()]
      .map(([merchantKey, v]) => ({ merchantKey, sample: v.sample, hits: v.hits }))
      .sort((a, b) => b.hits - a.hits)
      .slice(0, limit);
  }

  async createUser(config: SimConfig): Promise<string> {
    const userId = randomUUID();
    this.users.set(userId, { config, state: newLoopState(), processed: new Map() });
    return userId;
  }

  async getUserConfig(userId: string): Promise<SimConfig | null> {
    return this.users.get(userId)?.config ?? null;
  }

  async processTransaction(userId: string, txn: SampleTxn): Promise<ProcessResult | null> {
    const user = this.users.get(userId);
    if (!user) return null;
    const prior = user.processed.get(txn.ref);
    if (prior) return { event: prior, duplicate: true };
    if (!resolveMerchant(txn.merchant)) this.recordUnmapped(txn.merchant);
    const event = applyTransaction(user.state, txn, user.config, this.prices);
    user.processed.set(txn.ref, event);
    return { event, duplicate: false };
  }

  async getPortfolio(userId: string): Promise<Portfolio | null> {
    const user = this.users.get(userId);
    if (!user) return null;
    const { holdings, balances, names } = user.state;
    return {
      userId,
      holdings: [...holdings.entries()].map(([symbol, qty]) => ({
        symbol,
        name: names.get(symbol) ?? symbol,
        qty,
      })),
      accumulating: [...balances.entries()]
        .filter(([, bal]) => bal > 0)
        .map(([symbol, bal]) => ({ symbol, name: names.get(symbol) ?? symbol, balancePaise: bal })),
    };
  }
}
