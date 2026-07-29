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
 *  - 'boolInv' checkbox whose LABEL states the negative of the stored flag —
 *              shows !value and writes !checked (see canon "Can be changed…")
 *  - 'num'   number
 *  - 'enum'  select from options
 *  - 'ro'    read-only display
 *  - 'date'  read-only ISO timestamp shown in human-readable local form
 *  - 'multi' string[] chosen from `options`, with an "add a new one" escape hatch
 *  - 'pick'  single choice from `choices`, which carry a display label separate
 *            from the stored value (so ids are stored but names are shown)
 *  - 'longlist' string[] edited as one free textarea, one entry per line
 *  - 'proselist' string[] edited as FREE PROSE — you write paragraphs, not
 *            entries; blank lines separate them. For fields that are stored as a
 *            list for legacy reasons but read as writing (relationship history)
 */
import type { WorldDocument } from '@oread/shared';
import { characterLocations } from '@oread/shared';

export type FieldKind =
  | 'text'
  | 'long'
  | 'list'
  | 'bool'
  | 'boolInv'
  | 'multi'
  | 'pick'
  | 'longlist'
  | 'proselist'
  | 'num'
  | 'enum'
  | 'ro'
  | 'date'
  | 'credential' // dropdown of saved credentials (session.model.credentialId)
  | 'model'; // provider model dropdown + custom (session.model.model)

export interface EditableField {
  label: string;
  kind: FieldKind;
  /** dot/bracket path into WorldDocument, e.g. "world.entities.characters[2].definition.voice" */
  path: string;
  value: unknown;
  options?: string[];
  /** for 'pick': the stored value and the label shown for it, kept separate */
  choices?: { value: string; label: string }[];
  /** for 'multi'/'pick': what is being chosen ("character", "concept", "source") */
  noun?: string;
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
): EditableField => ({
  label,
  path,
  value:
    value ??
    (kind === 'list' || kind === 'multi' || kind === 'longlist' || kind === 'proselist' ? [] : ''),
  kind,
  ...extra,
});

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
            // identity.id is deliberately not shown — it's an internal handle the
            // author never needs, and it's read-only anyway. Still stored/persisted.
            F('Created', 'world.identity.created', w.identity.created, 'date'),
            F('Last modified', 'world.identity.lastModified', w.identity.lastModified, 'date'),
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
      subtitle: l.description.slice(0, 80),
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
      subtitle: r.canBreak ? 'Flexible — may bend if the story demands' : 'Firm',
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
            // Pick from the world's defined locations by NAME, with an add-new
            // escape hatch. Normalized through characterLocations() so a doc that
            // still stores a single string edits as a one-item list.
            F('Location', `${base}.state.location`, characterLocations(c.state), 'multi', {
              noun: 'location',
              options: w.setting.locations.map((l) => l.name).filter(Boolean),
            }),
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
    // A relationship is a pair, so each side is a single choice. The dropdown
    // shows character NAMES while still storing ids, so the panel never surfaces
    // raw handles like `char_abc123`.
    const charOpts = w.entities.characters.map((c) => ({ value: c.id, label: c.name || c.id }));
    return {
      kicker: 'Relationship',
      title: r.type || 'Relationship',
      // Who this is actually between, by name — far more use than the raw id.
      subtitle: r.between
        .map((id) => w.entities.characters.find((c) => c.id === id)?.name)
        .filter(Boolean)
        .join(' & '),
      hasImage: false,
      deletable: true,
      groups: [
        {
          heading: 'Relationship',
          fields: [
            F('Between A', `${base}.between[0]`, r.between[0], 'pick', {
              noun: 'character',
              choices: charOpts,
            }),
            F('Between B', `${base}.between[1]`, r.between[1], 'pick', {
              noun: 'character',
              choices: charOpts,
            }),
            F('Type', `${base}.type`, r.type),
            F('Description', `${base}.description`, r.description, 'long'),
            F('Tension', `${base}.tension`, r.tension, 'long'),
            // Free-write prose, not a line-per-entry list.
            F('History', `${base}.history`, r.history, 'proselist'),
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
      // Internal ids are never surfaced — the author has no use for them.
      subtitle: c.definition.slice(0, 80),
      hasImage: false,
      deletable: true,
      groups: [
        {
          heading: 'Concept',
          fields: [
            F('Name', `${base}.name`, c.name),
            F('Definition', `${base}.definition`, c.definition, 'long'),
            F('Author position', `${base}.authorPosition`, c.authorPosition, 'long'),
            // Pick from what the world already defines, or add a new entry inline.
            F('Sources', `${base}.sources`, c.sources, 'multi', {
              noun: 'source',
              options: w.entities.sources.map((s) => s.citation).filter(Boolean),
            }),
            F('Related concepts', `${base}.relatedConcepts`, c.relatedConcepts, 'multi', {
              noun: 'concept',
              // Other CONCEPTS — never characters — and a concept is not its own relation.
              options: w.entities.concepts
                .filter((o) => o.id !== c.id)
                .map((o) => o.name)
                .filter(Boolean),
            }),
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
      subtitle: s.reliability,
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
      subtitle: c.summary.slice(0, 80),
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
            F('Word count', `${base}.wordCount`, c.wordCount, 'ro'),
          ],
        },
      ],
    };
  }

  // Scene and timeline nodes are legacy: a world doc may still hold `structure.scenes`
  // / `structure.timeline`, but there is no tree entry and no detail view for them —
  // the data is carried through untouched.

  // The event log is legacy: it held chat-distillation output, and distillation
  // was removed. `world.memory.events` is preserved on read/write for worlds that
  // still carry entries (AI recipes may still summarize them), but there is no
  // tree node and no detail view, so nothing routes here.

  // ── memory: canon ──
  // One group per fact so each can be edited AND deleted individually.
  if (key === 'canon') {
    // "Established by" picks from the cast by NAME (the stored value stays a plain
    // string[], so names typed before this was a picker still show and survive).
    const castNames = w.entities.characters.map((c) => c.name).filter(Boolean);
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
                F('Established by', `${base}.establishedBy`, c.establishedBy, 'multi', {
                  noun: 'character',
                  options: castNames,
                }),
                // Stored flag is `immutable`; the checkbox states the negative, so
                // ticking it makes the fact changeable (immutable: false).
                F('Can be changed by another character', `${base}.immutable`, c.immutable, 'boolInv'),
              ],
            };
          });
    return {
      kicker: 'Memory',
      title: 'Canon facts',
      subtitle: 'The compressed truth of the world — edit or delete individual facts',
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
