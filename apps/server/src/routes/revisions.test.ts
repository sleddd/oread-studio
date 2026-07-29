/**
 * Chapter revision-control routes: the save-reason distinction (autosave vs the
 * explicit 'manual' draft point) and restore, which must never lose work and
 * must not reach across chapters.
 */
import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { FileStore } from '../storage/file-store.js';
import { setStore } from '../storage/index.js';
import { emptyWorld } from '../world/factory.js';

const SCHEMA = 'u_00000000000000000000000000000000';
const CTX = () => ({ schemaName: SCHEMA });
let dir: string;
let store: FileStore;
let app: FastifyInstance;

before(() => {
  process.env.SESSION_SECRET = randomBytes(24).toString('base64');
  process.env.MASTER_KEY_V1 = randomBytes(32).toString('base64');
  process.env.OREAD_STORAGE = 'local';
});

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'oread-rev-'));
  store = new FileStore(dir);
  setStore(store);
  const { buildApp } = await import('../app.js');
  app = await buildApp();
  app.addHook('onRequest', async (req) => {
    req.auth = {
      user: { id: 'u1', email: 'a@b.c', name: 'A', schemaName: SCHEMA, totpEnabled: false },
      userRow: {} as never,
      sessionId: 's1',
    };
  });
});

afterEach(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
  setStore(null);
});

async function newChapter(content: string) {
  const wid = await store.createWorld(CTX(), 'W', emptyWorld('W'));
  const ms = await store.createManuscript(CTX(), wid, {});
  return store.createChapter(CTX(), wid, ms.id, { chapterId: 'ch_001', content });
}

test("content save defaults to 'autosave' and honours an explicit 'manual'", async () => {
  const ch = await newChapter('v1');

  await app.inject({
    method: 'PUT',
    url: `/api/chapters/${ch.id}/content`,
    payload: { content: 'v2' },
  });
  await app.inject({
    method: 'PUT',
    url: `/api/chapters/${ch.id}/content`,
    payload: { content: 'v3', reason: 'manual' },
  });

  const revs = await store.listChapterRevisions(CTX(), ch.id);
  const reasons = revs.map((r) => r.reason).sort();
  assert.deepEqual(reasons, ['autosave', 'manual']);
});

test('an unknown reason cannot smuggle in a non-prunable revision', async () => {
  const ch = await newChapter('v1');
  await app.inject({
    method: 'PUT',
    url: `/api/chapters/${ch.id}/content`,
    payload: { content: 'v2', reason: 'pre_ai_edit' },
  });
  const revs = await store.listChapterRevisions(CTX(), ch.id);
  assert.equal(revs[0]!.reason, 'autosave', 'only autosave|manual are accepted here');
});

test('restore brings back old content and keeps the replaced version', async () => {
  const ch = await newChapter('the original');
  await app.inject({
    method: 'PUT',
    url: `/api/chapters/${ch.id}/content`,
    payload: { content: 'the rewrite', reason: 'manual' },
  });

  const revs = await store.listChapterRevisions(CTX(), ch.id);
  const original = revs.find((r) => r.content === 'the original');
  assert.ok(original, 'the pre-rewrite text is in history');

  const res = await app.inject({
    method: 'POST',
    url: `/api/chapters/${ch.id}/restore`,
    payload: { revisionId: original.id },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().chapter.content, 'the original');

  const after = await store.listChapterRevisions(CTX(), ch.id);
  assert.ok(
    after.some((r) => r.content === 'the rewrite'),
    'restore is undoable — the replaced text was snapshotted',
  );
});

test('restore refuses a revision belonging to another chapter', async () => {
  const wid = await store.createWorld(CTX(), 'W', emptyWorld('W'));
  const ms = await store.createManuscript(CTX(), wid, {});
  const a = await store.createChapter(CTX(), wid, ms.id, { chapterId: 'ch_a', content: 'alpha' });
  const b = await store.createChapter(CTX(), wid, ms.id, { chapterId: 'ch_b', content: 'bravo' });

  // Give chapter B a revision, then try to restore it onto chapter A.
  await store.saveChapterContent(CTX(), b.id, 'bravo two', 'manual');
  const bRevs = await store.listChapterRevisions(CTX(), b.id);
  assert.ok(bRevs.length > 0);

  const res = await app.inject({
    method: 'POST',
    url: `/api/chapters/${a.id}/restore`,
    payload: { revisionId: bRevs[0]!.id },
  });
  assert.equal(res.statusCode, 404, "another chapter's revision is not addressable");

  const stillA = await store.getChapter(CTX(), a.id);
  assert.equal(stillA!.content, 'alpha', 'chapter A was not touched');
});

test('restore without a revisionId is a 400', async () => {
  const ch = await newChapter('x');
  const res = await app.inject({
    method: 'POST',
    url: `/api/chapters/${ch.id}/restore`,
    payload: {},
  });
  assert.equal(res.statusCode, 400);
});
