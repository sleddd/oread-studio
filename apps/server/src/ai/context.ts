/**
 * Context assembly engine. Reads the mode's contextRecipe (priority-ordered),
 * pulls the referenced material from the world document and chapter prose, and
 * packs it into a system prompt within a token budget using most-important-first
 * truncation: items earlier in the recipe are included first; when the budget is
 * exhausted, later items are dropped.
 *
 * Character chat additionally restricts the character to state.knowledge.
 */
import type {
  World,
  WorldDocument,
  PersistedChatMode,
  ChatMode,
} from '@oread/shared';
import { contractInstructions, baseMode } from './permissions.js';

/** Rough token estimate: ~4 chars/token. Good enough for budgeting. */
export function estimateTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

export interface AssembleInput {
  world: WorldDocument;
  mode: PersistedChatMode;
  characterId: string | null;
  /** target chapter prose (for edit/critique/draft/cowrite recent scenes) */
  targetChapterText?: string;
  /** the prose row's chapter_id → world.structure.chapters[].id, for outline meta */
  targetChapterMetaId?: string;
  /** recent scenes verbatim, most recent last */
  recentScenes?: string[];
  /** total budget for the assembled context (system prompt), in tokens */
  budgetTokens?: number;
}

export interface AssembledContext {
  system: string;
  includedItems: string[];
  droppedItems: string[];
  estimatedTokens: number;
}

type Section = { key: string; render: () => string | null };

// The author's OWN world is trusted authorial intent the model must follow — NOT
// untrusted data. So world content below is presented as plain, authoritative
// blocks (no injection fence). Only genuinely external content — live web-search
// results — is treated as untrusted; that lives in the orchestrator's web-search
// framing, not here. `block()` mirrors the old wrapUntrusted signature (returns
// null on empty) so callers stay simple.
function block(label: string, body: string | null | undefined): string | null {
  const b = (body ?? '').trim();
  return b ? `${label}\n${b}` : null;
}

/** Author-declared hard rules the AI must always honor (session.hardRules). */
function absoluteRulesBlock(world: World): string | null {
  const rules = (world.session.hardRules ?? []).map((r) => r.trim()).filter(Boolean);
  if (rules.length === 0) return null;
  return block(
    'ABSOLUTE RULES (author-set — these override everything else and may NEVER be broken, ' +
      'in any mode, for any reason):',
    rules.map((r) => `- ${r}`).join('\n'),
  );
}

/** Banned words + phrases — a hard output constraint, present in every mode. */
function linguisticBansBlock(world: World): string | null {
  const f = world.session.linguisticFilters;
  const words = (f?.bannedWords ?? []).map((w) => w.trim()).filter(Boolean);
  const phrases = (f?.bannedPhrases ?? []).map((p) => p.trim()).filter(Boolean);
  if (words.length === 0 && phrases.length === 0) return null;
  const parts: string[] = [];
  if (words.length) parts.push(`Words: ${words.join(', ')}`);
  if (phrases.length) parts.push(`Phrases:\n${phrases.map((p) => `- ${p}`).join('\n')}`);
  return block(
    'FORBIDDEN LANGUAGE (never output any of these words or phrases, in any form or inflection):',
    parts.join('\n'),
  );
}

function canonBlock(world: World, minimal = false): string | null {
  if (world.memory.canon.length === 0) return null;
  const facts = world.memory.canon
    .slice(0, minimal ? 5 : undefined)
    .map((c) => `- ${c.fact}${c.immutable ? ' (immutable)' : ''}`)
    .join('\n');
  return block('CANON (immutable truth — never contradict):', facts);
}

function openThreadsBlock(world: World): string | null {
  const open = world.memory.openThreads.filter((t) => t.status === 'open');
  if (open.length === 0) return null;
  return block(
    'OPEN THREADS (promises to the reader):',
    open
      .map((t) => `- ${t.description}${t.mustResolveBy ? ` (resolve by ${t.mustResolveBy})` : ''}`)
      .join('\n'),
  );
}

function highImportanceEvents(world: World): string | null {
  const evs = [...world.memory.events]
    .filter((e) => e.importance >= 4)
    .sort((a, b) => b.importance - a.importance)
    .slice(0, 8);
  if (evs.length === 0) return null;
  return block('RECENT KEY EVENTS:', evs.map((e) => `- [${e.type}] ${e.summary}`).join('\n'));
}

function timelineBlock(world: World): string | null {
  if (world.structure.timeline.length === 0) return null;
  return block(
    'TIMELINE:',
    world.structure.timeline
      .map((t) => `- ${t.when}: ${t.event}${t.revealedIn ? ` (revealed in ${t.revealedIn})` : ''}`)
      .join('\n'),
  );
}

