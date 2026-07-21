import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { distillChat, toEvents } from './distill.js';
import { emptyWorld } from '../world/factory.js';
import type { StoreCtx } from '../storage/types.js';

const ctx: StoreCtx = { schemaName: 'u_00000000000000000000000000000000' };

before(() => {
  process.env.MASTER_KEY_V1 = randomBytes(32).toString('base64');
  process.env.MASTER_KEY_ACTIVE_VER = '1';
});

test('heuristic distillation appends events to world.memory.events', async () => {
  const world = emptyWorld('W');
  const before = world.world.memory.events.length;
  const events = await distillChat({
    ctx,
    world,
    mode: 'discuss',
    messages: [
      { id: 1, role: 'user', text: 'Should Noor be the matchmaker?', time: '1:00 AM' },
      { id: 2, role: 'assistant', char: 'narrator', text: 'Yes — make her the orchestrator.', time: '1:00 AM' },
    ],
    chapterContext: 'ch_001',
  });
  assert.ok(events.length >= 1);
  assert.equal(world.world.memory.events.length, before + events.length);
  assert.equal(world.world.memory.events[before]!.chapterContext, 'ch_001');
});

test('empty transcript produces no events', async () => {
  const world = emptyWorld('W');
  const events = await distillChat({ ctx, world, mode: 'discuss', messages: [], chapterContext: '' });
  assert.equal(events.length, 0);
});

test('toEvents whitelists the type — an injected/unknown type falls back to plot', () => {
  const [ev] = toEvents(
    [{ type: 'system-override' as never, summary: 'x' }],
    'ch_001',
  );
  assert.equal(ev!.type, 'plot');
});

test('toEvents bounds summary/detail length, entity count, and importance range', () => {
  const [ev] = toEvents(
    [
      {
        type: 'plot',
        summary: 'a'.repeat(5000),
        detail: 'b'.repeat(5000),
        entities: Array.from({ length: 100 }, () => 'e'.repeat(500)),
        importance: 99 as never,
      },
    ],
    'ch_001',
  );
  assert.ok(ev!.summary.length <= 300);
  assert.ok(ev!.detail.length <= 1000);
  assert.ok(ev!.entities.length <= 20);
  assert.ok(ev!.entities.every((x) => x.length <= 120));
  assert.ok(ev!.importance >= 1 && ev!.importance <= 5);
});

test('toEvents caps the number of events per distill and drops summary-less entries', () => {
  const many = Array.from({ length: 50 }, (_, i) => ({ type: 'plot' as const, summary: `e${i}` }));
  assert.ok(toEvents(many, 'ch_001').length <= 20);
  assert.equal(toEvents([{ type: 'plot', detail: 'no summary' }], 'ch_001').length, 0);
  assert.equal(toEvents(null as never, 'ch_001').length, 0);
});
