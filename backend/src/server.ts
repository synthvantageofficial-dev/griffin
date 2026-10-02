/** Fastify app factory. Kept separate from bootstrap so tests can import it. */
import Fastify, { type FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import { env } from './config/env.js';
import { pingDb } from './db/pool.js';
import { registerApiRoutes } from './modules/api/routes.js';

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      ...(env.NODE_ENV === 'development'
        ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } }
        : {}),
    },
  });

  await app.register(helmet);

  // Liveness probe. Real business routes are added per module as we build.
  app.get('/health', async () => ({ status: 'ok', service: 'investing-app-backend', ts: new Date().toISOString() }));

  // DB connectivity probe.
  app.get('/health/db', async (_req, reply) => {
    if (!env.DATABASE_URL) return { status: 'not_configured' };
    try {
      const ok = await pingDb();
      return { status: ok ? 'ok' : 'error' };
    } catch (err) {
      reply.code(503);
      return { status: 'error', message: (err as Error).message };
    }
  });

  // Core-loop API (users, transactions, portfolio).
  await registerApiRoutes(app);

  return app;
}
