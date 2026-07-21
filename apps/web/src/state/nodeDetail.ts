/**
 * Editable detail view-model. Every field in the world JSON schema is exposed
 * here as an EditableField with a path into the world document. The WorldDetail
 * component renders these and writes changes back via store.editWorldField,
 * which mutates the live world doc (persisted by Save World).
 *
 * Field kinds:
 *  - 'text'  single-line string
 *  - 'long'  multi-line string
 *  - 'list'  string[] edited as a " · " / newline separated field
 *  - 'bool'  checkbox
 *  - 'num'   number
 *  - 'enum'  select from options
 *  - 'ro'    read-only display
 */
import type { WorldDocument } from '@oread/shared';

export type FieldKind =
  | 'text'
  | 'long'
  | 'list'
  | 'bool'
  | 'num'
  | 'enum'
  | 'ro'
  | 'credential' // dropdown of saved credentials (session.model.credentialId)
  | 'model'; // provider model dropdown + custom (session.model.model)

export interface EditableField {
  label: string;
  kind: FieldKind;
  /** dot/bracket path into WorldDocument, e.g. "world.entities.characters[2].definition.voice" */
  path: string;
  value: unknown;
  options?: string[];
  /** for lists: join/split separator */
  sep?: string;
  /**
   * for lists: accept MULTIPLE delimiters on input (newlines, commas, and ·) so a
   * pasted comma/quote-delimited block splits correctly. Items are stored verbatim
   * (quotes/parentheticals kept), displayed one per line. Used for banned words/phrases.
   */
  multiDelim?: boolean;
}
export interface DetailGroup {
  heading: string;
  fields: EditableField[];
  /** if set, an "+ Add …" affordance is offered for this repeating group */
  addKind?: string;
  /** if set, a per-group "Delete" affordance is offered; passed to deleteWorldNode */
  deleteKey?: string;
}
export interface NodeDetail {
  kicker: string;
  title: string;
  subtitle: string;
  hasImage: boolean;
  groups: DetailGroup[];
  /** node key, so the view can offer Delete */
  deletable?: boolean;
}

// ── path get/set over a plain object ──
export function getByPath(root: unknown, path: string): unknown {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let cur: unknown = root;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}
export function setByPath(root: unknown, path: string, value: unknown): void {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let cur = root as Record<string, unknown>;
  for (let i = 0; i < parts.length - 1; i++) {
    cur = cur[parts[i]!] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]!] = value;
}

/**
 * Coerce any value into readable display text. Guards against docs where a
 * field arrived as an object/array (e.g. traits: { core: [...] }) — rendering
 * such a value directly would crash React, and String() would show
 * "[object Object]". Arrays become " · " lists; objects flatten their values.
 */
export function asText(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map(asText).filter(Boolean).join(' · ');
  if (typeof v === 'object') {
    return Object.values(v as Record<string, unknown>)
      .map(asText)
      .filter(Boolean)
      .join(' · ');
  }
  return String(v);
}

const F = (
  label: string,
  path: string,
  value: unknown,
  kind: FieldKind = 'text',
  extra?: Partial<EditableField>,
): EditableField => ({ label, path, value: value ?? (kind === 'list' ? [] : ''), kind, ...extra });

/**
 * Parse a pasted banned-words/phrases block into clean entries.
 *
 * If the text contains quoted items — e.g. `"got it," "ha," "my bad"` — the
 * quotes are treated as the delimiters and each quoted run becomes one entry.
 * This is necessary because commas often sit INSIDE the quotes ("got it,"), so a
 * plain comma split would cut mid-item. Straight and curly quotes are supported.
 *
 * With no quotes, the text is split on newlines, commas, and · . In both cases
 * each entry is trimmed and stripped of surrounding quotes + trailing separators
 * so matching sees the bare word/phrase (e.g. `ha`, not `"ha,"`). A trailing
 * parenthetical like "(in any form)" is left attached to its word (it's a
 * qualifier the author wrote, e.g. "coming (in any form)").
 */
