/**
 * OpenAI Chat Completions adapter (fetch + SSE).
 * POST https://api.openai.com/v1/chat/completions
 */
import type {
  ProviderAdapter,
  GenerateRequest,
  GenerateResult,
  ProviderAuth,
} from '../provider.js';
import { ProviderError } from '../provider.js';
import { parseSSE } from '../sse.js';

const BASE = 'https://api.openai.com/v1/chat/completions';

function headers(auth: ProviderAuth): Record<string, string> {
  if (!auth.secret) throw new ProviderError('OpenAI API key missing');
  return { 'content-type': 'application/json', authorization: `Bearer ${auth.secret}` };
}

function messages(req: GenerateRequest) {
  return [
    { role: 'system', content: req.system },
    ...req.messages.map((m) => ({ role: m.role, content: m.content })),
  ];
}

export class OpenAIAdapter implements ProviderAdapter {
  readonly provider = 'openai' as const;

  async generate(req: GenerateRequest, auth: ProviderAuth): Promise<GenerateResult> {
    const res = await fetch(BASE, {
      method: 'POST',
      headers: headers(auth),
      body: JSON.stringify({
        model: req.model,
        temperature: req.temperature,
        max_tokens: req.maxTokens ?? 2048,
        messages: messages(req),
      }),
    });
    if (!res.ok) throw new ProviderError(`OpenAI ${res.status}: ${await res.text()}`, res.status);
    const json = (await res.json()) as {
      choices: { message: { content: string }; finish_reason?: string }[];
    };
    return {
      text: json.choices[0]?.message.content ?? '',
      stopReason: json.choices[0]?.finish_reason,
    };
  }

  async stream(
    req: GenerateRequest,
    auth: ProviderAuth,
    onDelta: (t: string) => void,
  ): Promise<GenerateResult> {
    const res = await fetch(BASE, {
      method: 'POST',
      headers: headers(auth),
      body: JSON.stringify({
        model: req.model,
        temperature: req.temperature,
        max_tokens: req.maxTokens ?? 2048,
        stream: true,
        messages: messages(req),
      }),
    });
    if (!res.ok || !res.body) {
      throw new ProviderError(`OpenAI ${res.status}: ${await res.text()}`, res.status);
    }
    let text = '';
    let stopReason: string | undefined;
    for await (const evt of parseSSE(res.body)) {
      if (!evt.data || evt.data === '[DONE]') continue;
      let parsed: { choices?: { delta?: { content?: string }; finish_reason?: string }[] };
      try {
        parsed = JSON.parse(evt.data);
      } catch {
        continue;
      }
      const choice = parsed.choices?.[0];
      const delta = choice?.delta?.content;
      if (delta) {
        text += delta;
        onDelta(delta);
      }
      if (choice?.finish_reason) stopReason = choice.finish_reason;
    }
    return { text, stopReason };
  }
}
