/** Fastify app factory. Kept separate from bootstrap so tests can import it. */
import Fastify, { type FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import { env } from './config/env.js';

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

  return app;
}
