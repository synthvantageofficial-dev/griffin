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
import { toPaise } from '../../lib/money.js';
import type { PriceProvider } from '../prices/priceProvider.js';
import { resolveMerchant, normalize } from '../mapping/resolveMerchant.js';
import { evaluateExecution } from '../accumulation/engine.js';
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

/** A whole-share buy executed by the batch sweep. */
export interface SweepBuy {
  readonly userId: string;
  readonly symbol: string;
  readonly name: string;
  readonly qty: number;
  readonly costPaise: number;
}

/** DPDP consent purposes (separate, explicit). */
export type ConsentType = 'terms' | 'kyc' | 'txn_data' | 'marketing';
export interface ConsentState {
  readonly type: string;
  readonly granted: boolean;
  readonly version: string;
  readonly updatedAt: string;
}

/** A line of the user's money trail (audit surfacing — Golden Rule #7). */
export interface LedgerEntryView {
  readonly symbol: string;
  readonly direction: string;
  readonly amountPaise: number;
  readonly reason: string;
  readonly createdAt: string;
}

/** Reconciliation: stored balance vs the ledger-derived balance. */
export interface ReconDiscrepancy {
  readonly userId: string;
  readonly symbol: string;
  readonly storedPaise: number;
  readonly ledgerPaise: number;
}
export interface ReconReport {
  readonly checked: number;
  readonly discrepancies: ReconDiscrepancy[];
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

export interface CreateUserInput {
  readonly email: string;
  readonly passwordHash: string;
  readonly config: SimConfig;
}
export type CreateUserResult = { readonly userId: string } | { readonly error: 'email_exists' };
export interface Credentials {
  readonly userId: string;
  readonly passwordHash: string;
}

export interface AccumulationStore {
  createUser(input: CreateUserInput): Promise<CreateUserResult>;
  findByEmail(email: string): Promise<Credentials | null>;
  getUserConfig(userId: string): Promise<SimConfig | null>;
  /** Process one spend atomically. Returns null if the user does not exist. */
  processTransaction(userId: string, txn: SampleTxn): Promise<ProcessResult | null>;
  getPortfolio(userId: string): Promise<Portfolio | null>;
  /** Most-frequent merchants we couldn't map (to prioritize adding to the mapping). */
  topUnmapped(limit: number): Promise<UnmappedMerchant[]>;
  /** Batch job: for every balance that now covers >= 1 share at the current price, buy. */
  runSweep(): Promise<SweepBuy[]>;
  /** Record a DPDP consent grant/withdraw; returns current consent state (null if no user). */
  recordConsent(userId: string, type: ConsentType, granted: boolean, version: string): Promise<ConsentState[] | null>;
  getConsents(userId: string): Promise<ConsentState[] | null>;
  /** The user's money trail (ledger entries), newest first. Null if no user. */
  getActivity(userId: string, limit: number): Promise<LedgerEntryView[] | null>;
  /** Ops integrity check: does each stored balance match its ledger sum? */
  reconcile(): Promise<ReconReport>;
}

interface MemUser {
  readonly email: string;
  readonly passwordHash: string;
  readonly config: SimConfig;
  readonly state: LoopState;
  readonly processed: Map<string, SimEvent>;
  readonly consents: Map<string, ConsentState>;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export class InMemoryStore implements AccumulationStore {
  private readonly users = new Map<string, MemUser>();
  private readonly emailIndex = new Map<string, string>(); // email -> userId
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

  async createUser(input: CreateUserInput): Promise<CreateUserResult> {
    const email = normalizeEmail(input.email);
    if (this.emailIndex.has(email)) return { error: 'email_exists' };
    const userId = randomUUID();
    this.users.set(userId, {
      email,
      passwordHash: input.passwordHash,
      config: input.config,
      state: newLoopState(),
      processed: new Map(),
      consents: new Map(),
    });
    this.emailIndex.set(email, userId);
    return { userId };
  }

  async findByEmail(email: string): Promise<Credentials | null> {
    const userId = this.emailIndex.get(normalizeEmail(email));
    if (!userId) return null;
    const user = this.users.get(userId);
    if (!user) return null;
    return { userId, passwordHash: user.passwordHash };
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

  async recordConsent(
    userId: string,
    type: ConsentType,
    granted: boolean,
    version: string,
  ): Promise<ConsentState[] | null> {
    const user = this.users.get(userId);
    if (!user) return null;
    user.consents.set(type, { type, granted, version, updatedAt: new Date().toISOString() });
    return [...user.consents.values()];
  }

  async getConsents(userId: string): Promise<ConsentState[] | null> {
    const user = this.users.get(userId);
    if (!user) return null;
    return [...user.consents.values()];
  }

  // The in-memory store keeps no separate ledger (that lives only in Postgres),
  // so audit/reconcile are trivially empty here; the real checks run on PgStore.
  async getActivity(userId: string): Promise<LedgerEntryView[] | null> {
    return this.users.has(userId) ? [] : null;
  }

  async reconcile(): Promise<ReconReport> {
    return { checked: 0, discrepancies: [] };
  }

  async runSweep(): Promise<SweepBuy[]> {
    const buys: SweepBuy[] = [];
    for (const [userId, user] of this.users) {
      for (const [symbol, balance] of user.state.balances) {
        const price = this.prices.getPricePaise(symbol) ?? toPaise(0);
        const dec = evaluateExecution(balance, price);
        if (!dec.shouldBuy) continue;
        user.state.balances.set(symbol, dec.remainingPaise);
        user.state.holdings.set(symbol, (user.state.holdings.get(symbol) ?? 0) + dec.qty);
        buys.push({
          userId,
          symbol,
          name: user.state.names.get(symbol) ?? symbol,
          qty: dec.qty,
          costPaise: dec.costPaise,
        });
      }
    }
    return buys;
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
