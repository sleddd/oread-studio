import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  contractFor,
  assertResultAllowed,
  assertApplyAllowed,
  ModePermissionError,
  baseMode,
} from './permissions.js';

test('the suggestion modes are applicable on an explicit accept', () => {
  // Both produce a redline the author may accept; neither ever applies itself.
  assert.equal(contractFor('critique').applicable, true);
  assert.equal(contractFor('edit').applicable, true);
  assert.doesNotThrow(() => assertApplyAllowed('critique'));
  assert.doesNotThrow(() => assertApplyAllowed('edit'));
});

test('discuss (and character) may not apply changes', () => {
  assert.throws(() => assertApplyAllowed('discuss'), ModePermissionError);
  assert.throws(() => assertApplyAllowed('character'), ModePermissionError);
});

test('each mode enforces its output kind', () => {
  assertResultAllowed('discuss', 'text');
  assertResultAllowed('cowrite', 'prose');
  assertResultAllowed('draft', 'prose');
  assertResultAllowed('edit', 'suggestion');
  assertResultAllowed('critique', 'suggestion');
  assert.throws(() => assertResultAllowed('critique', 'prose'), ModePermissionError);
  assert.throws(() => assertResultAllowed('discuss', 'prose'), ModePermissionError);
  assert.throws(() => assertResultAllowed('draft', 'suggestion'), ModePermissionError);
});

test('draft may not invent plot; edit may not invent plot', () => {
  assert.equal(contractFor('draft').mayInventPlot, false);
  assert.equal(contractFor('edit').mayInventPlot, false);
});

test('character mode resolves to the discuss base mode', () => {
  assert.equal(baseMode('character'), 'discuss');
  assert.equal(baseMode('cowrite'), 'cowrite');
});

test('memory writeback matches the spec table', () => {
  assert.equal(contractFor('cowrite').memoryWriteback, 'events');
  assert.equal(contractFor('draft').memoryWriteback, 'events+chapterStatus');
  assert.equal(contractFor('critique').memoryWriteback, 'nothing');
});
