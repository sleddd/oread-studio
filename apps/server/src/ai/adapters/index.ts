import type { Provider } from '@oread/shared';
import type { ProviderAdapter } from '../provider.js';
import { AnthropicAdapter } from './anthropic.js';
import { OpenAIAdapter } from './openai.js';
import { CloudflareAdapter } from './cloudflare.js';
import { BedrockAdapter } from './bedrock.js';
import { LocalAdapter } from './local.js';

const ADAPTERS: Record<Provider, ProviderAdapter> = {
  anthropic: new AnthropicAdapter(),
  openai: new OpenAIAdapter(),
  cloudflare: new CloudflareAdapter(),
  bedrock: new BedrockAdapter(),
  local: new LocalAdapter(),
};

export function getAdapter(provider: Provider): ProviderAdapter {
  return ADAPTERS[provider];
}
