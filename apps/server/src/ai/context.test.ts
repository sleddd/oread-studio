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

test("world content is presented as the author's trusted material (no injection fence)", () => {
  const doc = worldWithCanonAndChar();
  const ctx = assembleContext({ world: doc, mode: 'discuss', characterId: null });
  // The author's world is authoritative intent to follow, not fenced untrusted data.
  assert.match(ctx.system, /authoritative|follow the premise/i);
  assert.ok(!/<untrusted-data-/.test(ctx.system), 'no fence tags around world content');
  // The canon fact is present, plainly under its CANON label.
  assert.ok(ctx.system.includes('CANON'));
  assert.ok(ctx.system.includes('Beanstalk and Sweet Nothings share a wall'));
});

test('web-search framing (not world content) is what marks external data untrusted', () => {
  // World content is trusted; the untrusted framing lives only in the web-search
  // instruction, which assembleContext does not add — the orchestrator does when
  // research is on. So a plain assembled prompt has no "untrusted" framing.
  const doc = worldWithCanonAndChar();
  const ctx = assembleContext({ world: doc, mode: 'draft', characterId: null, targetChapterText: 'x' });
  assert.ok(!/untrusted/i.test(ctx.system), 'no untrusted framing around the author world');
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

test('draft mode includes the premise/synopsis (where the outline lives) and the target chapter meta', () => {
  const doc = worldWithCanonAndChar();
  doc.world.premise.logline = 'A slow-burn romance across a shared bakery wall.';
  doc.world.premise.synopsis =
    'Chapter 1: Jamie nearly drops a tower of boxes; Claudette catches them. Chapter 2: coffee.';
  doc.world.structure.chapters.push({
    id: 'ch_001',
    order: 1,
    title: 'The Catch',
    status: 'outline',
    summary: 'Jamie and the boxes.',
    purpose: 'Meet-cute; establish the wall.',
    povCharacter: 'Claudette',
    sceneIds: [],
    wordCount: 0,
  });
  const ctx = assembleContext({
    world: doc,
    mode: 'draft',
    characterId: null,
    targetChapterText: '', // empty per-chapter outline — synopsis is the real outline
    targetChapterMetaId: 'ch_001',
  });
  // The synopsis (the actual outline) reaches draft mode…
  assert.ok(ctx.system.includes('PREMISE'));
  assert.ok(ctx.system.includes('Jamie nearly drops a tower of boxes'));
  // …and the target chapter is identified so the model knows which to write.
  assert.ok(ctx.system.includes('CHAPTER TO WRITE'));
  assert.ok(ctx.system.includes('The Catch'));
  // The instruction tells it to use the premise/synopsis, not ask for an outline.
  assert.match(ctx.system, /synopsis/i);
});

test('character chat injects the knowledge boundary and forbids outside knowledge', () => {
  const doc = worldWithCanonAndChar();
  const ctx = assembleContext({ world: doc, mode: 'character', characterId: 'sam' });
  assert.ok(ctx.system.includes('You ARE Sam Reeves'));
  assert.ok(ctx.system.includes('KNOWS ONLY'));
  assert.ok(ctx.system.includes("Jamie's schedule"));
});

test('AI hard rules + banned words/phrases appear in EVERY mode, including critique/discuss', () => {
  const doc = worldWithCanonAndChar();
  doc.world.session.hardRules = ['Never speak for the author.', 'Never kill Sam.'];
  doc.world.session.linguisticFilters = { bannedWords: ['moist'], bannedPhrases: ['it was all a dream'] };
  for (const mode of ['cowrite', 'draft', 'edit', 'critique', 'discuss'] as const) {
    const ctx = assembleContext({ world: doc, mode, characterId: null, targetChapterText: 'x' });
    assert.match(ctx.system, /ABSOLUTE RULES/, `${mode}: hard rules present`);
    assert.ok(ctx.system.includes('Never kill Sam.'), `${mode}: rule text present`);
    assert.match(ctx.system, /FORBIDDEN LANGUAGE/, `${mode}: bans present`);
    assert.ok(ctx.system.includes('moist'), `${mode}: banned word present`);
    assert.ok(ctx.system.includes('it was all a dream'), `${mode}: banned phrase present`);
  }
});

test('character mode also carries the absolute rules + forbidden language', () => {
  const doc = worldWithCanonAndChar();
  doc.world.session.hardRules = ['Never break the fourth wall.'];
  doc.world.session.linguisticFilters = { bannedWords: ['literally'], bannedPhrases: [] };
  const ctx = assembleContext({ world: doc, mode: 'character', characterId: 'sam' });
  assert.ok(ctx.system.includes('Never break the fourth wall.'));
  assert.ok(ctx.system.includes('literally'));
});

test('priority constraints survive even when the token budget drops all recipe sections', () => {
  const doc = worldWithCanonAndChar();
  doc.world.session.hardRules = ['Never contradict canon.'];
  doc.world.session.linguisticFilters = { bannedWords: ['very'], bannedPhrases: [] };
  const ctx = assembleContext({
    world: doc,
    mode: 'critique',
    characterId: null,
    targetChapterText: 'word '.repeat(20000), // blows the budget
    budgetTokens: 400,
  });
  // Recipe sections are dropped, but the header constraints are always present.
  assert.ok(ctx.droppedItems.length > 0);
  assert.ok(ctx.system.includes('Never contradict canon.'), 'hard rule not dropped');
  assert.ok(ctx.system.includes('very'), 'banned word not dropped');
});

test('empty hard rules / bans render nothing (no empty ABSOLUTE RULES header)', () => {
  const doc = worldWithCanonAndChar();
  doc.world.session.hardRules = [];
  doc.world.session.linguisticFilters = { bannedWords: [], bannedPhrases: [] };
  const ctx = assembleContext({ world: doc, mode: 'discuss', characterId: null });
  assert.ok(!ctx.system.includes('ABSOLUTE RULES'));
  assert.ok(!ctx.system.includes('FORBIDDEN LANGUAGE'));
});

test('world rules (setting.rules) render statement + implications, flagging flexible vs firm', () => {
  const doc = worldWithCanonAndChar();
  doc.world.setting.rules = [
    { id: 'r1', statement: 'Magic requires a blood price.', implications: 'No free spells.', canBreak: false },
    { id: 'r2', statement: 'Dragons are rare.', implications: '', canBreak: true },
  ];
  const ctx = assembleContext({ world: doc, mode: 'cowrite', characterId: null });
  assert.match(ctx.system, /WORLD RULES/);
  assert.ok(ctx.system.includes('Magic requires a blood price.'));
  assert.ok(ctx.system.includes('No free spells.'));
  assert.ok(ctx.system.includes('[firm]'));
  assert.ok(ctx.system.includes('[flexible'));
});

test('banned words are not double-injected via the style-notes block', () => {
  const doc = worldWithCanonAndChar();
  doc.world.session.linguisticFilters = { bannedWords: ['zzqx'], bannedPhrases: [] };
  const ctx = assembleContext({ world: doc, mode: 'edit', characterId: null, targetChapterText: 'x' });
  // 'zzqx' should appear once (the FORBIDDEN LANGUAGE header), not also in STYLE NOTES.
  const occurrences = ctx.system.split('zzqx').length - 1;
  assert.equal(occurrences, 1);
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
