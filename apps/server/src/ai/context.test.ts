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

// ── character chat: the model must know WHO it is and WHERE it lives ──

function roleplayWorld() {
  const doc = emptyWorld('W');
  const w = doc.world;
  w.setting.lore = 'The lake floods every spring.';
  w.setting.locations.push({
    id: 'l1', name: 'The Beanstalk', description: 'Coffee shop on 9th.', significance: '', tags: [],
  });
  w.entities.characters.push(
    {
      id: 'c1', name: 'Claudette', role: 'protagonist',
      definition: { voice: 'Clipped.', traits: 'guarded', backstory: 'Left at 19.', desires: 'forgiveness', wounds: 'the drowning', contradiction: 'craves what she flees', knowledgeSkills: '' },
      state: { location: [], status: 'alive', emotionalState: 'wary', knowledge: ['Her brother drowned'], inventory: [] },
      arc: { startingPoint: 'closed', trajectory: 'opens', endpoint: 'stays' },
    },
    {
      id: 'c2', name: 'Henry', role: 'supporting',
      definition: { voice: 'Warm.', traits: 'patient', backstory: '', desires: '', wounds: '', contradiction: '', knowledgeSkills: '' },
      state: { location: [], status: 'alive', emotionalState: '', knowledge: [], inventory: [] },
      arc: { startingPoint: '', trajectory: '', endpoint: '' },
    },
  );
  w.entities.relationships.push({
    id: 'r1', between: ['c1', 'c2'], type: 'estranged siblings', description: '', tension: 'unspoken blame', history: [],
  });
  return doc;
}

test('character chat receives the WHOLE character, not just a voice line', () => {
  const ctx = assembleContext({ world: roleplayWorld(), mode: 'character', characterId: 'c1' });
  assert.match(ctx.system, /You ARE Claudette/);
  // The definition fields that were previously missing entirely.
  for (const facet of ['Left at 19', 'forgiveness', 'the drowning', 'craves what she flees', 'guarded']) {
    assert.ok(ctx.system.includes(facet), `missing definition facet: ${facet}`);
  }
  assert.match(ctx.system, /Feeling: wary/, 'current state');
  assert.match(ctx.system, /Becoming: opens/, 'arc');
  assert.match(ctx.system, /KNOWS ONLY/, 'knowledge boundary still enforced');
});

test('character chat receives the world the character lives in', () => {
  const ctx = assembleContext({ world: roleplayWorld(), mode: 'character', characterId: 'c1' });
  assert.match(ctx.system, /Henry, supporting/, 'knows the other cast');
  assert.match(ctx.system, /estranged siblings/, 'knows the relationship');
  assert.match(ctx.system, /Beanstalk/, 'knows the places');
  assert.match(ctx.system, /lake floods/, 'knows the lore');
});

test("another character's private interiority is NOT handed over", () => {
  const doc = roleplayWorld();
  doc.world.entities.characters[1]!.definition.wounds = 'a secret shame';
  const ctx = assembleContext({ world: doc, mode: 'character', characterId: 'c1' });
  assert.ok(!ctx.system.includes('a secret shame'), "must not leak Henry's private wounds");
});

test('the author speaks as themselves by default', () => {
  const ctx = assembleContext({ world: roleplayWorld(), mode: 'character', characterId: 'c1' });
  assert.match(ctx.system, /THE AUTHOR of this world, speaking as themselves/);
});

test('the author can speak AS another character', () => {
  const ctx = assembleContext({
    world: roleplayWorld(), mode: 'character', characterId: 'c1', userAs: 'c2',
  });
  assert.match(ctx.system, /playing Henry/);
  assert.match(ctx.system, /Every message from them is Henry speaking to you, in scene/);
  assert.match(ctx.system, /BETWEEN YOU AND HENRY:/);
});

test('playing the same character the AI plays is ignored, not confusing', () => {
  const ctx = assembleContext({
    world: roleplayWorld(), mode: 'character', characterId: 'c1', userAs: 'c1',
  });
  assert.ok(!/playing Claudette/.test(ctx.system), 'no nonsensical self-pairing');
});

test('non-character modes are unaffected by userAs', () => {
  const ctx = assembleContext({
    world: roleplayWorld(), mode: 'discuss', characterId: null, userAs: 'c2',
  });
  assert.ok(!/playing Henry/.test(ctx.system));
  assert.ok(!/You ARE/.test(ctx.system));
});

// ── draft/co-write: the model must see the REAL preceding prose, and the world ──

function bookWorld() {
  const doc = emptyWorld('W');
  const w = doc.world;
  w.setting.lore = 'The lake floods every spring.';
  w.setting.timePeriod = '1997, rural Michigan';
  w.setting.locations.push({
    id: 'l1', name: 'The Beanstalk', description: 'Coffee shop on 9th.', significance: 'Where they last spoke', tags: [],
  });
  w.entities.characters.push({
    id: 'c1', name: 'Claudette', role: 'protagonist',
    definition: { voice: 'Clipped.', traits: 'guarded', backstory: '', desires: 'forgiveness', wounds: 'the drowning', contradiction: '', knowledgeSkills: '' },
    state: { location: [], status: 'alive', emotionalState: 'wary', knowledge: [], inventory: [] },
    arc: { startingPoint: '', trajectory: '', endpoint: '' },
  });
  for (let i = 1; i <= 4; i++) {
    w.structure.chapters.push({
      id: `ch${i}`, order: i, title: `Chapter ${i}`, status: 'final',
      summary: `Summary of ${i}.`, purpose: '', povCharacter: '', wordCount: 0,
    });
  }
  return doc;
}

