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
import {
  applyTransaction,
  newLoopState,
  type LoopState,
  type SimConfig,
  type SimEvent,
  type SampleTxn,
} from '../simulation/runSimulation.js';

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
}

interface MemUser {
  readonly config: SimConfig;
  readonly state: LoopState;
  readonly processed: Map<string, SimEvent>;
}

export class InMemoryStore implements AccumulationStore {
  private readonly users = new Map<string, MemUser>();

  constructor(private readonly prices: PriceProvider) {}

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
