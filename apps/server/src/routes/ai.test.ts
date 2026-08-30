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

test('discuss may not apply — 403', async () => {
  const wid = await store.createWorld(SCHEMA_CTX(), 'W', emptyWorld('W'));
  const ms = await store.createManuscript(SCHEMA_CTX(), wid, {});
  const ch = await store.createChapter(SCHEMA_CTX(), wid, ms.id, { chapterId: 'ch_001', content: 'x' });
  const res = await app.inject({
    method: 'POST',
    url: '/api/ai/apply',
    payload: { mode: 'discuss', chapterRowId: ch.id, text: 'nope', reason: 'pre_ai_edit' },
  });
  assert.equal(res.statusCode, 403);
});

async function chapterWith(content: string) {
  const wid = await store.createWorld(SCHEMA_CTX(), 'W', emptyWorld('W'));
  const ms = await store.createManuscript(SCHEMA_CTX(), wid, {});
  return store.createChapter(SCHEMA_CTX(), wid, ms.id, { chapterId: 'ch_001', content });
}

test('an edit REPLACES its span instead of appending', async () => {
  const ch = await chapterWith('One. The moist air hung there. Three.');

  const res = await app.inject({
    method: 'POST',
    url: '/api/ai/apply',
    payload: {
      mode: 'edit',
      chapterRowId: ch.id,
      original: 'The moist air hung there.',
      text: 'The damp air hung there.',
      reason: 'pre_ai_edit',
    },
  });

  assert.equal(res.statusCode, 200);
  const content = res.json().chapter.content;
  assert.equal(content, 'One. The damp air hung there. Three.');
  assert.ok(!content.includes('moist'), 'the flagged text is GONE, not left for a re-flag');
});

test('critique applies as a replacement too', async () => {
  const ch = await chapterWith('Alpha. Bravo. Charlie.');
  const res = await app.inject({
    method: 'POST',
    url: '/api/ai/apply',
    payload: {
      mode: 'critique',
      chapterRowId: ch.id,
      original: 'Bravo.',
      text: 'Bravissimo.',
      reason: 'pre_ai_draft',
    },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().chapter.content, 'Alpha. Bravissimo. Charlie.');
});

test('a stale span is refused rather than silently appended', async () => {
  const ch = await chapterWith('The author has since rewritten this passage.');
  const res = await app.inject({
    method: 'POST',
    url: '/api/ai/apply',
    payload: {
      mode: 'edit',
      chapterRowId: ch.id,
      original: 'a sentence that is no longer in the draft',
      text: 'replacement',
      reason: 'pre_ai_edit',
    },
  });
  assert.equal(res.statusCode, 409);

  const after = await store.getChapter(SCHEMA_CTX(), ch.id);
  assert.equal(after!.content, 'The author has since rewritten this passage.', 'untouched');
  const revs = await store.listChapterRevisions(SCHEMA_CTX(), ch.id);
  assert.equal(revs.length, 0, 'a refused apply takes no revision');
});

test('only the FIRST occurrence is replaced', async () => {
  const ch = await chapterWith('Repeat. Repeat. Repeat.');
  const res = await app.inject({
    method: 'POST',
    url: '/api/ai/apply',
    payload: {
      mode: 'edit',
      chapterRowId: ch.id,
      original: 'Repeat.',
      text: 'Changed.',
      reason: 'pre_ai_edit',
    },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().chapter.content, 'Changed. Repeat. Repeat.');
});

test('prose modes still append', async () => {
  const ch = await chapterWith('Existing prose.');
  const res = await app.inject({
    method: 'POST',
    url: '/api/ai/apply',
    payload: { mode: 'cowrite', chapterRowId: ch.id, text: 'A new turn.', reason: 'pre_ai_draft' },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().chapter.content, 'Existing prose.\n\nA new turn.');
});

function SCHEMA_CTX() {
  return { schemaName: SCHEMA };
}
