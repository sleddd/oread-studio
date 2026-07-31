/**
 * How many tokens of assembled context a world's chosen model can actually take.
 *
 * The old behaviour was a flat 6000-token budget for every model, which is
 * roughly a 2015 assumption: a single 12k-character chapter of preceding prose
 * eats half of it, so on any real world the later recipe items — style notes,
 * nearby chapter summaries, the world's own setting — were silently dropped on
 * every single turn. Modern models take 200k–1M tokens. The world bible of an
 * entire novel is 10–30k. It fits; it should simply be sent.
 *
 * Two inputs decide the number, in priority order:
 *   1. `session.model.contextBudget` — an explicit author override, when set.
 *   2. A per-model-id table, matched by prefix against the selected model.
 *
 * The table is deliberately conservative: the figure is the CONTEXT budget, not
 * the model's window. We reserve the remainder for the chat transcript, the
 * model's own reply, and the gap between our ~4-chars-per-token estimate and the
 * real tokenizer. Unknown ids get `FALLBACK_BUDGET` — generous enough that a
 * new frontier model works well on the day it ships, low enough to be safe on a
 * small self-hosted model.
 */
import type { ModelSettings } from '@oread/shared';

/**
 * Context budget for an unrecognised model id. Every provider ships new ids
 * faster than this table can track them, and the common case for an unknown id
 * is a NEW model (bigger), not an ancient one. 32k is comfortable on anything
 * current while staying inside even a modest 64k-window local model.
 */
export const FALLBACK_BUDGET = 32_000;

/** Budget when no model is configured at all (the mock path). */
export const NO_MODEL_BUDGET = 8_000;

/**
 * Prefix-matched context budgets. Longest matching prefix wins, so a specific
 * entry can override a family default. Figures are usable context for world
 * material, well under each model's true window.
 */
const MODEL_BUDGETS: Array<[prefix: string, budget: number]> = [
  // ── Anthropic ──
  // Claude 5 family and 4.x: 200k windows (1M for tagged variants).
  ['claude-opus-5[1m]', 700_000],
  ['claude-sonnet-5[1m]', 700_000],
  ['claude-opus-5', 150_000],
  ['claude-sonnet-5', 150_000],
  ['claude-fable-5', 150_000],
  ['claude-haiku-4-5', 150_000],
  ['claude-opus-4', 150_000],
  ['claude-sonnet-4', 150_000],
  ['claude-haiku-4', 150_000],
  ['claude-3-7-sonnet', 150_000],
  ['claude-3-5-sonnet', 150_000],
  ['claude-3-5-haiku', 150_000],
  ['claude-3-opus', 150_000],
  ['claude-3-haiku', 150_000],
  ['claude-', 150_000],
  // Bedrock exposes the same models behind region-prefixed inference profiles.
  ['us.anthropic.claude', 150_000],
  ['eu.anthropic.claude', 150_000],
  ['apac.anthropic.claude', 150_000],
  ['anthropic.claude', 150_000],

  // ── OpenAI ──
  ['gpt-5', 300_000],
  ['gpt-4.1', 700_000],
  ['gpt-4o', 100_000],
  ['gpt-4-turbo', 100_000],
  ['gpt-4', 6_000],
  ['gpt-3.5', 12_000],
  ['o3', 150_000],
  ['o1', 150_000],

  // ── Other hosted families (Bedrock / Cloudflare) ──
  ['meta.llama3', 100_000],
  ['meta.llama', 24_000],
  ['mistral.mistral-large', 100_000],
  ['mistral.', 24_000],
  ['amazon.nova', 250_000],
  ['amazon.titan', 24_000],
  ['cohere.command-r', 100_000],
  ['deepseek.', 50_000],
  ['@cf/meta/llama-3', 16_000],
  ['@cf/', 6_000],
];

/**
 * Context budget for a model id alone, ignoring any author override.
 * Exported for tests and for the settings UI to show what the default would be.
 */
export function budgetForModel(modelId: string | null | undefined): number {
  const id = (modelId ?? '').trim().toLowerCase();
  if (!id) return NO_MODEL_BUDGET;

  let best: number | null = null;
  let bestLen = -1;
  for (const [prefix, budget] of MODEL_BUDGETS) {
    if (id.startsWith(prefix) && prefix.length > bestLen) {
      best = budget;
      bestLen = prefix.length;
    }
  }
  return best ?? FALLBACK_BUDGET;
}

/**
 * The context budget for a world, honouring an explicit author override.
 *
 * A non-positive or non-finite override is ignored rather than trusted — a
 * stored 0 would otherwise silently produce a prompt with no world in it.
 */
export function contextBudgetFor(model: ModelSettings | undefined | null): number {
  const override = model?.contextBudget;
  if (typeof override === 'number' && Number.isFinite(override) && override > 0) {
    return Math.floor(override);
  }
  return budgetForModel(model?.model);
}
