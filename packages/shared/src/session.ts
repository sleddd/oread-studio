/**
 * The `world.session` block: default mode, per-mode configs (with credentialId
 * pointers — NEVER raw keys), memory-writeback table, context recipes, and
 * voice/rules/filters.
 */

export type ChatMode = 'cowrite' | 'draft' | 'edit' | 'critique' | 'discuss';
/** `character` chat is a discuss variant carrying a characterId. */
export type PersistedChatMode = ChatMode | 'character';

// ─── per-mode config ────────────────────────────────────────
export interface CowriteConfig {
  turnScope: 'sentence' | 'paragraph' | 'beat' | 'scene';
  userRole: 'author' | 'character' | 'director';
  handoffRule: string;
  canAdvancePlot: boolean;
  maxTurnLength: number;
}

export interface DraftConfig {
  target: string; // chapter id
  fromMaterial: 'outline' | 'beats' | 'priorDraft';
  lengthTarget: string; // e.g. "~800"
  canInventDetails: boolean;
  canAlterCanon: false; // never true
}

export interface EditConfig {
  target: string;
  editLevel: 'line' | 'structural' | 'developmental';
  constraints: string[];
  outputFormat: 'redline' | 'diff' | 'clean';
}

export interface CritiqueConfig {
  target: string;
  lenses: Array<'pacing' | 'voice' | 'continuity' | 'argument'>;
  depth: 'margin-notes' | 'full-report';
  suggestRewrites: boolean;
}

export interface DiscussConfig {
  focus: 'plot-problem' | 'character' | 'research' | 'theme';
  mayProposeCanon: boolean;
}

/**
 * ONE model/credential setting for the whole world (chosen once). Every mode
 * uses it. The per-mode configs below carry only BEHAVIORAL settings.
 */
export interface ModelSettings {
  /** pointer into the per-user credentials table; resolved+decrypted server-side */
  credentialId: string | null;
  provider: 'anthropic' | 'openai' | 'bedrock' | 'cloudflare' | 'local' | null;
  model: string | null;
  temperature: number;
}

export type CowriteModeConfig = CowriteConfig;
export type DraftModeConfig = DraftConfig;
export type EditModeConfig = EditConfig;
export type CritiqueModeConfig = CritiqueConfig;
export type DiscussModeConfig = DiscussConfig;

export interface ModeConfigs {
  cowrite: CowriteModeConfig;
  draft: DraftModeConfig;
  edit: EditModeConfig;
  critique: CritiqueModeConfig;
  discuss: DiscussModeConfig;
}

// ─── memory writeback ───────────────────────────────────────
/**
 * What each mode is permitted to write back to memory when a chat is saved /
 * a turn completes. Enforced server-side.
 */
export interface MemoryWriteback {
  cowrite: 'events';
  draft: 'events+chapterStatus';
  edit: 'decisions-if-structural';
  critique: 'nothing';
  discuss: 'decisions+canon-with-user-confirmation';
}

// ─── context recipes ────────────────────────────────────────
/** A recipe is an ordered list of context items (priority-ordered). */
export type ContextRecipes = Record<ChatMode, string[]>;

export interface LinguisticFilters {
  bannedWords: string[];
  bannedPhrases: string[];
}

export interface WorldSession {
  defaultMode: ChatMode;
  /** single model/credential for the whole world — used by every mode */
  model: ModelSettings;
  modeConfigs: ModeConfigs;
  memoryWriteback: MemoryWriteback;
  contextRecipes: ContextRecipes;
  narratorVoice: string;
  hardRules: string[];
  styleNotes: string;
  linguisticFilters: LinguisticFilters;
}

export const DEFAULT_MODEL_SETTINGS: ModelSettings = {
  credentialId: null,
  provider: null,
  model: null,
  temperature: 0.85,
};

// ─── canonical defaults (mirror the prototype) ──────────────
export const DEFAULT_CONTEXT_RECIPES: ContextRecipes = {
  cowrite: [
    'recentScenesVerbatim:2',
    'characterStates:present',
    'openThreads',
    'canon',
    'styleNotes',
  ],
  draft: [
    'targetOutlineBeats',
    'canon',
    'adjacentChapterSummaries',
    'characterDefinitions:present',
    'styleNotes',
  ],
  edit: ['targetTextFull', 'styleNotes', 'bannedWords', 'canon:minimal'],
  critique: [
    'targetTextFull',
    'canon',
    'openThreads',
    'timeline',
    'characterStates:present',
  ],
  discuss: [
    'premise',
    'canonSummary',
    'openThreads',
    'recentEvents:high-importance',
  ],
};

export const DEFAULT_MEMORY_WRITEBACK: MemoryWriteback = {
  cowrite: 'events',
  draft: 'events+chapterStatus',
  edit: 'decisions-if-structural',
  critique: 'nothing',
  discuss: 'decisions+canon-with-user-confirmation',
};