const THREE_BEFORE = [
  { title: 'Chapter 1', text: 'One begins. ENDS_ONE.' },
  { title: 'Chapter 2', text: 'Two begins. ENDS_TWO.' },
  { title: 'Chapter 3', text: 'Three begins. She left the key on the counter.' },
];

test('draft receives the real prose of the preceding chapters', () => {
  const ctx = assembleContext({
    world: bookWorld(), mode: 'draft', characterId: null,
    targetChapterText: '', targetChapterMetaId: 'ch4', precedingChapters: THREE_BEFORE,
  });
  assert.match(ctx.system, /She left the key on the counter/, 'the nearest chapter is verbatim');
  assert.ok(ctx.system.includes('ENDS_ONE'), 'all three preceding chapters reach the model');
  assert.ok(ctx.system.includes('ENDS_TWO'));
  assert.match(ctx.system, /— Chapter 3 —/, 'chapters are labelled');
  assert.match(ctx.system, /do not contradict what happens here/, 'framed as continuity');
});

test('long preceding chapters are trimmed from the FRONT, keeping their endings', () => {
  const long = [{ title: 'Chapter 3', text: 'START_MARKER ' + 'filler '.repeat(5000) + 'FINAL_LINE.' }];
  const ctx = assembleContext({
    world: bookWorld(), mode: 'draft', characterId: null,
    targetChapterMetaId: 'ch4', precedingChapters: long,
  });
  assert.ok(ctx.system.includes('FINAL_LINE.'), 'the ending survives — it is what we continue from');
  assert.ok(!ctx.system.includes('START_MARKER'), 'the front is dropped');
  assert.match(ctx.system, /earlier part of this chapter omitted/, 'the trim is disclosed');
});

test('draft receives the world it must be set in', () => {
  const ctx = assembleContext({
    world: bookWorld(), mode: 'draft', characterId: null,
    targetChapterMetaId: 'ch4', precedingChapters: THREE_BEFORE,
  });
  assert.match(ctx.system, /lake floods/, 'lore');
  assert.match(ctx.system, /1997, rural Michigan/, 'time period');
  assert.match(ctx.system, /Beanstalk/, 'places');
  assert.match(ctx.system, /Wants: forgiveness/, 'character motivation, not just a voice line');
  assert.match(ctx.system, /Wound: the drowning/);
});

test('adjacentChapterSummaries is ADJACENT, not the whole book', () => {
  const doc = bookWorld();
  for (let i = 5; i <= 12; i++) {
    doc.world.structure.chapters.push({
      id: `ch${i}`, order: i, title: `Chapter ${i}`, status: 'outline',
      summary: `FARAWAY_${i}`, purpose: '', povCharacter: '', wordCount: 0,
    });
  }
  const ctx = assembleContext({
    world: doc, mode: 'draft', characterId: null, targetChapterMetaId: 'ch4',
  });
  assert.ok(ctx.system.includes('Summary of 3.'), 'the chapter just before is included');
  assert.ok(ctx.system.includes('FARAWAY_5'), 'the chapter just after is included');
  assert.ok(!ctx.system.includes('FARAWAY_12'), 'a chapter eight ahead is NOT');
  assert.ok(!ctx.system.includes('FARAWAY_8'), 'nor one four ahead');
  // The target's own summary belongs to CHAPTER TO WRITE, not the NEARBY list —
  // it should not be repeated there as if it were context for itself.
  const nearby = ctx.system.match(/NEARBY CHAPTERS \(summaries\):\n([\s\S]*?)(\n\n|$)/)?.[1] ?? '';
  assert.ok(!nearby.includes('Chapter 4:'), 'the target is not listed among its own neighbours');
});

test('preceding prose is absent (not broken) when there is none', () => {
  const ctx = assembleContext({
    world: bookWorld(), mode: 'draft', characterId: null, targetChapterMetaId: 'ch1',
    precedingChapters: [],
  });
  assert.ok(!/CHAPTERS IMMEDIATELY BEFORE/.test(ctx.system), 'no empty section for chapter one');
});

test('co-write also gets the preceding prose', () => {
  const ctx = assembleContext({
    world: bookWorld(), mode: 'cowrite', characterId: null, precedingChapters: THREE_BEFORE,
  });
  assert.match(ctx.system, /She left the key on the counter/);
});

test('a full draft prompt with three long chapters still fits the budget', () => {
  const long = THREE_BEFORE.map((c) => ({ title: c.title, text: c.text + ' ' + 'filler '.repeat(3000) }));
  const ctx = assembleContext({
    world: bookWorld(), mode: 'draft', characterId: null,
    targetChapterMetaId: 'ch4', precedingChapters: long,
  });
  assert.deepEqual(ctx.droppedItems, [], 'nothing is dropped');
  assert.ok(ctx.estimatedTokens < 6000, `within budget (was ${ctx.estimatedTokens})`);
});