export function parseMultiDelimList(raw: string): string[] {
  const clean = (s: string): string =>
    s
      .trim()
      .replace(/^["“”']+|["“”']+$/g, '') // surrounding quotes
      .replace(/[,;.\s]+$/g, '') // trailing separators/space
      .trim();

  if (/["“”]/.test(raw)) {
    const quoted = [...raw.matchAll(/["“]([^"“”]+)["”]/g)].map((m) => clean(m[1]!)).filter(Boolean);
    if (quoted.length > 0) return quoted;
  }
  return raw
    .split(/[\n,·]/)
    .map(clean)
    .filter(Boolean);
}

/** camelCase object key → human label, e.g. "suggestRewrites" → "Suggest rewrites". */
function humanizeKey(key: string): string {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2') // camelCase boundary
    .replace(/[_-]+/g, ' ') // snake / kebab
    .trim()
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function charIndex(doc: WorldDocument, id: string): number {
  return doc.world.entities.characters.findIndex((c) => c.id === id);
}

export function nodeDetail(doc: WorldDocument | null, key: string | null): NodeDetail | null {
  if (!doc || !key) return null;
  const w = doc.world;

  // ── identity ──
  if (key === 'identity') {
    return {
      kicker: 'Identity',
      title: 'World identity',
      subtitle: 'The top-level record for this world.',
      hasImage: false,
      groups: [
        {
          heading: 'Identity',
          fields: [
            F('Name', 'world.identity.name', w.identity.name),
            F('Version', 'world.identity.version', w.identity.version),
            F('Mode', 'world.identity.mode', w.identity.mode, 'enum', {
              options: ['fiction', 'nonfiction', 'roleplay', 'hybrid'],
            }),
            F('ID', 'world.identity.id', w.identity.id, 'ro'),
            F('Created', 'world.identity.created', w.identity.created, 'ro'),
            F('Last modified', 'world.identity.lastModified', w.identity.lastModified, 'ro'),
          ],
        },
      ],
    };
  }

  // ── premise ──
  if (key === 'premise') {
    return {
      kicker: 'Premise',
      title: 'The essence',
      subtitle: 'One sentence you could tell a stranger, and everything that unpacks from it.',
      hasImage: false,
      groups: [
        {
          heading: 'Logline',
          fields: [F('Logline', 'world.premise.logline', w.premise.logline, 'long')],
        },
        {
          heading: 'Details',
          fields: [
            F('Synopsis', 'world.premise.synopsis', w.premise.synopsis, 'long'),
            F('Themes', 'world.premise.themes', w.premise.themes, 'list'),
            F('Genre', 'world.premise.genre', w.premise.genre, 'list'),
            F('Tone', 'world.premise.tone', w.premise.tone),
            F('Thesis (nonfiction)', 'world.premise.thesis', w.premise.thesis ?? '', 'long'),
          ],
        },
      ],
    };
  }

  // ── setting: lore ──
  if (key === 'lore') {
    return {
      kicker: 'Setting',
      title: 'Lore & backdrop',
      subtitle: 'The world beneath the world.',
      hasImage: false,
      groups: [
        {
          heading: 'Backdrop',
          fields: [
            F('Lore', 'world.setting.lore', w.setting.lore, 'long'),
            F('Time period', 'world.setting.timePeriod', w.setting.timePeriod),
          ],
        },
      ],
    };
  }

  // ── setting: location ──
  if (key.startsWith('loc:')) {
    const i = w.setting.locations.findIndex((l) => l.id === key.slice(4));
    if (i < 0) return null;
    const l = w.setting.locations[i]!;
    return {
      kicker: 'Location',
      title: l.name,
      subtitle: l.id,
      hasImage: false,
      deletable: true,
      groups: [
        {
          heading: 'Location',
          fields: [
            F('Name', `world.setting.locations[${i}].name`, l.name),
            F('Description', `world.setting.locations[${i}].description`, l.description, 'long'),
            F('Significance', `world.setting.locations[${i}].significance`, l.significance, 'long'),
            F('Tags', `world.setting.locations[${i}].tags`, l.tags, 'list'),
          ],
        },
      ],
    };
  }

  // ── setting: rule ──
  if (key.startsWith('rule:')) {
    const i = w.setting.rules.findIndex((r) => r.id === key.slice(5));
    if (i < 0) return null;
    const r = w.setting.rules[i]!;
    return {
      kicker: 'Convention',
      title: r.statement.slice(0, 40) || 'Rule',
      subtitle: r.id,
      hasImage: false,
      deletable: true,
      groups: [
        {
          heading: 'Rule',
          fields: [
            F('Statement', `world.setting.rules[${i}].statement`, r.statement, 'long'),
            F('Implications', `world.setting.rules[${i}].implications`, r.implications, 'long'),
            F('Can break', `world.setting.rules[${i}].canBreak`, r.canBreak, 'bool'),
          ],
        },
      ],
    };
  }

  // ── entities: character ──
  if (key.startsWith('char:')) {
    const i = charIndex(doc, key.slice(5));
    if (i < 0) return null;
    const c = w.entities.characters[i]!;
    const base = `world.entities.characters[${i}]`;
    return {
      kicker: `Character · ${c.role}`,
      title: c.name,
      subtitle: asText(c.definition.traits) || c.role,
      hasImage: true,
      deletable: true,
      groups: [
        {
          heading: 'Basics',
          fields: [
            F('Name', `${base}.name`, c.name),
            F('Role', `${base}.role`, c.role),
            F('Portrait URL', `${base}.image`, c.image ?? ''),
          ],
        },
        {
          heading: 'Definition',
          fields: [
            F('Backstory', `${base}.definition.backstory`, c.definition.backstory, 'long'),
            F('Traits', `${base}.definition.traits`, c.definition.traits, 'long'),
            F('Voice', `${base}.definition.voice`, c.definition.voice, 'long'),
            F('Knowledge & skills', `${base}.definition.knowledgeSkills`, c.definition.knowledgeSkills, 'long'),
            F('Desires', `${base}.definition.desires`, c.definition.desires),
            F('Wounds', `${base}.definition.wounds`, c.definition.wounds),
            F('Contradiction', `${base}.definition.contradiction`, c.definition.contradiction),
          ],
        },
        {
          heading: 'State',
          fields: [
            F('Location', `${base}.state.location`, c.state.location),
            F('Status', `${base}.state.status`, c.state.status),
            F('Emotional state', `${base}.state.emotionalState`, c.state.emotionalState),
            F('Knowledge', `${base}.state.knowledge`, c.state.knowledge, 'list', { sep: '\n' }),
            F('Inventory', `${base}.state.inventory`, c.state.inventory, 'list'),
          ],
        },
        {
          heading: 'Arc',
          fields: [
            F('Starting point', `${base}.arc.startingPoint`, c.arc.startingPoint),
            F('Trajectory', `${base}.arc.trajectory`, c.arc.trajectory),
            F('Endpoint', `${base}.arc.endpoint`, c.arc.endpoint),
          ],
        },
      ],
    };
  }

  // ── entities: relationship ──
  if (key.startsWith('rel:')) {
    const i = w.entities.relationships.findIndex((r) => r.id === key.slice(4));
    if (i < 0) return null;
    const r = w.entities.relationships[i]!;
    const base = `world.entities.relationships[${i}]`;
    const charOpts = w.entities.characters.map((c) => c.id);
    return {
      kicker: 'Relationship',
      title: r.type || 'Relationship',
      subtitle: r.id,
      hasImage: false,
      deletable: true,
      groups: [
        {
          heading: 'Relationship',
          fields: [
            F('Between A', `${base}.between[0]`, r.between[0], 'enum', { options: charOpts }),
            F('Between B', `${base}.between[1]`, r.between[1], 'enum', { options: charOpts }),
            F('Type', `${base}.type`, r.type),
            F('Description', `${base}.description`, r.description, 'long'),
            F('Tension', `${base}.tension`, r.tension, 'long'),
            F('History (event refs)', `${base}.history`, r.history, 'list'),
          ],
        },
      ],
    };
  }

  // ── entities: concept ──
  if (key.startsWith('concept:')) {
    const i = w.entities.concepts.findIndex((c) => c.id === key.slice(8));
    if (i < 0) return null;
    const c = w.entities.concepts[i]!;
    const base = `world.entities.concepts[${i}]`;
    return {
      kicker: 'Concept',
      title: c.name,
      subtitle: c.id,
      hasImage: false,
      deletable: true,
      groups: [
        {
          heading: 'Concept',
          fields: [
            F('Name', `${base}.name`, c.name),
            F('Definition', `${base}.definition`, c.definition, 'long'),
            F('Author position', `${base}.authorPosition`, c.authorPosition, 'long'),
            F('Sources', `${base}.sources`, c.sources, 'list'),
            F('Related concepts', `${base}.relatedConcepts`, c.relatedConcepts, 'list'),
          ],
        },
      ],
    };
  }

  // ── entities: source ──
  if (key.startsWith('source:')) {
    const i = w.entities.sources.findIndex((s) => s.id === key.slice(7));
    if (i < 0) return null;
    const s = w.entities.sources[i]!;
    const base = `world.entities.sources[${i}]`;
    return {
      kicker: 'Source',
      title: s.citation.slice(0, 40) || 'Source',
      subtitle: s.id,
      hasImage: false,
      deletable: true,
      groups: [
        {
          heading: 'Source',
          fields: [
            F('Citation', `${base}.citation`, s.citation, 'long'),
            F('Key claims', `${base}.keyClaims`, s.keyClaims, 'list', { sep: '\n' }),
            F('Notes', `${base}.notes`, s.notes, 'long'),
            F('Reliability', `${base}.reliability`, s.reliability),
          ],
        },
      ],
    };
  }

  // ── structure: chapter meta ──
  if (key.startsWith('ch:')) {
    const i = w.structure.chapters.findIndex((c) => c.id === key.slice(3));
    if (i < 0) return null;
    const c = w.structure.chapters[i]!;
    const base = `world.structure.chapters[${i}]`;
    return {
      kicker: 'Chapter',
      title: c.title,
      subtitle: c.id,
      hasImage: false,
      deletable: true,
      groups: [
        {
          heading: 'Chapter',
          fields: [
            F('Title', `${base}.title`, c.title),
            F('Order', `${base}.order`, c.order, 'num'),
            F('Status', `${base}.status`, c.status, 'enum', {
              options: ['outline', 'drafting', 'revised', 'final'],
            }),
            F('POV character', `${base}.povCharacter`, c.povCharacter),
            F('Purpose', `${base}.purpose`, c.purpose, 'long'),
            F('Summary', `${base}.summary`, c.summary, 'long'),
            F('Scene IDs', `${base}.sceneIds`, c.sceneIds, 'list'),
            F('Word count', `${base}.wordCount`, c.wordCount, 'ro'),
          ],
        },
      ],
    };
  }

  // ── structure: scene ──
  if (key.startsWith('scene:')) {
    const i = w.structure.scenes.findIndex((s) => s.id === key.slice(6));
    if (i < 0) return null;
    const s = w.structure.scenes[i]!;
    const base = `world.structure.scenes[${i}]`;
    return {
      kicker: 'Scene',
      title: s.summary.slice(0, 40) || 'Scene',
      subtitle: s.id,
      hasImage: false,
      deletable: true,
      groups: [
        {
          heading: 'Scene',
          fields: [
            F('Chapter ID', `${base}.chapterId`, s.chapterId),
            F('Location', `${base}.location`, s.location),
            F('Characters present', `${base}.charactersPresent`, s.charactersPresent, 'list'),
            F('Summary', `${base}.summary`, s.summary, 'long'),
            F('Beats', `${base}.beats`, s.beats, 'list', { sep: '\n' }),
            F('Timeline position', `${base}.timelinePosition`, s.timelinePosition),
          ],
        },
      ],
    };
  }

  // ── structure: timeline (list editor) ──
  if (key === 'timeline') {
    return {
      kicker: 'Structure',
      title: 'Timeline',
      subtitle: 'Story-world chronology (may differ from chapter order)',
      hasImage: false,
      groups: [
        {
          heading: 'Events',
          addKind: 'timeline',
          fields: w.structure.timeline.flatMap((t, i) => [
            F(`When · ${t.id}`, `world.structure.timeline[${i}].when`, t.when),
            F('Event', `world.structure.timeline[${i}].event`, t.event, 'long'),
            F('Revealed in', `world.structure.timeline[${i}].revealedIn`, t.revealedIn),
          ]),
        },
      ],
    };
  }

  // ── memory: events ──
  // One group per event so each can be edited AND deleted individually. The first
  // group also carries the "+ Add" affordance for the list as a whole.
  if (key === 'mem') {
    const eventGroups: DetailGroup[] =
      w.memory.events.length === 0
        ? [{ heading: 'Events', addKind: 'event', fields: [] }]
        : w.memory.events.map((e, i) => {
            const base = `world.memory.events[${i}]`;
            return {
              heading: e.summary ? `Event · ${e.summary.slice(0, 40)}` : `Event · ${e.id}`,
              addKind: i === 0 ? 'event' : undefined,
              deleteKey: `event:${e.id}`,
              fields: [
                F('Summary', `${base}.summary`, e.summary),
                F('Type', `${base}.type`, e.type, 'enum', {
                  options: ['plot', 'character-development', 'worldbuilding', 'decision', 'retcon', 'research-finding'],
                }),
                F('Detail', `${base}.detail`, e.detail, 'long'),
                F('Importance (1-5)', `${base}.importance`, e.importance, 'num'),
                F('Entities', `${base}.entities`, e.entities, 'list'),
                F('Chapter context', `${base}.chapterContext`, e.chapterContext),
                F('Supersedes (retcon)', `${base}.supersedes`, e.supersedes ?? ''),
              ],
            };
          });
    return {
      kicker: 'Memory',
      title: 'Event log',
      subtitle: 'What happened in the writing sessions — edit or delete individual events',
      hasImage: false,
      groups: eventGroups,
    };
  }

  // ── memory: canon ──
  // One group per fact so each can be edited AND deleted individually.
  if (key === 'canon') {
    const factGroups: DetailGroup[] =
      w.memory.canon.length === 0
        ? [{ heading: 'Facts', addKind: 'canon', fields: [] }]
        : w.memory.canon.map((c, i) => {
            const base = `world.memory.canon[${i}]`;
            return {
              heading: c.fact ? `Fact · ${c.fact.slice(0, 40)}` : `Fact · ${c.id}`,
              addKind: i === 0 ? 'canon' : undefined,
              deleteKey: `canon:${c.id}`,
              fields: [
                F('Fact', `${base}.fact`, c.fact, 'long'),
                F('Established by', `${base}.establishedBy`, c.establishedBy, 'list'),
                F('Immutable', `${base}.immutable`, c.immutable, 'bool'),
              ],
            };
          });
    return {
      kicker: 'Memory',
      title: 'Canon facts',
      subtitle: 'The compressed, immutable truth — edit or delete individual facts',
      hasImage: false,
      groups: factGroups,
    };
  }

  // ── memory: threads ──
  if (key === 'threads') {
    const threadGroups: DetailGroup[] =
      w.memory.openThreads.length === 0
        ? [{ heading: 'Threads', addKind: 'thread', fields: [] }]
        : w.memory.openThreads.map((t, i) => {
            const base = `world.memory.openThreads[${i}]`;
            return {
              heading: t.description ? `Thread · ${t.description.slice(0, 40)}` : `Thread · ${t.id}`,
              addKind: i === 0 ? 'thread' : undefined,
              deleteKey: `thread:${t.id}`,
              fields: [
                F('Description', `${base}.description`, t.description, 'long'),
                F('Planted in', `${base}.plantedIn`, t.plantedIn),
                F('Must resolve by', `${base}.mustResolveBy`, t.mustResolveBy),
                F('Status', `${base}.status`, t.status, 'enum', {
                  options: ['open', 'resolved', 'abandoned'],
                }),
                F('Resolved in', `${base}.resolvedIn`, t.resolvedIn ?? ''),
              ],
            };
          });
    return {
      kicker: 'Memory',
      title: 'Open threads',
      subtitle: 'Promises made to the reader — edit or delete individual threads',
      hasImage: false,
      groups: threadGroups,
    };
  }

  // ── memory: decisions ──
  if (key === 'decisions') {
    const decisionGroups: DetailGroup[] =
      w.memory.decisions.length === 0
        ? [{ heading: 'Log', addKind: 'decision', fields: [] }]
        : w.memory.decisions.map((d, i) => {
            const base = `world.memory.decisions[${i}]`;
            return {
              heading: d.decision ? `Decision · ${d.decision.slice(0, 40)}` : `Decision · ${d.id}`,
              addKind: i === 0 ? 'decision' : undefined,
              deleteKey: `decision:${d.id}`,
              fields: [
                F('Decision', `${base}.decision`, d.decision, 'long'),
                F('Reasoning', `${base}.reasoning`, d.reasoning, 'long'),
                F('Date', `${base}.date`, d.date),
              ],
            };
          });
    return {
      kicker: 'Memory',
      title: 'Decisions',
      subtitle: 'Authorial choices, with reasoning — edit or delete individual decisions',
      hasImage: false,
      groups: decisionGroups,
    };
  }

  // ── session ──
  if (key === 'session') {
    const sess = w.session;
    // One model/credential for the whole world — shared by every mode.
    const model = sess.model ?? { credentialId: null, provider: null, model: null, temperature: 0.85 };
    const modelGroup: DetailGroup = {
      heading: 'Model & sampling — shared by every mode',
      fields: [
        // Credential dropdown → also sets provider; Model dropdown depends on provider.
        F('Credential', 'world.session.model.credentialId', model.credentialId ?? '', 'credential'),
        F('Provider', 'world.session.model.provider', model.provider ?? '', 'ro'),
        F('Model', 'world.session.model.model', model.model ?? '', 'model'),
        F('Temperature', 'world.session.model.temperature', model.temperature ?? 0.85, 'num'),
      ],
    };

    // Voice, rules & filters — one shared set applied across all modes.
    const voiceGroup: DetailGroup = {
      heading: 'Voice, rules & filters — shared by every mode',
      fields: [
        F('Default mode', 'world.session.defaultMode', sess.defaultMode, 'enum', {
          options: ['cowrite', 'draft', 'edit', 'critique', 'discuss'],
        }),
        F('Narrator voice', 'world.session.narratorVoice', sess.narratorVoice),
        F('AI rules — never broken (one per line)', 'world.session.hardRules', sess.hardRules, 'list', { sep: '\n' }),
        F('Style notes', 'world.session.styleNotes', sess.styleNotes, 'long'),
        F('Banned words (comma, newline, or · — quotes kept)', 'world.session.linguisticFilters.bannedWords', sess.linguisticFilters.bannedWords, 'list', { multiDelim: true }),
        F('Banned phrases (comma, newline, or · — quotes kept)', 'world.session.linguisticFilters.bannedPhrases', sess.linguisticFilters.bannedPhrases, 'list', { multiDelim: true }),
      ],
    };

    // Per-mode BEHAVIORAL knobs. Each mode has its own distinct fields, so each
    // gets its own headed group — the heading/divider is what visually separates
    // one mode from the next. These follow the two shared groups above.
    const modeGroups: DetailGroup[] = (Object.keys(sess.modeConfigs) as (keyof typeof sess.modeConfigs)[]).map((m) => {
      const cfg = sess.modeConfigs[m] as unknown as Record<string, unknown>;
      const base = `world.session.modeConfigs.${m}`;
      const fields: EditableField[] = [];
      for (const [k, v] of Object.entries(cfg)) {
        const kind: FieldKind = typeof v === 'boolean' ? 'bool' : typeof v === 'number' ? 'num' : Array.isArray(v) ? 'list' : 'text';
        fields.push(F(humanizeKey(k), `${base}.${k}`, v, kind));
      }
      return { heading: `${m} mode — behavior`, fields };
    });

    return {
      kicker: 'Session',
      title: 'Session & model',
      subtitle: 'Shared model, voice & rules — plus each mode’s own behavior',
      hasImage: false,
      groups: [modelGroup, voiceGroup, ...modeGroups],
    };
  }

  return null;
}
