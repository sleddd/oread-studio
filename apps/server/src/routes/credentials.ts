/**
 * Credential management routes. Metadata in/out only — plaintext keys are
 * accepted on create (sealed immediately) and NEVER returned.
 */
import type { FastifyInstance } from 'fastify';
import type { Provider } from '@oread/shared';
import {
  listCredentials,
  createCredential,
  deleteCredential,
} from '../credentials/store.js';

const PROVIDERS: Provider[] = ['anthropic', 'openai', 'bedrock', 'cloudflare', 'local'];

interface CreateBody {
  provider: Provider;
  label: string;
  secret?: string;
  accountId?: string;
  region?: string;
  baseUrl?: string;
}

export async function credentialRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/credentials', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthenticated' });
    const rows = await listCredentials({ schemaName: req.auth.user.schemaName });
    return reply.send({ credentials: rows });
  });

  app.post<{ Body: CreateBody }>('/api/credentials', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthenticated' });
    const body = req.body ?? ({} as CreateBody);
    if (!PROVIDERS.includes(body.provider)) {
      return reply.code(400).send({ error: 'invalid provider' });
    }
    if (!body.label) return reply.code(400).send({ error: 'label required' });
    if (body.provider !== 'local' && !body.secret) {
      return reply.code(400).send({ error: 'secret required for this provider' });
    }
    try {
      const meta = await createCredential(
        { schemaName: req.auth.user.schemaName },
        {
          provider: body.provider,
          label: body.label,
          secret: body.secret ?? '',
          accountId: body.accountId,
          region: body.region,
          baseUrl: body.baseUrl,
        },
      );
      return reply.code(201).send({ credential: meta });
    } catch (e: unknown) {
      if (
        typeof e === 'object' && e !== null && 'code' in e &&
        (e as { code?: string }).code === '23505'
      ) {
        return reply.code(409).send({ error: 'a credential with that label exists' });
      }
      req.log.error(e);
      return reply.code(500).send({ error: 'failed to store credential' });
    }
  });

  app.delete<{ Params: { id: string } }>('/api/credentials/:id', async (req, reply) => {
    if (!req.auth) return reply.code(401).send({ error: 'unauthenticated' });
    await deleteCredential({ schemaName: req.auth.user.schemaName }, req.params.id);
    return reply.send({ ok: true });
  });
}
