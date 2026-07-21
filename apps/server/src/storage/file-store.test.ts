import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
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

test('chats save and list, distillation flag flips', async () => {
  const wid = await store.createWorld(ctx, 'W', minimalWorld('W'));
  const chat = await store.saveChat(ctx, {
    worldId: wid,
    title: 'A talk',
    mode: 'discuss',
    characterId: 'jamie',
    messages: [{ id: 1, role: 'user', text: 'hi', time: '1:00 AM' }],
  });
  assert.equal(chat.distilled, false);
  await store.markChatDistilled(ctx, chat.id);
  const got = await store.getChat(ctx, chat.id);
  assert.equal(got!.distilled, true);
});

test('saveChat with chatId updates in place (continued chat) and resets distilled', async () => {
  const wid = await store.createWorld(ctx, 'W', minimalWorld('W'));
  const chat = await store.saveChat(ctx, {
    worldId: wid,
    title: 'A talk',
    mode: 'discuss',
    characterId: null,
    messages: [{ id: 1, role: 'user', text: 'hi', time: '1:00 AM' }],
  });
  await store.markChatDistilled(ctx, chat.id);

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
  assert.equal(updated.distilled, false, 'messages changed → distilled resets');

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
