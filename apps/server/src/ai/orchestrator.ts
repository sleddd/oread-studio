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
  WebCitation,
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
  /** user asked the model to research the web this turn (gated by mode contract) */
  allowWebSearch?: boolean;
  /** streaming sink; if omitted, non-streaming */
  onDelta?: (t: string) => void;
}

export interface GenerateOutput {
  kind: OutputKind;
  /** prose/text body */
  text?: string;
  /** edit/critique suggestion */
  suggestion?: Suggestion;
  /** web sources the model consulted, if research ran */
  citations?: WebCitation[];
  /** whether a real provider or the mock produced this */
  usedMock: boolean;
  includedContext: string[];
  droppedContext: string[];
}

// One model/credential for the whole world (session.model), used by every mode.
function worldCredentialId(world: WorldDocument): string | null {
  return world.world.session.model?.credentialId ?? null;
}

function worldModel(world: WorldDocument): string | null {
  return world.world.session.model?.model ?? null;
}

function worldTemperature(world: WorldDocument): number {
  return world.world.session.model?.temperature ?? 0.85;
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

  // Web search is only offered to modes whose contract permits research, and
  // only when the user opted in for this turn.
  const useWebSearch = !!params.allowWebSearch && contract.mayResearch;

  // Add a structured-output instruction for suggestion modes.
  let system = assembled.system;
  if (contract.output === 'suggestion') {
    system +=
      '\n\nReturn your result as a single JSON object: ' +
      '{ "type": "rewrite|cut|expand|flag|continuity-error", "original": string, ' +
      '"proposed": string|null, "rationale": string }. ' +
      'Output ONLY the JSON object.';
  }
  if (useWebSearch) {
    system +=
      '\n\nYou may search the web to ground your answer in real-world facts ' +
      '(places, history, science, current information). Search only when it ' +
      'materially improves accuracy, and cite what you use. Do not let web ' +
      'facts override established world canon.';
  }

  const credentialId = worldCredentialId(world);
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
  const model = worldModel(world) ?? defaultModelFor(resolved.provider);
  const req = {
    model,
    system,
    messages: params.messages,
    temperature: worldTemperature(world),
    webSearch: useWebSearch,
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
  const out: GenerateOutput = {
    kind,
    text: result.text,
    citations: result.citations,
    usedMock: false,
    includedContext: assembled.includedItems,
    droppedContext: assembled.droppedItems,
  };
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
      // Inference profile id — bare model ids are rejected for on-demand invoke.
      return 'us.anthropic.claude-sonnet-4-6';
    case 'local':
      return 'llama3.1';
    default:
      return 'claude-sonnet-5';
  }
}
