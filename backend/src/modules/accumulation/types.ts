/**
 * Accumulation engine — domain types.
 * See CLAUDE.md §1 (core model) and §6 (eligibility decision tree).
 * All money is integer Paise (Golden Rule #5).
 */
import type { Paise } from '../../lib/money.js';

/** What a set-aside amount is ultimately invested into. */
export type TargetKind = 'india_stock' | 'india_index_etf' | 'us_stock';

/** How much to set aside from each purchase. */
export type RoundupRule =
  | { readonly type: 'round_up_nearest'; readonly nearestPaise: Paise } // e.g. nearest ₹10 = 1000 paise
  | { readonly type: 'fixed'; readonly amountPaise: Paise }; // e.g. ₹20 per purchase = 2000 paise

/** Whether/where a merchant's brand is listed. */
export type ListingStatus = 'india_listed' | 'abroad_listed' | 'unlisted';

/** Result of mapping a merchant to a listed entity (CLAUDE.md §6). */
export interface MerchantMapping {
  readonly listing: ListingStatus;
  /** NSE/BSE symbol — present when listing is 'india_listed'. */
  readonly symbol?: string;
  /** Foreign symbol (e.g. 'AMZN') — present when listing is 'abroad_listed'. Phase 2. */
  readonly foreignSymbol?: string;
  /** Human-readable listed entity, for display (e.g. 'Jubilant FoodWorks'). */
  readonly entityName?: string;
}

/** The concrete, deterministic target a set-aside goes to. */
export interface Target {
  readonly kind: TargetKind;
  readonly symbol: string;
}

export type LedgerDirection = 'credit' | 'debit';

/** An immutable, idempotent audit entry for a balance change. */
export interface LedgerEntry {
  readonly direction: LedgerDirection;
  readonly amountPaise: Paise;
  readonly reason: string;
  readonly idempotencyKey: string;
}

/** Decision on how many whole shares/units the accumulated balance can buy. */
export interface ExecutionDecision {
  readonly shouldBuy: boolean;
  readonly qty: number;
  readonly costPaise: Paise;
  readonly remainingPaise: Paise;
}
