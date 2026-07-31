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

/**
 * How many preceding chapters of real prose to fetch for the model.
 *
 * This is a FETCH ceiling, not the context policy: the assembler's
 * `precedingChapters:N` recipe item caps the characters actually sent and trims
 * each chapter from the front, and the token budget drops what still won't fit.
 * Three was sized for the old flat 6000-token budget; with the budget now
 * derived from the model, the limiter should be the budget, not this number.
 */
const PRECEDING_CHAPTERS = 12;

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
  /** who the author is speaking AS in character chat (character id, or null = the author) */
  userAs?: string | null;
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

    // Load target chapter prose + its structure link for context (if any). The
    // prose row's `chapter_id` points at world.structure.chapters[].id, letting the
    // context builder pull the chapter's outline metadata (title/summary/purpose).
    let targetText: string | undefined;
    let targetChapterMetaId: string | undefined;
    let precedingChapters: { title: string; text: string }[] | undefined;
    if (body.targetChapterId) {
      const ch = await store.getChapter(ctxOf(req), body.targetChapterId);
      targetText = ch?.content;
      targetChapterMetaId = ch?.chapter_id;

      // The chapters immediately BEFORE this one, as actual prose. Draft and
      // co-write need to continue from what was really written — chapter
      // summaries are author metadata and often stale or absent, so on their own
      // they let the model contradict the text it is continuing.
      if (ch) {
        const siblings = await store.listChapters(ctxOf(req), ch.manuscript_id);
        const titleOf = (row: { chapter_id: string }): string =>
          world.world.structure.chapters.find((m) => m.id === row.chapter_id)?.title ?? 'Untitled';
        precedingChapters = siblings
          .filter((c) => c.order < ch.order && c.content.trim())
          .sort((a, b) => a.order - b.order)
          .slice(-PRECEDING_CHAPTERS)
          .map((c) => ({ title: titleOf(c), text: c.content }));
      }
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
        userAs: body.userAs ?? null,
        messages: body.messages,
        targetChapterId: body.targetChapterId,
        targetChapterText: targetText,
        targetChapterMetaId,
        precedingChapters,
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

    // The applied text is client-supplied — the client sends the accepted
    // prose/suggestion body. Validate it's a string within a sane bound before
    // writing it into the manuscript (the OLD content is snapshotted below, so
    // any bad write is revertable, but we still reject obviously malformed input).
    if (typeof body.text !== 'string' || body.text.length > 1_000_000) {
      return reply.code(400).send({ error: 'invalid apply text' });
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
