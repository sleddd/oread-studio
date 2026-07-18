/**
 * AWS Bedrock adapter (Anthropic models on Bedrock).
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

function anthropicBody(req: GenerateRequest): string {
  return JSON.stringify({
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: req.maxTokens ?? 2048,
    temperature: req.temperature,
    system: req.system,
    messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
  });
}

export class BedrockAdapter implements ProviderAdapter {
  readonly provider = 'bedrock' as const;

  /**
   * List Bedrock models via the control-plane client (@aws-sdk/client-bedrock,
   * optional). Returns INFERENCE PROFILES first — these are the IDs you actually
   * invoke (e.g. `us.anthropic.claude-opus-4-6-v1`); newer Anthropic models
   * reject bare on-demand model IDs and require a profile. Falls back to
   * foundation-model IDs, then (in the route) to the curated catalog.
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
        inferenceProfileSummaries?: { inferenceProfileId: string; inferenceProfileName?: string }[];
        modelSummaries?: { modelId: string; modelName?: string }[];
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
        profiles.push({
          id: s.inferenceProfileId,
          label: s.inferenceProfileName ?? s.inferenceProfileId,
        });
      }
    } catch {
      // some regions/permissions can't list profiles — fall through to models
    }
    if (profiles.length) {
      // Sort anthropic/newest-ish to the top, then alphabetical.
      return profiles.sort((a, b) => a.id.localeCompare(b.id));
    }

    // 2. Fallback: foundation-model IDs (may still need a profile to invoke).
    const out = await client.send(new ListModels({ byOutputModality: 'TEXT' }));
    return (out.modelSummaries ?? []).map((m) => ({
      id: m.modelId,
      label: m.modelName ?? m.modelId,
    }));
  }

  async generate(req: GenerateRequest, auth: ProviderAuth): Promise<GenerateResult> {
    const region = auth.region ?? env.provider.awsRegion;
    const { client, Invoke } = await loadClient(auth, region);
    const out = await client.send(
      new Invoke({
        modelId: req.model,
        contentType: 'application/json',
        accept: 'application/json',
        body: anthropicBody(req),
      }),
    );
    const decoded = JSON.parse(new TextDecoder().decode(out.body)) as {
      content?: { type: string; text?: string }[];
      stop_reason?: string;
    };
    const text = (decoded.content ?? [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('');
    return { text, stopReason: decoded.stop_reason };
  }

  async stream(
    req: GenerateRequest,
    auth: ProviderAuth,
    onDelta: (t: string) => void,
  ): Promise<GenerateResult> {
    const region = auth.region ?? env.provider.awsRegion;
    const { client, InvokeStream } = await loadClient(auth, region);
    const out = (await client.send(
      new InvokeStream({
        modelId: req.model,
        contentType: 'application/json',
        accept: 'application/json',
        body: anthropicBody(req),
      }),
    )) as unknown as { body: AsyncIterable<{ chunk?: { bytes?: Uint8Array } }> };

    let text = '';
    let stopReason: string | undefined;
    for await (const event of out.body) {
      if (!event.chunk?.bytes) continue;
      const parsed = JSON.parse(new TextDecoder().decode(event.chunk.bytes)) as {
        type?: string;
        delta?: { text?: string; stop_reason?: string };
      };
      if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
        text += parsed.delta.text;
        onDelta(parsed.delta.text);
      } else if (parsed.type === 'message_delta' && parsed.delta?.stop_reason) {
        stopReason = parsed.delta.stop_reason;
      }
    }
    return { text, stopReason };
  }
}
