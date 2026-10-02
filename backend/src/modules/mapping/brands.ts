/**
 * Seed brand -> listed-entity data for the merchant mapping engine (CLAUDE.md §6).
 *
 * ⚠️ SYMBOLS MUST BE VERIFIED before production — tickers & corporate structures
 * change (e.g. Zomato's listed entity is now "Eternal Ltd"). This is a starter
 * set for building/testing the engine, not a source of truth for live trading.
 *
 * `patterns` are matched (normalized, substring) against the detected merchant
 * name. Order matters: more specific entries should come before broader ones.
 */
import type { ListingStatus } from '../accumulation/types.js';

export interface BrandEntry {
  readonly patterns: readonly string[];
  readonly listing: ListingStatus;
  /** NSE symbol for india_listed. */
  readonly symbol?: string;
  /** Foreign ticker for abroad_listed (Phase 2 US route). */
  readonly foreignSymbol?: string;
  readonly entityName: string;
}

export const BRANDS: readonly BrandEntry[] = [
  // --- International brands run by a LISTED INDIAN operator (CLAUDE.md §6) ---
  { patterns: ['dominos', 'popeyes', 'dunkin'], listing: 'india_listed', symbol: 'JUBLFOOD', entityName: 'Jubilant FoodWorks' },
  { patterns: ['mcdonald', 'mcdonalds'], listing: 'india_listed', symbol: 'WESTLIFE', entityName: 'Westlife Foodworld' },
  { patterns: ['kfc', 'pizza hut', 'pizzahut', 'taco bell', 'tacobell'], listing: 'india_listed', symbol: 'DEVYANI', entityName: 'Devyani International' },
  { patterns: ['starbucks'], listing: 'india_listed', symbol: 'TATACONSUM', entityName: 'Tata Consumer (Tata Starbucks)' },

  // --- Direct India-listed consumer brands ---
  { patterns: ['zomato', 'blinkit', 'eternal'], listing: 'india_listed', symbol: 'ETERNAL', entityName: 'Eternal Ltd (Zomato)' },
  { patterns: ['swiggy', 'instamart'], listing: 'india_listed', symbol: 'SWIGGY', entityName: 'Swiggy Ltd' },
  { patterns: ['dmart', 'avenue supermart'], listing: 'india_listed', symbol: 'DMART', entityName: 'Avenue Supermarts (DMart)' },
  { patterns: ['nykaa'], listing: 'india_listed', symbol: 'NYKAA', entityName: 'FSN E-Commerce (Nykaa)' },
  { patterns: ['tanishq', 'titan', 'fastrack', 'titan eye'], listing: 'india_listed', symbol: 'TITAN', entityName: 'Titan Company' },
  { patterns: ['westside', 'zudio', 'trent'], listing: 'india_listed', symbol: 'TRENT', entityName: 'Trent Ltd' },
  { patterns: ['paytm'], listing: 'india_listed', symbol: 'PAYTM', entityName: 'One97 Communications (Paytm)' },
  { patterns: ['jiomart', 'reliance digital', 'reliance trends', 'reliance smart', 'reliance fresh', 'jio', 'reliance'], listing: 'india_listed', symbol: 'RELIANCE', entityName: 'Reliance Industries' },
  { patterns: ['apollo pharmacy', 'apollo'], listing: 'india_listed', symbol: 'APOLLOHOSP', entityName: 'Apollo Hospitals' },
  { patterns: ['bata'], listing: 'india_listed', symbol: 'BATAINDIA', entityName: 'Bata India' },
  { patterns: ['airtel'], listing: 'india_listed', symbol: 'BHARTIARTL', entityName: 'Bharti Airtel' },
  { patterns: ['vodafoneidea', 'vodafone'], listing: 'india_listed', symbol: 'IDEA', entityName: 'Vodafone Idea' },
  { patterns: ['indigo', 'goindigo'], listing: 'india_listed', symbol: 'INDIGO', entityName: 'InterGlobe Aviation (IndiGo)' },
  { patterns: ['irctc'], listing: 'india_listed', symbol: 'IRCTC', entityName: 'IRCTC' },
  { patterns: ['maggi', 'nescafe', 'kitkat', 'nestle'], listing: 'india_listed', symbol: 'NESTLEIND', entityName: 'Nestle India' },
  { patterns: ['aashirvaad', 'sunfeast', 'bingo', 'yippee', 'itc'], listing: 'india_listed', symbol: 'ITC', entityName: 'ITC Ltd' },
  { patterns: ['surf excel', 'dove', 'lux', 'lifebuoy', 'rin', 'hindustan unilever', 'hul'], listing: 'india_listed', symbol: 'HINDUNILVR', entityName: 'Hindustan Unilever' },
  { patterns: ['asian paints'], listing: 'india_listed', symbol: 'ASIANPAINT', entityName: 'Asian Paints' },
  { patterns: ['tata salt', 'tata tea', 'tata consumer', 'tata cliq'], listing: 'india_listed', symbol: 'TATACONSUM', entityName: 'Tata Consumer Products' },

  // --- Listed ONLY abroad (no listed Indian entity) -> Phase 2 US route ---
  { patterns: ['amazon'], listing: 'abroad_listed', foreignSymbol: 'AMZN', entityName: 'Amazon.com Inc' },
  { patterns: ['apple', 'iphone'], listing: 'abroad_listed', foreignSymbol: 'AAPL', entityName: 'Apple Inc' },
  { patterns: ['netflix'], listing: 'abroad_listed', foreignSymbol: 'NFLX', entityName: 'Netflix Inc' },
  { patterns: ['nike'], listing: 'abroad_listed', foreignSymbol: 'NKE', entityName: 'Nike Inc' },
  { patterns: ['spotify'], listing: 'abroad_listed', foreignSymbol: 'SPOT', entityName: 'Spotify' },
  { patterns: ['uber'], listing: 'abroad_listed', foreignSymbol: 'UBER', entityName: 'Uber Technologies' },
  { patterns: ['google', 'youtube premium'], listing: 'abroad_listed', foreignSymbol: 'GOOGL', entityName: 'Alphabet Inc' },
  { patterns: ['microsoft', 'xbox'], listing: 'abroad_listed', foreignSymbol: 'MSFT', entityName: 'Microsoft Corp' },
];
