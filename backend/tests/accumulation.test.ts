import { describe, it, expect } from 'vitest';
import { toPaise } from '../src/lib/money.js';
import { computeRoundup } from '../src/modules/accumulation/roundup.js';
import { resolveTarget } from '../src/modules/accumulation/routing.js';
import {
  applyRoundup,
  evaluateExecution,
  progressPercent,
  processPurchase,
} from '../src/modules/accumulation/engine.js';
import type { MerchantMapping, RoundupRule } from '../src/modules/accumulation/types.js';

const near10: RoundupRule = { type: 'round_up_nearest', nearestPaise: toPaise(1000) };
const fixed20: RoundupRule = { type: 'fixed', amountPaise: toPaise(2000) };

describe('computeRoundup', () => {
  it('rounds up to the nearest ₹10', () => {
    expect(computeRoundup(toPaise(18200), near10)).toBe(800); // ₹182.00 -> ₹190.00, set aside ₹8
    expect(computeRoundup(toPaise(81700), near10)).toBe(300); // ₹817 -> ₹820, set aside ₹3
  });

  it('sets aside 0 when the purchase is already a multiple', () => {
    expect(computeRoundup(toPaise(19000), near10)).toBe(0); // ₹190.00 exactly
  });

  it('fixed rule sets aside a flat amount', () => {
    expect(computeRoundup(toPaise(50000), fixed20)).toBe(2000); // ₹500 purchase -> ₹20
  });

  it('fixed rule never exceeds the purchase amount', () => {
    expect(computeRoundup(toPaise(1500), fixed20)).toBe(1500); // ₹15 purchase, ₹20 rule -> cap at ₹15
  });

  it('returns 0 for a non-positive purchase', () => {
    expect(computeRoundup(toPaise(0), fixed20)).toBe(0);
  });
});

describe('resolveTarget (deterministic, execution-only)', () => {
  it('routes an India-listed merchant to its stock', () => {
    const m: MerchantMapping = { listing: 'india_listed', symbol: 'ZOMATO' };
    expect(resolveTarget(m, 'NIFTYBEES')).toEqual({ kind: 'india_stock', symbol: 'ZOMATO' });
  });

  it('routes an abroad-only listing to the fallback (US route is Phase 2)', () => {
    const m: MerchantMapping = { listing: 'abroad_listed', foreignSymbol: 'AMZN' };
    expect(resolveTarget(m, 'NIFTYBEES')).toEqual({ kind: 'india_index_etf', symbol: 'NIFTYBEES' });
  });

  it('routes an unlisted merchant to the fallback', () => {
    expect(resolveTarget({ listing: 'unlisted' }, 'NIFTYBEES')).toEqual({
      kind: 'india_index_etf',
      symbol: 'NIFTYBEES',
    });
  });

  it('routes an unknown merchant (null) to the fallback', () => {
    expect(resolveTarget(null, 'NIFTYBEES')).toEqual({ kind: 'india_index_etf', symbol: 'NIFTYBEES' });
  });

  it('falls back when an India listing is missing its symbol', () => {
    expect(resolveTarget({ listing: 'india_listed' }, 'NIFTYBEES').kind).toBe('india_index_etf');
  });
});

describe('applyRoundup', () => {
  it('credits the balance and emits an idempotent credit entry', () => {
    const r = applyRoundup(toPaise(13800), toPaise(2000), 'txn_1:credit');
    expect(r.newBalancePaise).toBe(15800);
    expect(r.ledgerEntry).toEqual({
      direction: 'credit',
      amountPaise: 2000,
      reason: 'roundup',
      idempotencyKey: 'txn_1:credit',
    });
  });
});

