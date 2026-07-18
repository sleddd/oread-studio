/**
 * Anthropic Messages API adapter. Uses fetch + SSE for streaming.
 * Docs: POST https://api.anthropic.com/v1/messages
 */
import type { WebCitation } from '@oread/shared';
import type {
  ProviderAdapter,
  GenerateRequest,
  GenerateResult,
  ProviderAuth,
  ModelInfo,
} from '../provider.js';
import { ProviderError } from '../provider.js';
import { parseSSE } from '../sse.js';

const BASE = 'https://api.anthropic.com/v1/messages';
const VERSION = '2023-06-01';

// Anthropic native web-search server tool (dynamic filtering variant). Runs on
// Anthropic's infrastructure — no MCP/gateway. Supported on Opus 4.6+/Sonnet 4.6+.
const WEB_SEARCH_TOOL = { type: 'web_search_20260209', name: 'web_search', max_uses: 5 };

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
    ...(req.webSearch ? { tools: [WEB_SEARCH_TOOL] } : {}),
    messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
  });
}

/**
 * Pull unique {url,title} sources out of a `web_search_tool_result` block.
 * On error the block's `content` is an object (not a list) — guarded here.
 */
function collectCitations(
  block: { type?: string; content?: unknown },
  into: Map<string, WebCitation>,
): void {
  if (block.type !== 'web_search_tool_result' || !Array.isArray(block.content)) return;
  for (const r of block.content as { type?: string; url?: string; title?: string }[]) {
    if (r.type === 'web_search_result' && r.url && !into.has(r.url)) {
      into.set(r.url, { url: r.url, title: r.title ?? r.url });
    }
  }
}

export class AnthropicAdapter implements ProviderAdapter {
  readonly provider = 'anthropic' as const;

  async listModels(auth: ProviderAuth): Promise<ModelInfo[]> {
    const res = await fetch('https://api.anthropic.com/v1/models?limit=1000', {
      headers: {
        'x-api-key': auth.secret ?? '',
        'anthropic-version': VERSION,
      },
    });
    if (!res.ok) throw new ProviderError(`Anthropic models ${res.status}`, res.status);
    const json = (await res.json()) as { data: { id: string; display_name?: string }[] };
    return json.data.map((m) => ({ id: m.id, label: m.display_name }));
  }

  async generate(req: GenerateRequest, auth: ProviderAuth): Promise<GenerateResult> {
    const res = await fetch(BASE, { method: 'POST', headers: headers(auth), body: body(req, false) });
    if (!res.ok) throw new ProviderError(`Anthropic ${res.status}: ${await res.text()}`, res.status);
    const json = (await res.json()) as {
      content: { type: string; text?: string; content?: unknown }[];
      stop_reason?: string;
    };
    const cites = new Map<string, WebCitation>();
    const text = json.content
      .map((b) => {
        collectCitations(b, cites);
        return b.type === 'text' ? (b.text ?? '') : '';
      })
      .join('');
    return {
      text,
      stopReason: json.stop_reason,
      citations: cites.size ? [...cites.values()] : undefined,
    };
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
    const cites = new Map<string, WebCitation>();
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
      } else if (parsed.type === 'content_block_start') {
        // web_search_tool_result blocks arrive whole at block-start.
        collectCitations(parsed.content_block as { type?: string; content?: unknown }, cites);
      } else if (parsed.type === 'message_delta') {
        const d = parsed.delta as { stop_reason?: string } | undefined;
        if (d?.stop_reason) stopReason = d.stop_reason;
      }
    }
    return {
      text,
      stopReason,
      citations: cites.size ? [...cites.values()] : undefined,
    };
  }
}
