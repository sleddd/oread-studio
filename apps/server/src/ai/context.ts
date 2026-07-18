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

function canonBlock(world: World, minimal = false): string | null {
  if (world.memory.canon.length === 0) return null;
  const facts = world.memory.canon
    .slice(0, minimal ? 5 : undefined)
    .map((c) => `- ${c.fact}${c.immutable ? ' (immutable)' : ''}`)
    .join('\n');
  return `CANON (immutable truth — never contradict):\n${facts}`;
}

function openThreadsBlock(world: World): string | null {
  const open = world.memory.openThreads.filter((t) => t.status === 'open');
  if (open.length === 0) return null;
  return `OPEN THREADS (promises to the reader):\n${open
    .map((t) => `- ${t.description}${t.mustResolveBy ? ` (resolve by ${t.mustResolveBy})` : ''}`)
    .join('\n')}`;
}

function highImportanceEvents(world: World): string | null {
  const evs = [...world.memory.events]
    .filter((e) => e.importance >= 4)
    .sort((a, b) => b.importance - a.importance)
    .slice(0, 8);
  if (evs.length === 0) return null;
  return `RECENT KEY EVENTS:\n${evs.map((e) => `- [${e.type}] ${e.summary}`).join('\n')}`;
}

function timelineBlock(world: World): string | null {
  if (world.structure.timeline.length === 0) return null;
  return `TIMELINE:\n${world.structure.timeline
    .map((t) => `- ${t.when}: ${t.event}${t.revealedIn ? ` (revealed in ${t.revealedIn})` : ''}`)
    .join('\n')}`;
}

function presentCharacterStates(world: World, characterId: string | null): string | null {
  const chars = characterId
    ? world.entities.characters.filter((c) => c.id === characterId)
    : world.entities.characters;
  if (chars.length === 0) return null;
  return `CHARACTER STATES:\n${chars
    .map(
      (c) =>
        `- ${c.name}: ${c.state.status || 'unknown'}, at ${c.state.location || 'unknown'}${
          c.state.emotionalState ? `, feeling ${c.state.emotionalState}` : ''
        }`,
    )
    .join('\n')}`;
}

function presentCharacterDefinitions(world: World, characterId: string | null): string | null {
  const chars = characterId
    ? world.entities.characters.filter((c) => c.id === characterId)
    : world.entities.characters;
  if (chars.length === 0) return null;
  return `CHARACTERS:\n${chars
    .map((c) => `- ${c.name} (${c.role}). Voice: ${c.definition.voice}`)
    .join('\n')}`;
}

function premiseBlock(world: World): string | null {
  if (!world.premise.logline && !world.premise.synopsis) return null;
  return `PREMISE:\n${world.premise.logline}${
    world.premise.synopsis ? `\n${world.premise.synopsis}` : ''
  }`;
}

function styleNotesBlock(world: World): string | null {
  const parts: string[] = [];
  if (world.session.styleNotes) parts.push(`Style: ${world.session.styleNotes}`);
  if (world.session.narratorVoice) parts.push(`Narrator voice: ${world.session.narratorVoice}`);
  const banned = world.session.linguisticFilters?.bannedWords ?? [];
  if (banned.length) parts.push(`Avoid these words: ${banned.join(', ')}`);
  return parts.length ? `STYLE NOTES:\n${parts.join('\n')}` : null;
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
        sections.push({ key: item, render: () => (input.targetChapterText ? `TARGET TEXT:\n${input.targetChapterText}` : null) });
        break;
      case 'targetOutlineBeats':
        sections.push({ key: item, render: () => (input.targetChapterText ? `TARGET OUTLINE / BEATS:\n${input.targetChapterText}` : null) });
        break;
      case 'recentScenesVerbatim': {
        const n = Number(item.split(':')[1] ?? '2');
        sections.push({
          key: item,
          render: () => {
            const scenes = (input.recentScenes ?? []).slice(-n);
            return scenes.length ? `RECENT SCENES:\n${scenes.join('\n\n')}` : null;
          },
        });
        break;
      }
      case 'adjacentChapterSummaries':
        sections.push({ key: item, render: () => {
          const sums = world.structure.chapters.filter((c) => c.summary).map((c) => `- ${c.title}: ${c.summary}`);
          return sums.length ? `ADJACENT CHAPTERS:\n${sums.join('\n')}` : null;
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
      case 'bannedWords':
        sections.push({ key: item, render: () => {
          const banned = world.session.linguisticFilters?.bannedWords ?? [];
          return banned.length ? `BANNED WORDS: ${banned.join(', ')}` : null;
        }});
        break;
      default:
        // unknown recipe key — skip silently
        break;
    }
  }
  return sections;
}

/** The character-chat knowledge boundary. */
function characterPreamble(world: World, characterId: string): string | null {
  const ch = world.entities.characters.find((c) => c.id === characterId);
  if (!ch) return null;
  const knows = ch.state.knowledge.length
    ? ch.state.knowledge.map((k) => `- ${k}`).join('\n')
    : '- (only what a person in their situation would naturally know)';
  return [
    `You ARE ${ch.name}. Speak only as ${ch.name}, in first person, using this voice: ${ch.definition.voice}`,
    `${ch.name} KNOWS ONLY the following. Do not reveal or reference anything outside this list — if asked about something ${ch.name} would not know, react as ${ch.name} genuinely would (confusion, curiosity, deflection):`,
    knows,
  ].join('\n');
}

export function assembleContext(input: AssembleInput): AssembledContext {
  const world = input.world.world;
  const mode: ChatMode = baseMode(input.mode);
  const budget = input.budgetTokens ?? 6000;

  const header: string[] = [];
  header.push(`You are the AI writing partner in Oread Studio for the work "${world.identity.name}".`);
  header.push(...contractInstructions(input.mode));

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
