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
  /**
   * Author override for how many tokens of world context to send, in tokens.
   * `null` (the default) derives it from the selected model — see the server's
   * `contextBudgetFor`. Set this to force a smaller prompt on a model whose
   * real window is smaller than the table assumes, or a larger one on a model
   * the table doesn't know about.
   */
  contextBudget?: number | null;
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
  contextBudget: null,
};

// ─── canonical defaults (mirror the prototype) ──────────────
// Note: hard rules (session.hardRules) and banned words/phrases are NOT recipe
// items — they are injected into the trusted prompt header for every mode and are
// never dropped under budget. `worldRules` (the fiction's own laws) IS soft,
// droppable context and appears here.
export const DEFAULT_CONTEXT_RECIPES: ContextRecipes = {
  cowrite: [
    // Co-write continues the scene in front of the author, so the real text of
    // the chapters leading up to it matters most. ('recentScenesVerbatim' was
    // here, but nothing ever populated it — it always rendered nothing.)
    'premise',
    'precedingChapters:60',
    'characterStates:present',
    'openThreads',
    'canon',
    'worldRules',
    'characterDefinitions:present',
    'characterArcs',
    'relationships',
    'worldSetting',
    'factions',
    'concepts',
    'sources',
    'styleNotes',
  ],
  draft: [
    // premise carries the synopsis, where the author's chapter-by-chapter outline
    // usually lives; targetChapterMeta names WHICH chapter to write; targetOutlineBeats
    // is any per-chapter outline text (often empty — the synopsis is the real outline).
    'premise',
    'targetChapterMeta',
    'targetOutlineBeats',
    // The REAL prose of the chapters just before this one. High priority: the
    // model has to continue actual writing, not a summary of it. Summaries alone
    // let it contradict the text it is picking up from.
    'precedingChapters:60',
    'canon',
    'worldRules',
    'characterDefinitions:present',
    // Who these people are to each other, and where each of them is headed.
    // Without these the model writes each character correctly in isolation and
    // still gets every scene between two of them wrong.
    'relationships',
    'characterArcs',
    'worldSetting',
    'factions',
    // The nonfiction backbone: the author's concept definitions and their
    // research. A drafting model without these invents citations rather than
    // using the ones the author has on file.
    'concepts',
    'sources',
    'openThreads',
    'adjacentChapterSummaries',
    'styleNotes',
  ],
  // Editing used to see the prose, style notes, and only the first five canon
  // facts — so it could contradict canon fact six, and knew nothing about the
  // people in the passage it was rewriting.
  edit: [
    'targetTextFull',
    'styleNotes',
    'canon',
    'worldRules',
    'characterDefinitions:present',
    'relationships',
    'concepts',
    'sources',
  ],
  critique: [
    'targetTextFull',
    'canon',
    'worldRules',
    'openThreads',
    'characterStates:present',
    'characterDefinitions:present',
    'relationships',
    'characterArcs',
    'concepts',
    'sources',
  ],
  // 'recentEvents:high-importance' is deliberately absent: the event log is no
  // longer authored anywhere in the UI, so it would be an empty section on every
  // new world. The renderer still handles the item for worlds whose saved recipe
  // names it and whose memory.events still has entries.
  discuss: [
    'premise',
    'canonSummary',
    'worldRules',
    'openThreads',
    'characterDefinitions:present',
    'relationships',
    'worldSetting',
    'concepts',
    'sources',
  ],
};

export const DEFAULT_MEMORY_WRITEBACK: MemoryWriteback = {
  cowrite: 'events',
  draft: 'events+chapterStatus',
  edit: 'decisions-if-structural',
  critique: 'nothing',
  discuss: 'decisions+canon-with-user-confirmation',
};
