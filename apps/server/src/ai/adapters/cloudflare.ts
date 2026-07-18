/**
 * Cloudflare Workers AI adapter.
 * POST https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/{model}
 * Auth: Bearer token + account id.
 */
import type {
  ProviderAdapter,
  GenerateRequest,
  GenerateResult,
  ProviderAuth,
  ModelInfo,
} from '../provider.js';
import { ProviderError } from '../provider.js';
import { parseSSE } from '../sse.js';

function url(auth: ProviderAuth, model: string): string {
  if (!auth.accountId) throw new ProviderError('Cloudflare account id missing');
  return `https://api.cloudflare.com/client/v4/accounts/${auth.accountId}/ai/run/${model}`;
}

function headers(auth: ProviderAuth): Record<string, string> {
  if (!auth.secret) throw new ProviderError('Cloudflare API token missing');
  return { 'content-type': 'application/json', authorization: `Bearer ${auth.secret}` };
}

function messages(req: GenerateRequest) {
  return [
    { role: 'system', content: req.system },
    ...req.messages.map((m) => ({ role: m.role, content: m.content })),
  ];
}

export class CloudflareAdapter implements ProviderAdapter {
  readonly provider = 'cloudflare' as const;

  async listModels(auth: ProviderAuth): Promise<ModelInfo[]> {
    if (!auth.accountId) throw new ProviderError('Cloudflare account id missing');
    // Text-generation models only, paginated.
    const out: ModelInfo[] = [];
    let page = 1;
    for (;;) {
      const url =
        `https://api.cloudflare.com/client/v4/accounts/${auth.accountId}/ai/models/search` +
        `?task=Text%20Generation&per_page=100&page=${page}`;
      const res = await fetch(url, { headers: headers(auth) });
      if (!res.ok) throw new ProviderError(`Cloudflare models ${res.status}`, res.status);
      const json = (await res.json()) as { result?: { name: string }[] };
      const batch = json.result ?? [];
      out.push(...batch.map((m) => ({ id: m.name })));
      if (batch.length < 100) break;
      page++;
      if (page > 10) break;
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
  }

  async generate(req: GenerateRequest, auth: ProviderAuth): Promise<GenerateResult> {
    const res = await fetch(url(auth, req.model), {
      method: 'POST',
      headers: headers(auth),
      body: JSON.stringify({ messages: messages(req), temperature: req.temperature }),
    });
    if (!res.ok) throw new ProviderError(`Cloudflare ${res.status}: ${await res.text()}`, res.status);
    const json = (await res.json()) as { result?: { response?: string } };
    return { text: json.result?.response ?? '' };
  }

  async stream(
    req: GenerateRequest,
    auth: ProviderAuth,
    onDelta: (t: string) => void,
  ): Promise<GenerateResult> {
    const res = await fetch(url(auth, req.model), {
      method: 'POST',
      headers: headers(auth),
      body: JSON.stringify({
        messages: messages(req),
        temperature: req.temperature,
        stream: true,
      }),
    });
    if (!res.ok || !res.body) {
      throw new ProviderError(`Cloudflare ${res.status}: ${await res.text()}`, res.status);
    }
    let text = '';
    for await (const evt of parseSSE(res.body)) {
      if (!evt.data || evt.data === '[DONE]') continue;
      try {
        const parsed = JSON.parse(evt.data) as { response?: string };
        if (parsed.response) {
          text += parsed.response;
          onDelta(parsed.response);
        }
      } catch {
        // ignore keepalive lines
      }
    }
    return { text };
  }
}
