import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { InMemoryStore } from '../src/modules/api/store.js';
import { MockPriceProvider, type PriceProvider } from '../src/modules/prices/priceProvider.js';
import { toPaise, type Paise } from '../src/lib/money.js';

/** A price provider whose prices can change at runtime (to test the sweep). */
class MutablePrices implements PriceProvider {
  private readonly m = new Map<string, number>();
  set(sym: string, paise: number): void {
    this.m.set(sym, paise);
  }
  getPricePaise(sym: string): Paise | null {
    const p = this.m.get(sym);
    return p === undefined ? null : toPaise(p);
  }
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildServer({ store: new InMemoryStore(new MockPriceProvider()) });
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

async function newUser(roundup?: { type: 'round_up_nearest' | 'fixed'; valuePaise: number }): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/users', payload: roundup ? { roundup } : {} });
  expect(res.statusCode).toBe(201);
  return res.json().userId as string;
}

describe('API — users', () => {
  it('creates a user with a default round-up rule', async () => {
    const res = await app.inject({ method: 'POST', url: '/users', payload: {} });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.userId).toBeTruthy();
    expect(body.config.rule).toEqual({ type: 'round_up_nearest', nearestPaise: 1000 });
    expect(body.config.fallbackSymbol).toBe('NIFTYBEES');
  });

  it('404s for an unknown user', async () => {
    const res = await app.inject({ method: 'GET', url: '/users/does-not-exist' });
    expect(res.statusCode).toBe(404);
  });
});

describe('API — transactions + portfolio', () => {
  it('processes a spend and buys a cheap share', async () => {
    const userId = await newUser({ type: 'fixed', valuePaise: 2500 }); // ₹25 per spend
    const res = await app.inject({
      method: 'POST',
      url: `/users/${userId}/transactions`,
      payload: { merchant: 'Vodafone Idea Recharge', amountPaise: 29900, ref: 'v1' }, // ₹299
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.duplicate).toBe(false);
    expect(body.target.symbol).toBe('IDEA');
    expect(body.target.entityName).toBe('Vodafone Idea');
    expect(body.bought).toEqual(expect.objectContaining({ qty: 2 })); // ₹25 / ₹9 -> 2 shares
    expect(body.setAside.display).toBe('₹25.00');

    const port = await app.inject({ method: 'GET', url: `/users/${userId}/portfolio` });
    expect(port.statusCode).toBe(200);
    expect(port.json().holdings).toContainEqual({ symbol: 'IDEA', name: 'Vodafone Idea', qty: 2 });
  });

  it('is idempotent on repeated ref', async () => {
    const userId = await newUser({ type: 'fixed', valuePaise: 2500 });
    const payload = { merchant: 'KFC', amountPaise: 40000, ref: 'k1' };
    const first = await app.inject({ method: 'POST', url: `/users/${userId}/transactions`, payload });
    const second = await app.inject({ method: 'POST', url: `/users/${userId}/transactions`, payload });
    expect(first.json().duplicate).toBe(false);
    expect(second.json().duplicate).toBe(true);
    // Balance must not double-count the same transaction.
    expect(second.json().balance.paise).toBe(first.json().balance.paise);
  });

  it('routes an unknown merchant to the fallback ETF', async () => {
    const userId = await newUser({ type: 'fixed', valuePaise: 2500 });
    const res = await app.inject({
      method: 'POST',
      url: `/users/${userId}/transactions`,
      payload: { merchant: 'Sharma General Store', amountPaise: 24000, ref: 's1' },
    });
    expect(res.json().target.symbol).toBe('NIFTYBEES');
  });

  it('rejects an invalid transaction body with 400', async () => {
    const userId = await newUser();
    const res = await app.inject({
      method: 'POST',
      url: `/users/${userId}/transactions`,
      payload: { amountPaise: 100 }, // missing merchant + ref
    });
    expect(res.statusCode).toBe(400);
  });

  it('404s when posting a transaction for an unknown user', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/users/nope/transactions',
      payload: { merchant: 'KFC', amountPaise: 40000, ref: 'x1' },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('API — unmapped merchants', () => {
  it('logs unknown merchants with hit counts, not known ones', async () => {
    const userId = await newUser();
    const unique = 'Qwerty Unique Store XYZ';
    for (const ref of ['uq1', 'uq2', 'uq3']) {
      await app.inject({
        method: 'POST',
        url: `/users/${userId}/transactions`,
        payload: { merchant: unique, amountPaise: 15700, ref },
      });
    }
    // a known merchant should NOT be logged as unmapped
    await app.inject({
      method: 'POST',
      url: `/users/${userId}/transactions`,
      payload: { merchant: 'KFC', amountPaise: 40000, ref: 'known1' },
    });

    const res = await app.inject({ method: 'GET', url: '/admin/unmapped-merchants?limit=500' });
    expect(res.statusCode).toBe(200);
    const rows = res.json().unmapped as Array<{ sample: string; hits: number }>;
    const row = rows.find((r) => r.sample === unique);
    expect(row?.hits).toBe(3);
    expect(rows.find((r) => r.sample === 'KFC')).toBeFalsy();
  });
});

describe('API — batch sweep', () => {
  it('buys a whole share when a balance covers one (e.g. after a price drop)', async () => {
    const prices = new MutablePrices();
    prices.set('ETERNAL', 30000); // ₹300 — above what we will accumulate
    const sweepApp = await buildServer({ store: new InMemoryStore(prices) });
    await sweepApp.ready();
    try {
      const userId = (
        await sweepApp.inject({
          method: 'POST',
          url: '/users',
          payload: { roundup: { type: 'fixed', valuePaise: 2500 } },
        })
      ).json().userId as string;

      // 11 × ₹25 = ₹275 into ETERNAL (Zomato), below ₹300 -> no buy yet.
      for (let i = 0; i < 11; i++) {
        await sweepApp.inject({
          method: 'POST',
          url: `/users/${userId}/transactions`,
          payload: { merchant: 'Zomato', amountPaise: 32000, ref: `z${i}` },
        });
      }
      let port = (await sweepApp.inject({ method: 'GET', url: `/users/${userId}/portfolio` })).json();
      expect(port.holdings.length).toBe(0);

      // Price drops to ₹250 -> the ₹275 balance now covers one share. Sweep buys it.
      prices.set('ETERNAL', 25000);
      const sweep = (await sweepApp.inject({ method: 'POST', url: '/admin/run-sweep' })).json();
      expect(sweep.bought).toBe(1);
      expect(sweep.buys[0]).toEqual(expect.objectContaining({ symbol: 'ETERNAL', qty: 1 }));

      port = (await sweepApp.inject({ method: 'GET', url: `/users/${userId}/portfolio` })).json();
      expect(port.holdings).toContainEqual(expect.objectContaining({ symbol: 'ETERNAL', qty: 1 }));

      // Running again buys nothing more (balance now below one share).
      const again = (await sweepApp.inject({ method: 'POST', url: '/admin/run-sweep' })).json();
      expect(again.bought).toBe(0);
    } finally {
      await sweepApp.close();
    }
  });
});
