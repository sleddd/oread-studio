import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { distillChat } from './distill.js';
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
