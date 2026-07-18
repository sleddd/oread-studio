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
    { id: 'us.meta.llama3-3-70b-instruct-v1:0', label: 'Llama 3.3 70B' },
    { id: 'us.meta.llama3-1-8b-instruct-v1:0', label: 'Llama 3.1 8B' },
    { id: 'us.amazon.nova-pro-v1:0', label: 'Amazon Nova Pro' },
    { id: 'us.amazon.nova-lite-v1:0', label: 'Amazon Nova Lite' },
    { id: 'us.amazon.nova-micro-v1:0', label: 'Amazon Nova Micro' },
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

/** The cheap model recommended for the chat-distillation pass, per provider. */
export const DISTILL_MODEL_BY_PROVIDER: Record<Provider, string> = {
  anthropic: 'claude-haiku-4-5',
  openai: 'gpt-4o-mini',
  bedrock: 'anthropic.claude-haiku-4-5',
  cloudflare: '@cf/meta/llama-3.1-8b-instruct',
  local: 'llama3.1',
};
