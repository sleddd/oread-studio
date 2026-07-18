/**
 * Export routes. world.json is a first-class download; the full export lists
 * everything in the user's world for portability. Never emits key material.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getStore } from '../storage/index.js';
import { buildWorldExport } from '../export/world-export.js';

function ctxOf(req: FastifyRequest) {
  return { schemaName: req.auth!.user.schemaName };
}
function auth(req: FastifyRequest, reply: FastifyReply): boolean {
  if (!req.auth) {
    void reply.code(401).send({ error: 'unauthenticated' });
    return false;
  }
  return true;
}

export async function exportRoutes(app: FastifyInstance): Promise<void> {
  const store = getStore();

  app.get<{ Params: { id: string } }>('/api/worlds/:id/export', async (req, reply) => {
    if (!auth(req, reply)) return;
    const data = await buildWorldExport(store, ctxOf(req), req.params.id);
    if (!data) return reply.code(404).send({ error: 'world not found' });
    const filename = `${data.world.world.identity.name.replace(/[^\w.-]+/g, '_') || 'world'}.oread.json`;
    reply.header('content-type', 'application/json');
    reply.header('content-disposition', `attachment; filename="${filename}"`);
    return reply.send(data);
  });
}
