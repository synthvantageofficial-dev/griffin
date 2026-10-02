import { describe, it, expect } from 'vitest';
import { resolveMerchant, normalize } from '../src/modules/mapping/resolveMerchant.js';
import { resolveTarget } from '../src/modules/accumulation/routing.js';

describe('normalize', () => {
  it('lowercases and strips non-alphanumerics', () => {
    expect(normalize("McDonald's #231, Pune")).toBe('mcdonalds231pune');
    expect(normalize('PIZZA HUT')).toBe('pizzahut');
  });
});

describe('resolveMerchant — India-listed brands', () => {
  it('maps direct India-listed brands to their symbol', () => {
    expect(resolveMerchant('ZOMATO LTD')).toMatchObject({ listing: 'india_listed', symbol: 'ETERNAL' });
    expect(resolveMerchant('Swiggy Instamart')).toMatchObject({ listing: 'india_listed', symbol: 'SWIGGY' });
    expect(resolveMerchant('DMART AVENUE, Nagpur')).toMatchObject({ listing: 'india_listed', symbol: 'DMART' });
    expect(resolveMerchant('Tanishq Jewellers')).toMatchObject({ listing: 'india_listed', symbol: 'TITAN' });
    expect(resolveMerchant('RELIANCE DIGITAL')).toMatchObject({ listing: 'india_listed', symbol: 'RELIANCE' });
  });

  it('maps international brands to their LISTED INDIAN operator', () => {
    expect(resolveMerchant("McDonald's")).toMatchObject({ listing: 'india_listed', symbol: 'WESTLIFE' });
    expect(resolveMerchant('KFC')).toMatchObject({ listing: 'india_listed', symbol: 'DEVYANI' });
    expect(resolveMerchant('PIZZAHUT')).toMatchObject({ listing: 'india_listed', symbol: 'DEVYANI' });
    expect(resolveMerchant('Dominos Pizza')).toMatchObject({ listing: 'india_listed', symbol: 'JUBLFOOD' });
    expect(resolveMerchant('Starbucks Coffee')).toMatchObject({ listing: 'india_listed', symbol: 'TATACONSUM' });
  });

  it('includes a human-readable entity name', () => {
    expect(resolveMerchant('KFC')?.entityName).toBe('Devyani International');
  });
});

describe('resolveMerchant — abroad-only & unknown', () => {
  it('maps abroad-only brands to a foreign ticker', () => {
    expect(resolveMerchant('Amazon Pay')).toMatchObject({ listing: 'abroad_listed', foreignSymbol: 'AMZN' });
    expect(resolveMerchant('Netflix')).toMatchObject({ listing: 'abroad_listed', foreignSymbol: 'NFLX' });
  });

  it('returns null for an unknown / local merchant', () => {
    expect(resolveMerchant('Sharma General Store')).toBeNull();
    expect(resolveMerchant('Local Kirana')).toBeNull();
    expect(resolveMerchant('')).toBeNull();
  });
});

describe('merchant -> target (end-to-end with the engine)', () => {
  const FALLBACK = 'NIFTYBEES';
  it('India-listed merchant -> that Indian stock', () => {
    expect(resolveTarget(resolveMerchant('KFC'), FALLBACK)).toEqual({ kind: 'india_stock', symbol: 'DEVYANI' });
  });
  it('abroad-only merchant -> fallback (US route is Phase 2)', () => {
    expect(resolveTarget(resolveMerchant('Amazon'), FALLBACK)).toEqual({ kind: 'india_index_etf', symbol: FALLBACK });
  });
  it('unknown merchant -> fallback', () => {
    expect(resolveTarget(resolveMerchant('Sharma General Store'), FALLBACK)).toEqual({
      kind: 'india_index_etf',
      symbol: FALLBACK,
    });
  });
});
