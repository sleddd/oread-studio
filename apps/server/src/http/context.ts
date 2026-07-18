/**
 * Auth context: resolve the session cookie into a user, and a `requireAuth`
 * preHandler that 401s unauthenticated requests. Authenticated routes get
 * `request.auth` with the user + their schema name.
 */
import type { FastifyRequest, FastifyReply } from 'fastify';
import { validateSession, type SessionInfo } from '../auth/accounts.js';

export const SESSION_COOKIE = 'oread_session';

declare module 'fastify' {
  interface FastifyRequest {
    auth?: SessionInfo;
  }
}

export async function resolveAuth(request: FastifyRequest): Promise<void> {
  const raw = request.cookies?.[SESSION_COOKIE];
  if (!raw) return;
  const info = await validateSession(raw);
  if (info) request.auth = info;
}

export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!request.auth) {
    await reply.code(401).send({ error: 'unauthenticated' });
  }
}
