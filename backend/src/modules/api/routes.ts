/**
 * HTTP API for the core loop.
 *
 *   POST /users                      -> create a user (round-up rule + fallback)
 *   GET  /users/:id                  -> user config
 *   POST /users/:id/transactions     -> process one detected spend
 *   GET  /users/:id/portfolio        -> holdings + accumulating balances
 *
 * Uses the Postgres store when DATABASE_URL is set, else an in-memory store.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { toPaise, paiseToRupees, formatINR } from '../../lib/money.js';
import { env } from '../../config/env.js';
import { getPool } from '../../db/pool.js';
import { MockPriceProvider } from '../prices/priceProvider.js';
import type { SimConfig, SimEvent } from '../simulation/runSimulation.js';
import { InMemoryStore, type AccumulationStore } from './store.js';
import { PgStore } from './pgStore.js';

const prices = new MockPriceProvider();
const store: AccumulationStore = env.DATABASE_URL
  ? new PgStore(getPool(), prices)
  : new InMemoryStore(prices);

const createUserSchema = z
  .object({
    roundup: z
      .object({
        type: z.enum(['round_up_nearest', 'fixed']),
        valuePaise: z.number().int().positive(),
      })
      .optional(),
    fallbackSymbol: z.string().min(1).max(20).optional(),
  })
  .optional();

const txnSchema = z.object({
  merchant: z.string().min(1).max(140),
  amountPaise: z.number().int().positive(),
  ref: z.string().min(1).max(80),
});

function buildConfig(body: z.infer<typeof createUserSchema>): SimConfig {
  const r = body?.roundup;
  const rule =
    r?.type === 'fixed'
      ? ({ type: 'fixed', amountPaise: toPaise(r.valuePaise) } as const)
      : r?.type === 'round_up_nearest'
        ? ({ type: 'round_up_nearest', nearestPaise: toPaise(r.valuePaise) } as const)
        : ({ type: 'round_up_nearest', nearestPaise: toPaise(1000) } as const); // default ₹10
  return {
    rule,
    fallbackEtfSymbol: body?.fallbackSymbol ?? 'NIFTYBEES',
    fallbackName: 'Nifty 50 ETF (fallback)',
  };
}

function eventView(e: SimEvent) {
  return {
    ref: e.ref,
    merchant: e.merchant,
    target: { kind: e.kind, symbol: e.symbol, entityName: e.entityName },
    setAside: { paise: e.roundupPaise, display: formatINR(e.roundupPaise) },
    bought:
      e.boughtQty > 0
        ? { qty: e.boughtQty, costPaise: e.boughtCostPaise, costDisplay: formatINR(e.boughtCostPaise) }
        : null,
    balance: { paise: e.balancePaise, display: formatINR(e.balancePaise), rupees: paiseToRupees(e.balancePaise) },
    progressPct: e.progressPct,
  };
}

function configView(config: SimConfig) {
  return { fallbackSymbol: config.fallbackEtfSymbol, rule: config.rule };
}

export async function registerApiRoutes(app: FastifyInstance): Promise<void> {
  app.post('/users', async (req, reply) => {
    const parsed = createUserSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'invalid body', details: parsed.error.flatten() });
    const config = buildConfig(parsed.data);
    const userId = await store.createUser(config);
    reply.code(201);
    return { userId, config: configView(config) };
  });

  app.get('/users/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const config = await store.getUserConfig(id);
    if (!config) return reply.code(404).send({ error: 'user not found' });
    return { userId: id, config: configView(config) };
  });

  app.post('/users/:id/transactions', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = txnSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid body', details: parsed.error.flatten() });
    const body = parsed.data;

    const result = await store.processTransaction(id, {
      ref: body.ref,
      merchant: body.merchant,
      amountPaise: toPaise(body.amountPaise),
    });
    if (!result) return reply.code(404).send({ error: 'user not found' });

    if (!result.duplicate) reply.code(201);
    return { duplicate: result.duplicate, ...eventView(result.event) };
  });

  app.get('/users/:id/portfolio', async (req, reply) => {
    const { id } = req.params as { id: string };
    const portfolio = await store.getPortfolio(id);
    if (!portfolio) return reply.code(404).send({ error: 'user not found' });
    return {
      userId: portfolio.userId,
      holdings: portfolio.holdings,
      accumulating: portfolio.accumulating.map((a) => ({
        ...a,
        balanceDisplay: formatINR(toPaise(a.balancePaise)),
      })),
    };
  });
}
