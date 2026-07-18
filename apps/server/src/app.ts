/**
 * Fastify app factory. Wires plugins (cookies, CORS, rate-limit), the auth
 * resolver hook, and all route groups. Exported so tests can build an app
 * without listening on a port.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { env } from './env.js';
import { resolveAuth } from './http/context.js';
import { authRoutes } from './routes/auth.js';
import { credentialRoutes } from './routes/credentials.js';
import { worldRoutes } from './routes/worlds.js';
import { aiRoutes } from './routes/ai.js';
import { chatRoutes } from './routes/chats.js';
import { exportRoutes } from './routes/export.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
    trustProxy: true,
  });

  await app.register(cookie, { secret: env.sessionSecret });
  await app.register(cors, {
    origin: env.webOrigin,
    credentials: true,
  });
  await app.register(rateLimit, {
    global: false, // opt-in per route via config.rateLimit
    max: 100,
    timeWindow: '1 minute',
  });

  // Resolve the session on every request (sets request.auth if valid).
  app.addHook('preHandler', resolveAuth);

  app.get('/api/health', async () => ({ ok: true, storage: env.storageBackend }));

  await app.register(authRoutes);
  await app.register(credentialRoutes);
  await app.register(worldRoutes);
  await app.register(aiRoutes);
  await app.register(chatRoutes);
  await app.register(exportRoutes);

  return app;
}
