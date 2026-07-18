/**
 * World + manuscript + chapter CRUD. World writes are explicit (Save World).
 * Chapter content writes are the autosave target. Validation runs on world
 * load and save.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { WorldDocument, WritingFormat, ChapterStatusDb } from '@oread/shared';
import { getStore } from '../storage/index.js';
import { emptyWorld } from '../world/factory.js';
import { validateWorld, WorldValidationError } from '../world/validate.js';

function ctxOf(req: FastifyRequest): { schemaName: string } {
  return { schemaName: req.auth!.user.schemaName };
}

function auth(req: FastifyRequest, reply: FastifyReply): boolean {
  if (!req.auth) {
    void reply.code(401).send({ error: 'unauthenticated' });
    return false;
  }
  return true;
}

export async function worldRoutes(app: FastifyInstance): Promise<void> {
  const store = getStore();

  // ── worlds ──
  app.get('/api/worlds', async (req, reply) => {
    if (!auth(req, reply)) return;
    return reply.send({ worlds: await store.listWorlds(ctxOf(req)) });
  });

  app.get<{ Params: { id: string } }>('/api/worlds/:id', async (req, reply) => {
    if (!auth(req, reply)) return;
    const doc = await store.getWorld(ctxOf(req), req.params.id);
    if (!doc) return reply.code(404).send({ error: 'world not found' });
    try {
      validateWorld(doc);
    } catch (e) {
      if (e instanceof WorldValidationError) {
        return reply.code(422).send({ error: 'stored world is invalid', details: e.errors });
      }
      throw e;
    }
    return reply.send({ world: doc });
  });

  app.post<{ Body: { name?: string } }>('/api/worlds', async (req, reply) => {
    if (!auth(req, reply)) return;
    const doc = emptyWorld(req.body?.name ?? 'Untitled World');
    validateWorld(doc);
    const id = await store.createWorld(ctxOf(req), doc.world.identity.name, doc);
    // Seed the first manuscript + chapter (mirrors the prototype's newWorld).
    const ms = await store.createManuscript(ctxOf(req), id, { name: 'Untitled Manuscript', format: 'novel' });
    await store.createChapter(ctxOf(req), id, ms.id, { chapterId: 'ch_001', status: 'outline' });
    return reply.code(201).send({ id });
  });

  app.put<{ Params: { id: string }; Body: { world: WorldDocument } }>(
    '/api/worlds/:id',
    async (req, reply) => {
      if (!auth(req, reply)) return;
      const doc = req.body?.world;
      try {
        validateWorld(doc);
      } catch (e) {
        if (e instanceof WorldValidationError) {
          return reply.code(422).send({ error: 'world is invalid', details: e.errors });
        }
        throw e;
      }
      await store.saveWorld(ctxOf(req), req.params.id, doc);
      return reply.send({ ok: true });
    },
  );

  app.delete<{ Params: { id: string } }>('/api/worlds/:id', async (req, reply) => {
    if (!auth(req, reply)) return;
    await store.deleteWorld(ctxOf(req), req.params.id);
    return reply.send({ ok: true });
  });

  app.post<{ Params: { id: string }; Body: { reason?: string } }>(
    '/api/worlds/:id/snapshot',
    async (req, reply) => {
      if (!auth(req, reply)) return;
      await store.snapshotWorld(ctxOf(req), req.params.id, 'manual');
      return reply.send({ ok: true });
    },
  );

  // ── manuscripts ──
  app.get<{ Params: { id: string } }>('/api/worlds/:id/manuscripts', async (req, reply) => {
    if (!auth(req, reply)) return;
    return reply.send({ manuscripts: await store.listManuscripts(ctxOf(req), req.params.id) });
  });

  app.post<{ Params: { id: string }; Body: { name?: string; format?: WritingFormat } }>(
    '/api/worlds/:id/manuscripts',
    async (req, reply) => {
      if (!auth(req, reply)) return;
      const ms = await store.createManuscript(ctxOf(req), req.params.id, {
        name: req.body?.name,
        format: req.body?.format,
      });
      // seed a first chapter
      await store.createChapter(ctxOf(req), req.params.id, ms.id, { chapterId: 'ch_001', status: 'outline' });
      return reply.code(201).send({ manuscript: ms });
    },
  );

  app.patch<{ Params: { mid: string }; Body: { name?: string; format?: WritingFormat; order?: number } }>(
    '/api/manuscripts/:mid',
    async (req, reply) => {
      if (!auth(req, reply)) return;
      await store.updateManuscript(ctxOf(req), req.params.mid, req.body ?? {});
      return reply.send({ ok: true });
    },
  );

  app.delete<{ Params: { mid: string } }>('/api/manuscripts/:mid', async (req, reply) => {
    if (!auth(req, reply)) return;
    await store.deleteManuscript(ctxOf(req), req.params.mid);
    return reply.send({ ok: true });
  });

  // ── chapters ──
  app.get<{ Params: { mid: string } }>('/api/manuscripts/:mid/chapters', async (req, reply) => {
    if (!auth(req, reply)) return;
    return reply.send({ chapters: await store.listChapters(ctxOf(req), req.params.mid) });
  });

  app.post<{ Params: { id: string; mid: string }; Body: { chapterId: string; content?: string; status?: ChapterStatusDb } }>(
    '/api/worlds/:id/manuscripts/:mid/chapters',
    async (req, reply) => {
      if (!auth(req, reply)) return;
      const ch = await store.createChapter(ctxOf(req), req.params.id, req.params.mid, {
        chapterId: req.body?.chapterId ?? `ch_${Date.now()}`,
        content: req.body?.content,
        status: req.body?.status,
      });
      return reply.code(201).send({ chapter: ch });
    },
  );

  app.get<{ Params: { cid: string } }>('/api/chapters/:cid', async (req, reply) => {
    if (!auth(req, reply)) return;
    const ch = await store.getChapter(ctxOf(req), req.params.cid);
    if (!ch) return reply.code(404).send({ error: 'chapter not found' });
    return reply.send({ chapter: ch });
  });

  // Autosave / manual save of chapter prose.
  app.put<{ Params: { cid: string }; Body: { content: string } }>(
    '/api/chapters/:cid/content',
    async (req, reply) => {
      if (!auth(req, reply)) return;
      const ch = await store.saveChapterContent(ctxOf(req), req.params.cid, req.body?.content ?? '', 'autosave');
      return reply.send({ chapter: ch });
    },
  );

  app.patch<{ Params: { cid: string }; Body: { status?: ChapterStatusDb; order?: number; chapter_id?: string } }>(
    '/api/chapters/:cid',
    async (req, reply) => {
      if (!auth(req, reply)) return;
      await store.updateChapterMeta(ctxOf(req), req.params.cid, req.body ?? {});
      return reply.send({ ok: true });
    },
  );

  app.delete<{ Params: { cid: string } }>('/api/chapters/:cid', async (req, reply) => {
    if (!auth(req, reply)) return;
    await store.deleteChapter(ctxOf(req), req.params.cid);
    return reply.send({ ok: true });
  });

  app.get<{ Params: { cid: string } }>('/api/chapters/:cid/revisions', async (req, reply) => {
    if (!auth(req, reply)) return;
    return reply.send({ revisions: await store.listChapterRevisions(ctxOf(req), req.params.cid) });
  });
}
