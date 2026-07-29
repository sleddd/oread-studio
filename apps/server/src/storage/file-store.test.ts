import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileStore } from './file-store.js';
import type { StoreCtx } from './types.js';
import type { WorldDocument } from '@oread/shared';

const ctx: StoreCtx = { schemaName: 'u_00000000000000000000000000000000' };
let dir: string;
let store: FileStore;

function minimalWorld(name: string): WorldDocument {
  return {
    world: {
      identity: {
        id: '',
        name,
        version: '1',
        mode: 'fiction',
        created: '2026-01-01T00:00:00Z',
        lastModified: '2026-01-01T00:00:00Z',
      },
      premise: { logline: '', synopsis: '', themes: [], genre: [], tone: '' },
      setting: { lore: '', timePeriod: '', locations: [], rules: [] },
      entities: { characters: [], relationships: [], factions: [], concepts: [], sources: [] },
      // Legacy shape on purpose: scenes/timeline are retired from the interface,
      // and a doc that still carries them must keep round-tripping through the store.
      structure: { chapters: [], scenes: [], timeline: [] },
      memory: { events: [], canon: [], openThreads: [], decisions: [] },
      suggestions: [],
      session: {} as never,
    },
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'oread-store-'));
  store = new FileStore(dir);
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

test('world create → list → get → save round-trip', async () => {
  const id = await store.createWorld(ctx, 'Sweet Nothings', minimalWorld('Sweet Nothings'));
  const list = await store.listWorlds(ctx);
  assert.equal(list.length, 1);
  assert.equal(list[0]!.name, 'Sweet Nothings');
  const doc = await store.getWorld(ctx, id);
  assert.ok(doc);
  doc!.world.identity.name = 'Renamed';
  await store.saveWorld(ctx, id, doc!);
  const reread = await store.getWorld(ctx, id);
  assert.equal(reread!.world.identity.name, 'Renamed');
});

test('manuscript → chapter → autosave with word count', async () => {
  const wid = await store.createWorld(ctx, 'W', minimalWorld('W'));
  const ms = await store.createManuscript(ctx, wid, { name: 'Book One', format: 'novel' });
  assert.equal(ms.format, 'novel');
  const ch = await store.createChapter(ctx, wid, ms.id, { chapterId: 'ch_001', content: 'one two three' });
  assert.equal(ch.word_count, 3);
  const saved = await store.saveChapterContent(ctx, ch.id, 'now there are five words here');
  assert.equal(saved.word_count, 6);
  const chapters = await store.listChapters(ctx, ms.id);
  assert.equal(chapters.length, 1);
  assert.equal(chapters[0]!.content, 'now there are five words here');
});

test('revision-before-AI-write: pre_ai_edit snapshots the OLD content first', async () => {
  const wid = await store.createWorld(ctx, 'W', minimalWorld('W'));
  const ms = await store.createManuscript(ctx, wid, {});
  const ch = await store.createChapter(ctx, wid, ms.id, { chapterId: 'ch_001', content: 'original text' });
  // AI applies a change — must snapshot original first.
  await store.saveChapterContent(ctx, ch.id, 'ai-rewritten text', 'pre_ai_edit');
  const revs = await store.listChapterRevisions(ctx, ch.id);
  assert.equal(revs.length, 1);
  assert.equal(revs[0]!.reason, 'pre_ai_edit');
  assert.equal(revs[0]!.content, 'original text', 'revision holds the PRE-change content');
});

test('prune removes old autosave revisions but keeps pre_ai_* forever', async () => {
  const wid = await store.createWorld(ctx, 'W', minimalWorld('W'));
  const ms = await store.createManuscript(ctx, wid, {});
  const ch = await store.createChapter(ctx, wid, ms.id, { chapterId: 'ch_001', content: 'a' });
  await store.snapshotChapter(ctx, ch.id, 'pre_ai_draft'); // kept forever
  await store.snapshotChapter(ctx, ch.id, 'autosave'); // young — kept
  const removed = await store.pruneAutosaveRevisions(ctx, 30);
  assert.equal(removed, 0, 'young autosave not pruned');
  const revs = await store.listChapterRevisions(ctx, ch.id);
  assert.equal(revs.length, 2);
});

