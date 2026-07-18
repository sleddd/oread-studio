/**
 * Auth routes: signup, login (with optional TOTP), logout, me, and TOTP
 * enable/disable. Rate limiting is applied to the sensitive endpoints.
 */
import type { FastifyInstance } from 'fastify';
import { env } from '../env.js';
import { SESSION_COOKIE } from '../http/context.js';
import {
  signup,
  verifyCredentials,
  createSession,
  revokeSession,
  touchLastLogin,
  changePassword,
  SignupError,
  SignupForbiddenError,
  PasswordChangeError,
  findUserById,
} from '../auth/accounts.js';
import {
  generateTotpSecret,
  enableTotp,
  disableTotp,
  verifyStoredTotp,
} from '../auth/totp.js';

interface SignupBody {
  email: string;
  name: string;
  password: string;
}
interface LoginBody {
  email: string;
  password: string;
  totp?: string;
}

function setSessionCookie(reply: import('fastify').FastifyReply, raw: string) {
  reply.setCookie(SESSION_COOKIE, raw, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: 'lax',
    path: '/',
    maxAge: env.sessionTtlDays * 24 * 60 * 60,
  });
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // Tighter rate limit on auth mutations.
  const authLimit = {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  };

  app.post<{ Body: SignupBody }>('/api/auth/signup', authLimit, async (req, reply) => {
    const { email, name, password } = req.body ?? ({} as SignupBody);
    if (typeof password !== 'string' || password.length < 8) {
      return reply.code(400).send({ error: 'password must be at least 8 characters' });
    }
    try {
      const user = await signup({ email, name, password });
      const raw = await createSession(user.id);
      setSessionCookie(reply, raw);
      return reply.code(201).send({ user });
    } catch (e) {
      if (e instanceof SignupForbiddenError) return reply.code(403).send({ error: e.message });
      if (e instanceof SignupError) return reply.code(409).send({ error: e.message });
      req.log.error(e);
      return reply.code(500).send({ error: 'signup failed' });
    }
  });

  app.post<{ Body: LoginBody }>('/api/auth/login', authLimit, async (req, reply) => {
    const { email, password, totp } = req.body ?? ({} as LoginBody);
    const user = await verifyCredentials(email ?? '', password ?? '');
    if (!user) return reply.code(401).send({ error: 'invalid email or password' });

    if (user.totp_enabled) {
      if (!totp) return reply.code(401).send({ error: 'totp_required', totpRequired: true });
      if (!user.totp_secret || !verifyStoredTotp(user.totp_secret, totp)) {
        return reply.code(401).send({ error: 'invalid totp code' });
      }
    }

    const raw = await createSession(user.id);
    setSessionCookie(reply, raw);
    await touchLastLogin(user.id);
    return reply.send({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        schemaName: user.schema_name,
        totpEnabled: user.totp_enabled,
      },
    });
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const raw = req.cookies?.[SESSION_COOKIE];
    if (raw) await revokeSession(raw);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.send({ ok: true });
  });

  app.get('/api/auth/me', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthenticated' });
    return reply.send({ user: req.auth.user });
  });

  app.post<{ Body: { currentPassword: string; newPassword: string } }>(
    '/api/auth/change-password',
    authLimit,
    async (req, reply) => {
      if (!req.auth) return reply.code(401).send({ error: 'unauthenticated' });
      const { currentPassword, newPassword } = req.body ?? ({} as { currentPassword: string; newPassword: string });
      try {
        await changePassword({
          userId: req.auth.user.id,
          currentPassword: currentPassword ?? '',
          newPassword: newPassword ?? '',
          keepSessionId: req.auth.sessionId,
        });
        return reply.send({ ok: true });
      } catch (e) {
        if (e instanceof PasswordChangeError) return reply.code(400).send({ error: e.message });
        req.log.error(e);
        return reply.code(500).send({ error: 'failed to change password' });
      }
    },
  );

  // ─── TOTP management (must be authenticated) ───
  app.post('/api/auth/totp/setup', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthenticated' });
    const { secretBase32, otpauthUri } = generateTotpSecret(req.auth.user.email);
    // Secret is returned once for the client to confirm; not yet persisted.
    return reply.send({ secretBase32, otpauthUri });
  });

  app.post<{ Body: { secretBase32: string; code: string } }>(
    '/api/auth/totp/enable',
    authLimit,
    async (req, reply) => {
      if (!req.auth) return reply.code(401).send({ error: 'unauthenticated' });
      const { secretBase32, code } = req.body ?? ({} as { secretBase32: string; code: string });
      const ok = await enableTotp(req.auth.user.id, secretBase32, code);
      if (!ok) return reply.code(400).send({ error: 'invalid code' });
      return reply.send({ ok: true });
    },
  );

  app.post('/api/auth/totp/disable', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthenticated' });
    await disableTotp(req.auth.user.id);
    return reply.send({ ok: true });
  });

  // Prevent unused import warning under noUnusedLocals in some configs.
  void findUserById;
}
