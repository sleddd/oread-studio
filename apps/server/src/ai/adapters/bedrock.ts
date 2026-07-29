/**
 * AWS Bedrock adapter — ALL model families, not just Anthropic.
 *
 * Uses the Bedrock **Converse API** (`ConverseCommand` / `ConverseStreamCommand`)
 * rather than raw `InvokeModel`. That matters: every Bedrock family has its own
 * request/response schema (Anthropic Messages, Llama's `prompt`, Nova's
 * `schemaVersion`, DeepSeek, Mistral, Titan, Cohere…), and Converse is AWS's
 * unified surface that normalizes all of them behind one shape. Posting an
 * Anthropic-shaped body to DeepSeek is exactly what produced the opaque
 * "ValidationException" this adapter used to fail with.
 *
 * So there is ONE code path here and it works for whatever the account can call.
 * Model availability is decided by AWS entitlement, not by this file.
 *
 * Uses @aws-sdk/client-bedrock-runtime, imported LAZILY so it stays an OPTIONAL
 * dependency — installing AWS packages is only required if you actually use
 * Bedrock. Auth uses the standard AWS credential chain (env/role) + region;
 * ProviderAuth.region overrides.
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

// Minimal shapes for the lazily-imported SDK to avoid a hard type dependency.
interface BedrockClientLike {
  send(cmd: unknown): Promise<{ body: Uint8Array }>;
}

/**
 * Build an AWS SDK client config. If the credential carries an explicit AWS
 * access key id (stored in ProviderAuth.accountId) + secret (ProviderAuth.secret),
 * pass them; otherwise fall back to the ambient AWS credential chain
 * (env vars, shared profile, IAM role).
 */
function awsClientConfig(auth: ProviderAuth, region: string): Record<string, unknown> {
  const cfg: Record<string, unknown> = { region };
  if (auth.accountId && auth.secret) {
    cfg.credentials = {
      accessKeyId: auth.accountId,
      secretAccessKey: auth.secret,
    };
  }
  return cfg;
}

async function loadClient(auth: ProviderAuth, region: string): Promise<{
  client: BedrockClientLike;
  Invoke: new (input: unknown) => unknown;
  InvokeStream: new (input: unknown) => unknown;
}> {
  let mod: Record<string, unknown>;
  try {
    mod = (await import('@aws-sdk/client-bedrock-runtime')) as unknown as Record<string, unknown>;
  } catch {
    throw new ProviderError(
      'Bedrock requires @aws-sdk/client-bedrock-runtime. Install it to use the bedrock provider.',
    );
  }
  const Client = mod.BedrockRuntimeClient as new (input: unknown) => BedrockClientLike;
  return {
    client: new Client(awsClientConfig(auth, region)),
    Invoke: mod.InvokeModelCommand as new (i: unknown) => unknown,
    InvokeStream: mod.InvokeModelWithResponseStreamCommand as new (i: unknown) => unknown,
  };
}

/** The fields of a Bedrock FoundationModelSummary this adapter reasons about. */
export interface FoundationModelLike {
  modelId: string;
  modelName?: string;
  providerName?: string;
  inputModalities?: string[];
  outputModalities?: string[];
  inferenceTypesSupported?: string[];
  modelLifecycle?: { status?: string };
}

/** The vendor segment of a Bedrock id, e.g. `us.anthropic.claude-…` → "anthropic". */
export function modelVendor(id: string): string {
  const parts = id.split('.');
  // Region-prefixed inference profiles (`us.`, `eu.`, `apac.`) put the vendor second.
  const head = parts[0] ?? '';
  if (/^(us|eu|apac|us-gov)$/.test(head) && parts.length > 1) return parts[1] ?? '';
  return head;
}

/**
 * Model ids that are not text-generation LLMs, matched by name.
 *
 * Needed because the INFERENCE PROFILE listing — which takes priority over
 * foundation models — carries no modality metadata at all (a profile summary
 * exposes only an id, a name and a status). So embedding and image models can't
 * be excluded structurally there the way they can for foundation models; the id
 * is the only signal available.
 *
 * Deliberately narrow: it matches product lines that are definitively not
 * chat/completion models, rather than guessing from loose keywords.
 */