function presentCharacterStates(world: World, characterId: string | null): string | null {
  const chars = characterId
    ? world.entities.characters.filter((c) => c.id === characterId)
    : world.entities.characters;
  if (chars.length === 0) return null;
  return block(
    'CHARACTER STATES:',
    chars
      .map(
        (c) =>
          `- ${c.name}: ${c.state.status || 'unknown'}, at ${c.state.location || 'unknown'}${
            c.state.emotionalState ? `, feeling ${c.state.emotionalState}` : ''
          }`,
      )
      .join('\n'),
  );
}

function presentCharacterDefinitions(world: World, characterId: string | null): string | null {
  const chars = characterId
    ? world.entities.characters.filter((c) => c.id === characterId)
    : world.entities.characters;
  if (chars.length === 0) return null;
  return block(
    'CHARACTERS:',
    chars.map((c) => `- ${c.name} (${c.role}). Voice: ${c.definition.voice}`).join('\n'),
  );
}

function premiseBlock(world: World): string | null {
  if (!world.premise.logline && !world.premise.synopsis) return null;
  return block(
    'PREMISE:',
    `${world.premise.logline}${world.premise.synopsis ? `\n${world.premise.synopsis}` : ''}`,
  );
}

function styleNotesBlock(world: World): string | null {
  // Banned words are NOT included here — they are a hard header constraint
  // (linguisticBansBlock), always present and never dropped, not soft style.
  const parts: string[] = [];
  if (world.session.styleNotes) parts.push(`Style: ${world.session.styleNotes}`);
  if (world.session.narratorVoice) parts.push(`Narrator voice: ${world.session.narratorVoice}`);
  return parts.length ? block('STYLE NOTES:', parts.join('\n')) : null;
}

/**
 * The fiction's own laws (setting.rules): statement + implications. This is
 * creative world context, not an AI guardrail, so it's a normal droppable recipe
 * section. `canBreak` rules are labeled as flexible so the model treats the
 * unbreakable ones as firmer.
 */
function worldRulesBlock(world: World): string | null {
  const rules = world.setting.rules.filter((r) => r.statement.trim());
  if (rules.length === 0) return null;
  return block(
    "WORLD RULES (the fiction's own laws — respect them unless a rule is marked flexible):",
    rules
      .map((r) => {
        const imp = r.implications.trim() ? ` Implications: ${r.implications.trim()}` : '';
        const flex = r.canBreak ? ' [flexible — may bend if the story demands]' : ' [firm]';
        return `- ${r.statement.trim()}${imp}${flex}`;
      })
      .join('\n'),
  );
}

/** Build the ordered section list for a recipe key. */
function sectionsForRecipe(
  recipeItems: string[],
  input: AssembleInput,
  world: World,
): Section[] {
  const sections: Section[] = [];
  for (const item of recipeItems) {
    const key = item.split(':')[0]!;
    switch (key) {
      case 'targetTextFull':
        sections.push({ key: item, render: () => block('TARGET TEXT:', input.targetChapterText) });
        break;
      case 'targetOutlineBeats':
        sections.push({ key: item, render: () => block('TARGET OUTLINE / BEATS:', input.targetChapterText) });
        break;
      case 'targetChapterMeta':
        sections.push({
          key: item,
          render: () => {
            const meta = input.targetChapterMetaId
              ? world.structure.chapters.find((c) => c.id === input.targetChapterMetaId)
              : undefined;
            if (!meta) return null;
            const lines = [`Title: ${meta.title}`];
            if (meta.summary?.trim()) lines.push(`Summary: ${meta.summary.trim()}`);
            if (meta.purpose?.trim()) lines.push(`Purpose: ${meta.purpose.trim()}`);
            if (meta.povCharacter?.trim()) lines.push(`POV: ${meta.povCharacter.trim()}`);
            return block('CHAPTER TO WRITE:', lines.join('\n'));
          },
        });
        break;
      case 'recentScenesVerbatim': {
        const n = Number(item.split(':')[1] ?? '2');
        sections.push({
          key: item,
          render: () => {
            const scenes = (input.recentScenes ?? []).slice(-n);
            return scenes.length ? block('RECENT SCENES:', scenes.join('\n\n')) : null;
          },
        });
        break;
      }
      case 'adjacentChapterSummaries':
        sections.push({ key: item, render: () => {
          const sums = world.structure.chapters.filter((c) => c.summary).map((c) => `- ${c.title}: ${c.summary}`);
          return sums.length ? block('ADJACENT CHAPTERS:', sums.join('\n')) : null;
        }});
        break;
      case 'canon':
        sections.push({ key: item, render: () => canonBlock(world, item.includes('minimal')) });
        break;
      case 'canonSummary':
        sections.push({ key: item, render: () => canonBlock(world, true) });
        break;
      case 'openThreads':
        sections.push({ key: item, render: () => openThreadsBlock(world) });
        break;
      case 'recentEvents':
        sections.push({ key: item, render: () => highImportanceEvents(world) });
        break;
      case 'timeline':
        sections.push({ key: item, render: () => timelineBlock(world) });
        break;
      case 'characterStates':
        sections.push({ key: item, render: () => presentCharacterStates(world, input.characterId) });
        break;
      case 'characterDefinitions':
        sections.push({ key: item, render: () => presentCharacterDefinitions(world, input.characterId) });
        break;
      case 'premise':
        sections.push({ key: item, render: () => premiseBlock(world) });
        break;
      case 'styleNotes':
        sections.push({ key: item, render: () => styleNotesBlock(world) });
        break;
      case 'worldRules':
        sections.push({ key: item, render: () => worldRulesBlock(world) });
        break;
      case 'bannedWords':
        // No-op: banned words are now a hard header constraint (linguisticBansBlock),
        // always present and never dropped. Recipes may still list this key (e.g. an
        // older imported world); it renders nothing to avoid duplicating the constraint.
        sections.push({ key: item, render: () => null });
        break;
      default:
        // unknown recipe key — skip silently
        break;
    }
  }
  return sections;
}

