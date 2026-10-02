/**
 * Merchant -> listed-entity resolver (CLAUDE.md §6).
 *
 * Takes a raw merchant string (from the bank/UPI feed) and returns the
 * MerchantMapping the accumulation engine needs, or null for an unknown
 * merchant (which the engine routes to the user's fallback).
 *
 * v1 uses normalized substring matching against a curated brand list. This is a
 * starter: production needs stricter matching (MCC codes, a verified merchant
 * DB, word boundaries) to avoid false positives like "pineapple" -> Apple.
 */
import { BRANDS } from './brands.js';
import type { MerchantMapping } from '../accumulation/types.js';

/** Lowercase and strip all non-alphanumerics, so "Pizza Hut" and "PIZZAHUT" match alike. */
export function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function resolveMerchant(rawMerchant: string): MerchantMapping | null {
  const m = normalize(rawMerchant);
  if (!m) return null;

  for (const brand of BRANDS) {
    for (const pattern of brand.patterns) {
      const pn = normalize(pattern);
      if (pn && m.includes(pn)) {
        return {
          listing: brand.listing,
          entityName: brand.entityName,
          ...(brand.symbol ? { symbol: brand.symbol } : {}),
          ...(brand.foreignSymbol ? { foreignSymbol: brand.foreignSymbol } : {}),
        };
      }
    }
  }
  return null;
}
