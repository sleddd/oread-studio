/**
 * Postgres WorldStore — the default backend. Uses withUserSchema so every
 * query runs against the caller's namespace with bare table names.
 *
 * Snapshots are delta-first: the first snapshot of a world (or every Nth) is a
 * full copy; intermediate ones store a JSON-Patch diff from the previous
 * snapshot's reconstructed state.
 */
import jsonpatch from 'fast-json-patch';
import type { Operation } from 'fast-json-patch';
const { compare, applyPatch } = jsonpatch;
import { withUserSchema } from '../db/pool.js';
import { countWords } from '@oread/shared';
import type {
  WorldDocument,
  ManuscriptRow,
  ChapterRow,
  ChapterRevisionRow,
  ChatRow,
} from '@oread/shared';
import type {
  WorldStore,
  StoreCtx,
  WorldSummary,
  CreateManuscriptInput,
  CreateChapterInput,
  SaveChatInput,
} from './types.js';
import type { RevisionReason, SnapshotReason } from '@oread/shared';

/** Take a full snapshot every SNAPSHOT_FULL_EVERY snapshots. */
const SNAPSHOT_FULL_EVERY = 10;

export class PostgresStore implements WorldStore {
  async listWorlds(ctx: StoreCtx): Promise<WorldSummary[]> {
    return withUserSchema(ctx.schemaName, async (c) => {
      const { rows } = await c.query<{
        id: string;
        name: string;
        updated_at: string;
        mcount: string;
      }>(
        `SELECT w.id, w.name, w.updated_at,
                (SELECT count(*) FROM manuscripts m WHERE m.world_id = w.id) AS mcount
         FROM worlds w ORDER BY w.updated_at DESC`,
      );
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        updated_at: r.updated_at,
        manuscriptCount: Number(r.mcount),
      }));
    });
  }

  async getWorld(ctx: StoreCtx, worldId: string): Promise<WorldDocument | null> {
    return withUserSchema(ctx.schemaName, async (c) => {
      const { rows } = await c.query<{ data: WorldDocument }>(
        'SELECT data FROM worlds WHERE id = $1',
        [worldId],
      );
      return rows[0]?.data ?? null;
    });
  }

  async createWorld(
    ctx: StoreCtx,
    name: string,
    doc: WorldDocument,
  ): Promise<string> {
    return withUserSchema(ctx.schemaName, async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO worlds (name, data, schema_version)
         VALUES ($1, $2, $3) RETURNING id`,
        [name, doc, doc.world.identity.version ?? '1'],
      );
      return rows[0]!.id;
    });
  }

  async saveWorld(
    ctx: StoreCtx,
    worldId: string,
    doc: WorldDocument,
  ): Promise<void> {
    await withUserSchema(ctx.schemaName, async (c) => {
      await c.query(
        `UPDATE worlds SET data = $1, name = $2, updated_at = now() WHERE id = $3`,
        [doc, doc.world.identity.name ?? 'Untitled World', worldId],
      );
    });
  }

  async deleteWorld(ctx: StoreCtx, worldId: string): Promise<void> {
    await withUserSchema(ctx.schemaName, async (c) => {
      await c.query('DELETE FROM worlds WHERE id = $1', [worldId]);
    });
  }

  async snapshotWorld(
    ctx: StoreCtx,
    worldId: string,
    reason: SnapshotReason,
  ): Promise<void> {
    await withUserSchema(ctx.schemaName, async (c) => {
      const { rows: worldRows } = await c.query<{ data: WorldDocument }>(
        'SELECT data FROM worlds WHERE id = $1',
        [worldId],
      );
      const current = worldRows[0]?.data;
      if (!current) return;

      // How many snapshots exist so far?
      const { rows: cnt } = await c.query<{ n: string }>(
        'SELECT count(*) AS n FROM world_snapshots WHERE world_id = $1',
        [worldId],
      );
      const n = Number(cnt[0]!.n);
      const forceFull = n % SNAPSHOT_FULL_EVERY === 0;

      if (forceFull || reason === 'pre_migration') {
        await c.query(
          `INSERT INTO world_snapshots (world_id, kind, data, reason)
           VALUES ($1, 'full', $2, $3)`,
          [worldId, current, reason],
        );
        return;
      }

      // Reconstruct the latest state and store a delta from it.
      const prior = await this.#reconstructLatest(c, worldId);
      const patch = compare(prior ?? {}, current);
      await c.query(
        `INSERT INTO world_snapshots (world_id, kind, data, reason)
         VALUES ($1, 'delta', $2, $3)`,
        [worldId, JSON.stringify(patch), reason],
      );
    });
  }

  /** Rebuild the most recent snapshot state (full + replay deltas). */
  async #reconstructLatest(
    c: import('pg').PoolClient,
    worldId: string,
  ): Promise<unknown> {
    const { rows } = await c.query<{
      kind: 'full' | 'delta';
      data: unknown;
      created_at: string;
    }>(
      `SELECT kind, data, created_at FROM world_snapshots
       WHERE world_id = $1 ORDER BY created_at ASC`,
      [worldId],
    );
    if (rows.length === 0) return null;
    // Find the last full, then replay deltas after it.
    let state: unknown = null;
    for (const row of rows) {
      if (row.kind === 'full') {
        state = row.data;
      } else if (state != null) {
        state = applyPatch(
          structuredClone(state),
          row.data as Operation[],
          false,
          false,
        ).newDocument;
      }
    }
    return state;
  }

  async listManuscripts(
    ctx: StoreCtx,
    worldId: string,
  ): Promise<ManuscriptRow[]> {
    return withUserSchema(ctx.schemaName, async (c) => {
      const { rows } = await c.query<ManuscriptRow>(
        'SELECT * FROM manuscripts WHERE world_id = $1 ORDER BY "order" ASC, created_at ASC',
        [worldId],
      );
      return rows;
    });
  }

  async getManuscript(ctx: StoreCtx, manuscriptId: string): Promise<ManuscriptRow | null> {
    return withUserSchema(ctx.schemaName, async (c) => {
      const { rows } = await c.query<ManuscriptRow>('SELECT * FROM manuscripts WHERE id = $1', [
        manuscriptId,
      ]);
      return rows[0] ?? null;
    });
  }

  async listUnattachedManuscripts(ctx: StoreCtx): Promise<ManuscriptRow[]> {
    return withUserSchema(ctx.schemaName, async (c) => {
      const { rows } = await c.query<ManuscriptRow>(
        'SELECT * FROM manuscripts WHERE world_id IS NULL ORDER BY "order" ASC, created_at ASC',
      );
      return rows;
    });
  }

  async reassignManuscript(
    ctx: StoreCtx,
    manuscriptId: string,
    worldId: string | null,
  ): Promise<void> {
    await withUserSchema(ctx.schemaName, async (c) => {
      await c.query('BEGIN');
      try {
        await c.query('UPDATE manuscripts SET world_id = $1, updated_at = now() WHERE id = $2', [
          worldId,
          manuscriptId,
        ]);
        await c.query('UPDATE chapters SET world_id = $1, updated_at = now() WHERE manuscript_id = $2', [
          worldId,
          manuscriptId,
        ]);
        await c.query('COMMIT');
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      }
    });
  }

  async createManuscript(
    ctx: StoreCtx,
    worldId: string,
    input: CreateManuscriptInput,
  ): Promise<ManuscriptRow> {
    return withUserSchema(ctx.schemaName, async (c) => {
      const { rows } = await c.query<ManuscriptRow>(
        `INSERT INTO manuscripts (world_id, name, format, "order")
         VALUES ($1, $2, $3,
           COALESCE((SELECT max("order") + 1 FROM manuscripts WHERE world_id = $1), 0))
         RETURNING *`,
        [worldId, input.name ?? 'Untitled Manuscript', input.format ?? 'novel'],
      );
      return rows[0]!;
    });
  }

  async updateManuscript(
    ctx: StoreCtx,
    manuscriptId: string,
    patch: Partial<Pick<ManuscriptRow, 'name' | 'format' | 'order'>>,
  ): Promise<void> {
    await withUserSchema(ctx.schemaName, async (c) => {
      const sets: string[] = [];
      const vals: unknown[] = [];
      let i = 1;
      if (patch.name !== undefined) { sets.push(`name = $${i++}`); vals.push(patch.name); }
      if (patch.format !== undefined) { sets.push(`format = $${i++}`); vals.push(patch.format); }
      if (patch.order !== undefined) { sets.push(`"order" = $${i++}`); vals.push(patch.order); }
      if (sets.length === 0) return;
      sets.push('updated_at = now()');
      vals.push(manuscriptId);
      await c.query(
        `UPDATE manuscripts SET ${sets.join(', ')} WHERE id = $${i}`,
        vals,
      );
    });
  }

  async deleteManuscript(ctx: StoreCtx, manuscriptId: string): Promise<void> {
    await withUserSchema(ctx.schemaName, async (c) => {
      await c.query('DELETE FROM manuscripts WHERE id = $1', [manuscriptId]);
    });
  }

  async listChapters(
    ctx: StoreCtx,
    manuscriptId: string,
  ): Promise<ChapterRow[]> {
    return withUserSchema(ctx.schemaName, async (c) => {
      const { rows } = await c.query<ChapterRow>(
        'SELECT * FROM chapters WHERE manuscript_id = $1 ORDER BY "order" ASC, created_at ASC',
        [manuscriptId],
      );
      return rows;
    });
  }

  async getChapter(
    ctx: StoreCtx,
    chapterRowId: string,
  ): Promise<ChapterRow | null> {
    return withUserSchema(ctx.schemaName, async (c) => {
      const { rows } = await c.query<ChapterRow>(
        'SELECT * FROM chapters WHERE id = $1',
        [chapterRowId],
      );
      return rows[0] ?? null;
    });
  }

  async createChapter(
    ctx: StoreCtx,
    worldId: string,
    manuscriptId: string,
    input: CreateChapterInput,
  ): Promise<ChapterRow> {
    return withUserSchema(ctx.schemaName, async (c) => {
      const content = input.content ?? '';
      const { rows } = await c.query<ChapterRow>(
        `INSERT INTO chapters (world_id, manuscript_id, chapter_id, content, word_count, status, "order")
         VALUES ($1, $2, $3, $4, $5, $6,
           COALESCE((SELECT max("order") + 1 FROM chapters WHERE manuscript_id = $2), 0))
         RETURNING *`,
        [worldId, manuscriptId, input.chapterId, content, countWords(content), input.status ?? 'outline'],
      );
      return rows[0]!;
    });
  }

  async createChapterInManuscript(
    ctx: StoreCtx,
    manuscriptId: string,
    input: CreateChapterInput,
  ): Promise<ChapterRow> {
    return withUserSchema(ctx.schemaName, async (c) => {
      const content = input.content ?? '';
      const { rows } = await c.query<ChapterRow>(
        `INSERT INTO chapters (world_id, manuscript_id, chapter_id, content, word_count, status, "order")
         SELECT m.world_id, m.id, $2, $3, $4, $5,
           COALESCE((SELECT max("order") + 1 FROM chapters WHERE manuscript_id = m.id), 0)
         FROM manuscripts m WHERE m.id = $1
         RETURNING *`,
        [manuscriptId, input.chapterId, content, countWords(content), input.status ?? 'outline'],
      );
      return rows[0]!;
    });
  }

  async saveChapterContent(
    ctx: StoreCtx,
    chapterRowId: string,
    content: string,
    revisionReason?: RevisionReason,
  ): Promise<ChapterRow> {
    return withUserSchema(ctx.schemaName, async (c) => {
      // If a revision reason is given, snapshot the CURRENT content first.
      if (revisionReason) {
        await c.query(
          `INSERT INTO chapter_revisions (chapter_id, content, word_count, reason)
           SELECT id, content, word_count, $2 FROM chapters WHERE id = $1`,
          [chapterRowId, revisionReason],
        );
      }
      const { rows } = await c.query<ChapterRow>(
        `UPDATE chapters SET content = $1, word_count = $2, updated_at = now()
         WHERE id = $3 RETURNING *`,
        [content, countWords(content), chapterRowId],
      );
      return rows[0]!;
    });
  }

  async updateChapterMeta(
    ctx: StoreCtx,
    chapterRowId: string,
    patch: Partial<Pick<ChapterRow, 'status' | 'order' | 'chapter_id'>>,
  ): Promise<void> {
    await withUserSchema(ctx.schemaName, async (c) => {
      const sets: string[] = [];
      const vals: unknown[] = [];
      let i = 1;
      if (patch.status !== undefined) { sets.push(`status = $${i++}`); vals.push(patch.status); }
      if (patch.order !== undefined) { sets.push(`"order" = $${i++}`); vals.push(patch.order); }
      if (patch.chapter_id !== undefined) { sets.push(`chapter_id = $${i++}`); vals.push(patch.chapter_id); }
      if (sets.length === 0) return;
      sets.push('updated_at = now()');
      vals.push(chapterRowId);
      await c.query(`UPDATE chapters SET ${sets.join(', ')} WHERE id = $${i}`, vals);
    });
  }

  async deleteChapter(ctx: StoreCtx, chapterRowId: string): Promise<void> {
    await withUserSchema(ctx.schemaName, async (c) => {
      await c.query('DELETE FROM chapters WHERE id = $1', [chapterRowId]);
    });
  }

  async snapshotChapter(
    ctx: StoreCtx,
    chapterRowId: string,
    reason: RevisionReason,
  ): Promise<void> {
    await withUserSchema(ctx.schemaName, async (c) => {
      await c.query(
        `INSERT INTO chapter_revisions (chapter_id, content, word_count, reason)
         SELECT id, content, word_count, $2 FROM chapters WHERE id = $1`,
        [chapterRowId, reason],
      );
    });
  }

  async listChapterRevisions(
    ctx: StoreCtx,
    chapterRowId: string,
  ): Promise<ChapterRevisionRow[]> {
    return withUserSchema(ctx.schemaName, async (c) => {
      const { rows } = await c.query<ChapterRevisionRow>(
        'SELECT * FROM chapter_revisions WHERE chapter_id = $1 ORDER BY created_at DESC',
        [chapterRowId],
      );
      return rows;
    });
  }

  async pruneAutosaveRevisions(
    ctx: StoreCtx,
    olderThanDays: number,
  ): Promise<number> {
    return withUserSchema(ctx.schemaName, async (c) => {
      const { rowCount } = await c.query(
        `DELETE FROM chapter_revisions
         WHERE reason = 'autosave' AND created_at < now() - ($1 || ' days')::interval`,
        [String(olderThanDays)],
      );
      return rowCount ?? 0;
    });
  }

  async listChats(ctx: StoreCtx, worldId: string): Promise<ChatRow[]> {
    return withUserSchema(ctx.schemaName, async (c) => {
      const { rows } = await c.query<ChatRow>(
        'SELECT * FROM chats WHERE world_id = $1 ORDER BY saved_at DESC',
        [worldId],
      );
      return rows;
    });
  }

  async saveChat(ctx: StoreCtx, input: SaveChatInput): Promise<ChatRow> {
    return withUserSchema(ctx.schemaName, async (c) => {
      // Continued chat: update the existing row in place. Messages changed, so
      // reset distilled=false — the caller re-runs distillation on every save.
      if (input.chatId) {
        const { rows } = await c.query<ChatRow>(
          `UPDATE chats
              SET title = $2, mode = $3, character_id = $4, messages = $5,
                  distilled = false, saved_at = now()
            WHERE id = $1 AND world_id = $6
          RETURNING *`,
          [
            input.chatId,
            input.title,
            input.mode,
            input.characterId,
            JSON.stringify(input.messages),
            input.worldId,
          ],
        );
        if (rows[0]) return rows[0];
        // Row vanished (e.g. deleted) — fall through to insert a fresh one.
      }
      const { rows } = await c.query<ChatRow>(
        `INSERT INTO chats (world_id, title, mode, character_id, messages)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [
          input.worldId,
          input.title,
          input.mode,
          input.characterId,
          JSON.stringify(input.messages),
        ],
      );
      return rows[0]!;
    });
  }

  async markChatDistilled(ctx: StoreCtx, chatId: string): Promise<void> {
    await withUserSchema(ctx.schemaName, async (c) => {
      await c.query('UPDATE chats SET distilled = true WHERE id = $1', [chatId]);
    });
  }

  async getChat(ctx: StoreCtx, chatId: string): Promise<ChatRow | null> {
    return withUserSchema(ctx.schemaName, async (c) => {
      const { rows } = await c.query<ChatRow>('SELECT * FROM chats WHERE id = $1', [chatId]);
      return rows[0] ?? null;
    });
  }

  async deleteChat(ctx: StoreCtx, chatId: string): Promise<void> {
    await withUserSchema(ctx.schemaName, async (c) => {
      await c.query('DELETE FROM chats WHERE id = $1', [chatId]);
    });
  }
}