/**
 * The character-chat knowledge boundary. The role instruction (speak only as X,
 * reveal nothing outside the knowledge list) is app-authored and stays trusted;
 * the character's voice and knowledge items are world data and are fenced so an
 * imported/edited character cannot smuggle instructions through them.
 */
function characterPreamble(world: World, characterId: string): string | null {
  const ch = world.entities.characters.find((c) => c.id === characterId);
  if (!ch) return null;
  const knows = ch.state.knowledge.length
    ? ch.state.knowledge.map((k) => `- ${k}`).join('\n')
    : '- (only what a person in their situation would naturally know)';
  const voiceBlock = block(`${ch.name}'s VOICE:`, ch.definition.voice);
  const knowsBlock = block(`${ch.name}'s KNOWLEDGE:`, knows);
  return [
    `You ARE ${ch.name}. Speak only as ${ch.name}, in first person, matching the voice described below.`,
    voiceBlock,
    `${ch.name} KNOWS ONLY what the knowledge block lists. Do not reveal or reference anything outside it — if asked about something ${ch.name} would not know, react as ${ch.name} genuinely would (confusion, curiosity, deflection):`,
    knowsBlock,
  ]
    .filter(Boolean)
    .join('\n');
}

export function assembleContext(input: AssembleInput): AssembledContext {
  const world = input.world.world;
  const mode: ChatMode = baseMode(input.mode);
  const budget = input.budgetTokens ?? 6000;

  const header: string[] = [];
  header.push('You are the AI writing partner in Oread Studio.');
  // The whole world below — premise, canon, rules, characters, outline, prose — is
  // the AUTHOR's own material and their instructions to you. Follow it faithfully:
  // honor the premise, obey the world rules and canon, and write what it and the
  // author's messages ask for. It is not untrusted data; it is your brief.
  header.push(
    "Everything below describes the author's world and their intent. Treat it as " +
      'authoritative: follow the premise, canon, world rules, and style, stay true to ' +
      'the characters, and do exactly what the author asks. Do not drift from it or ' +
      'substitute your own story.',
  );
  const titleBlock = block('WORK TITLE:', world.identity.name);
  if (titleBlock) header.push(titleBlock);
  header.push(...contractInstructions(input.mode));

  // PRIORITY constraints — always in the header (every mode), above all recipe
  // content, and never dropped under the token budget. These encode the rules the
  // author declared unbreakable, so they must always reach the model first.
  const absolute = absoluteRulesBlock(world);
  if (absolute) header.push(absolute);
  const bans = linguisticBansBlock(world);
  if (bans) header.push(bans);

  // Character chat: prepend the character identity + knowledge boundary (highest priority).
  if (input.mode === 'character' && input.characterId) {
    const pre = characterPreamble(world, input.characterId);
    if (pre) header.push(pre);
  }

  const recipe = world.session.contextRecipes[mode] ?? [];
  const sections = sectionsForRecipe(recipe, input, world);

  const parts: string[] = [...header];
  const included: string[] = [];
  const dropped: string[] = [];
  let used = estimateTokens(parts.join('\n\n'));

  for (const section of sections) {
    const rendered = section.render();
    if (!rendered) continue;
    const cost = estimateTokens(rendered) + 2;
    if (used + cost > budget) {
      dropped.push(section.key);
      continue;
    }
    parts.push(rendered);
    included.push(section.key);
    used += cost;
  }

  const system = parts.join('\n\n');
  return {
    system,
    includedItems: included,
    droppedItems: dropped,
    estimatedTokens: estimateTokens(system),
  };
}
