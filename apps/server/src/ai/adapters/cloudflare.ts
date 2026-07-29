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
    // Only send a system turn when there IS one — some Workers AI models reject
    // an empty-content message outright.
    ...(req.system.trim() ? [{ role: 'system', content: req.system }] : []),
    ...req.messages.map((m) => ({ role: m.role, content: m.content })),
  ];
}

/**
 * Body for /ai/run text generation.
 *
 * `max_tokens` matters: Workers AI defaults to **256**, so omitting it truncates
 * prose mid-sentence. `temperature` is clamped to the documented 0–5 range — an
 * out-of-range value is a 400.
 * https://developers.cloudflare.com/workers-ai/models/llama-3.1-8b-instruct/
 */
function runBody(req: GenerateRequest, stream: boolean): Record<string, unknown> {
  return {
    messages: messages(req),
    max_tokens: req.maxTokens ?? 2048,
    temperature: Math.min(Math.max(req.temperature, 0), 5),
    ...(stream ? { stream: true } : {}),
  };
}

/**
 * Pull generated text out of a Workers AI payload, streaming chunk or not.
 *
 * Workers AI is not consistent across models: the classic shape is `response`,
 * but newer models (Gemma 4, other reasoning/OpenAI-compatible ones) return
 * OpenAI-style `choices[].delta.content` / `choices[].message.content`, and
 * reasoning models put the answer alongside a separate thinking field. Reading
 * only `response` made those models look like they returned nothing at all.
 *
 * Reasoning text is deliberately NOT included — it's the model's scratchpad, not
 * prose the author asked for.
 */
export function extractText(payload: Record<string, unknown>): string {
  // 1. Classic Workers AI.
  if (typeof payload.response === 'string' && payload.response) return payload.response;

  // 2. OpenAI-compatible shapes.
  const choices = payload.choices as
    | { delta?: { content?: string }; message?: { content?: string }; text?: string }[]
    | undefined;
  if (Array.isArray(choices)) {
    const joined = choices
      .map((c) => c.delta?.content ?? c.message?.content ?? c.text ?? '')
      .join('');
    if (joined) return joined;
  }

  // 3. Some models nest the classic shape under `result`.
  const result = payload.result as { response?: string } | undefined;
  if (result && typeof result.response === 'string' && result.response) return result.response;

  return '';
}

/**
 * Strip `<think>`-style reasoning from a completed answer. Gemma 4 and other
 * reasoning models on Workers AI can emit their scratchpad inline when it isn't
 * carried in a separate field.
 */
export function stripThinking(text: string): string {
  const withoutPairs = text.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '');
  // Unterminated open tag: everything after it is scratchpad we can't use.
  const open = withoutPairs.search(/<think(?:ing)?>/i);
  const trimmed = open >= 0 ? withoutPairs.slice(0, open) : withoutPairs;
  return trimmed.trim();
}

/**
 * Turn a Workers AI failure into something actionable.
 *
 * Cloudflare returns its own error envelope with a `code`, and the raw JSON is
 * what the author currently sees. Codes are documented at
 * https://developers.cloudflare.com/workers-ai/platform/errors/ — 3030 is not
 * among them; it is the generic upstream/inference failure, which in practice
 * means the model itself failed or is unavailable, NOT that the request was
 * malformed. Saying so is the difference between "try another model" and the
 * author assuming their world is broken.
 */
