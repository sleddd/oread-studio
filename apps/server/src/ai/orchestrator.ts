/**
 * AI orchestration. Resolves the mode's credential → assembles context →
 * calls the provider (streaming) → enforces the mode contract on the result.
 * For edit/critique it coerces the output into a Suggestion object. When no
 * credential is configured, falls back to the deterministic mock.
 *
 * The revision-before-AI-write guarantee is enforced by the ROUTE that applies
 * a change (it snapshots before writing); this module only GENERATES.
 */
import type {
  WorldDocument,
  PersistedChatMode,
  Suggestion,
} from '@oread/shared';
import type { StoreCtx } from '../storage/types.js';
import { resolveAuth } from '../credentials/store.js';
import { getAdapter } from './adapters/index.js';
import { assembleContext } from './context.js';
import {
  contractFor,
  baseMode,
  assertResultAllowed,
  type OutputKind,
} from './permissions.js';
import { mockReply, mockSuggestion } from './mock.js';
import type { ChatTurn } from './provider.js';

export interface GenerateParams {
  ctx: StoreCtx;
  world: WorldDocument;
  mode: PersistedChatMode;
  characterId: string | null;
  messages: ChatTurn[];
  targetChapterId: string;
  targetChapterText?: string;
  recentScenes?: string[];
  /** streaming sink; if omitted, non-streaming */
  onDelta?: (t: string) => void;
}

export interface GenerateOutput {
  kind: OutputKind;
  /** prose/text body */
  text?: string;
  /** edit/critique suggestion */
  suggestion?: Suggestion;
  /** whether a real provider or the mock produced this */
  usedMock: boolean;
  includedContext: string[];
  droppedContext: string[];
}

function modeCredentialId(world: WorldDocument, mode: PersistedChatMode): string | null {
  const base = baseMode(mode);
  const cfg = world.world.session.modeConfigs[base];
  return cfg?.credentialId ?? null;
}

function modeModel(world: WorldDocument, mode: PersistedChatMode): string | null {
  const base = baseMode(mode);
  return world.world.session.modeConfigs[base]?.model ?? null;
}

function modeTemperature(world: WorldDocument, mode: PersistedChatMode): number {
  const base = baseMode(mode);
  return world.world.session.modeConfigs[base]?.temperature ?? 0.85;
}

/** Parse a suggestion from model text. Accepts a JSON block or falls back to a flag. */
function coerceSuggestion(raw: string, target: string, mode: PersistedChatMode): Suggestion {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const o = JSON.parse(jsonMatch[0]) as Partial<Suggestion>;
      return {
        id: `sug_${Date.now()}`,
        target,
        anchor: o.anchor ?? { start: 0, end: 0 },
        type: (o.type as Suggestion['type']) ?? 'rewrite',
        original: o.original ?? '',
        proposed: o.proposed ?? null,
        rationale: o.rationale ?? raw.slice(0, 300),
        status: 'pending',
        createdIn: mode,
      };
    } catch {
      // fall through
    }
  }
  // No structured output — treat the whole reply as a rationale-only flag.
  return {
    id: `sug_${Date.now()}`,
    target,
    anchor: { start: 0, end: 0 },
    type: 'flag',
    original: '',
    proposed: null,
    rationale: raw.trim().slice(0, 500),
    status: 'pending',
    createdIn: mode,
  };
}

export async function generate(params: GenerateParams): Promise<GenerateOutput> {
  const { world, mode } = params;
  const contract = contractFor(mode);

  const assembled = assembleContext({
    world,
    mode,
    characterId: params.characterId,
    targetChapterText: params.targetChapterText,
    recentScenes: params.recentScenes,
  });

  // Add a structured-output instruction for suggestion modes.
  let system = assembled.system;
  if (contract.output === 'suggestion') {
    system +=
      '\n\nReturn your result as a single JSON object: ' +
      '{ "type": "rewrite|cut|expand|flag|continuity-error", "original": string, ' +
      '"proposed": string|null, "rationale": string }. ' +
      'Output ONLY the JSON object.';
  }

  const credentialId = modeCredentialId(world, mode);
  const resolved = credentialId ? await resolveAuth(params.ctx, credentialId) : null;

  // ── Mock fallback (no credential configured) ──
  if (!resolved) {
    let out: GenerateOutput;
    if (contract.output === 'suggestion') {
      const sug = mockSuggestion(params.targetChapterId);
      out = { kind: 'suggestion', suggestion: sug, usedMock: true, includedContext: assembled.includedItems, droppedContext: assembled.droppedItems };
    } else {
      const r = mockReply(mode);
      if (params.onDelta) params.onDelta(r.text);
      out = { kind: r.kind, text: r.text, usedMock: true, includedContext: assembled.includedItems, droppedContext: assembled.droppedItems };
    }
    assertResultAllowed(mode, out.kind);
    return out;
  }

  // ── Real provider ──
  const adapter = getAdapter(resolved.provider);
  const model = modeModel(world, mode) ?? defaultModelFor(resolved.provider);
  const req = {
    model,
    system,
    messages: params.messages,
    temperature: modeTemperature(world, mode),
  };

  const result = params.onDelta
    ? await adapter.stream(req, resolved.auth, params.onDelta)
    : await adapter.generate(req, resolved.auth);

  if (contract.output === 'suggestion') {
    const suggestion = coerceSuggestion(result.text, params.targetChapterId, mode);
    const out: GenerateOutput = { kind: 'suggestion', suggestion, usedMock: false, includedContext: assembled.includedItems, droppedContext: assembled.droppedItems };
    assertResultAllowed(mode, out.kind);
    return out;
  }

  const kind: OutputKind = contract.output; // 'prose' or 'text'
  const out: GenerateOutput = { kind, text: result.text, usedMock: false, includedContext: assembled.includedItems, droppedContext: assembled.droppedItems };
  assertResultAllowed(mode, out.kind);
  return out;
}

function defaultModelFor(provider: string): string {
  switch (provider) {
    case 'anthropic':
      return 'claude-sonnet-5';
    case 'openai':
      return 'gpt-4o';
    case 'cloudflare':
      return '@cf/meta/llama-3.1-8b-instruct';
    case 'bedrock':
      return 'anthropic.claude-3-5-sonnet-20241022-v2:0';
    case 'local':
      return 'llama3.1';
    default:
      return 'claude-sonnet-5';
  }
}