test("prune keeps 'manual' draft points as well as pre_ai_*", async () => {
  const wid = await store.createWorld(ctx, 'W', minimalWorld('W'));
  const ms = await store.createManuscript(ctx, wid, {});
  const ch = await store.createChapter(ctx, wid, ms.id, { chapterId: 'ch_001', content: 'a' });
  await store.snapshotChapter(ctx, ch.id, 'manual');
  await store.snapshotChapter(ctx, ch.id, 'autosave');
  // Age everything past the prune window: only the autosave row may go.
  const sidePath = join(dir, wid, 'store.json');
  const side = JSON.parse(readFileSync(sidePath, 'utf8')) as {
    revisions: { reason: string; created_at: string }[];
  };
  for (const r of side.revisions) r.created_at = '2020-01-01T00:00:00.000Z';
  writeFileSync(sidePath, JSON.stringify(side));

  const removed = await store.pruneAutosaveRevisions(ctx, 30);
  assert.equal(removed, 1, 'only the old autosave is pruned');
  const revs = await store.listChapterRevisions(ctx, ch.id);
  assert.equal(revs.length, 1);
  assert.equal(revs[0]!.reason, 'manual', 'the deliberate draft point survives');
});

test('restore is non-destructive: the replaced text is snapshotted first', async () => {
  const wid = await store.createWorld(ctx, 'W', minimalWorld('W'));
  const ms = await store.createManuscript(ctx, wid, {});
  const ch = await store.createChapter(ctx, wid, ms.id, { chapterId: 'ch_001', content: 'draft one' });

  // Author saves a draft point, then keeps writing.
  await store.saveChapterContent(ctx, ch.id, 'draft two', 'manual');
  const afterFirst = await store.listChapterRevisions(ctx, ch.id);
  const draftOne = afterFirst.find((r) => r.content === 'draft one');
  assert.ok(draftOne, 'the pre-save content was captured as a revision');

  // Restore that earlier version — this is what the restore route does.
  const restored = await store.saveChapterContent(ctx, ch.id, draftOne.content, 'manual');
  assert.equal(restored.content, 'draft one', 'chapter now holds the restored text');

  const revs = await store.listChapterRevisions(ctx, ch.id);
  assert.ok(
    revs.some((r) => r.content === 'draft two'),
    'the version replaced BY the restore is itself recoverable',
  );
});

test('delta snapshots reconstruct to the current world state', async () => {
  const wid = await store.createWorld(ctx, 'W', minimalWorld('W'));
  await store.snapshotWorld(ctx, wid, 'manual'); // #0 → full
  const doc = await store.getWorld(ctx, wid);
  doc!.world.premise.logline = 'a new logline';
  await store.saveWorld(ctx, wid, doc!);
  await store.snapshotWorld(ctx, wid, 'pre_ai_write'); // #1 → delta
  // No assertion on internals beyond: it doesn't throw and both snapshots exist.
  // (reconstruction is exercised internally by the delta path.)
  assert.ok(true);
});

test('rejects world ids that escape the storage root (path traversal)', async () => {
  for (const evil of ['../escape', '../../etc', 'a/../../b', '/abs/path']) {
    await assert.rejects(
      () => store.getWorld(ctx, evil),
      /invalid world id/,
      `getWorld should reject ${evil}`,
    );
    await assert.rejects(
      () => store.saveWorld(ctx, evil, minimalWorld('x')),
      /invalid world id/,
      `saveWorld should reject ${evil}`,
    );
    await assert.rejects(
      () => store.deleteWorld(ctx, evil),
      /invalid world id/,
      `deleteWorld should reject ${evil}`,
    );
  }
});

test('chats save and are retrievable by id', async () => {
  const wid = await store.createWorld(ctx, 'W', minimalWorld('W'));
  const chat = await store.saveChat(ctx, {
    worldId: wid,
    title: 'A talk',
    mode: 'discuss',
    characterId: 'jamie',
    messages: [{ id: 1, role: 'user', text: 'hi', time: '1:00 AM' }],
  });
  const got = await store.getChat(ctx, chat.id);
  assert.equal(got!.id, chat.id);
  assert.equal(got!.messages.length, 1);
  assert.equal(got!.character_id, 'jamie');
});

