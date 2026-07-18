/**
 * The storage interface. Two backends implement it: Postgres (default) and
 * file (OREAD_STORAGE=local). Both store the identical single JSON world
 * document. Route code depends only on this interface.
 *
 * Persistence cadence (Settled Decisions):
 *  - World document: written on explicit save + discrete events only.
 *  - Chapter prose: the only frequent writer (debounced autosave client-side;
 *    server just writes what it's given). A revision snapshot is taken BEFORE
 *    any AI-applied change (reason pre_ai_edit / pre_ai_draft).
 *  - Chats: persisted only on explicit save.
 */
import type {
  WorldDocument,
  ManuscriptRow,
  ChapterRow,
  ChapterRevisionRow,
  ChatRow,
  WritingFormat,
  ChapterStatusDb,
  RevisionReason,
  SnapshotReason,
  PersistedChatMode,
  ChatMessage,
} from '@oread/shared';

export interface WorldSummary {
  id: string;
  name: string;
  manuscriptCount: number;
  updated_at: string;
}

export interface CreateManuscriptInput {
  name?: string;
  format?: WritingFormat;
}

export interface CreateChapterInput {
  chapterId: string;
  content?: string;
  status?: ChapterStatusDb;
}

export interface SaveChatInput {
  worldId: string;
  title: string | null;
  mode: PersistedChatMode;
  characterId: string | null;
  messages: ChatMessage[];
}

/**
 * Context passed to every store call. For Postgres it carries the user's
 * schema name; the file backend ignores it (single-user).
 */
export interface StoreCtx {
  schemaName: string;
}

export interface WorldStore {
  // ── worlds ──
  listWorlds(ctx: StoreCtx): Promise<WorldSummary[]>;
  getWorld(ctx: StoreCtx, worldId: string): Promise<WorldDocument | null>;
  createWorld(ctx: StoreCtx, name: string, doc: WorldDocument): Promise<string>;
  /** Explicit save of the whole world document (Save World). */
  saveWorld(ctx: StoreCtx, worldId: string, doc: WorldDocument): Promise<void>;
  deleteWorld(ctx: StoreCtx, worldId: string): Promise<void>;

  // ── snapshots (delta-first) ──
  snapshotWorld(
    ctx: StoreCtx,
    worldId: string,
    reason: SnapshotReason,
  ): Promise<void>;

  // ── manuscripts ──
  listManuscripts(ctx: StoreCtx, worldId: string): Promise<ManuscriptRow[]>;
  createManuscript(
    ctx: StoreCtx,
    worldId: string,
    input: CreateManuscriptInput,
  ): Promise<ManuscriptRow>;
  updateManuscript(
    ctx: StoreCtx,
    manuscriptId: string,
    patch: Partial<Pick<ManuscriptRow, 'name' | 'format' | 'order'>>,
  ): Promise<void>;
  deleteManuscript(ctx: StoreCtx, manuscriptId: string): Promise<void>;

  // ── chapters (prose) ──
  listChapters(ctx: StoreCtx, manuscriptId: string): Promise<ChapterRow[]>;
  getChapter(ctx: StoreCtx, chapterRowId: string): Promise<ChapterRow | null>;
  createChapter(
    ctx: StoreCtx,
    worldId: string,
    manuscriptId: string,
    input: CreateChapterInput,
  ): Promise<ChapterRow>;
  /** Autosave / manual save of chapter prose (writes chapters.content). */
  saveChapterContent(
    ctx: StoreCtx,
    chapterRowId: string,
    content: string,
    revisionReason?: RevisionReason,
  ): Promise<ChapterRow>;
  updateChapterMeta(
    ctx: StoreCtx,
    chapterRowId: string,
    patch: Partial<Pick<ChapterRow, 'status' | 'order' | 'chapter_id'>>,
  ): Promise<void>;
  deleteChapter(ctx: StoreCtx, chapterRowId: string): Promise<void>;

  // ── revisions ──
  /** Take a revision snapshot of a chapter BEFORE an AI-applied change. */
  snapshotChapter(
    ctx: StoreCtx,
    chapterRowId: string,
    reason: RevisionReason,
  ): Promise<void>;
  listChapterRevisions(
    ctx: StoreCtx,
    chapterRowId: string,
  ): Promise<ChapterRevisionRow[]>;
  /** Prune autosave revisions older than N days (kept: pre_ai_* / manual forever). */
  pruneAutosaveRevisions(ctx: StoreCtx, olderThanDays: number): Promise<number>;

  // ── chats ──
  listChats(ctx: StoreCtx, worldId: string): Promise<ChatRow[]>;
  saveChat(ctx: StoreCtx, input: SaveChatInput): Promise<ChatRow>;
  markChatDistilled(ctx: StoreCtx, chatId: string): Promise<void>;
  getChat(ctx: StoreCtx, chatId: string): Promise<ChatRow | null>;
}
