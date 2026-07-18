/**
 * AI endpoints. `/api/ai/generate` streams a reply per the active mode.
 * `/api/ai/apply` applies an accepted prose/suggestion to a chapter — and
 * ALWAYS snapshots the chapter's current content to chapter_revisions FIRST
 * (reason pre_ai_edit / pre_ai_draft). Critique output can never be applied.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { PersistedChatMode } from '@oread/shared';
import { getStore } from '../storage/index.js';
import { generate } from '../ai/orchestrator.js';
import { assertApplyAllowed, baseMode, ModePermissionError } from '../ai/permissions.js';
import type { ChatTurn } from '../ai/provider.js';

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

interface GenerateBody {
  worldId: string;
  mode: PersistedChatMode;
  characterId: string | null;
  messages: ChatTurn[];
  targetChapterId: string; // the chapter row uuid
  /** user opted into web research for this turn (gated server-side by mode) */
  allowWebSearch?: boolean;
}

interface ApplyBody {
  mode: PersistedChatMode;
  chapterRowId: string;
  /** prose to append (cowrite/draft) or the suggestion's proposed text (edit) */
  text: string;
  /** 'pre_ai_draft' for draft/cowrite, 'pre_ai_edit' for edit */
  reason: 'pre_ai_draft' | 'pre_ai_edit';
}

export async function aiRoutes(app: FastifyInstance): Promise<void> {
  const store = getStore();

  // Streaming generate (SSE to the client).
  app.post<{ Body: GenerateBody }>('/api/ai/generate', async (req, reply) => {
    if (!auth(req, reply)) return;
    const body = req.body;
    const world = await store.getWorld(ctxOf(req), body.worldId);
    if (!world) return reply.code(404).send({ error: 'world not found' });

    // Load target chapter prose for context (if any).
    let targetText: string | undefined;
    if (body.targetChapterId) {
      const ch = await store.getChapter(ctxOf(req), body.targetChapterId);
      targetText = ch?.content;
    }

    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    const sse = (event: string, data: unknown) => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const out = await generate({
        ctx: ctxOf(req),
        world,
        mode: body.mode,
        characterId: body.characterId,
        messages: body.messages,
        targetChapterId: body.targetChapterId,
        targetChapterText: targetText,
        allowWebSearch: body.allowWebSearch,
        onDelta: (t) => sse('delta', { text: t }),
      });
      sse('done', {
        kind: out.kind,
        text: out.text,
        suggestion: out.suggestion,
        citations: out.citations,
        usedMock: out.usedMock,
        includedContext: out.includedContext,
        droppedContext: out.droppedContext,
      });
    } catch (e) {
      req.log.error(e);
      sse('error', { error: e instanceof Error ? e.message : 'generation failed' });
    } finally {
      reply.raw.end();
    }
  });

  // Apply an accepted result to a chapter — revision snapshot FIRST.
  app.post<{ Body: ApplyBody }>('/api/ai/apply', async (req, reply) => {
    if (!auth(req, reply)) return;
    const body = req.body;
    try {
      assertApplyAllowed(body.mode); // critique/discuss cannot apply
    } catch (e) {
      if (e instanceof ModePermissionError) return reply.code(403).send({ error: e.message });
      throw e;
    }

    const chapter = await store.getChapter(ctxOf(req), body.chapterRowId);
    if (!chapter) return reply.code(404).send({ error: 'chapter not found' });

    // Append the applied text (matches prototype: insert with a blank line).
    const newContent = chapter.content
      ? `${chapter.content}\n\n${body.text}`
      : body.text;

    // The store's saveChapterContent with a revision reason snapshots the OLD
    // content BEFORE overwriting — this IS the revision-before-AI-write guarantee.
    const reason = baseMode(body.mode) === 'edit' ? 'pre_ai_edit' : 'pre_ai_draft';
    const updated = await store.saveChapterContent(
      ctxOf(req),
      body.chapterRowId,
      newContent,
      reason,
    );
    return reply.send({ chapter: updated });
  });
}
