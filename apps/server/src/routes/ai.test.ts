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
let dir: string;
let store: FileStore;
let app: FastifyInstance;

before(() => {
  process.env.SESSION_SECRET = randomBytes(24).toString('base64');
  process.env.MASTER_KEY_V1 = randomBytes(32).toString('base64');
  process.env.OREAD_STORAGE = 'local';
});

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'oread-ai-'));
  store = new FileStore(dir);
  setStore(store);
  // Build app AFTER injecting the store so routes capture it.
  const { buildApp } = await import('../app.js');
  app = await buildApp();
  // Stub auth: decorate every request with a fake session.
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

test('apply snapshots the chapter BEFORE the AI-applied change', async () => {
  const wid = await store.createWorld(SCHEMA_CTX(), 'W', emptyWorld('W'));
  const ms = await store.createManuscript(SCHEMA_CTX(), wid, {});
  const ch = await store.createChapter(SCHEMA_CTX(), wid, ms.id, {
    chapterId: 'ch_001',
    content: 'the original prose',
  });

  const res = await app.inject({
    method: 'POST',
    url: '/api/ai/apply',
    payload: {
      mode: 'draft',
      chapterRowId: ch.id,
      text: 'AI-DRAFTED CONTINUATION',
      reason: 'pre_ai_draft',
    },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.ok(body.chapter.content.includes('AI-DRAFTED CONTINUATION'));
  assert.ok(body.chapter.content.startsWith('the original prose'));

  const revs = await store.listChapterRevisions(SCHEMA_CTX(), ch.id);
  assert.equal(revs.length, 1);
  assert.equal(revs[0]!.reason, 'pre_ai_draft');
  assert.equal(revs[0]!.content, 'the original prose', 'snapshot holds PRE-change content');
});

test('critique may not apply — 403', async () => {
  const wid = await store.createWorld(SCHEMA_CTX(), 'W', emptyWorld('W'));
  const ms = await store.createManuscript(SCHEMA_CTX(), wid, {});
  const ch = await store.createChapter(SCHEMA_CTX(), wid, ms.id, { chapterId: 'ch_001', content: 'x' });
  const res = await app.inject({
    method: 'POST',
    url: '/api/ai/apply',
    payload: { mode: 'critique', chapterRowId: ch.id, text: 'nope', reason: 'pre_ai_edit' },
  });
  assert.equal(res.statusCode, 403);
});

function SCHEMA_CTX() {
  return { schemaName: SCHEMA };
}
