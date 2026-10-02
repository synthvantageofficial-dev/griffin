import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildServer();
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