const NON_LLM_PATTERNS: RegExp[] = [
  /embed/i, // titan-embed-*, cohere.embed-*, nova embeddings
  /\brerank\b|\.rerank|rerank-/i, // cohere.rerank-*, amazon.rerank-*
  /titan-image|nova-canvas|stable-?diffusion|\bsd3\b|stability\./i, // image generation
  /nova-reel|titan-video|\bvideo\b/i, // video generation
  /nova-sonic|titan-speech|\bspeech\b|\btts\b/i, // speech
  /segment-anything|titan-multimodal/i, // vision/multimodal embedding
];

/** Is this id a text-generating LLM (as opposed to embeddings, image, speech…)? */
export function isTextGenerationModel(modelId: string): boolean {
  return !NON_LLM_PATTERNS.some((re) => re.test(modelId));
}

/**
 * Can we actually invoke this foundation model on this account, and is it a
 * text-generation LLM?
 *
 * Family is NOT a criterion — each family has its own codec, so Anthropic,
 * DeepSeek, Llama, Nova, Mistral, Titan and Cohere are all fair game. What's
 * filtered is what genuinely cannot be used here, each of which would otherwise
 * surface as a different confusing runtime error:
 *  - LEGACY lifecycle    → deprecated; AWS refuses new invocations
 *  - no ON_DEMAND        → needs provisioned throughput this app doesn't allocate
 *  - no TEXT output      → image/video/speech generators
 *  - EMBEDDING output    → vector models; they return no prose at all
 *  - no TEXT input       → can't be handed a prompt
 *  - non-LLM by name     → belt-and-braces for when AWS omits the metadata
 *  - no codec            → a family with no request format here (see findCodec)
 */
export function isInvokable(m: FoundationModelLike): boolean {
  if (!m.modelId) return false;
  if (m.modelLifecycle?.status === 'LEGACY') return false;
  // Absent means the API didn't say; only exclude when it explicitly lacks ON_DEMAND.
  if (m.inferenceTypesSupported && !m.inferenceTypesSupported.includes('ON_DEMAND')) return false;
  if (m.outputModalities) {
    if (!m.outputModalities.includes('TEXT')) return false;
    // An embedding model can list TEXT output while returning vectors, not prose.
    if (m.outputModalities.includes('EMBEDDING')) return false;
  }
  // Must be able to accept a text prompt in the first place.
  if (m.inputModalities && !m.inputModalities.includes('TEXT')) return false;
  // Finally: only offer what we can actually build a request for. This keeps the
  // picker and the invoke path in agreement — adding a codec is what makes a
  // family appear, so the two can never drift.
  return findCodec(m.modelId) !== null;
}

/**
 * Translate a raw AWS SDK error into something that says what to DO about it.
 *
 * Bedrock's native errors are famously opaque here: picking a non-Anthropic model
 * yields a bare "ValidationException", and an un-enabled model yields
 * "AccessDeniedException" with no hint that model access is granted per-account
 * in the Bedrock console.
 */
