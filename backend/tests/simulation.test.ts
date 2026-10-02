import { describe, it, expect } from 'vitest';
import { toPaise } from '../src/lib/money.js';
import { MockPriceProvider } from '../src/modules/prices/priceProvider.js';
import { runSimulation, type SampleTxn, type SimConfig } from '../src/modules/simulation/runSimulation.js';

const r = (rupees: number) => toPaise(rupees * 100);

const config: SimConfig = {
  rule: { type: 'fixed', amountPaise: toPaise(2500) }, // ₹25 per purchase
  fallbackEtfSymbol: 'NIFTYBEES',
};

describe('MockPriceProvider', () => {
  it('returns paise prices and null for unknown symbols', () => {
    expect(new MockPriceProvider().getPricePaise('IDEA')).toBe(900);
    expect(new MockPriceProvider().getPricePaise('NOT_A_SYMBOL')).toBeNull();
  });
});

describe('runSimulation (full core loop)', () => {
  const txns: readonly SampleTxn[] = [
    { ref: 't1', merchant: 'Vodafone Idea Recharge', amountPaise: r(299) }, // -> IDEA (₹9)
    { ref: 't2', merchant: 'Zomato', amountPaise: r(320) }, // -> ETERNAL
    { ref: 't3', merchant: 'Zomato', amountPaise: r(260) }, // -> ETERNAL
    { ref: 't4', merchant: 'Amazon Pay', amountPaise: r(1299) }, // abroad -> NIFTYBEES
    { ref: 't5', merchant: 'Sharma General Store', amountPaise: r(240) }, // unknown -> NIFTYBEES
  ];

  const result = runSimulation(txns, config, new MockPriceProvider());

  it('buys a cheap share immediately (₹25 set aside, IDEA ₹9 -> 2 shares)', () => {
    expect(result.holdings.get('IDEA')).toBe(2); // floor(2500 / 900) = 2
    expect(result.balances.get('IDEA')).toBe(700); // 2500 - 1800 carried over
  });

  it('accumulates per-brand without buying when below one share', () => {
    expect(result.balances.get('ETERNAL')).toBe(5000); // 2 × ₹25, no buy (₹250 share)
    expect(result.holdings.get('ETERNAL')).toBeUndefined();
  });

  it('routes abroad-only and unknown merchants to the same fallback bucket', () => {
    expect(result.balances.get('NIFTYBEES')).toBe(5000); // Amazon + Sharma, ₹25 each
  });

  it('maps a messy merchant string to the right listed entity', () => {
    const idea = result.events.find((e) => e.ref === 't1');
    expect(idea?.entityName).toBe('Vodafone Idea');
    expect(idea?.symbol).toBe('IDEA');
  });
});
