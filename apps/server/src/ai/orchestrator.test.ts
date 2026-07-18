import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { generate } from './orchestrator.js';
import { emptyWorld } from '../world/factory.js';
import type { StoreCtx } from '../storage/types.js';

const ctx: StoreCtx = { schemaName: 'u_00000000000000000000000000000000' };

before(() => {
  process.env.MASTER_KEY_V1 = randomBytes(32).toString('base64');
  process.env.MASTER_KEY_ACTIVE_VER = '1';
});

test('mock fallback: discuss produces text, writes nothing', async () => {
  const world = emptyWorld('W');
  const out = await generate({
    ctx,
    world,
    mode: 'discuss',
    characterId: null,
    messages: [{ role: 'user', content: 'How would Jamie react?' }],
    targetChapterId: 'ch_row_1',
  });
  assert.equal(out.kind, 'text');
  assert.ok(out.usedMock);
  assert.ok(out.text && out.text.length > 0);
});

test('mock fallback: cowrite produces prose', async () => {
  const world = emptyWorld('W');
  const out = await generate({
    ctx,
    world,
    mode: 'cowrite',
    characterId: null,
    messages: [{ role: 'user', content: 'Take the next paragraph.' }],
    targetChapterId: 'ch_row_1',
  });
  assert.equal(out.kind, 'prose');
});

test('mock fallback: edit produces an applicable suggestion', async () => {
  const world = emptyWorld('W');
  const out = await generate({
    ctx,
    world,
    mode: 'edit',
    characterId: null,
    messages: [{ role: 'user', content: 'Redline my lines.' }],
    targetChapterId: 'ch_row_1',
  });
  assert.equal(out.kind, 'suggestion');
  assert.ok(out.suggestion);
  assert.equal(out.suggestion!.status, 'pending');
});

test('mock fallback: critique produces a suggestion (never auto-applied)', async () => {
  const world = emptyWorld('W');
  const out = await generate({
    ctx,
    world,
    mode: 'critique',
    characterId: null,
    messages: [{ role: 'user', content: 'Run the critique.' }],
    targetChapterId: 'ch_row_1',
  });
  assert.equal(out.kind, 'suggestion');
});
