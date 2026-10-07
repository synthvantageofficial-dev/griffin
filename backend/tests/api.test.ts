import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { InMemoryStore } from '../src/modules/api/store.js';
import { MockPriceProvider, type PriceProvider } from '../src/modules/prices/priceProvider.js';
import { toPaise, type Paise } from '../src/lib/money.js';

const ADMIN = { 'x-admin-key': 'dev-admin-key-change-me' };

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
let emailCounter = 0;

beforeAll(async () => {
  app = await buildServer({ store: new InMemoryStore(new MockPriceProvider()) });
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

async function signup(roundup?: { type: 'round_up_nearest' | 'fixed'; valuePaise: number }) {
  emailCounter += 1;
  const email = `u${emailCounter}@test.com`;
  const res = await app.inject({
    method: 'POST',
    url: '/auth/signup',
    payload: { email, password: 'password123', ...(roundup ? { roundup } : {}) },
  });
  const body = res.json();
  return { email, userId: body.userId as string, auth: { authorization: `Bearer ${body.token}` } };
}

describe('auth', () => {
  it('signs up and returns a token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { email: 'alice@test.com', password: 'password123' },
    });
    expect(res.statusCode).toBe(201);
    const b = res.json();
    expect(b.userId).toBeTruthy();
    expect(b.token).toBeTruthy();
    expect(b.config.rule).toEqual({ type: 'round_up_nearest', nearestPaise: 1000 });
  });

  it('rejects duplicate email (409) and weak/invalid input (400)', async () => {
    await app.inject({ method: 'POST', url: '/auth/signup', payload: { email: 'dup@test.com', password: 'password123' } });
    const dup = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email: 'dup@test.com', password: 'password123' } });
    expect(dup.statusCode).toBe(409);
    const weak = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email: 'x@test.com', password: 'short' } });
    expect(weak.statusCode).toBe(400);
    const bademail = await app.inject({ method: 'POST', url: '/auth/signup', payload: { email: 'not-an-email', password: 'password123' } });
    expect(bademail.statusCode).toBe(400);
  });

  it('logs in with correct password, rejects wrong', async () => {
    await app.inject({ method: 'POST', url: '/auth/signup', payload: { email: 'bob@test.com', password: 'secretpass1' } });
    const ok = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'bob@test.com', password: 'secretpass1' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().token).toBeTruthy();
    const bad = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'bob@test.com', password: 'wrong' } });
    expect(bad.statusCode).toBe(401);
    const missing = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'nobody@test.com', password: 'whatever1' } });
    expect(missing.statusCode).toBe(401);
  });
});

