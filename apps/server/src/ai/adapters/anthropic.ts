/**
 * Anthropic Messages API adapter. Uses fetch + SSE for streaming.
 * Docs: POST https://api.anthropic.com/v1/messages
 */
import type {
  ProviderAdapter,
  GenerateRequest,
  GenerateResult,
  ProviderAuth,
} from '../provider.js';
import { ProviderError } from '../provider.js';
import { parseSSE } from '../sse.js';

const BASE = 'https://api.anthropic.com/v1/messages';
const VERSION = '2023-06-01';

function headers(auth: ProviderAuth): Record<string, string> {
  if (!auth.secret) throw new ProviderError('Anthropic API key missing');
  return {
    'content-type': 'application/json',
    'x-api-key': auth.secret,
    'anthropic-version': VERSION,
  };
}

function body(req: GenerateRequest, stream: boolean): string {
  return JSON.stringify({
    model: req.model,
    system: req.system,
    max_tokens: req.maxTokens ?? 2048,
    temperature: req.temperature,
    stream,
    messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
  });
}

export class AnthropicAdapter implements ProviderAdapter {
  readonly provider = 'anthropic' as const;

  async generate(req: GenerateRequest, auth: ProviderAuth): Promise<GenerateResult> {
    const res = await fetch(BASE, { method: 'POST', headers: headers(auth), body: body(req, false) });
    if (!res.ok) throw new ProviderError(`Anthropic ${res.status}: ${await res.text()}`, res.status);
    const json = (await res.json()) as {
      content: { type: string; text?: string }[];
      stop_reason?: string;
    };
    const text = json.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('');
    return { text, stopReason: json.stop_reason };
  }

  async stream(
    req: GenerateRequest,
    auth: ProviderAuth,
    onDelta: (t: string) => void,
  ): Promise<GenerateResult> {
    const res = await fetch(BASE, { method: 'POST', headers: headers(auth), body: body(req, true) });
    if (!res.ok || !res.body) {
      throw new ProviderError(`Anthropic ${res.status}: ${await res.text()}`, res.status);
    }
    let text = '';
    let stopReason: string | undefined;
    for await (const evt of parseSSE(res.body)) {
      if (!evt.data || evt.data === '[DONE]') continue;
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(evt.data);
      } catch {
        continue;
      }
      if (parsed.type === 'content_block_delta') {
        const delta = parsed.delta as { text?: string } | undefined;
        if (delta?.text) {
          text += delta.text;
          onDelta(delta.text);
        }
      } else if (parsed.type === 'message_delta') {
        const d = parsed.delta as { stop_reason?: string } | undefined;
        if (d?.stop_reason) stopReason = d.stop_reason;
      }
    }
    return { text, stopReason };
  }
}
