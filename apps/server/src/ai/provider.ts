/**
 * Provider adapter interface. One implementation per provider. All calls are
 * server-side; the mode contracts and prompt assembly are provider-agnostic —
 * only transport/auth differs. Both a non-streaming `generate` and a streaming
 * `stream` are supported.
 */
import type { Provider } from '@oread/shared';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface GenerateRequest {
  model: string;
  system: string;
  messages: ChatTurn[];
  temperature: number;
  maxTokens?: number;
}

export interface GenerateResult {
  text: string;
  /** provider-native stop reason, best-effort */
  stopReason?: string;
}

export interface ProviderAdapter {
  readonly provider: Provider;
  generate(req: GenerateRequest, apiKey: ProviderAuth): Promise<GenerateResult>;
  stream(
    req: GenerateRequest,
    apiKey: ProviderAuth,
    onDelta: (text: string) => void,
  ): Promise<GenerateResult>;
}

/**
 * Provider auth material. For most providers this is a single secret string;
 * Cloudflare needs an account id + token; Bedrock uses AWS creds/region; local
 * needs no secret. Adapters read what they need.
 */
export interface ProviderAuth {
  secret?: string; // API key / token
  accountId?: string; // cloudflare
  region?: string; // bedrock
  baseUrl?: string; // local / self-hosted
}

export class ProviderError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
  }
}
