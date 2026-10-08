/**
 * HTTP API for the core loop, with auth.
 *
 *   POST /auth/signup                -> create account (email+password) -> token
 *   POST /auth/login                 -> token
 *   GET  /me                         -> my config            (Bearer token)
 *   POST /me/transactions            -> process one spend    (Bearer token)
 *   GET  /me/portfolio               -> my holdings/balances (Bearer token)
 *   GET  /admin/unmapped-merchants   -> ops (x-admin-key)
 *   POST /admin/run-sweep            -> ops (x-admin-key)
 *
 * Users only ever touch their OWN data (userId comes from the token, not the URL).
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { toPaise, paiseToRupees, formatINR } from '../../lib/money.js';
import { env } from '../../config/env.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { signToken, verifyToken } from '../auth/jwt.js';
import type { SimConfig, SimEvent } from '../simulation/runSimulation.js';
import type { AccumulationStore } from './store.js';

const roundupSchema = z
  .object({ type: z.enum(['round_up_nearest', 'fixed']), valuePaise: z.number().int().positive() })
  .optional();

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
  roundup: roundupSchema,
  fallbackSymbol: z.string().min(1).max(20).optional(),
});

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1).max(200) });

const txnSchema = z.object({
  merchant: z.string().min(1).max(140),
  amountPaise: z.number().int().positive(),
  ref: z.string().min(1).max(80),
});

const consentSchema = z.object({
  type: z.enum(['terms', 'kyc', 'txn_data', 'marketing']),
  granted: z.boolean(),
  version: z.string().min(1).max(20).default('v1'),
});

function buildConfig(body: { roundup?: z.infer<typeof roundupSchema>; fallbackSymbol?: string | undefined }): SimConfig {
  const r = body.roundup;
  const rule =
    r?.type === 'fixed'
      ? ({ type: 'fixed', amountPaise: toPaise(r.valuePaise) } as const)
      : r?.type === 'round_up_nearest'
        ? ({ type: 'round_up_nearest', nearestPaise: toPaise(r.valuePaise) } as const)
        : ({ type: 'round_up_nearest', nearestPaise: toPaise(1000) } as const); // default ₹10
  return {
    rule,
    fallbackEtfSymbol: body.fallbackSymbol ?? 'NIFTYBEES',
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

/** Returns the authenticated userId from a Bearer token, or null. */
function bearerUserId(req: FastifyRequest): string | null {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  return verifyToken(auth.slice(7));
}

function isAdmin(req: FastifyRequest): boolean {
  return req.headers['x-admin-key'] === env.ADMIN_API_KEY;
}

export async function registerApiRoutes(app: FastifyInstance, store: AccumulationStore): Promise<void> {
  // ---- Auth ----
  app.post('/auth/signup', async (req, reply) => {
    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid body', details: parsed.error.flatten() });
    const { email, password } = parsed.data;
    const config = buildConfig(parsed.data);
    const passwordHash = await hashPassword(password);
    const result = await store.createUser({ email, passwordHash, config });
    if ('error' in result) return reply.code(409).send({ error: 'email already registered' });
    reply.code(201);
    return { userId: result.userId, token: signToken(result.userId), config: configView(config) };
  });

  app.post('/auth/login', async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid body' });
    const creds = await store.findByEmail(parsed.data.email);
    // Verify even when the user is missing would be ideal (timing); kept simple here.
    if (!creds || !(await verifyPassword(parsed.data.password, creds.passwordHash))) {
      return reply.code(401).send({ error: 'invalid email or password' });
    }
    return { userId: creds.userId, token: signToken(creds.userId) };
  });

  // ---- Authenticated user routes (userId from token) ----
  const requireUser = (req: FastifyRequest, reply: FastifyReply): string | null => {
    const userId = bearerUserId(req);
    if (!userId) {
      reply.code(401).send({ error: 'unauthorized' });
      return null;
    }
    return userId;
  };

  app.get('/me', async (req, reply) => {
    const userId = requireUser(req, reply);
    if (!userId) return;
    const config = await store.getUserConfig(userId);
    if (!config) return reply.code(404).send({ error: 'user not found' });
    return { userId, config: configView(config) };
  });

  app.post('/me/transactions', async (req, reply) => {
    const userId = requireUser(req, reply);
    if (!userId) return;
    const parsed = txnSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid body', details: parsed.error.flatten() });
    const b = parsed.data;
    const result = await store.processTransaction(userId, {
      ref: b.ref,
      merchant: b.merchant,
      amountPaise: toPaise(b.amountPaise),
    });
    if (!result) return reply.code(404).send({ error: 'user not found' });
    if (!result.duplicate) reply.code(201);
    return { duplicate: result.duplicate, ...eventView(result.event) };
  });

  app.get('/me/portfolio', async (req, reply) => {
    const userId = requireUser(req, reply);
    if (!userId) return;
    const portfolio = await store.getPortfolio(userId);
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

  // ---- DPDP consents (the user's own) ----
  app.get('/me/consents', async (req, reply) => {
    const userId = requireUser(req, reply);
    if (!userId) return;
    const consents = await store.getConsents(userId);
    if (!consents) return reply.code(404).send({ error: 'user not found' });
    return { consents };
  });

  app.post('/me/consents', async (req, reply) => {
    const userId = requireUser(req, reply);
    if (!userId) return;
    const parsed = consentSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid body', details: parsed.error.flatten() });
    const consents = await store.recordConsent(userId, parsed.data.type, parsed.data.granted, parsed.data.version);
    if (!consents) return reply.code(404).send({ error: 'user not found' });
    return { consents };
  });

  // ---- Audit: the user's own money trail ----
  app.get('/me/activity', async (req, reply) => {
    const userId = requireUser(req, reply);
    if (!userId) return;
    const q = req.query as { limit?: string };
    const limit = Math.min(Math.max(Number(q.limit) || 100, 1), 500);
    const activity = await store.getActivity(userId, limit);
    if (!activity) return reply.code(404).send({ error: 'user not found' });
    return {
      activity: activity.map((a) => ({ ...a, display: formatINR(toPaise(a.amountPaise)) })),
    };
  });

  // ---- Admin (x-admin-key) ----
  app.get('/admin/reconcile', async (req, reply) => {
    if (!isAdmin(req)) return reply.code(401).send({ error: 'unauthorized' });
    const report = await store.reconcile();
    return { ok: report.discrepancies.length === 0, ...report };
  });

  app.get('/admin/unmapped-merchants', async (req, reply) => {
    if (!isAdmin(req)) return reply.code(401).send({ error: 'unauthorized' });
    const q = req.query as { limit?: string };
    const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 500);
    return { unmapped: await store.topUnmapped(limit) };
  });

  app.post('/admin/run-sweep', async (req, reply) => {
    if (!isAdmin(req)) return reply.code(401).send({ error: 'unauthorized' });
    const buys = await store.runSweep();
    return { bought: buys.length, buys };
  });
}
