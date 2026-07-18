/**
 * Fastify app factory. Wires plugins (cookies, CORS, rate-limit), the auth
 * resolver hook, and all route groups. Exported so tests can build an app
 * without listening on a port.
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
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

  // ── Serve the built web app (single-service deploy) ──
  // Registered AFTER the API routes so /api/* always wins. Skipped when the
  // build isn't present (dev/tests run the web on Vite separately).
  const here = dirname(fileURLToPath(import.meta.url));
  const webDir = process.env.OREAD_WEB_DIR
    ? resolve(process.env.OREAD_WEB_DIR)
    : resolve(here, '../../web/dist');

  if (existsSync(join(webDir, 'index.html'))) {
    await app.register(fastifyStatic, { root: webDir, wildcard: false });
    // SPA fallback: any non-API GET that didn't match a file returns index.html
    // so client-side routing / deep links work.
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) {
        return reply.sendFile('index.html');
      }
      return reply.code(404).send({ error: 'not found' });
    });
    app.log.info(`serving web app from ${webDir}`);
  } else {
    app.log.info('web build not found — API only (run the web on Vite in dev)');
  }

  return app;
}
