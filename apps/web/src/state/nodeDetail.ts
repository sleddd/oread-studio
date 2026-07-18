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
}
export interface DetailGroup {
  heading: string;
  fields: EditableField[];
  /** if set, an "+ Add …" affordance is offered for this repeating group */
  addKind?: string;
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
  if (key === 'mem') {
    return {
      kicker: 'Memory',
      title: 'Event log',
      subtitle: 'Append-only record of what happened in the writing sessions',
      hasImage: false,
      groups: [
        {
          heading: 'Events',
          addKind: 'event',
          fields: w.memory.events.flatMap((e, i) => {
            const base = `world.memory.events[${i}]`;
            return [
              F(`Summary · ${e.id}`, `${base}.summary`, e.summary),
              F('Type', `${base}.type`, e.type, 'enum', {
                options: ['plot', 'character-development', 'worldbuilding', 'decision', 'retcon', 'research-finding'],
              }),
              F('Detail', `${base}.detail`, e.detail, 'long'),
              F('Importance (1-5)', `${base}.importance`, e.importance, 'num'),
              F('Entities', `${base}.entities`, e.entities, 'list'),
              F('Chapter context', `${base}.chapterContext`, e.chapterContext),
              F('Supersedes (retcon)', `${base}.supersedes`, e.supersedes ?? ''),
            ];
          }),
        },
      ],
    };
  }

  // ── memory: canon ──
  if (key === 'canon') {
    return {
      kicker: 'Memory',
      title: 'Canon facts',
      subtitle: 'The compressed, immutable truth',
      hasImage: false,
      groups: [
        {
          heading: 'Facts',
          addKind: 'canon',
          fields: w.memory.canon.flatMap((c, i) => [
            F(`Fact · ${c.id}`, `world.memory.canon[${i}].fact`, c.fact, 'long'),
            F('Established by', `world.memory.canon[${i}].establishedBy`, c.establishedBy, 'list'),
            F('Immutable', `world.memory.canon[${i}].immutable`, c.immutable, 'bool'),
          ]),
        },
      ],
    };
  }

  // ── memory: threads ──
  if (key === 'threads') {
    return {
      kicker: 'Memory',
      title: 'Open threads',
      subtitle: 'Promises made to the reader',
      hasImage: false,
      groups: [
        {
          heading: 'Threads',
          addKind: 'thread',
          fields: w.memory.openThreads.flatMap((t, i) => {
            const base = `world.memory.openThreads[${i}]`;
            return [
              F(`Description · ${t.id}`, `${base}.description`, t.description, 'long'),
              F('Planted in', `${base}.plantedIn`, t.plantedIn),
              F('Must resolve by', `${base}.mustResolveBy`, t.mustResolveBy),
              F('Status', `${base}.status`, t.status, 'enum', {
                options: ['open', 'resolved', 'abandoned'],
              }),
              F('Resolved in', `${base}.resolvedIn`, t.resolvedIn ?? ''),
            ];
          }),
        },
      ],
    };
  }

  // ── memory: decisions ──
  if (key === 'decisions') {
    return {
      kicker: 'Memory',
      title: 'Decisions',
      subtitle: 'Authorial choices, with reasoning',
      hasImage: false,
      groups: [
        {
          heading: 'Log',
          addKind: 'decision',
          fields: w.memory.decisions.flatMap((d, i) => {
            const base = `world.memory.decisions[${i}]`;
            return [
              F(`Decision · ${d.id}`, `${base}.decision`, d.decision, 'long'),
              F('Reasoning', `${base}.reasoning`, d.reasoning, 'long'),
              F('Date', `${base}.date`, d.date),
            ];
          }),
        },
      ],
    };
  }

  // ── session ──
  if (key === 'session') {
    const sess = w.session;
    // One model/credential for the whole world.
    const model = sess.model ?? { credentialId: null, provider: null, model: null, temperature: 0.85 };
    const modelGroup: DetailGroup = {
      heading: 'Model (used by every mode)',
      fields: [
        // Credential dropdown → also sets provider; Model dropdown depends on provider.
        F('Credential', 'world.session.model.credentialId', model.credentialId ?? '', 'credential'),
        F('Provider', 'world.session.model.provider', model.provider ?? '', 'ro'),
        F('Model', 'world.session.model.model', model.model ?? '', 'model'),
        F('Temperature', 'world.session.model.temperature', model.temperature ?? 0.85, 'num'),
      ],
    };
    // Behavioral-only mode groups.
    const modeGroups = (Object.keys(sess.modeConfigs) as (keyof typeof sess.modeConfigs)[]).map((m) => {
      const cfg = sess.modeConfigs[m] as unknown as Record<string, unknown>;
      const base = `world.session.modeConfigs.${m}`;
      const fields: EditableField[] = [];
      for (const [k, v] of Object.entries(cfg)) {
        const kind: FieldKind = typeof v === 'boolean' ? 'bool' : typeof v === 'number' ? 'num' : Array.isArray(v) ? 'list' : 'text';
        fields.push(F(k, `${base}.${k}`, v, kind));
      }
      return { heading: `Mode · ${m}`, fields };
    });
    return {
      kicker: 'Session',
      title: 'Session & model',
      subtitle: 'How the studio behaves right now',
      hasImage: false,
      groups: [
        modelGroup,
        {
          heading: 'Voice & rules',
          fields: [
            F('Default mode', 'world.session.defaultMode', sess.defaultMode, 'enum', {
              options: ['cowrite', 'draft', 'edit', 'critique', 'discuss'],
            }),
            F('Narrator voice', 'world.session.narratorVoice', sess.narratorVoice),
            F('Hard rules', 'world.session.hardRules', sess.hardRules, 'list', { sep: '\n' }),
            F('Style notes', 'world.session.styleNotes', sess.styleNotes, 'long'),
            F('Banned words', 'world.session.linguisticFilters.bannedWords', sess.linguisticFilters.bannedWords, 'list'),
            F('Banned phrases', 'world.session.linguisticFilters.bannedPhrases', sess.linguisticFilters.bannedPhrases, 'list', { sep: '\n' }),
          ],
        },
        ...modeGroups,
      ],
    };
  }

  return null;
}
