/**
 * File WorldStore — the solo/offline backend (OREAD_STORAGE=local).
 *
 * Each world is a directory under OREAD_WORLDS_DIR:
 *   <dir>/<worldId>/world.json          — the world document (the cat-able file)
 *   <dir>/<worldId>/store.json          — manuscripts, chapters, revisions, chats
 *   <dir>/<worldId>/snapshots/*.json    — delta/full snapshots
 *
 * The `schemaName` in StoreCtx is ignored (single user). Writes are whole-file
 * for the small store.json; world.json is written only on explicit save.
 */
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import jsonpatch from 'fast-json-patch';
import type { Operation } from 'fast-json-patch';
const { compare, applyPatch } = jsonpatch;
import { countWords } from '@oread/shared';
import type {
  WorldDocument,
  ManuscriptRow,
  ChapterRow,
  ChapterRevisionRow,
  ChatRow,
  RevisionReason,
  SnapshotReason,
} from '@oread/shared';
import type {
  WorldStore,
  StoreCtx,
  WorldSummary,
  CreateManuscriptInput,
  CreateChapterInput,
  SaveChatInput,
} from './types.js';
import { env } from '../env.js';

interface WorldSideStore {
  manuscripts: ManuscriptRow[];
  chapters: ChapterRow[];
  revisions: ChapterRevisionRow[];
  chats: ChatRow[];
}

const SNAPSHOT_FULL_EVERY = 10;
/** Pseudo-world directory holding detached (world-less) manuscripts. */
const UNATTACHED = '__unattached__';
const nowIso = () => new Date().toISOString();

export class FileStore implements WorldStore {
  #root: string;

