/**
 * Server-side mode-permission enforcement. The mode contract is enforced HERE,
 * not trusted from the client:
 *  - discuss   → conversation only, writes nothing
 *  - cowrite   → prose, insertable
 *  - draft     → prose; may NOT contradict canon (canon injected + instructed)
 *  - edit      → suggestion (original→proposed); may NOT invent plot
 *  - critique  → suggestion; applies NOTHING (client must never auto-apply)
 *  - character → discuss variant; speaks only as the character, respecting
 *                state.knowledge
 */
import type { ChatMode, PersistedChatMode } from '@oread/shared';

export type OutputKind = 'text' | 'prose' | 'suggestion';

export interface ModeContract {
  /** the shape the model must return */
  output: OutputKind;
  /** may the result be applied to the manuscript on accept? */
  applicable: boolean;
  /** must canon be included and protected? */
  protectCanon: boolean;
  /** may the model invent new plot/canon? */
  mayInventPlot: boolean;
  /** may the model research the live web (native web-search tool) in this mode? */
  mayResearch: boolean;
  /** what this mode may write back to memory */
  memoryWriteback: 'events' | 'events+chapterStatus' | 'decisions-if-structural' | 'nothing' | 'decisions+canon-with-user-confirmation';
}

export const MODE_CONTRACTS: Record<ChatMode, ModeContract> = {
  discuss: {
    output: 'text',
    applicable: false,
    protectCanon: false,
    mayInventPlot: false,
    mayResearch: true, // grounding facts, research focus, real places/history
    memoryWriteback: 'decisions+canon-with-user-confirmation',
  },
  cowrite: {
    output: 'prose',
    applicable: true,
    protectCanon: true,
    mayInventPlot: true,
    mayResearch: false, // in-scene prose, not research
    memoryWriteback: 'events',
  },
  draft: {
    output: 'prose',
    applicable: true,
    protectCanon: true,
    mayInventPlot: false, // draft may not contradict canon; invents detail, not plot
    mayResearch: true, // may ground a scene in real places/history/science
    memoryWriteback: 'events+chapterStatus',
  },
  edit: {
    output: 'suggestion',
    applicable: true, // edit suggestions CAN be applied on accept
    protectCanon: true,
    mayInventPlot: false, // edit may not invent plot
    mayResearch: false, // works on the user's own text
    memoryWriteback: 'decisions-if-structural',
  },
  critique: {
    output: 'suggestion',
    applicable: false, // critique applies NOTHING
    protectCanon: true,
    mayInventPlot: false,
    mayResearch: false, // works on the user's own text
    memoryWriteback: 'nothing',
  },
};

export function baseMode(mode: PersistedChatMode): ChatMode {
  return mode === 'character' ? 'discuss' : mode;
}

export function contractFor(mode: PersistedChatMode): ModeContract {
  return MODE_CONTRACTS[baseMode(mode)];
}

/**
 * Guard applied to a produced result BEFORE it is returned/applied. Throws if
 * the model's output violates the mode contract (defense in depth against a
 * misbehaving model or a client trying to smuggle an apply).
 */
export class ModePermissionError extends Error {}

export function assertResultAllowed(
  mode: PersistedChatMode,
  producedKind: OutputKind,
): void {
  const c = contractFor(mode);
  if (producedKind !== c.output) {
    throw new ModePermissionError(
      `mode "${mode}" must produce ${c.output}, got ${producedKind}`,
    );
  }
}

/** Whether a client request to APPLY a suggestion/prose is permitted for this mode. */
export function assertApplyAllowed(mode: PersistedChatMode): void {
  const c = contractFor(mode);
  if (!c.applicable) {
    throw new ModePermissionError(`mode "${mode}" may not apply changes to the manuscript`);
  }
}

/** System-prompt clauses that encode the contract for the model. */
export function contractInstructions(mode: PersistedChatMode): string[] {
  const c = contractFor(mode);
  const lines: string[] = [];
  if (baseMode(mode) === 'discuss') {
    lines.push('You are in DISCUSS mode. Converse only. Do NOT write manuscript prose or produce edits.');
  }
  if (baseMode(mode) === 'cowrite') {
    lines.push('You are in CO-WRITE mode. Produce a single prose turn to continue the scene, then hand back.');
  }
  if (baseMode(mode) === 'draft') {
    lines.push('You are in DRAFT mode. Produce prose for the target chapter. You may invent concrete sensory detail, but you MUST NOT contradict or add to established canon.');
  }
  if (baseMode(mode) === 'edit') {
    lines.push('You are in EDIT mode. Return a structured redline: the original span and your proposed replacement. Do NOT invent new plot or events — edit the existing text only.');
  }
  if (baseMode(mode) === 'critique') {
    lines.push('You are in CRITIQUE mode. Offer observations and optionally propose lines, but understand that NOTHING you produce will be applied automatically.');
  }
  if (c.protectCanon) {
    lines.push('The CANON facts provided are immutable truth. Never contradict them.');
  }
  return lines;
}
