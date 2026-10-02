/**
 * HTTP API for the core loop (dev; backed by the in-memory store).
 *
 *   POST /users                      -> create a user (round-up rule + fallback)
 *   GET  /users/:id                  -> user config
 *   POST /users/:id/transactions     -> process one detected spend
 *   GET  /users/:id/portfolio        -> holdings + accumulating balances
 */
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { toPaise, paiseToRupees, formatINR } from '../../lib/money.js';
import { MockPriceProvider } from '../prices/priceProvider.js';
import { applyTransaction, type SimConfig, type SimEvent } from '../simulation/runSimulation.js';
import { InMemoryStore } from './store.js';

const prices = new MockPriceProvider();
const store = new InMemoryStore();

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

/** Shape a SimEvent into a clean API response. */
function eventView(e: SimEvent) {
  return {
    ref: e.ref,
    merchant: e.merchant,
    target: { kind: e.kind, symbol: e.symbol, entityName: e.entityName },
    setAside: { paise: e.roundupPaise, display: formatINR(e.roundupPaise) },
    bought: e.boughtQty > 0 ? { qty: e.boughtQty, costPaise: e.boughtCostPaise, costDisplay: formatINR(e.boughtCostPaise) } : null,
    balance: { paise: e.balancePaise, display: formatINR(e.balancePaise), rupees: paiseToRupees(e.balancePaise) },
    progressPct: e.progressPct,
  };
}

export async function registerApiRoutes(app: FastifyInstance): Promise<void> {
  app.post('/users', async (req, reply) => {
    const parsed = createUserSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'invalid body', details: parsed.error.flatten() });
    const userId = randomUUID();
    const user = store.createUser(userId, buildConfig(parsed.data));
    reply.code(201);
    return { userId, config: { fallbackSymbol: user.config.fallbackEtfSymbol, rule: user.config.rule } };
  });

  app.get('/users/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const user = store.getUser(id);
    if (!user) return reply.code(404).send({ error: 'user not found' });
    return { userId: user.userId, config: { fallbackSymbol: user.config.fallbackEtfSymbol, rule: user.config.rule } };
  });

  app.post('/users/:id/transactions', async (req, reply) => {
    const { id } = req.params as { id: string };
    const user = store.getUser(id);
    if (!user) return reply.code(404).send({ error: 'user not found' });

    const parsed = txnSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid body', details: parsed.error.flatten() });
    const body = parsed.data;

    // Idempotency: the same (ref) is processed at most once.
    const prior = user.processed.get(body.ref);
    if (prior) return { duplicate: true, ...eventView(prior) };

    const event = applyTransaction(
      user.state,
      { ref: body.ref, merchant: body.merchant, amountPaise: toPaise(body.amountPaise) },
      user.config,
      prices,
    );
    user.processed.set(body.ref, event);
    reply.code(201);
    return { duplicate: false, ...eventView(event) };
  });

  app.get('/users/:id/portfolio', async (req, reply) => {
    const { id } = req.params as { id: string };
    const user = store.getUser(id);
    if (!user) return reply.code(404).send({ error: 'user not found' });

    const { holdings, balances, names } = user.state;
    return {
      userId: user.userId,
      holdings: [...holdings.entries()].map(([symbol, qty]) => ({
        symbol,
        name: names.get(symbol) ?? symbol,
        qty,
      })),
      accumulating: [...balances.entries()]
        .filter(([, bal]) => bal > 0)
        .map(([symbol, bal]) => ({
          symbol,
          name: names.get(symbol) ?? symbol,
          balancePaise: bal,
          balanceDisplay: formatINR(bal),
        })),
    };
  });
}
