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

/** Hosts that must never be reachable via a user-supplied baseUrl (SSRF). */
function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, ''); // strip IPv6 brackets
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  // IPv6 loopback / link-local / unique-local.
  if (h === '::1' || h === '::' || h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) {
    return true;
  }
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false; // a public DNS name — allowed
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 0 || // 0.0.0.0/8
    a === 127 || // loopback
    a === 10 || // private
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 168) || // private
    (a === 169 && b === 254) || // link-local incl. 169.254.169.254 metadata
    a >= 224 // multicast / reserved
  );
}

/**
 * Resolve the Ollama base URL. The env-configured default is trusted; a
 * user-supplied `auth.baseUrl` is validated to block SSRF at internal hosts
 * unless the operator has opted in via OREAD_ALLOW_PRIVATE_AI_HOST.
 */
function base(auth: ProviderAuth): string {
  if (!auth.baseUrl) return env.provider.ollamaBaseUrl;
  let url: URL;
  try {
    url = new URL(auth.baseUrl);
  } catch {
    throw new ProviderError('Invalid local AI base URL', 400);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ProviderError('Local AI base URL must be http(s)', 400);
  }
  if (!env.provider.allowPrivateLocalAiHost && isPrivateHost(url.hostname)) {
    throw new ProviderError('Local AI base URL host is not allowed', 400);
  }
  return auth.baseUrl.replace(/\/+$/, '');
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
