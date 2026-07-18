/**
 * Provider adapter interface. One implementation per provider. All calls are
 * server-side; the mode contracts and prompt assembly are provider-agnostic —
 * only transport/auth differs. Both a non-streaming `generate` and a streaming
 * `stream` are supported.
 */
import type { Provider, WebCitation } from '@oread/shared';

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
  /**
   * Let the model research the live web via the provider's native web-search
   * tool (Anthropic/OpenAI). Only set by modes that permit it (discuss/draft).
   * Adapters that don't support it ignore the flag.
   */
  webSearch?: boolean;
}

export interface GenerateResult {
  text: string;
  /** provider-native stop reason, best-effort */
  stopReason?: string;
  /** web sources the model consulted, if web search ran */
  citations?: WebCitation[];
}

export interface ModelInfo {
  id: string;
  label?: string;
}

export interface ProviderAdapter {
  readonly provider: Provider;
  generate(req: GenerateRequest, apiKey: ProviderAuth): Promise<GenerateResult>;
  stream(
    req: GenerateRequest,
    apiKey: ProviderAuth,
    onDelta: (text: string) => void,
  ): Promise<GenerateResult>;
  /** List every model the provider offers for this credential. */
  listModels?(auth: ProviderAuth): Promise<ModelInfo[]>;
}

/**
 * Provider auth material. For most providers this is a single secret string;
 * Cloudflare needs an account id + token; Bedrock uses AWS creds/region; local
 * needs no secret. Adapters read what they need.
 */
export interface ProviderAuth {
  secret?: string; // API key / token (also: Bedrock AWS secret access key)
  accountId?: string; // cloudflare account id (also: Bedrock AWS access key id)
  region?: string; // bedrock region
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
