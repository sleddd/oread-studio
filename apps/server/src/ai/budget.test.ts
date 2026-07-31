import { test } from 'node:test';
import assert from 'node:assert/strict';
import { budgetForModel, contextBudgetFor, FALLBACK_BUDGET, NO_MODEL_BUDGET } from './budget.js';

test('frontier models get a budget that can actually hold a world bible', () => {
  // The bug this replaces: a flat 6000 tokens for every model, which dropped
  // most of the world on every turn.
  for (const id of ['claude-opus-5', 'claude-sonnet-5', 'gpt-5', 'us.anthropic.claude-sonnet-5']) {
    assert.ok(budgetForModel(id) >= 100_000, `${id} should get a real budget`);
  }
});

test('the longest matching prefix wins, so a variant can override its family', () => {
  assert.ok(
    budgetForModel('claude-opus-5[1m]') > budgetForModel('claude-opus-5'),
    'the 1M-context variant gets more than the 200k default',
  );
});

test('an unknown model id gets the generous fallback, not a crash or zero', () => {
  assert.equal(budgetForModel('some-model-shipped-next-year'), FALLBACK_BUDGET);
  assert.ok(FALLBACK_BUDGET > 6000, 'the fallback still beats the old flat default');
});

test('no model configured falls back to a small safe budget', () => {
  assert.equal(budgetForModel(null), NO_MODEL_BUDGET);
  assert.equal(budgetForModel(''), NO_MODEL_BUDGET);
  assert.equal(budgetForModel(undefined), NO_MODEL_BUDGET);
});

test('small-window models are not handed a budget they cannot take', () => {
  assert.ok(budgetForModel('gpt-4') <= 8_000, 'original gpt-4 has an 8k window');
  assert.ok(budgetForModel('@cf/tinyllama') <= 8_000);
});

test('model ids match case-insensitively', () => {
  assert.equal(budgetForModel('Claude-Opus-5'), budgetForModel('claude-opus-5'));
});

test("the author's explicit override wins over the model table", () => {
  const budget = contextBudgetFor({
    credentialId: null, provider: 'local', model: 'claude-opus-5',
    temperature: 0.8, contextBudget: 12_345,
  });
  assert.equal(budget, 12_345);
});

test('an absent or null override falls through to the model table', () => {
  const settings = {
    credentialId: null, provider: 'anthropic' as const, model: 'claude-opus-5', temperature: 0.8,
  };
  assert.equal(contextBudgetFor(settings), budgetForModel('claude-opus-5'));
  assert.equal(contextBudgetFor({ ...settings, contextBudget: null }), budgetForModel('claude-opus-5'));
});

test('a nonsense override is ignored rather than trusted', () => {
  // A stored 0 would otherwise produce a prompt with no world in it at all.
  const base = {
    credentialId: null, provider: 'anthropic' as const, model: 'claude-opus-5', temperature: 0.8,
  };
  for (const bad of [0, -1, NaN, Infinity]) {
    assert.equal(
      contextBudgetFor({ ...base, contextBudget: bad }),
      budgetForModel('claude-opus-5'),
      `override ${bad} should be ignored`,
    );
  }
});
