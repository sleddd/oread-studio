/**
 * Server entrypoint.
 */
import { buildApp } from './app.js';
import { env } from './env.js';
import { closePool } from './db/pool.js';

async function main(): Promise<void> {
  const app = await buildApp();
  const shutdown = async (signal: string) => {
    app.log.info(`received ${signal}, shutting down`);
    await app.close();
    await closePool();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: env.port, host: '0.0.0.0' });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