describe('protected routes require a token', () => {
  it('401 without a token', async () => {
    expect((await app.inject({ method: 'GET', url: '/me' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/me/portfolio' })).statusCode).toBe(401);
    const noauthTxn = await app.inject({
      method: 'POST',
      url: '/me/transactions',
      payload: { merchant: 'KFC', amountPaise: 40000, ref: 'n1' },
    });
    expect(noauthTxn.statusCode).toBe(401);
  });

  it('401 with a garbage token', async () => {
    const res = await app.inject({ method: 'GET', url: '/me', headers: { authorization: 'Bearer not.a.jwt' } });
    expect(res.statusCode).toBe(401);
  });
});

describe('transactions + portfolio (authenticated)', () => {
  it('processes a spend and buys a cheap share', async () => {
    const { auth } = await signup({ type: 'fixed', valuePaise: 2500 });
    const res = await app.inject({
      method: 'POST',
      url: '/me/transactions',
      headers: auth,
      payload: { merchant: 'Vodafone Idea Recharge', amountPaise: 29900, ref: 'v1' },
    });
    expect(res.statusCode).toBe(201);
    const b = res.json();
    expect(b.target.symbol).toBe('IDEA');
    expect(b.bought).toEqual(expect.objectContaining({ qty: 2 }));

    const port = await app.inject({ method: 'GET', url: '/me/portfolio', headers: auth });
    expect(port.json().holdings).toContainEqual({ symbol: 'IDEA', name: 'Vodafone Idea', qty: 2 });
  });

  it('is idempotent on repeated ref', async () => {
    const { auth } = await signup({ type: 'fixed', valuePaise: 2500 });
    const payload = { merchant: 'KFC', amountPaise: 40000, ref: 'k1' };
    const first = await app.inject({ method: 'POST', url: '/me/transactions', headers: auth, payload });
    const second = await app.inject({ method: 'POST', url: '/me/transactions', headers: auth, payload });
    expect(first.json().duplicate).toBe(false);
    expect(second.json().duplicate).toBe(true);
    expect(second.json().balance.paise).toBe(first.json().balance.paise);
  });

  it('keeps each user separate', async () => {
    const a = await signup({ type: 'fixed', valuePaise: 2500 });
    const b = await signup({ type: 'fixed', valuePaise: 2500 });
    await app.inject({ method: 'POST', url: '/me/transactions', headers: a.auth, payload: { merchant: 'Zomato', amountPaise: 32000, ref: 'z1' } });
    const bPort = await app.inject({ method: 'GET', url: '/me/portfolio', headers: b.auth });
    expect(bPort.json().accumulating.length).toBe(0); // user B untouched by user A's spend
  });

  it('routes an unknown merchant to the fallback ETF', async () => {
    const { auth } = await signup({ type: 'fixed', valuePaise: 2500 });
    const res = await app.inject({
      method: 'POST',
      url: '/me/transactions',
      headers: auth,
      payload: { merchant: 'Sharma General Store', amountPaise: 24000, ref: 's1' },
    });
    expect(res.json().target.symbol).toBe('NIFTYBEES');
  });
});

describe('admin routes (x-admin-key)', () => {
  it('401 without the admin key', async () => {
    expect((await app.inject({ method: 'GET', url: '/admin/unmapped-merchants' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/admin/run-sweep', payload: {} })).statusCode).toBe(401);
  });

  it('logs unknown merchants with hit counts, not known ones', async () => {
    const { auth } = await signup();
    const unique = 'Qwerty Unique Store XYZ';
    for (const ref of ['uq1', 'uq2', 'uq3']) {
      await app.inject({ method: 'POST', url: '/me/transactions', headers: auth, payload: { merchant: unique, amountPaise: 15700, ref } });
    }
    await app.inject({ method: 'POST', url: '/me/transactions', headers: auth, payload: { merchant: 'KFC', amountPaise: 40000, ref: 'known1' } });

    const res = await app.inject({ method: 'GET', url: '/admin/unmapped-merchants?limit=500', headers: ADMIN });
    expect(res.statusCode).toBe(200);
    const rows = res.json().unmapped as Array<{ sample: string; hits: number }>;
    expect(rows.find((r) => r.sample === unique)?.hits).toBe(3);
    expect(rows.find((r) => r.sample === 'KFC')).toBeFalsy();
  });
});

describe('batch sweep', () => {
  it('buys a whole share when a balance covers one (e.g. after a price drop)', async () => {
    const prices = new MutablePrices();
    prices.set('ETERNAL', 30000); // ₹300
    const sweepApp = await buildServer({ store: new InMemoryStore(prices) });
    await sweepApp.ready();
    try {
      const su = await sweepApp.inject({
        method: 'POST',
        url: '/auth/signup',
        payload: { email: 'sweep@test.com', password: 'password123', roundup: { type: 'fixed', valuePaise: 2500 } },
      });
      const auth = { authorization: `Bearer ${su.json().token}` };

      for (let i = 0; i < 11; i++) {
        await sweepApp.inject({ method: 'POST', url: '/me/transactions', headers: auth, payload: { merchant: 'Zomato', amountPaise: 32000, ref: `z${i}` } });
      }
      let port = (await sweepApp.inject({ method: 'GET', url: '/me/portfolio', headers: auth })).json();
      expect(port.holdings.length).toBe(0);

      prices.set('ETERNAL', 25000); // price drops -> the ₹275 balance now covers one share
      const sweep = (await sweepApp.inject({ method: 'POST', url: '/admin/run-sweep', headers: ADMIN, payload: {} })).json();
      expect(sweep.bought).toBe(1);
      expect(sweep.buys[0]).toEqual(expect.objectContaining({ symbol: 'ETERNAL', qty: 1 }));

      port = (await sweepApp.inject({ method: 'GET', url: '/me/portfolio', headers: auth })).json();
      expect(port.holdings).toContainEqual(expect.objectContaining({ symbol: 'ETERNAL', qty: 1 }));

      const again = (await sweepApp.inject({ method: 'POST', url: '/admin/run-sweep', headers: ADMIN, payload: {} })).json();
      expect(again.bought).toBe(0);
    } finally {
      await sweepApp.close();
    }
  });
});
