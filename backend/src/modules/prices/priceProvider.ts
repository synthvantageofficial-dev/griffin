/**
 * Price provider — abstracts "what is 1 share/unit of SYMBOL worth right now".
 *
 * In production this is backed by the BROKER API (live prices). For development
 * we use a MockPriceProvider with fixed, illustrative prices so the whole loop
 * can run without any external integration. Same interface -> drop-in swap later.
 *
 * ⚠️ Mock prices are illustrative only, not real quotes.
 */
import { toPaise, type Paise } from '../../lib/money.js';

export interface PriceProvider {
  /** Price of one share/unit in paise, or null if the symbol is unknown. */
  getPricePaise(symbol: string): Paise | null;
}

// Illustrative prices in paise (₹ × 100). NOT real quotes.
const MOCK_PRICES_PAISE: Readonly<Record<string, number>> = {
  ETERNAL: 25000, // ₹250  (Zomato)
  SWIGGY: 45000, // ₹450
  DMART: 400000, // ₹4,000
  TITAN: 360000, // ₹3,600
  NYKAA: 18000, // ₹180
  TRENT: 600000, // ₹6,000
  PAYTM: 90000, // ₹900
  RELIANCE: 140000, // ₹1,400
  JUBLFOOD: 65000, // ₹650  (Domino's)
  WESTLIFE: 80000, // ₹800  (McDonald's)
  DEVYANI: 18000, // ₹180  (KFC / Pizza Hut)
  TATACONSUM: 110000, // ₹1,100 (Starbucks)
  NESTLEIND: 230000, // ₹2,300
  ITC: 42000, // ₹420
  HINDUNILVR: 240000, // ₹2,400
  ASIANPAINT: 250000, // ₹2,500
  BATAINDIA: 130000, // ₹1,300
  BHARTIARTL: 160000, // ₹1,600 (Airtel)
  APOLLOHOSP: 700000, // ₹7,000
  INDIGO: 480000, // ₹4,800
  IRCTC: 78000, // ₹780
  IDEA: 900, // ₹9    (Vodafone Idea — cheap share)
  NIFTYBEES: 28000, // ₹280  (fallback index ETF)
};

export class MockPriceProvider implements PriceProvider {
  getPricePaise(symbol: string): Paise | null {
    const p = MOCK_PRICES_PAISE[symbol];
    return p === undefined ? null : toPaise(p);
  }
}