function explainCloudflareError(status: number, raw: string, model: string): ProviderError {
  let code: number | undefined;
  let message = '';
  try {
    const json = JSON.parse(raw) as { errors?: { code?: number; message?: string }[] };
    const first = json.errors?.[0];
    code = first?.code;
    message = first?.message ?? '';
  } catch {
    message = raw.slice(0, 300);
  }

  const known: Record<number, string> = {
    3003: 'The request was missing headers or a body.',
    3006: 'The request is too large for Workers AI.',
    3007: `Workers AI timed out running "${model}". It may be busy — retry, or pick a smaller model.`,
    3008: 'The request was aborted before it finished.',
    3036: 'Your daily free Workers AI allocation (10,000 neurons) is used up. Upgrade to the Workers Paid plan or wait for the reset.',
    3040: 'Workers AI has no capacity for this model right now. Retry shortly or pick another model.',
    5007: `Workers AI has no model named "${model}". Pick another model.`,
  };

  if (code && known[code]) return new ProviderError(`Cloudflare: ${known[code]}`, status);

  // 3030 and friends: Cloudflare's own inference failed. This is upstream, not
  // something the author's prompt or world caused.
  if (/internal server error|aierror/i.test(message)) {
    return new ProviderError(
      `Cloudflare Workers AI failed while running "${model}" (its own internal error, ` +
        `not a problem with your request). This is usually the model being overloaded or ` +
        `temporarily unavailable — retry, or choose a different model.` +
        (code ? ` [code ${code}]` : ''),
      status,
    );
  }

  return new ProviderError(
    `Cloudflare ${status} running "${model}": ${message || raw.slice(0, 300)}`,
    status,
  );
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
      const json = (await res.json()) as {
        result?: { name: string; description?: string; deprecated?: boolean }[];
      };
      const batch = json.result ?? [];
      out.push(
        ...batch
          // Deprecated models still appear under the Text Generation task but fail
          // (or are withdrawn) at inference time. Cloudflare marks some with a flag
          // and others only in the description, so check both.
          .filter((m) => !m.deprecated && !/\bdeprecat/i.test(m.description ?? ''))
          .map((m) => ({ id: m.name })),
      );
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
      body: JSON.stringify(runBody(req, false)),
    });
    if (!res.ok) throw explainCloudflareError(res.status, await res.text(), req.model);
    const json = (await res.json()) as {
      result?: { response?: string };
      success?: boolean;
      errors?: { code?: number; message?: string }[];
    };
    // Workers AI can return HTTP 200 with success:false and an empty result, so a
    // failure here is not always signalled by the status code.
    if (json.success === false || json.errors?.length) {
      throw explainCloudflareError(200, JSON.stringify(json), req.model);
    }
    // The payload can be the envelope OR the bare result depending on the model.
    const raw = json as unknown as Record<string, unknown>;
    const text = extractText((raw.result as Record<string, unknown>) ?? raw) || extractText(raw);
    return { text: stripThinking(text) };
  }

  async stream(
    req: GenerateRequest,
    auth: ProviderAuth,
    onDelta: (t: string) => void,
  ): Promise<GenerateResult> {
    const res = await fetch(url(auth, req.model), {
      method: 'POST',
      headers: headers(auth),
      body: JSON.stringify(runBody(req, true)),
    });
    if (!res.ok || !res.body) {
      throw explainCloudflareError(res.status, await res.text(), req.model);
    }
    let text = '';
    let failure: string | null = null;
    for await (const evt of parseSSE(res.body)) {
      if (!evt.data || evt.data === '[DONE]') continue;
      try {
        const parsed = JSON.parse(evt.data) as Record<string, unknown>;
        // A stream can fail PART-WAY: Cloudflare emits an error object mid-stream
        // after some text. Capture it rather than silently returning a truncation.
        if ((parsed.errors as unknown[] | undefined)?.length) failure = JSON.stringify(parsed);
        const piece = extractText(parsed);
        if (piece) {
          text += piece;
          onDelta(piece);
        }
      } catch {
        // ignore keepalive lines
      }
    }
    if (failure) throw explainCloudflareError(200, failure, req.model);
    const clean = stripThinking(text);
    // An empty completion with no error is still a failure from the author's side.
    if (!clean) {
      throw new ProviderError(
        `Cloudflare Workers AI returned no usable text for "${req.model}". The model may be ` +
          'overloaded or unavailable, or it may return a response format this app does not ' +
          'recognise yet — retry, or choose a different model.',
      );
    }
    return { text: clean };
  }
}
