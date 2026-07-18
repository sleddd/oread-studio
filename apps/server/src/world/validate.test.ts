import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkWorld, validateWorld, WorldValidationError } from './validate.js';
import { emptyWorld } from './factory.js';

test('the empty-world factory produces a valid document', () => {
  const { valid, errors } = checkWorld(emptyWorld());
  assert.equal(valid, true, errors.join('; '));
});

test('missing a top-level section fails loudly', () => {
  const doc = emptyWorld() as unknown as { world: Record<string, unknown> };
  delete doc.world.memory;
  const { valid, errors } = checkWorld(doc);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('memory')));
});

test('bad enum value is rejected', () => {
  const doc = emptyWorld();
  (doc.world.identity as { mode: string }).mode = 'nonsense';
  assert.throws(() => validateWorld(doc), WorldValidationError);
});

test('raw key material in a mode config is rejected', () => {
  const doc = emptyWorld();
  (doc.world.session.modeConfigs.cowrite as unknown as Record<string, unknown>).apiKey =
    'sk-ant-leaked';
  const { valid, errors } = checkWorld(doc);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('credentialId')));
});

test('draft.canAlterCanon=true is rejected', () => {
  const doc = emptyWorld();
  (doc.world.session.modeConfigs.draft as unknown as Record<string, unknown>).canAlterCanon = true;
  const { valid, errors } = checkWorld(doc);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes('canAlterCanon')));
});
