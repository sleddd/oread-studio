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
} from '../provider.js';
import { ProviderError } from '../provider.js';
import { env } from '../../env.js';

// Minimal shapes for the lazily-imported SDK to avoid a hard type dependency.
interface BedrockClientLike {
  send(cmd: unknown): Promise<{ body: Uint8Array }>;
}

async function loadClient(region: string): Promise<{
  client: BedrockClientLike;
  Invoke: new (input: unknown) => unknown;
  InvokeStream: new (input: unknown) => unknown;
}> {
  let mod: Record<string, unknown>;
  try {
    // Optional dependency — resolved at runtime only. Not installed by default.
    // @ts-expect-error module is optional and may be absent at build time
    mod = (await import('@aws-sdk/client-bedrock-runtime')) as Record<string, unknown>;
  } catch {
    throw new ProviderError(
      'Bedrock requires @aws-sdk/client-bedrock-runtime. Install it to use the bedrock provider.',
    );
  }
  const Client = mod.BedrockRuntimeClient as new (input: unknown) => BedrockClientLike;
  return {
    client: new Client({ region }),
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

  async generate(req: GenerateRequest, auth: ProviderAuth): Promise<GenerateResult> {
    const region = auth.region ?? env.provider.awsRegion;
    const { client, Invoke } = await loadClient(region);
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
    const { client, InvokeStream } = await loadClient(region);
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
