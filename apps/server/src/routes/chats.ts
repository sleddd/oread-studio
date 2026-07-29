/**
 * Chat routes. Chats are client-state until explicitly saved (no autosave).
 * Saving persists the transcript and nothing else.
 *
 * There is deliberately NO distillation pass: the durable state is already
 * captured by the three explicit saves (manuscript prose, Save World, Save
 * Chat), so a model pass writing derived memory events on top was redundant —
 * and it wrote to world.memory.events on a chat save, which is a surprising
 * side effect for a button labelled "Save Chat". Memory events are authored
 * explicitly via Memory → + Event.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { PersistedChatMode, ChatMessage } from '@oread/shared';
import { getStore } from '../storage/index.js';

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

interface SaveChatBody {
  /** When set, update this existing chat in place (continued conversation). */
  chatId?: string;
  worldId: string;
  title: string | null;
  mode: PersistedChatMode;
  characterId: string | null;
  messages: ChatMessage[];
}

export async function chatRoutes(app: FastifyInstance): Promise<void> {
  const store = getStore();

  app.get<{ Params: { id: string } }>('/api/worlds/:id/chats', async (req, reply) => {
    if (!auth(req, reply)) return;
    return reply.send({ chats: await store.listChats(ctxOf(req), req.params.id) });
  });

  app.delete<{ Params: { cid: string } }>('/api/chats/:cid', async (req, reply) => {
    if (!auth(req, reply)) return;
    await store.deleteChat(ctxOf(req), req.params.cid);
    return reply.send({ ok: true });
  });

  app.post<{ Body: SaveChatBody }>('/api/chats', async (req, reply) => {
    if (!auth(req, reply)) return;
    const body = req.body;
    const chat = await store.saveChat(ctxOf(req), {
      chatId: body.chatId,
      worldId: body.worldId,
      title: body.title,
      mode: body.mode,
      characterId: body.characterId,
      messages: body.messages,
    });

    // Saving a chat touches the chat row only — it never writes the world.
    return reply.code(201).send({ chat });
  });
}
