/**
 * World + manuscript + chapter CRUD. World writes are explicit (Save World).
 * Chapter content writes are the autosave target. Validation runs on world
 * load and save.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type {
  WorldDocument,
  WritingFormat,
  ChapterStatusDb,
  RevisionReason,
} from '@oread/shared';
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

  // Manuscripts with no world (detached).
  app.get('/api/manuscripts/unattached', async (req, reply) => {
    if (!auth(req, reply)) return;
    return reply.send({ manuscripts: await store.listUnattachedManuscripts(ctxOf(req)) });
  });

  // Reassign a manuscript to a world (or null to unattach). Moves the chapter
  // metadata (structure.chapters[]) from the source world doc into the target.
  app.post<{ Params: { mid: string }; Body: { worldId: string | null } }>(
    '/api/manuscripts/:mid/reassign',
    async (req, reply) => {
      if (!auth(req, reply)) return;
      const ctx = ctxOf(req);
      const targetWorldId = req.body?.worldId ?? null;
      const mid = req.params.mid;

      // Find the manuscript's current world + its chapters (to know which meta to move).
      const chapters = await store.listChapters(ctx, mid);
      const chapterIds = new Set(chapters.map((c) => c.chapter_id));
      const current = await store.getManuscript(ctx, mid);
      const sourceWorldId = current?.world_id ?? null;

      // 1. Pull chapter meta out of the source world doc (if attached).
      let movedMeta: unknown[] = [];
      if (sourceWorldId) {
        const srcDoc = await store.getWorld(ctx, sourceWorldId);
        if (srcDoc) {
          movedMeta = srcDoc.world.structure.chapters.filter((c) => chapterIds.has(c.id));
          srcDoc.world.structure.chapters = srcDoc.world.structure.chapters.filter(
            (c) => !chapterIds.has(c.id),
          );
          await store.saveWorld(ctx, sourceWorldId, srcDoc);
        }
      }

      // 2. Retag manuscript + chapters to the target world.
      await store.reassignManuscript(ctx, mid, targetWorldId);

      // 3. Push chapter meta into the target world doc (if attaching).
      if (targetWorldId && movedMeta.length > 0) {
        const dstDoc = await store.getWorld(ctx, targetWorldId);
        if (dstDoc) {
          dstDoc.world.structure.chapters.push(...(movedMeta as never[]));
          await store.saveWorld(ctx, targetWorldId, dstDoc);
        }
      }

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

  // Create a chapter under a manuscript directly (works for unattached ones too).
  app.post<{ Params: { mid: string }; Body: { chapterId: string; content?: string; status?: ChapterStatusDb } }>(
    '/api/manuscripts/:mid/chapters',
    async (req, reply) => {
      if (!auth(req, reply)) return;
      const ch = await store.createChapterInManuscript(ctxOf(req), req.params.mid, {
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

  // Autosave / manual save of chapter prose. `reason` marks WHY the revision was
  // taken: 'autosave' is the debounced typing checkpoint (prunable), 'manual' is
  // an explicit Save Draft the author asked for (never pruned). Only those two are
  // accepted here — pre_ai_* reasons belong to the AI apply path.
  app.put<{ Params: { cid: string }; Body: { content: string; reason?: RevisionReason } }>(
    '/api/chapters/:cid/content',
    async (req, reply) => {
      if (!auth(req, reply)) return;
      const reason: RevisionReason = req.body?.reason === 'manual' ? 'manual' : 'autosave';
      const ch = await store.saveChapterContent(ctxOf(req), req.params.cid, req.body?.content ?? '', reason);
      return reply.send({ chapter: ch });
    },
  );

  /**
   * Restore a chapter to an earlier revision. The CURRENT content is snapshotted
   * as a 'manual' revision first, so restoring is itself undoable and never
   * destroys work. The revision must belong to the chapter being restored.
   */
  app.post<{ Params: { cid: string }; Body: { revisionId: string } }>(
    '/api/chapters/:cid/restore',
    async (req, reply) => {
      if (!auth(req, reply)) return;
      const revisionId = req.body?.revisionId;
      if (!revisionId) return reply.code(400).send({ error: 'revisionId required' });

      const revisions = await store.listChapterRevisions(ctxOf(req), req.params.cid);
      const target = revisions.find((r) => r.id === revisionId);
      // Scoping the lookup to this chapter's own revisions means a revision id
      // from another chapter can't be used to inject content across chapters.
      if (!target) return reply.code(404).send({ error: 'revision not found for this chapter' });

      const ch = await store.saveChapterContent(
        ctxOf(req),
        req.params.cid,
        target.content,
        'manual',
      );
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
