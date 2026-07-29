/**
 * Context assembly engine. Reads the mode's contextRecipe (priority-ordered),
 * pulls the referenced material from the world document and chapter prose, and
 * packs it into a system prompt within a token budget using most-important-first
 * truncation: items earlier in the recipe are included first; when the budget is
 * exhausted, later items are dropped.
 *
 * Character chat gives the model the full character (definition, state, arc),
 * who the author is speaking as, and the world around them — then restricts what
 * the character may KNOW to state.knowledge.
 */
import type {
  World,
  WorldDocument,
  PersistedChatMode,
  ChatMode,
} from '@oread/shared';
import { characterLocations } from '@oread/shared';
import { contractInstructions, baseMode } from './permissions.js';

/** Rough token estimate: ~4 chars/token. Good enough for budgeting. */
export function estimateTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

export interface AssembleInput {
  world: WorldDocument;
  mode: PersistedChatMode;
  characterId: string | null;
  /**
   * Who the AUTHOR is speaking as in character chat: a character id to play
   * someone in the cast, or null/'author' to speak as themselves (the default).
   */
  userAs?: string | null;
  /** target chapter prose (for edit/critique/draft/cowrite recent scenes) */
  targetChapterText?: string;
  /** the prose row's chapter_id → world.structure.chapters[].id, for outline meta */
  targetChapterMetaId?: string;
  /** recent scenes verbatim, most recent last */
  recentScenes?: string[];
  /** the chapters immediately before the target, as real prose (oldest first) */
  precedingChapters?: { title: string; text: string }[];
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

/**
 * Legacy. The event log is no longer authored in the UI (it existed to hold
 * chat-distillation output, and distillation was removed), so this is absent from
 * the default recipes — but a world saved earlier may still hold events and name
 * the item in its saved recipe, and those keep rendering.
 */
function highImportanceEvents(world: World): string | null {
  const evs = [...(world.memory.events ?? [])]
    .filter((e) => e.importance >= 4)
    .sort((a, b) => b.importance - a.importance)
    .slice(0, 8);
  if (evs.length === 0) return null;
  return block('RECENT KEY EVENTS:', evs.map((e) => `- [${e.type}] ${e.summary}`).join('\n'));
}

/**
 * Legacy. The timeline was removed from the structure model and is no longer a
 * default recipe item, but a world document saved before that change may still
 * carry one — and a saved session recipe may still name 'timeline'. Both keep
 * working rather than throwing.
 */
function timelineBlock(world: World): string | null {
  const timeline = world.structure.timeline ?? [];
  if (timeline.length === 0) return null;
  return block(
    'TIMELINE:',
    timeline
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
      .map((c) => {
        // A character may be in several places at once (a ship and its cabin).
        const where = characterLocations(c.state).join(' / ') || 'unknown';
        return `- ${c.name}: ${c.state.status || 'unknown'}, at ${where}${
          c.state.emotionalState ? `, feeling ${c.state.emotionalState}` : ''
        }`;
      })
      .join('\n'),
  );
}

/**
 * The cast, as the model needs them to WRITE them: not just a voice line but
 * what drives each person and how they speak. A name and a role is not enough to
 * keep a character consistent across a chapter.
 */
function presentCharacterDefinitions(world: World, characterId: string | null): string | null {
  const chars = characterId
    ? world.entities.characters.filter((c) => c.id === characterId)
    : world.entities.characters;
  if (chars.length === 0) return null;
  return block(
    'CHARACTERS:',
    chars
      .map((c) => {
        const d = c.definition;
        const bits: string[] = [];
        if (d.voice?.trim()) bits.push(`Voice: ${d.voice.trim()}`);
        if (d.traits?.trim()) bits.push(`Traits: ${d.traits.trim()}`);
        if (d.desires?.trim()) bits.push(`Wants: ${d.desires.trim()}`);
        if (d.wounds?.trim()) bits.push(`Wound: ${d.wounds.trim()}`);
        if (d.contradiction?.trim()) bits.push(`Contradiction: ${d.contradiction.trim()}`);
        const where = characterLocations(c.state).join(' / ');
        const now = [
          where ? `at ${where}` : '',
          c.state.status?.trim(),
          c.state.emotionalState?.trim() ? `feeling ${c.state.emotionalState.trim()}` : '',
        ]
          .filter(Boolean)
          .join(', ');
        if (now) bits.push(`Currently: ${now}`);
        const detail = bits.length ? `\n  ${bits.join('\n  ')}` : '';
        return `- ${c.name} (${c.role})${detail}`;
      })
      .join('\n'),
  );
}

/**
 * The chapters immediately before the target, as REAL PROSE.
 *
 * Chapter summaries are author metadata — often stale, often empty — so a model
 * drafting from summaries alone contradicts the text it is supposed to be
 * continuing. This gives it the actual writing: the voice to match, the state
 * the characters were left in, and the sentence it is picking up from.
 *
 * Long chapters are trimmed from the FRONT, keeping each chapter's ending, since
 * what immediately precedes the new chapter matters most for continuity. The
 * nearest chapter gets the largest share.
 */
function precedingChaptersBlock(
  chapters: { title: string; text: string }[] | undefined,
  charBudget: number,
): string | null {
  const list = (chapters ?? []).filter((c) => c.text.trim());
  if (list.length === 0) return null;

  // Weight toward the most recent chapter: it gets half, the rest share the rest.
  const parts: string[] = [];
  let remaining = charBudget;
  for (let i = list.length - 1; i >= 0; i--) {
    const c = list[i]!;
    const share = i === list.length - 1 ? Math.floor(remaining / 2) : Math.floor(remaining / (i + 1));
    const allowance = Math.max(share, 400);
    const body = c.text.trim();
    const kept =
      body.length <= allowance
        ? body
        : `…[earlier part of this chapter omitted]…\n${body.slice(-allowance)}`;
    parts.unshift(`— ${c.title} —\n${kept}`);
    remaining = Math.max(0, remaining - kept.length);
  }

  return block(
    'THE CHAPTERS IMMEDIATELY BEFORE THIS ONE (the real text — continue from it, ' +
      'match its voice, and do not contradict what happens here):',
    parts.join('\n\n'),
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
      case 'precedingChapters': {
        // `precedingChapters:N` caps the prose at roughly N thousand characters.
        const kchars = Number(item.split(':')[1] ?? '');
        const charBudget = Number.isFinite(kchars) && kchars > 0 ? kchars * 1000 : 12000;
        sections.push({
          key: item,
          render: () => precedingChaptersBlock(input.precedingChapters, charBudget),
        });
        break;
      }
      case 'adjacentChapterSummaries':
        sections.push({ key: item, render: () => {
          // ADJACENT means around the target — the ones just before and just
          // after — not the whole book. Dumping every chapter's summary buried
          // the relevant ones and wasted budget on chapters far from the target.
          const all = [...world.structure.chapters].sort((a, b) => a.order - b.order);
          const i = input.targetChapterMetaId
            ? all.findIndex((c) => c.id === input.targetChapterMetaId)
            : -1;
          const near = i >= 0 ? all.slice(Math.max(0, i - 2), i + 2) : all;
          const sums = near
            .filter((c) => c.summary && c.id !== input.targetChapterMetaId)
            .map((c) => `- ${c.title}: ${c.summary}`);
          return sums.length ? block('NEARBY CHAPTERS (summaries):', sums.join('\n')) : null;
        }});
        break;
      case 'worldSetting':
        // The physical world the prose has to be set in: its backdrop, its
        // period, and the places that actually exist in it. Without this the
        // model invents geography that contradicts the author's.
        sections.push({
          key: item,
          render: () => {
            const parts: string[] = [];
            if (world.setting.lore?.trim()) parts.push(world.setting.lore.trim());
            if (world.setting.timePeriod?.trim()) {
              parts.push(`Time period: ${world.setting.timePeriod.trim()}`);
            }
            const locs = world.setting.locations.filter((l) => l.name.trim());
            if (locs.length) {
              parts.push(
                'Places:\n' +
                  locs
                    .map((l) => {
                      const d = l.description?.trim() ? ` — ${l.description.trim()}` : '';
                      const s = l.significance?.trim() ? ` (${l.significance.trim()})` : '';
                      return `- ${l.name}${d}${s}`;
                    })
                    .join('\n'),
              );
            }
            return parts.length ? block('THE WORLD:', parts.join('\n\n')) : null;
          },
        });
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
 * Who the AI is playing, in full.
 *
 * A character is not a voice line: playing them convincingly needs the whole
 * definition — what shaped them, what they want, what they're afraid of, the
 * contradiction at their centre — plus where they are in their arc and how they
 * feel right now. Previously only `voice` reached the model, so it improvised a
 * stranger who happened to talk like the character.
 *
 * This is the author's own material and their brief to the model, so it is
 * presented as authoritative (see the header note) rather than fenced as
 * untrusted data.
 */
function characterPreamble(world: World, characterId: string): string | null {
  const ch = world.entities.characters.find((c) => c.id === characterId);
  if (!ch) return null;

  const d = ch.definition;
  const facets: string[] = [];
  const add = (label: string, v: string | undefined) => {
    if (v?.trim()) facets.push(`${label}: ${v.trim()}`);
  };
  add('Role', ch.role);
  add('Traits', d.traits);
  add('Backstory', d.backstory);
  add('Desires', d.desires);
  add('Wounds', d.wounds);
  add('Contradiction', d.contradiction);
  add('Knowledge & skills', d.knowledgeSkills);

  // Where they are in the story, and how they are right now.
  const nowBits: string[] = [];
  const where = characterLocations(ch.state).join(' / ');
  if (where) nowBits.push(`At: ${where}`);
  if (ch.state.status?.trim()) nowBits.push(`Status: ${ch.state.status.trim()}`);
  if (ch.state.emotionalState?.trim()) nowBits.push(`Feeling: ${ch.state.emotionalState.trim()}`);
  if (ch.state.inventory?.length) nowBits.push(`Carrying: ${ch.state.inventory.join(', ')}`);

  const arcBits: string[] = [];
  if (ch.arc?.startingPoint?.trim()) arcBits.push(`Started as: ${ch.arc.startingPoint.trim()}`);
  if (ch.arc?.trajectory?.trim()) arcBits.push(`Becoming: ${ch.arc.trajectory.trim()}`);
  if (ch.arc?.endpoint?.trim()) arcBits.push(`Ends as: ${ch.arc.endpoint.trim()}`);

  const knows = ch.state.knowledge.length
    ? ch.state.knowledge.map((k) => `- ${k}`).join('\n')
    : '- (only what a person in their situation would naturally know)';

  return [
    `You ARE ${ch.name}. Speak only as ${ch.name}, in first person, as a real person would — ` +
      'not as an assistant describing them. Never break character, never mention being an AI, ' +
      'and never narrate on the author\'s behalf.',
    block(`${ch.name} — WHO THEY ARE:`, facets.join('\n')),
    block(`${ch.name}'s VOICE (speak like this):`, d.voice),
    block(`${ch.name} RIGHT NOW:`, nowBits.join('\n')),
    block(`${ch.name}'s ARC (where they are headed — do not skip ahead of it):`, arcBits.join('\n')),
    `${ch.name} KNOWS ONLY what the knowledge block lists, plus what the world context below ` +
      `establishes that they would plausibly know. Do not reveal anything outside it — if asked ` +
      `about something ${ch.name} would not know, react as ${ch.name} genuinely would ` +
      `(confusion, curiosity, deflection):`,
    block(`${ch.name}'s KNOWLEDGE:`, knows),
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * The rest of the cast, as the played character would know them — names, roles
 * and relationships, but NOT their private interiority. A character should know
 * who the others are without having read their wounds and secrets.
 */
function otherCastBlock(world: World, characterId: string): string | null {
  const others = world.entities.characters.filter((c) => c.id !== characterId);
  if (others.length === 0) return null;

  const byId = new Map(world.entities.characters.map((c) => [c.id, c.name]));
  const lines = others.map((c) => {
    const rels = world.entities.relationships
      .filter((r) => r.between.includes(c.id) && r.between.includes(characterId))
      .map((r) => r.type)
      .filter(Boolean);
    const rel = rels.length ? ` — your ${rels.join(', ')}` : '';
    const traits = c.definition.traits?.trim() ? ` (${c.definition.traits.trim()})` : '';
    return `- ${c.name}, ${c.role}${traits}${rel}`;
  });

  // Relationships between OTHER people that this character would plausibly see.
  const between = world.entities.relationships
    .filter((r) => !r.between.includes(characterId))
    .map((r) => {
      const [a, b] = r.between;
      const an = byId.get(a ?? '');
      const bn = byId.get(b ?? '');
      return an && bn && r.type ? `- ${an} and ${bn}: ${r.type}` : null;
    })
    .filter(Boolean) as string[];

  return block(
    'PEOPLE IN YOUR WORLD:',
    [...lines, ...(between.length ? ['', 'Among them:', ...between] : [])].join('\n'),
  );
}

/**
 * Who the AUTHOR is speaking as.
 *
 * Without this the model reads every incoming turn as the author talking to the
 * character out of world. Naming the author's persona is what makes a two-hander
 * possible: "these messages are Henry speaking to you, in scene."
 *
 * `userAs` is a character id, or null/'author' for the author as themselves.
 */
function speakingAsBlock(world: World, aiCharacterId: string, userAs: string | null): string | null {
  if (!userAs || userAs === 'author') {
    return (
      'The person writing to you is THE AUTHOR of this world, speaking as themselves — ' +
      'not a character in the story. Answer them in character, but understand that they ' +
      'stand outside the fiction.'
    );
  }
  if (userAs === aiCharacterId) return null; // nonsensical; ignore rather than confuse the model

  const them = world.entities.characters.find((c) => c.id === userAs);
  if (!them) return null;

  const rel = world.entities.relationships
    .filter((r) => r.between.includes(userAs) && r.between.includes(aiCharacterId))
    .map((r) => [r.type, r.description?.trim(), r.tension?.trim()].filter(Boolean).join(' — '))
    .filter(Boolean);

  return [
    `The person writing to you is playing ${them.name}. Every message from them is ` +
      `${them.name} speaking to you, in scene. Respond as your character responds to ` +
      `${them.name} — with the history and feeling between you, not as if meeting a stranger.`,
    block(
      `${them.name} (who you are speaking WITH):`,
      [
        them.role ? `Role: ${them.role}` : '',
        them.definition.traits?.trim() ? `Traits: ${them.definition.traits.trim()}` : '',
        them.definition.voice?.trim() ? `How they speak: ${them.definition.voice.trim()}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    ),
    rel.length ? block(`BETWEEN YOU AND ${them.name.toUpperCase()}:`, rel.join('\n')) : null,
  ]
    .filter(Boolean)
    .join('\n');
}

/** Places the character could reasonably know, so they can speak about them. */
function placesBlock(world: World): string | null {
  const locs = world.setting.locations.filter((l) => l.name.trim());
  if (locs.length === 0) return null;
  return block(
    'PLACES IN YOUR WORLD:',
    locs
      .map((l) => {
        const desc = l.description?.trim() ? ` — ${l.description.trim()}` : '';
        return `- ${l.name}${desc}`;
      })
      .join('\n'),
  );
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

  // Character chat: who the model IS, who the author is speaking AS, and the
  // world both of them live in. All of it sits in the priority header — a
  // character played without their world is a stranger who happens to have the
  // right voice.
  if (input.mode === 'character' && input.characterId) {
    const pre = characterPreamble(world, input.characterId);
    if (pre) header.push(pre);

    const speaking = speakingAsBlock(world, input.characterId, input.userAs ?? null);
    if (speaking) header.push(speaking);

    const cast = otherCastBlock(world, input.characterId);
    if (cast) header.push(cast);
    const places = placesBlock(world);
    if (places) header.push(places);

    // The lived-in texture of the world. These are in the header rather than the
    // recipe because `character` shares the `discuss` recipe (ContextRecipes is
    // keyed by ChatMode, which has no `character` member), and a character needs
    // this more than a discussion does.
    const lore = block('THE WORLD YOU LIVE IN:', world.setting.lore);
    if (lore) header.push(lore);
    if (world.setting.timePeriod?.trim()) {
      header.push(`WHEN THIS IS SET: ${world.setting.timePeriod.trim()}`);
    }
    const rules = worldRulesBlock(world);
    if (rules) header.push(rules);
    // How the author's prose sounds — a character's dialogue should sit inside it.
    const style = styleNotesBlock(world);
    if (style) header.push(style);
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
