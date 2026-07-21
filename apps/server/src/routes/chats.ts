/**
 * Chat routes. Chats are client-state until explicitly saved (no autosave).
 * On save we persist the transcript, then run the distillation pass:
 * snapshot the world (pre_ai_write), append extracted events, save the world,
 * and only THEN mark the chat distilled — so a crash mid-distill is restartable
 * (the chat stays distilled=false and can be re-distilled).
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { PersistedChatMode, ChatMessage } from '@oread/shared';
import { getStore } from '../storage/index.js';
import { distillChat } from '../ai/distill.js';

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
  chapterContext?: string;
  /** if false, skip distillation (default true) */
  distill?: boolean;
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

    let newEvents = 0;
    if (body.distill !== false) {
      const world = await store.getWorld(ctxOf(req), body.worldId);
      if (world) {
        // Snapshot world before the AI-initiated memory mutation.
        await store.snapshotWorld(ctxOf(req), body.worldId, 'pre_ai_write');
        const events = await distillChat({
          ctx: ctxOf(req),
          world,
          mode: body.mode,
          messages: body.messages,
          chapterContext: body.chapterContext ?? '',
        });
        if (events.length > 0) {
          await store.saveWorld(ctxOf(req), body.worldId, world);
        }
        // Mark distilled only AFTER the world write succeeded (restartable).
        await store.markChatDistilled(ctxOf(req), chat.id);
        newEvents = events.length;
      }
    }

    return reply.code(201).send({ chat: { ...chat, distilled: body.distill !== false }, newEvents });
  });

  // Re-run distillation for a saved chat that wasn't distilled (restartable).
  app.post<{ Params: { cid: string } }>('/api/chats/:cid/distill', async (req, reply) => {
    if (!auth(req, reply)) return;
    const chat = await store.getChat(ctxOf(req), req.params.cid);
    if (!chat) return reply.code(404).send({ error: 'chat not found' });
    if (chat.distilled) return reply.send({ ok: true, newEvents: 0, alreadyDistilled: true });

    const world = await store.getWorld(ctxOf(req), chat.world_id);
    if (!world) return reply.code(404).send({ error: 'world not found' });
    await store.snapshotWorld(ctxOf(req), chat.world_id, 'pre_ai_write');
    const events = await distillChat({
      ctx: ctxOf(req),
      world,
      mode: chat.mode,
      messages: chat.messages,
      chapterContext: '',
    });
    if (events.length > 0) await store.saveWorld(ctxOf(req), chat.world_id, world);
    await store.markChatDistilled(ctxOf(req), chat.id);
    return reply.send({ ok: true, newEvents: events.length });
  });
}
