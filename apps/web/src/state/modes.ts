/**
 * Mode + config chip definitions, and the one-click mode-action derivation.
 * Mirrors the prototype's MODES / cfgDefs / modeActionMap.
 */
import type { ChatMode } from '@oread/shared';

export interface ModeDef {
  key: ChatMode;
  label: string;
  hint: string;
}

export const MODES: ModeDef[] = [
  { key: 'discuss', label: 'Discuss', hint: 'Talk it through. Nothing gets written.' },
  { key: 'cowrite', label: 'Co-write', hint: 'Trade turns in-scene. Insert what lands.' },
  { key: 'draft', label: 'Draft', hint: 'A full pass from your outline. Review, then insert.' },
  { key: 'edit', label: 'Edit', hint: 'Rewrites your text as redlines. Accept or reject.' },
  { key: 'critique', label: 'Critique', hint: 'Margin notes & proposed lines. Applies nothing.' },
];

export interface CfgDef {
  key: string;
  label: string;
  options: string[];
}

export const CFG_DEFS: Record<ChatMode, CfgDef[]> = {
  cowrite: [
    { key: 'turnScope', label: 'turn', options: ['sentence', 'paragraph', 'beat', 'scene'] },
    { key: 'userRole', label: 'you are', options: ['author', 'character', 'director'] },
  ],
  draft: [
    { key: 'fromMaterial', label: 'from', options: ['outline', 'beats', 'priorDraft'] },
    { key: 'lengthTarget', label: 'length', options: ['~300', '~800', '~1600', '~2200'] },
  ],
  edit: [
    { key: 'editLevel', label: 'level', options: ['line', 'structural', 'developmental'] },
    { key: 'outputFormat', label: 'as', options: ['redline', 'diff', 'clean'] },
  ],
  critique: [
    { key: 'lens', label: 'lens', options: ['pacing', 'voice', 'continuity', 'argument'] },
    { key: 'depth', label: 'depth', options: ['margin-notes', 'full-report'] },
  ],
  discuss: [
    { key: 'focus', label: 'focus', options: ['plot-problem', 'character', 'research', 'theme'] },
  ],
};

export type ModeCfg = Record<ChatMode, Record<string, string>>;

export const DEFAULT_CFG: ModeCfg = {
  cowrite: { turnScope: 'paragraph', userRole: 'author' },
  draft: { fromMaterial: 'outline', lengthTarget: '~800' },
  edit: { editLevel: 'line', outputFormat: 'redline' },
  critique: { lens: 'pacing', depth: 'margin-notes' },
  discuss: { focus: 'character' },
};

export interface ModeAction {
  icon: string;
  label: string;
  sub: string;
  prompt: string;
}

export function modeAction(
  mode: ChatMode,
  cfg: ModeCfg,
  chapterTitle: string,
): ModeAction | null {
  switch (mode) {
    case 'cowrite':
      return {
        icon: '▸',
        label: 'Take the next turn',
        sub: `${cfg.cowrite.userRole} hands off · one ${cfg.cowrite.turnScope}`,
        prompt: `Take the next ${cfg.cowrite.turnScope} in the scene.`,
      };
    case 'draft':
      return {
        icon: '✎',
        label: `Write the full draft of ${chapterTitle}`,
        sub: `from ${cfg.draft.fromMaterial} · ${cfg.draft.lengthTarget} words`,
        prompt: `Write the full draft of ${chapterTitle} from the ${cfg.draft.fromMaterial} (${cfg.draft.lengthTarget} words).`,
      };
    case 'edit':
      return {
        icon: '⇄',
        label: 'Redline my latest lines',
        sub: `${cfg.edit.editLevel} edit · as ${cfg.edit.outputFormat}`,
        prompt: `Do a ${cfg.edit.editLevel} edit of my latest lines as a ${cfg.edit.outputFormat}.`,
      };
    case 'critique':
      return {
        icon: '◎',
        label: 'Run the critique',
        sub: `${cfg.critique.lens} lens · ${cfg.critique.depth}`,
        prompt: `Give me a ${cfg.critique.depth} critique through the ${cfg.critique.lens} lens.`,
      };
    default:
      return null; // discuss has no one-click action
  }
}

export function composerPlaceholder(mode: ChatMode, charName: string): string {
  switch (mode) {
    case 'discuss':
      return `Ask ${charName} anything…`;
    case 'cowrite':
      return 'Add direction, or just take your turn…';
    case 'draft':
      return 'Optional: notes to steer the draft…';
    case 'edit':
      return 'Optional: what should change?';
    default:
      return 'Optional: focus the critique…';
  }
}