  constructor(root = env.localWorldsDir) {
    this.#root = root;
    mkdirSync(this.#root, { recursive: true });
  }

  #worldDir(id: string): string {
    // Contain the per-world directory within #root. World/chat IDs arrive from
    // client request params/bodies; a `..` segment (or absolute path) would
    // otherwise let read/write/delete escape the worlds directory.
    const dir = resolve(this.#root, id);
    const rel = relative(this.#root, dir);
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error(`invalid world id: ${id}`);
    }
    return dir;
  }

  #readWorld(id: string): WorldDocument | null {
    const p = join(this.#worldDir(id), 'world.json');
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, 'utf8')) as WorldDocument;
  }

  #writeWorld(id: string, doc: WorldDocument): void {
    mkdirSync(this.#worldDir(id), { recursive: true });
    writeFileSync(join(this.#worldDir(id), 'world.json'), JSON.stringify(doc, null, 2));
  }

  #readSide(id: string): WorldSideStore {
    const p = join(this.#worldDir(id), 'store.json');
    if (!existsSync(p)) {
      return { manuscripts: [], chapters: [], revisions: [], chats: [] };
    }
    return JSON.parse(readFileSync(p, 'utf8')) as WorldSideStore;
  }

  #writeSide(id: string, side: WorldSideStore): void {
    mkdirSync(this.#worldDir(id), { recursive: true });
    writeFileSync(join(this.#worldDir(id), 'store.json'), JSON.stringify(side, null, 2));
  }

  async listWorlds(_ctx: StoreCtx): Promise<WorldSummary[]> {
    if (!existsSync(this.#root)) return [];
    const out: WorldSummary[] = [];
    for (const id of readdirSync(this.#root)) {
      const doc = this.#readWorld(id);
      if (!doc) continue;
      const side = this.#readSide(id);
      out.push({
        id,
        name: doc.world.identity.name ?? 'Untitled World',
        manuscriptCount: side.manuscripts.length,
        updated_at: doc.world.identity.lastModified ?? nowIso(),
      });
    }
    return out.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  async getWorld(_ctx: StoreCtx, worldId: string): Promise<WorldDocument | null> {
    return this.#readWorld(worldId);
  }

  async createWorld(_ctx: StoreCtx, _name: string, doc: WorldDocument): Promise<string> {
    const id = doc.world.identity.id || randomUUID();
    doc.world.identity.id = id;
    this.#writeWorld(id, doc);
    this.#writeSide(id, { manuscripts: [], chapters: [], revisions: [], chats: [] });
    return id;
  }

  async saveWorld(_ctx: StoreCtx, worldId: string, doc: WorldDocument): Promise<void> {
    doc.world.identity.lastModified = nowIso();
    this.#writeWorld(worldId, doc);
  }

  async deleteWorld(_ctx: StoreCtx, worldId: string): Promise<void> {
    // Detach (don't cascade) this world's manuscripts: move them to the
    // unattached pseudo-world, retagging world_id to null.
    const side = existsSync(this.#worldDir(worldId)) ? this.#readSide(worldId) : null;
    if (side && side.manuscripts.length > 0) {
      const dest = this.#readSide(UNATTACHED);
      for (const m of side.manuscripts) m.world_id = null;
      for (const c of side.chapters) c.world_id = null;
      dest.manuscripts.push(...side.manuscripts);
      dest.chapters.push(...side.chapters);
      dest.revisions.push(...side.revisions);
      this.#writeSide(UNATTACHED, dest);
    }
    rmSync(this.#worldDir(worldId), { recursive: true, force: true });
  }

  async snapshotWorld(
    _ctx: StoreCtx,
    worldId: string,
    reason: SnapshotReason,
  ): Promise<void> {
    const current = this.#readWorld(worldId);
    if (!current) return;
    const dir = join(this.#worldDir(worldId), 'snapshots');
    mkdirSync(dir, { recursive: true });
    const existing = existsSync(dir)
      ? readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
      : [];
    const n = existing.length;
    const stamp = `${String(n).padStart(6, '0')}_${reason}`;
    if (n % SNAPSHOT_FULL_EVERY === 0 || reason === 'pre_migration') {
      writeFileSync(join(dir, `${stamp}_full.json`), JSON.stringify(current));
      return;
    }
    const prior = this.#reconstructLatest(worldId);
    const patch = compare(prior ?? {}, current as unknown as object);
    writeFileSync(join(dir, `${stamp}_delta.json`), JSON.stringify(patch));
  }

  #reconstructLatest(worldId: string): unknown {
    const dir = join(this.#worldDir(worldId), 'snapshots');
    if (!existsSync(dir)) return null;
    const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
    let state: unknown = null;
    for (const f of files) {
      const data = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      if (f.endsWith('_full.json')) state = data;
      else if (state != null) {
        state = applyPatch(
          structuredClone(state),
          data as Operation[],
          false,
          false,
        ).newDocument;
      }
    }
    return state;
  }

  async listManuscripts(_ctx: StoreCtx, worldId: string): Promise<ManuscriptRow[]> {
    return this.#readSide(worldId).manuscripts.sort((a, b) => a.order - b.order);
  }

  async getManuscript(_ctx: StoreCtx, manuscriptId: string): Promise<ManuscriptRow | null> {
    const worldId = this.#worldOfManuscript(manuscriptId);
    if (!worldId) return null;
    return this.#readSide(worldId).manuscripts.find((m) => m.id === manuscriptId) ?? null;
  }

  async listUnattachedManuscripts(_ctx: StoreCtx): Promise<ManuscriptRow[]> {
    // Unattached manuscripts live under the special "__unattached__" world dir.
    if (!existsSync(join(this.#root, UNATTACHED))) return [];
    return this.#readSide(UNATTACHED).manuscripts.sort((a, b) => a.order - b.order);
  }

  async reassignManuscript(
    _ctx: StoreCtx,
    manuscriptId: string,
    worldId: string | null,
  ): Promise<void> {
    const fromWorld = this.#worldOfManuscript(manuscriptId);
    if (!fromWorld) return;
    const dest = worldId ?? UNATTACHED;
    if (fromWorld === dest) return;
    const src = this.#readSide(fromWorld);
    const ms = src.manuscripts.find((m) => m.id === manuscriptId);
    if (!ms) return;
    const chapters = src.chapters.filter((c) => c.manuscript_id === manuscriptId);
    const chapterIds = chapters.map((c) => c.id);
    const revs = src.revisions.filter((r) => chapterIds.includes(r.chapter_id));
    // remove from source
    src.manuscripts = src.manuscripts.filter((m) => m.id !== manuscriptId);
    src.chapters = src.chapters.filter((c) => c.manuscript_id !== manuscriptId);
    src.revisions = src.revisions.filter((r) => !chapterIds.includes(r.chapter_id));
    this.#writeSide(fromWorld, src);
    // add to dest (retag world_id)
    const destSide = this.#readSide(dest);
    ms.world_id = worldId;
    chapters.forEach((c) => (c.world_id = worldId));
    destSide.manuscripts.push(ms);
    destSide.chapters.push(...chapters);
    destSide.revisions.push(...revs);
    this.#writeSide(dest, destSide);
  }

  async createManuscript(
    _ctx: StoreCtx,
    worldId: string,
    input: CreateManuscriptInput,
  ): Promise<ManuscriptRow> {
    const side = this.#readSide(worldId);
    const row: ManuscriptRow = {
      id: randomUUID(),
      world_id: worldId,
      name: input.name ?? 'Untitled Manuscript',
      format: input.format ?? 'novel',
      order: side.manuscripts.length,
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    side.manuscripts.push(row);
    this.#writeSide(worldId, side);
    return row;
  }

  async updateManuscript(
    _ctx: StoreCtx,
    manuscriptId: string,
    patch: Partial<Pick<ManuscriptRow, 'name' | 'format' | 'order'>>,
  ): Promise<void> {
    const worldId = this.#worldOfManuscript(manuscriptId);
    if (!worldId) return;
    const side = this.#readSide(worldId);
    const m = side.manuscripts.find((x) => x.id === manuscriptId);
    if (!m) return;
    Object.assign(m, patch, { updated_at: nowIso() });
    this.#writeSide(worldId, side);
  }

  async deleteManuscript(_ctx: StoreCtx, manuscriptId: string): Promise<void> {
    const worldId = this.#worldOfManuscript(manuscriptId);
    if (!worldId) return;
    const side = this.#readSide(worldId);
    side.manuscripts = side.manuscripts.filter((m) => m.id !== manuscriptId);
    const removedChapters = side.chapters.filter((c) => c.manuscript_id === manuscriptId).map((c) => c.id);
    side.chapters = side.chapters.filter((c) => c.manuscript_id !== manuscriptId);
    side.revisions = side.revisions.filter((r) => !removedChapters.includes(r.chapter_id));
    this.#writeSide(worldId, side);
  }

  #worldOfManuscript(manuscriptId: string): string | null {
    for (const id of readdirSync(this.#root)) {
      const side = this.#readSide(id);
      if (side.manuscripts.some((m) => m.id === manuscriptId)) return id;
    }
    return null;
  }

  #worldOfChapter(chapterRowId: string): string | null {
    for (const id of readdirSync(this.#root)) {
      const side = this.#readSide(id);
      if (side.chapters.some((c) => c.id === chapterRowId)) return id;
    }
    return null;
  }

  async listChapters(_ctx: StoreCtx, manuscriptId: string): Promise<ChapterRow[]> {
    const worldId = this.#worldOfManuscript(manuscriptId);
    if (!worldId) return [];
    return this.#readSide(worldId)
      .chapters.filter((c) => c.manuscript_id === manuscriptId)
      .sort((a, b) => a.order - b.order);
  }

  async getChapter(_ctx: StoreCtx, chapterRowId: string): Promise<ChapterRow | null> {
    const worldId = this.#worldOfChapter(chapterRowId);
    if (!worldId) return null;
    return this.#readSide(worldId).chapters.find((c) => c.id === chapterRowId) ?? null;
  }

  async createChapter(
    _ctx: StoreCtx,
    worldId: string,
    manuscriptId: string,
    input: CreateChapterInput,
  ): Promise<ChapterRow> {
    const side = this.#readSide(worldId);
    const content = input.content ?? '';
    const siblings = side.chapters.filter((c) => c.manuscript_id === manuscriptId);
    const row: ChapterRow = {
      id: randomUUID(),
      world_id: worldId,
      manuscript_id: manuscriptId,
      chapter_id: input.chapterId,
      content,
      word_count: countWords(content),
      status: input.status ?? 'outline',
      order: siblings.length,
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    side.chapters.push(row);
    this.#writeSide(worldId, side);
    return row;
  }

  async createChapterInManuscript(
    _ctx: StoreCtx,
    manuscriptId: string,
    input: CreateChapterInput,
  ): Promise<ChapterRow> {
    const dir = this.#worldOfManuscript(manuscriptId);
    if (!dir) throw new Error('manuscript not found');
    const side = this.#readSide(dir);
    const ms = side.manuscripts.find((m) => m.id === manuscriptId);
    if (!ms) throw new Error('manuscript not found');
    const content = input.content ?? '';
    const siblings = side.chapters.filter((c) => c.manuscript_id === manuscriptId);
    const row: ChapterRow = {
      id: randomUUID(),
      world_id: ms.world_id, // inherits (null when unattached)
      manuscript_id: manuscriptId,
      chapter_id: input.chapterId,
      content,
      word_count: countWords(content),
      status: input.status ?? 'outline',
      order: siblings.length,
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    side.chapters.push(row);
    this.#writeSide(dir, side);
    return row;
  }

  async saveChapterContent(
    _ctx: StoreCtx,
    chapterRowId: string,
    content: string,
    revisionReason?: RevisionReason,
  ): Promise<ChapterRow> {
    const worldId = this.#worldOfChapter(chapterRowId);
    if (!worldId) throw new Error('chapter not found');
    const side = this.#readSide(worldId);
    const ch = side.chapters.find((c) => c.id === chapterRowId);
    if (!ch) throw new Error('chapter not found');
    if (revisionReason) {
      side.revisions.push({
        id: randomUUID(),
        chapter_id: ch.id,
        content: ch.content,
        word_count: ch.word_count,
        reason: revisionReason,
        created_at: nowIso(),
      });
    }
    ch.content = content;
    ch.word_count = countWords(content);
    ch.updated_at = nowIso();
    this.#writeSide(worldId, side);
    return ch;
  }

  async updateChapterMeta(
    _ctx: StoreCtx,
    chapterRowId: string,
    patch: Partial<Pick<ChapterRow, 'status' | 'order' | 'chapter_id'>>,
  ): Promise<void> {
    const worldId = this.#worldOfChapter(chapterRowId);
    if (!worldId) return;
    const side = this.#readSide(worldId);
    const ch = side.chapters.find((c) => c.id === chapterRowId);
    if (!ch) return;
    Object.assign(ch, patch, { updated_at: nowIso() });
    this.#writeSide(worldId, side);
  }

  async deleteChapter(_ctx: StoreCtx, chapterRowId: string): Promise<void> {
    const worldId = this.#worldOfChapter(chapterRowId);
    if (!worldId) return;
    const side = this.#readSide(worldId);
    side.chapters = side.chapters.filter((c) => c.id !== chapterRowId);
    side.revisions = side.revisions.filter((r) => r.chapter_id !== chapterRowId);
    this.#writeSide(worldId, side);
  }

  async snapshotChapter(
    _ctx: StoreCtx,
    chapterRowId: string,
    reason: RevisionReason,
  ): Promise<void> {
    const worldId = this.#worldOfChapter(chapterRowId);
    if (!worldId) return;
    const side = this.#readSide(worldId);
    const ch = side.chapters.find((c) => c.id === chapterRowId);
    if (!ch) return;
    side.revisions.push({
      id: randomUUID(),
      chapter_id: ch.id,
      content: ch.content,
      word_count: ch.word_count,
      reason,
      created_at: nowIso(),
    });
    this.#writeSide(worldId, side);
  }

  async listChapterRevisions(
    _ctx: StoreCtx,
    chapterRowId: string,
  ): Promise<ChapterRevisionRow[]> {
    const worldId = this.#worldOfChapter(chapterRowId);
    if (!worldId) return [];
    return this.#readSide(worldId)
      .revisions.filter((r) => r.chapter_id === chapterRowId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async pruneAutosaveRevisions(_ctx: StoreCtx, olderThanDays: number): Promise<number> {
    const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
    let removed = 0;
    for (const id of readdirSync(this.#root)) {
      const side = this.#readSide(id);
      const before = side.revisions.length;
      side.revisions = side.revisions.filter(
        (r) => !(r.reason === 'autosave' && Date.parse(r.created_at) < cutoff),
      );
      removed += before - side.revisions.length;
      this.#writeSide(id, side);
    }
    return removed;
  }

  async listChats(_ctx: StoreCtx, worldId: string): Promise<ChatRow[]> {
    return this.#readSide(worldId).chats.sort((a, b) => b.saved_at.localeCompare(a.saved_at));
  }

  async saveChat(_ctx: StoreCtx, input: SaveChatInput): Promise<ChatRow> {
    const side = this.#readSide(input.worldId);
    const row: ChatRow = {
      id: randomUUID(),
      world_id: input.worldId,
      title: input.title,
      mode: input.mode,
      character_id: input.characterId,
      messages: input.messages,
      distilled: false,
      saved_at: nowIso(),
    };
    side.chats.push(row);
    this.#writeSide(input.worldId, side);
    return row;
  }

  async markChatDistilled(_ctx: StoreCtx, chatId: string): Promise<void> {
    for (const id of readdirSync(this.#root)) {
      const side = this.#readSide(id);
      const chat = side.chats.find((c) => c.id === chatId);
      if (chat) {
        chat.distilled = true;
        this.#writeSide(id, side);
        return;
      }
    }
  }

  async getChat(_ctx: StoreCtx, chatId: string): Promise<ChatRow | null> {
    for (const id of readdirSync(this.#root)) {
      const side = this.#readSide(id);
      const chat = side.chats.find((c) => c.id === chatId);
      if (chat) return chat;
    }
    return null;
  }
}