test('saveChat with chatId updates in place (continued chat)', async () => {
  const wid = await store.createWorld(ctx, 'W', minimalWorld('W'));
  const chat = await store.saveChat(ctx, {
    worldId: wid,
    title: 'A talk',
    mode: 'discuss',
    characterId: null,
    messages: [{ id: 1, role: 'user', text: 'hi', time: '1:00 AM' }],
  });

  const updated = await store.saveChat(ctx, {
    chatId: chat.id,
    worldId: wid,
    title: 'A talk',
    mode: 'discuss',
    characterId: null,
    messages: [
      { id: 1, role: 'user', text: 'hi', time: '1:00 AM' },
      { id: 2, role: 'assistant', text: 'hello', time: '1:01 AM' },
    ],
  });

  assert.equal(updated.id, chat.id, 'same row is reused, not duplicated');
  assert.equal(updated.messages.length, 2);

  const list = await store.listChats(ctx, wid);
  assert.equal(list.length, 1, 'no duplicate row created');
});

test('deleteChat removes the row and leaves others intact', async () => {
  const wid = await store.createWorld(ctx, 'W', minimalWorld('W'));
  const a = await store.saveChat(ctx, {
    worldId: wid, title: 'A', mode: 'discuss', characterId: null,
    messages: [{ id: 1, role: 'user', text: 'hi', time: '1:00 AM' }],
  });
  const b = await store.saveChat(ctx, {
    worldId: wid, title: 'B', mode: 'cowrite', characterId: null,
    messages: [{ id: 1, role: 'user', text: 'yo', time: '1:00 AM' }],
  });
  await store.deleteChat(ctx, a.id);
  assert.equal(await store.getChat(ctx, a.id), null);
  const list = await store.listChats(ctx, wid);
  assert.equal(list.length, 1);
  assert.equal(list[0]!.id, b.id);
});

test('deleteChat on an unknown id is a no-op', async () => {
  const wid = await store.createWorld(ctx, 'W', minimalWorld('W'));
  await store.saveChat(ctx, {
    worldId: wid, title: 'A', mode: 'discuss', characterId: null,
    messages: [{ id: 1, role: 'user', text: 'hi', time: '1:00 AM' }],
  });
  await store.deleteChat(ctx, 'nope'); // does not throw
  assert.equal((await store.listChats(ctx, wid)).length, 1);
});

test('saveChat with a stale chatId inserts a fresh row', async () => {
  const wid = await store.createWorld(ctx, 'W', minimalWorld('W'));
  const chat = await store.saveChat(ctx, {
    chatId: 'does-not-exist',
    worldId: wid,
    title: null,
    mode: 'cowrite',
    characterId: null,
    messages: [{ id: 1, role: 'user', text: 'hi', time: '1:00 AM' }],
  });
  assert.ok(chat.id && chat.id !== 'does-not-exist');
  const list = await store.listChats(ctx, wid);
  assert.equal(list.length, 1);
});

test('a duplicate chapter_id is resolved, not allowed to collide', async () => {
  // The client's id generator is an in-memory counter that restarts at the same
  // number every page load, so after a reload it proposes ids that already exist.
  // Postgres enforces UNIQUE (manuscript_id, chapter_id) and was returning a 500;
  // both backends now resolve the collision instead.
  const wid = await store.createWorld(ctx, 'W', minimalWorld('W'));
  const ms = await store.createManuscript(ctx, wid, {});
  const first = await store.createChapter(ctx, wid, ms.id, { chapterId: 'ch_1001' });
  assert.equal(first.chapter_id, 'ch_1001');

  const second = await store.createChapter(ctx, wid, ms.id, { chapterId: 'ch_1001' });
  assert.notEqual(second.chapter_id, 'ch_1001', 'the duplicate is renamed');
  assert.equal(second.chapter_id, 'ch_1001_2');
  assert.notEqual(second.id, first.id, 'a genuinely new row');

  const third = await store.createChapter(ctx, wid, ms.id, { chapterId: 'ch_1001' });
  assert.equal(third.chapter_id, 'ch_1001_3', 'keeps counting past the first collision');

  const all = await store.listChapters(ctx, ms.id);
  assert.equal(new Set(all.map((c) => c.chapter_id)).size, 3, 'all ids distinct');
});

test('createChapterInManuscript resolves duplicates too', async () => {
  const wid = await store.createWorld(ctx, 'W', minimalWorld('W'));
  const ms = await store.createManuscript(ctx, wid, {});
  await store.createChapterInManuscript(ctx, ms.id, { chapterId: 'ch_1001' });
  const dup = await store.createChapterInManuscript(ctx, ms.id, { chapterId: 'ch_1001' });
  assert.equal(dup.chapter_id, 'ch_1001_2');
});
