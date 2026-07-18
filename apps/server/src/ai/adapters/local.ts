/**
 * Local / self-hosted adapter (Ollama). No API key required — for users running
 * the app standalone. Uses Ollama's /api/chat (NDJSON streaming).
 * Default base URL: http://localhost:11434
 */
import type {
  ProviderAdapter,
  GenerateRequest,
  GenerateResult,
  ProviderAuth,
  ModelInfo,
} from '../provider.js';
import { ProviderError } from '../provider.js';
import { env } from '../../env.js';

function base(auth: ProviderAuth): string {
  return auth.baseUrl ?? env.provider.ollamaBaseUrl;
}

function messages(req: GenerateRequest) {
  return [
    { role: 'system', content: req.system },
    ...req.messages.map((m) => ({ role: m.role, content: m.content })),
  ];
}

export class LocalAdapter implements ProviderAdapter {
  readonly provider = 'local' as const;

  async listModels(auth: ProviderAuth): Promise<ModelInfo[]> {
    const res = await fetch(`${base(auth)}/api/tags`);
    if (!res.ok) throw new ProviderError(`Ollama models ${res.status}`, res.status);
    const json = (await res.json()) as { models?: { name: string }[] };
    return (json.models ?? []).map((m) => ({ id: m.name }));
  }

  async generate(req: GenerateRequest, auth: ProviderAuth): Promise<GenerateResult> {
    const res = await fetch(`${base(auth)}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: req.model,
        messages: messages(req),
        stream: false,
        options: { temperature: req.temperature },
      }),
    });
    if (!res.ok) throw new ProviderError(`Ollama ${res.status}: ${await res.text()}`, res.status);
    const json = (await res.json()) as { message?: { content?: string } };
    return { text: json.message?.content ?? '' };
  }

  async stream(
    req: GenerateRequest,
    auth: ProviderAuth,
    onDelta: (t: string) => void,
  ): Promise<GenerateResult> {
    const res = await fetch(`${base(auth)}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: req.model,
        messages: messages(req),
        stream: true,
        options: { temperature: req.temperature },
      }),
    });
    if (!res.ok || !res.body) {
      throw new ProviderError(`Ollama ${res.status}: ${await res.text()}`, res.status);
    }
    let text = '';
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        try {
          const parsed = JSON.parse(line) as { message?: { content?: string } };
          const delta = parsed.message?.content;
          if (delta) {
            text += delta;
            onDelta(delta);
          }
        } catch {
          // ignore
        }
      }
    }
    return { text };
  }
}
