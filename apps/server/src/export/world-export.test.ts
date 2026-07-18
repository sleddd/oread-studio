import { test, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileStore } from '../storage/file-store.js';
import { buildWorldExport } from './world-export.js';
import { emptyWorld } from '../world/factory.js';
import type { StoreCtx } from '../storage/types.js';

const ctx: StoreCtx = { schemaName: 'u_00000000000000000000000000000000' };
let dir: string;
let store: FileStore;

before(() => {
  process.env.MASTER_KEY_V1 = randomBytes(32).toString('base64');
});
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'oread-export-'));
  store = new FileStore(dir);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test('world.json export includes manuscripts + chapters', async () => {
  const doc = emptyWorld('Sweet Nothings');
  const wid = await store.createWorld(ctx, 'Sweet Nothings', doc);
  const ms = await store.createManuscript(ctx, wid, { name: 'Book One', format: 'novel' });
  await store.createChapter(ctx, wid, ms.id, { chapterId: 'ch_001', content: 'hello world' });

  const out = await buildWorldExport(store, ctx, wid);
  assert.ok(out);
  assert.equal(out!.format, 'oread.world/v1');
  assert.equal(out!.manuscripts.length, 1);
  assert.equal(out!.manuscripts[0]!.chapters[0]!.content, 'hello world');
});

test('export leaves credentialId dangling and strips any key material', async () => {
  const doc = emptyWorld('W');
  // Simulate a configured credential + a smuggled raw key on the single model.
  doc.world.session.model.credentialId = 'cred_123';
  (doc.world.session.model as unknown as Record<string, unknown>).apiKey = 'sk-ant-should-not-export';
  const wid = await store.createWorld(ctx, 'W', doc);

  const out = await buildWorldExport(store, ctx, wid);
  const serialized = JSON.stringify(out);
  assert.ok(!serialized.includes('sk-ant-should-not-export'), 'no raw key in export');
  assert.equal(
    out!.world.world.session.model.credentialId,
    null,
    'credentialId nulled to a dangling reference',
  );
});
