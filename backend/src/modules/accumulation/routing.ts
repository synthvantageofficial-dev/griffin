/**
 * Eligibility routing — the deterministic decision tree (CLAUDE.md §6).
 *
 * CRITICAL (Golden Rules #1 & #4): we NEVER pick, rank, or recommend a stock.
 * The target follows ONLY from the merchant mapping and the user's pre-set
 * fallback choice. This keeps us execution-only.
 */
import type { MerchantMapping, Target } from './types.js';

/**
 * Resolve which investable target a set-aside goes to.
 *
 * 1. Merchant has a LISTED INDIAN entity  -> buy that Indian stock.
 * 2. Merchant is listed ONLY abroad        -> US route is Phase 2; until then,
 *    route to the user's fallback (step 3).
 * 3. Not listed anywhere / unknown merchant -> user's chosen India index ETF.
 *
 * @param mapping              merchant mapping, or null for an unknown merchant
 * @param userFallbackEtfSymbol the India index ETF the user chose once at onboarding
 */
export function resolveTarget(
  mapping: MerchantMapping | null,
  userFallbackEtfSymbol: string,
): Target {
  if (mapping && mapping.listing === 'india_listed' && mapping.symbol) {
    return { kind: 'india_stock', symbol: mapping.symbol };
  }
  // abroad_listed (Phase 2 US route not live yet), unlisted, or unknown -> fallback.
  return { kind: 'india_index_etf', symbol: userFallbackEtfSymbol };
}
