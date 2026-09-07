/**
 * Curated model catalog per provider — the dropdown source for the Session
 * editor's Model field. A "custom…" escape hatch lets the user type any model
 * id the provider accepts. Keep the Anthropic list current with the latest
 * Claude models.
 */
import type { Provider } from './storage.js';

export interface ModelOption {
  id: string;
  label: string;
}

export const PROVIDER_MODELS: Record<Provider, ModelOption[]> = {
  anthropic: [
    { id: 'claude-opus-4-8', label: 'Claude Opus 4.8 (most capable)' },
    { id: 'claude-sonnet-5', label: 'Claude Sonnet 5 (balanced)' },
    { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 (fast & cheap)' },
    { id: 'claude-opus-4-7', label: 'Claude Opus 4.7' },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  ],
  openai: [
    { id: 'gpt-4o', label: 'GPT-4o' },
    { id: 'gpt-4o-mini', label: 'GPT-4o mini' },
    { id: 'gpt-4.1', label: 'GPT-4.1' },
    { id: 'o3', label: 'o3 (reasoning)' },
    { id: 'o4-mini', label: 'o4-mini (reasoning)' },
  ],
  // Bedrock: use INFERENCE PROFILE ids (us.* / global.*). Newer Anthropic models
  // reject bare on-demand model ids and require a profile. The live list (from
  // ListInferenceProfiles) supersedes this; this is the offline fallback.
  bedrock: [
    { id: 'us.anthropic.claude-opus-4-7', label: 'Claude Opus 4.7' },
    { id: 'us.anthropic.claude-opus-4-6-v1', label: 'Claude Opus 4.6' },
    { id: 'us.anthropic.claude-opus-4-5-20251101-v1:0', label: 'Claude Opus 4.5' },
    { id: 'us.anthropic.claude-opus-4-1-20250805-v1:0', label: 'Claude Opus 4.1' },
    { id: 'us.anthropic.claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    { id: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0', label: 'Claude Sonnet 4.5' },
    { id: 'us.anthropic.claude-haiku-4-5-20251001-v1:0', label: 'Claude Haiku 4.5' },
    { id: 'us.anthropic.claude-3-5-sonnet-20241022-v2:0', label: 'Claude 3.5 Sonnet v2' },
    { id: 'us.anthropic.claude-3-5-haiku-20241022-v1:0', label: 'Claude 3.5 Haiku' },
    { id: 'us.deepseek.r1-v1:0', label: 'DeepSeek R1' },
    { id: 'us.meta.llama3-3-70b-instruct-v1:0', label: 'Llama 3.3 70B' },
    { id: 'us.meta.llama3-1-8b-instruct-v1:0', label: 'Llama 3.1 8B' },
    { id: 'us.amazon.nova-pro-v1:0', label: 'Amazon Nova Pro' },
    { id: 'us.amazon.nova-lite-v1:0', label: 'Amazon Nova Lite' },
    { id: 'us.amazon.nova-micro-v1:0', label: 'Amazon Nova Micro' },
    { id: 'mistral.mistral-large-2407-v1:0', label: 'Mistral Large' },
    { id: 'cohere.command-r-plus-v1:0', label: 'Cohere Command R+' },
  ],
  cloudflare: [
    { id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', label: 'Llama 3.3 70B (fast)' },
    { id: '@cf/meta/llama-3.1-8b-instruct', label: 'Llama 3.1 8B Instruct' },
    { id: '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b', label: 'DeepSeek R1 Distill Qwen 32B' },
    { id: '@cf/google/gemma-4-26b-a4b-it', label: 'Gemma 4 26B' },
    { id: '@cf/mistral/mistral-7b-instruct-v0.1', label: 'Mistral 7B Instruct' },
    { id: '@cf/qwen/qwen2.5-coder-32b-instruct', label: 'Qwen 2.5 Coder 32B' },
    { id: '@cf/ibm-granite/granite-4.0-h-micro', label: 'IBM Granite 4.0 Micro' },
  ],
  local: [
    { id: 'llama3.1', label: 'Llama 3.1 (Ollama)' },
    { id: 'llama3.3', label: 'Llama 3.3 (Ollama)' },
    { id: 'mistral', label: 'Mistral (Ollama)' },
    { id: 'qwen2.5', label: 'Qwen 2.5 (Ollama)' },
  ],
};


/**
 * Whether a model id pins specific weights.
 *
 * Bedrock inference-profile ids come in two shapes. A pinned id carries the
 * model's release date and version — `us.anthropic.claude-opus-4-5-20251101-v1:0`
 * — and always resolves to those exact weights. A floating alias omits them —
 * `us.anthropic.claude-opus-4-7` — and AWS may repoint it at updated weights
 * without notice.
 *
 * That distinction matters to an author: a world set to a floating alias can
 * change how it writes overnight with no change to the prompt or the code,
 * which is indistinguishable from a bug in the app and impossible to reproduce
 * afterwards. Surfacing it lets the author choose a pinned id when they want a
 * character's voice to stay put.
 */
export function isPinnedModelId(id: string): boolean {
  if (!id) return false;
  // A date (YYYYMMDD) or an explicit version suffix (-v1:0 / :0) pins it.
  return /\d{8}/.test(id) || /-v\d+:\d+$/.test(id) || /:\d+$/.test(id);
}

/** Human explanation for a floating id, or null when the id is pinned. */
export function modelDriftWarning(id: string): string | null {
  return isPinnedModelId(id)
    ? null
    : 'This id has no version pinned, so the provider may update the model behind it ' +
        'without notice — replies can change character without anything in your world ' +
        'changing. Pick an id with a date/version to keep it fixed.';
}