function explainAwsError(e: unknown, modelId: string): ProviderError {
  const name = (e as { name?: string })?.name ?? '';
  const raw = (e as { message?: string })?.message ?? String(e);
  const status = (e as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;

  if (name === 'AccessDeniedException' || status === 403) {
    return new ProviderError(
      `Bedrock denied access to "${modelId}". Model access is granted per account and ` +
        'region: open the Bedrock console → Model access and enable this model, and check ' +
        'the credential’s region matches where it is enabled.',
      403,
    );
  }
  if (name === 'ResourceNotFoundException' || status === 404) {
    return new ProviderError(
      `Bedrock has no model "${modelId}" in this region. Newer Claude models must be ` +
        'invoked through a region-prefixed inference profile (e.g. `us.anthropic.…`) ' +
        'rather than the bare model id.',
      404,
    );
  }
  if (name === 'ValidationException') {
    return new ProviderError(`Bedrock rejected the request for "${modelId}": ${raw}`, status ?? 400);
  }
  if (name === 'ThrottlingException' || status === 429) {
    return new ProviderError(`Bedrock throttled the request for "${modelId}". Retry shortly.`, 429);
  }
  return new ProviderError(`Bedrock error for "${modelId}": ${raw}`, status);
}

/**
 * Per-family wire format.
 *
 * Bedrock's `InvokeModel` speaks each vendor's NATIVE schema — there is no shared
 * shape. We use it rather than the Converse API deliberately: Converse is a
 * lowest-common-denominator surface that drops family-specific parameters and
 * doesn't cover every model, whereas InvokeModel gives full access to whatever
 * each family actually supports. The cost is this table.
 *
 *  - `body`   → the request JSON for that family
 *  - `text`   → pull the completion out of a non-streaming response
 *  - `delta`  → pull the incremental text out of one stream chunk
 *  - `stop`   → pull the stop reason out of a chunk, if it carries one
 */
interface FamilyCodec {
  body: (req: GenerateRequest) => Record<string, unknown>;
  text: (json: Record<string, unknown>) => string;
  delta: (chunk: Record<string, unknown>) => string;
  stop?: (chunk: Record<string, unknown>) => string | undefined;
  /**
   * Optional stateful filter over the delta stream, for families that emit a
   * reasoning preamble the author must never see. Returns a fresh function per
   * stream; it maps each raw delta to what should actually be emitted ('' to
   * swallow it).
   */
  streamFilter?: () => (piece: string) => string;
}

/**
 * Suppress everything up to and including a reasoning model's `</think>`, then
 * pass text through untouched. Used for the streaming path, where deltas are
 * forwarded as they arrive and so cannot be cleaned up after the fact.
 */
function makeReasoningFilter(): (piece: string) => string {
  let done = false;
  let buffer = '';
  return (piece) => {
    if (done) return piece;
    buffer += piece;
    const idx = buffer.indexOf('</think>');
    if (idx < 0) return ''; // still inside the scratchpad
    done = true;
    return buffer.slice(idx + '</think>'.length).replace(/^\s+/, '');
  };
}

/**
 * Drop a reasoning model's scratchpad from its completion.
 *
 * DeepSeek R1 is prompted with a trailing `<think>` tag, so its reply opens with
 * chain-of-thought before the actual answer. That's working notes, not prose the
 * author asked for, and it must not land in a manuscript. Handles both a matched
 * `<think>…</think>` pair and the unterminated case (the prompt opens the tag, so
 * the completion may only contain the closing one).
 */
export function stripReasoning(text: string): string {
  const closed = text.replace(/<think>[\s\S]*?<\/think>/g, '');
  // Prompt-opened tag: everything up to the first </think> is reasoning.
  const idx = closed.indexOf('</think>');
  return (idx >= 0 ? closed.slice(idx + '</think>'.length) : closed).trim();
}

/** Join system + turns into one prompt for families with no structured messages. */
function flattenPrompt(req: GenerateRequest, userTag: string, botTag: string): string {
  const turns = req.messages
    .map((m) => `${m.role === 'user' ? userTag : botTag}\n${m.content}`)
    .join('\n\n');
  return req.system.trim() ? `${req.system.trim()}\n\n${turns}\n\n${botTag}\n` : `${turns}\n\n${botTag}\n`;
}

const CODECS: Record<string, FamilyCodec> = {
  // Anthropic Messages API on Bedrock.
  anthropic: {
    body: (req) => ({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: req.maxTokens ?? 2048,
      temperature: req.temperature,
      ...(req.system.trim() ? { system: req.system } : {}),
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
    }),
    text: (j) =>
      ((j.content as { type: string; text?: string }[] | undefined) ?? [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text ?? '')
        .join(''),
    delta: (c) =>
      c.type === 'content_block_delta' ? ((c.delta as { text?: string })?.text ?? '') : '',
    stop: (c) =>
      c.type === 'message_delta' ? (c.delta as { stop_reason?: string })?.stop_reason : undefined,
  },

  // Amazon Nova — structured messages, but its own envelope.
  amazon: {
    body: (req) => ({
      schemaVersion: 'messages-v1',
      ...(req.system.trim() ? { system: [{ text: req.system }] } : {}),
      messages: req.messages.map((m) => ({ role: m.role, content: [{ text: m.content }] })),
      inferenceConfig: { max_new_tokens: req.maxTokens ?? 2048, temperature: req.temperature },
    }),
    text: (j) => {
      const out = j.output as { message?: { content?: { text?: string }[] } } | undefined;
      return (out?.message?.content ?? []).map((b) => b.text ?? '').join('');
    },
    delta: (c) => {
      const d = c.contentBlockDelta as { delta?: { text?: string } } | undefined;
      return d?.delta?.text ?? '';
    },
    stop: (c) => (c.messageStop as { stopReason?: string } | undefined)?.stopReason,
  },

  // Meta Llama — single prompt string with instruction tags.
  meta: {
    body: (req) => ({
      prompt: flattenPrompt(req, '<|start_header_id|>user<|end_header_id|>', '<|start_header_id|>assistant<|end_header_id|>'),
      max_gen_len: req.maxTokens ?? 2048,
      temperature: req.temperature,
    }),
    text: (j) => (j.generation as string | undefined) ?? '',
    delta: (c) => (c.generation as string | undefined) ?? '',
    stop: (c) => c.stop_reason as string | undefined,
  },

  /**
   * DeepSeek (R1 / V3.1) — a TEXT COMPLETION api on Bedrock's InvokeModel, not a
   * chat api. It takes a single `prompt` string and returns `choices[].text`.
   *
   * The special-token template is required, not cosmetic: without the
   * `<｜User｜> … <｜Assistant｜>` framing the model has no turn structure and just
   * continues the raw text, so a prompt mentioning a name comes back as that name
   * echoed instead of a reply. The trailing `<think>\n` is what R1 expects to
   * begin its reasoning block.
   *
   * `strip` then removes that reasoning block — it's the model's scratchpad, not
   * prose the author asked for.
   * https://docs.aws.amazon.com/bedrock/latest/userguide/model-parameters-deepseek.html
   */
  deepseek: {
    body: (req) => {
      const turns = req.messages
        .map((m) => (m.role === 'user' ? `<｜User｜>${m.content}` : `<｜Assistant｜>${m.content}`))
        .join('');
      const preamble = req.system.trim() ? `${req.system.trim()}\n\n` : '';
      return {
        prompt: `<｜begin▁of▁sentence｜>${preamble}${turns}<｜Assistant｜><think>\n`,
        // R1 quality degrades badly above 8,192 even though the api accepts more.
        max_tokens: Math.min(req.maxTokens ?? 2048, 8192),
        temperature: req.temperature,
      };
    },
    text: (j) => {
      const choices = j.choices as { text?: string }[] | undefined;
      return stripReasoning((choices ?? []).map((c) => c.text ?? '').join(''));
    },
    delta: (c) => {
      const choices = c.choices as { text?: string }[] | undefined;
      return (choices ?? []).map((x) => x.text ?? '').join('');
    },
    stop: (c) => (c.choices as { stop_reason?: string }[] | undefined)?.[0]?.stop_reason,
    streamFilter: makeReasoningFilter,
  },

  // Mistral — prompt string with [INST] framing.
  mistral: {
    body: (req) => ({
      prompt: `<s>[INST] ${req.system.trim() ? `${req.system.trim()}\n\n` : ''}${req.messages
        .map((m) => m.content)
        .join('\n\n')} [/INST]`,
      max_tokens: req.maxTokens ?? 2048,
      temperature: req.temperature,
    }),
    text: (j) =>
      ((j.outputs as { text?: string }[] | undefined) ?? []).map((o) => o.text ?? '').join(''),
    delta: (c) =>
      ((c.outputs as { text?: string }[] | undefined) ?? []).map((o) => o.text ?? '').join(''),
    stop: (c) =>
      ((c.outputs as { stop_reason?: string }[] | undefined) ?? [])[0]?.stop_reason,
  },

  // Cohere Command R — chat_history + message.
  cohere: {
    body: (req) => {
      const turns = [...req.messages];
      const last = turns.pop();
      return {
        message: last?.content ?? '',
        ...(req.system.trim() ? { preamble: req.system } : {}),
        chat_history: turns.map((m) => ({
          role: m.role === 'user' ? 'USER' : 'CHATBOT',
          message: m.content,
        })),
        max_tokens: req.maxTokens ?? 2048,
        temperature: req.temperature,
      };
    },
    text: (j) => (j.text as string | undefined) ?? '',
    delta: (c) => (c.event_type === 'text-generation' ? ((c.text as string) ?? '') : ''),
    stop: (c) => (c.finish_reason as string | undefined) ?? undefined,
  },
};

/** Amazon Titan predates Nova and uses inputText/textGenerationConfig. */
CODECS.titan = {
  body: (req) => ({
    inputText: flattenPrompt(req, 'User:', 'Bot:'),
    textGenerationConfig: { maxTokenCount: req.maxTokens ?? 2048, temperature: req.temperature },
  }),
  text: (j) =>
    ((j.results as { outputText?: string }[] | undefined) ?? [])
      .map((r) => r.outputText ?? '')
      .join(''),
  delta: (c) => (c.outputText as string | undefined) ?? '',
  stop: (c) => c.completionReason as string | undefined,
};

/**
 * Pick the codec for a model id. Titan and Nova are both `amazon.*`, so they are
 * separated by model name rather than vendor.
 */
/**
 * The codec for a model id, or null if this app has no request format for that
 * family. Returning null rather than throwing lets the PICKER use the same lookup
 * it uses at invoke time — so a family we can't drive (Writer's Palmyra, TwelveLabs,
 * Luma, AI21…) is never offered in the first place, instead of failing only once
 * the author has chosen it and pressed send.
 */
export function findCodec(modelId: string): FamilyCodec | null {
  if (!isTextGenerationModel(modelId)) return null;
  const vendor = modelVendor(modelId);
  // Titan and Nova are both `amazon.*` but use different formats.
  if (vendor === 'amazon' && /titan/i.test(modelId)) return CODECS.titan ?? null;
  return CODECS[vendor] ?? null;
}

/** Human-readable list of the families that DO have a request format. */
function supportedFamilies(): string {
  return Object.keys(CODECS)
    .filter((k) => k !== 'titan')
    .concat('titan')
    .join(', ');
}

export function codecFor(modelId: string): FamilyCodec {
  // A world saved before the picker was filtered could still name an embedding or
  // image model; those have no chat format at all, so say so plainly.
  if (!isTextGenerationModel(modelId)) {
    throw new ProviderError(
      `Bedrock model "${modelId}" is not a text-generation model (it looks like an ` +
        'embedding, rerank, image, video or speech model). Pick a chat model instead.',
      400,
    );
  }
  const codec = findCodec(modelId);
  if (!codec) {
    throw new ProviderError(
      `Bedrock model "${modelId}" is from a family this app doesn't have a request format ` +
        `for yet ("${modelVendor(modelId)}"). Supported: ${supportedFamilies()}.`,
      400,
    );
  }
  return codec;
}

export class BedrockAdapter implements ProviderAdapter {
  readonly provider = 'bedrock' as const;

  /**
   * List Bedrock models via the control-plane client (@aws-sdk/client-bedrock,
   * optional). Returns INFERENCE PROFILES first — these are the IDs you actually
   * invoke (e.g. `us.anthropic.claude-opus-4-6-v1`); newer Anthropic models
   * reject bare on-demand model IDs and require a profile. Falls back to
   * foundation-model IDs, then (in the route) to the curated catalog.
   *
   * Everything returned is filtered to what this adapter can actually invoke and
   * what the account can actually call — see `isInvokable`. Listing a model we
   * can't drive just moves the failure to generate-time as an opaque AWS
   * ValidationException.
   */
  async listModels(auth: ProviderAuth): Promise<ModelInfo[]> {
    const region = auth.region ?? env.provider.awsRegion;
    let mod: Record<string, unknown>;
    try {
      mod = (await import('@aws-sdk/client-bedrock')) as unknown as Record<string, unknown>;
    } catch {
      throw new ProviderError(
        'Bedrock model listing needs @aws-sdk/client-bedrock. Using the curated list.',
      );
    }
    const Client = mod.BedrockClient as new (i: unknown) => {
      send(cmd: unknown): Promise<{
        inferenceProfileSummaries?: {
          inferenceProfileId: string;
          inferenceProfileName?: string;
          status?: string;
        }[];
        modelSummaries?: FoundationModelLike[];
      }>;
    };
    const ListProfiles = mod.ListInferenceProfilesCommand as new (i: unknown) => unknown;
    const ListModels = mod.ListFoundationModelsCommand as new (i: unknown) => unknown;
    const client = new Client(awsClientConfig(auth, region));

    // 1. Inference profiles — the invokable IDs.
    const profiles: ModelInfo[] = [];
    try {
      const out = await client.send(new ListProfiles({ maxResults: 100 }));
      for (const s of out.inferenceProfileSummaries ?? []) {
        // ACTIVE only: a profile still being created can't be invoked. Every
        // vendor is kept — each family has its own codec.
        if (s.status && s.status !== 'ACTIVE') continue;
        // Profile summaries carry NO modality metadata, so the id is the only
        // signal: this drops non-LLMs (embedding/image/speech) AND families we
        // have no request format for (Writer's Palmyra, AI21, TwelveLabs, Luma…).
        if (!findCodec(s.inferenceProfileId)) continue;
        profiles.push({
          id: s.inferenceProfileId,
          label: s.inferenceProfileName ?? s.inferenceProfileId,
        });
      }
    } catch {
      // some regions/permissions can't list profiles — fall through to models
    }
    if (profiles.length) {
      return profiles.sort((a, b) => a.id.localeCompare(b.id));
    }

    // 2. Fallback: foundation-model IDs (may still need a profile to invoke).
    const out = await client.send(new ListModels({ byOutputModality: 'TEXT' }));
    return (out.modelSummaries ?? [])
      .filter(isInvokable)
      .map((m) => ({ id: m.modelId, label: m.modelName ?? m.modelId }));
  }

  async generate(req: GenerateRequest, auth: ProviderAuth): Promise<GenerateResult> {
    const codec = codecFor(req.model);
    const region = auth.region ?? env.provider.awsRegion;
    const { client, Invoke } = await loadClient(auth, region);
    let out: { body: Uint8Array };
    try {
      out = await client.send(
        new Invoke({
          modelId: req.model,
          contentType: 'application/json',
          accept: 'application/json',
          body: JSON.stringify(codec.body(req)),
        }),
      );
    } catch (e) {
      throw explainAwsError(e, req.model);
    }
    const decoded = JSON.parse(new TextDecoder().decode(out.body)) as Record<string, unknown>;
    return {
      text: codec.text(decoded),
      stopReason: codec.stop?.(decoded) ?? (decoded.stop_reason as string | undefined),
    };
  }

  async stream(
    req: GenerateRequest,
    auth: ProviderAuth,
    onDelta: (t: string) => void,
  ): Promise<GenerateResult> {
    const codec = codecFor(req.model);
    const region = auth.region ?? env.provider.awsRegion;
    const { client, InvokeStream } = await loadClient(auth, region);
    let out: { body: AsyncIterable<{ chunk?: { bytes?: Uint8Array } }> };
    try {
      out = (await client.send(
        new InvokeStream({
          modelId: req.model,
          contentType: 'application/json',
          accept: 'application/json',
          body: JSON.stringify(codec.body(req)),
        }),
      )) as unknown as { body: AsyncIterable<{ chunk?: { bytes?: Uint8Array } }> };
    } catch (e) {
      throw explainAwsError(e, req.model);
    }

    let text = '';
    let stopReason: string | undefined;
    const filter = codec.streamFilter?.();
    for await (const event of out.body) {
      if (!event.chunk?.bytes) continue;
      const parsed = JSON.parse(new TextDecoder().decode(event.chunk.bytes)) as Record<
        string,
        unknown
      >;
      const raw = codec.delta(parsed);
      // Reasoning families emit a scratchpad first; the filter swallows it so it
      // never reaches the editor (it can't be retracted once streamed).
      const piece = filter ? filter(raw) : raw;
      if (piece) {
        text += piece;
        onDelta(piece);
      }
      stopReason = codec.stop?.(parsed) ?? stopReason;
    }
    return { text, stopReason };
  }
}
