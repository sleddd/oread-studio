import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { generate, coerceSuggestion } from './orchestrator.js';
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

test('coerceSuggestion whitelists type and rejects an injected type value', () => {
  const s = coerceSuggestion(
    JSON.stringify({ type: 'delete-everything', original: 'a', proposed: 'b', rationale: 'x' }),
    'ch_row_1',
    'edit',
  );
  assert.equal(s.type, 'rewrite', 'unknown type falls back to rewrite, never trusted');
});

test('coerceSuggestion sanitizes a malformed anchor to non-negative ordered ints', () => {
  const s = coerceSuggestion(
    JSON.stringify({ type: 'cut', anchor: { start: -5, end: 'nonsense' }, rationale: 'x' }),
    'ch_row_1',
    'edit',
  );
  assert.ok(s.anchor.start >= 0 && s.anchor.end >= s.anchor.start);
});

test('coerceSuggestion coerces non-string fields and caps rationale length', () => {
  const s = coerceSuggestion(
    JSON.stringify({ type: 'flag', original: 123, proposed: {}, rationale: 'r'.repeat(9000) }),
    'ch_row_1',
    'critique',
  );
  assert.equal(typeof s.original, 'string');
  assert.equal(s.original, '', 'non-string original becomes empty, not "[object]"');
  assert.equal(s.proposed, null, 'non-string proposed becomes null');
  assert.ok(s.rationale.length <= 2000);
});

test('coerceSuggestion with no JSON degrades to a flag carrying the raw text', () => {
  const s = coerceSuggestion('just some prose, no json here', 'ch_row_1', 'critique');
  assert.equal(s.type, 'flag');
  assert.ok(s.rationale.includes('just some prose'));
});
