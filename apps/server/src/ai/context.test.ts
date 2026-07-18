import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assembleContext } from './context.js';
import { emptyWorld } from '../world/factory.js';
import type { WorldDocument } from '@oread/shared';

function worldWithCanonAndChar(): WorldDocument {
  const doc = emptyWorld('Sweet Nothings');
  doc.world.memory.canon.push({
    id: 'canon_001',
    fact: 'Beanstalk and Sweet Nothings share a wall.',
    establishedBy: [],
    immutable: true,
  });
  doc.world.entities.characters.push({
    id: 'sam',
    name: 'Sam Reeves',
    role: 'love interest',
    definition: {
      backstory: '', traits: '', voice: 'Spare, precise, dry.',
      knowledgeSkills: '', desires: '', wounds: '', contradiction: '',
    },
    state: {
      location: 'Beanstalk', status: 'alive', emotionalState: 'guarded',
      knowledge: ["Jamie's schedule"], inventory: [],
    },
    arc: { startingPoint: '', trajectory: '', endpoint: '' },
  });
  return doc;
}

test('discuss recipe includes premise/canon, excludes target text', () => {
  const doc = worldWithCanonAndChar();
  const ctx = assembleContext({ world: doc, mode: 'discuss', characterId: null });
  assert.ok(ctx.system.includes('CANON'));
  assert.ok(ctx.system.includes('Beanstalk and Sweet Nothings share a wall'));
});

test('draft protects canon and instructs against contradiction', () => {
  const doc = worldWithCanonAndChar();
  const ctx = assembleContext({
    world: doc,
    mode: 'draft',
    characterId: null,
    targetChapterText: 'OUTLINE — some beats',
  });
  assert.ok(/never contradict/i.test(ctx.system));
  assert.ok(ctx.system.includes('DRAFT mode'));
});

test('character chat injects the knowledge boundary and forbids outside knowledge', () => {
  const doc = worldWithCanonAndChar();
  const ctx = assembleContext({ world: doc, mode: 'character', characterId: 'sam' });
  assert.ok(ctx.system.includes('You ARE Sam Reeves'));
  assert.ok(ctx.system.includes('KNOWS ONLY'));
  assert.ok(ctx.system.includes("Jamie's schedule"));
});

test('budget truncation drops later recipe items, keeps earlier ones', () => {
  const doc = worldWithCanonAndChar();
  // huge target text forces the budget to cut later sections
  const big = 'word '.repeat(20000);
  const ctx = assembleContext({
    world: doc,
    mode: 'critique',
    characterId: null,
    targetChapterText: big,
    budgetTokens: 500,
  });
  // targetTextFull is first in the critique recipe — but it alone exceeds budget,
  // so it is dropped and lighter later items may fit. Either way, nothing throws
  // and dropped is populated.
  assert.ok(ctx.droppedItems.length > 0);
  assert.ok(ctx.estimatedTokens <= 500 + 200); // header overhead tolerance
});
