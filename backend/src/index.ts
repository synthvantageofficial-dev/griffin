/** Bootstrap: build the server and start listening. */
import { buildServer } from './server.js';
import { env } from './config/env.js';

async function main(): Promise<void> {
  const app = await buildServer();
  try {
    await app.listen({ host: env.HOST, port: env.PORT });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  // Graceful shutdown.
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, async () => {
      app.log.info(`Received ${signal}, shutting down…`);
      await app.close();
      process.exit(0);
    });
  }
}

void main();