describe('evaluateExecution (whole-share bridge model)', () => {
  it('does not buy when balance is below one share', () => {
    expect(evaluateExecution(toPaise(7000), toPaise(14000))).toEqual({
      shouldBuy: false,
      qty: 0,
      costPaise: 0,
      remainingPaise: 7000,
    });
  });

  it('buys exactly one share when balance equals the price', () => {
    expect(evaluateExecution(toPaise(14000), toPaise(14000))).toEqual({
      shouldBuy: true,
      qty: 1,
      costPaise: 14000,
      remainingPaise: 0,
    });
  });

  it('buys multiple whole shares and keeps the remainder', () => {
    // ₹300.00 balance, ₹140.00 price -> 2 shares (₹280), ₹20 left
    expect(evaluateExecution(toPaise(30000), toPaise(14000))).toEqual({
      shouldBuy: true,
      qty: 2,
      costPaise: 28000,
      remainingPaise: 2000,
    });
  });

  it('never buys at a non-positive price', () => {
    expect(evaluateExecution(toPaise(14000), toPaise(0)).shouldBuy).toBe(false);
  });
});

describe('progressPercent', () => {
  it('reports progress toward the next whole share', () => {
    expect(progressPercent(toPaise(7000), toPaise(14000))).toBe(50);
    expect(progressPercent(toPaise(13999), toPaise(14000))).toBe(99);
    expect(progressPercent(toPaise(0), toPaise(14000))).toBe(0);
  });
});

describe('processPurchase (full pure flow)', () => {
  const zomato: MerchantMapping = { listing: 'india_listed', symbol: 'ZOMATO' };

  it('accumulates without buying when below one share', () => {
    const r = processPurchase({
      purchasePaise: toPaise(30000), // ₹300
      rule: fixed20, // +₹20
      mapping: zomato,
      fallbackEtfSymbol: 'NIFTYBEES',
      currentBalancePaise: toPaise(5000), // ₹50 already
      sharePricePaise: toPaise(14000), // ₹140 per share
      idempotencyKey: 'txn_A',
    });
    expect(r.target).toEqual({ kind: 'india_stock', symbol: 'ZOMATO' });
    expect(r.roundupPaise).toBe(2000);
    expect(r.execution.shouldBuy).toBe(false);
    expect(r.debitEntry).toBeUndefined();
    expect(r.finalBalancePaise).toBe(7000); // ₹70 accumulating
  });

  it('buys one share when the set-aside tips the balance over the price', () => {
    const r = processPurchase({
      purchasePaise: toPaise(50000), // ₹500
      rule: fixed20, // +₹20
      mapping: zomato,
      fallbackEtfSymbol: 'NIFTYBEES',
      currentBalancePaise: toPaise(13800), // ₹138 already
      sharePricePaise: toPaise(14000), // ₹140 per share
      idempotencyKey: 'txn_B',
    });
    expect(r.execution.shouldBuy).toBe(true);
    expect(r.execution.qty).toBe(1);
    expect(r.creditEntry.idempotencyKey).toBe('txn_B:credit');
    expect(r.debitEntry).toEqual({
      direction: 'debit',
      amountPaise: 14000,
      reason: 'buy',
      idempotencyKey: 'txn_B:debit',
    });
    expect(r.finalBalancePaise).toBe(1800); // ₹18 carries over
  });

  it('routes an unlisted merchant to the fallback ETF', () => {
    const r = processPurchase({
      purchasePaise: toPaise(21700), // ₹217, round to ₹220
      rule: near10,
      mapping: { listing: 'unlisted' },
      fallbackEtfSymbol: 'NIFTYBEES',
      currentBalancePaise: toPaise(0),
      sharePricePaise: toPaise(28000), // ETF unit ₹280
      idempotencyKey: 'txn_C',
    });
    expect(r.target).toEqual({ kind: 'india_index_etf', symbol: 'NIFTYBEES' });
    expect(r.roundupPaise).toBe(300); // ₹3 set aside
    expect(r.execution.shouldBuy).toBe(false);
    expect(r.finalBalancePaise).toBe(300);
  });
});
