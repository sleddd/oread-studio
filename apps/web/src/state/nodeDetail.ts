/**
 * Maps a selected world-tree node key to a detail view-model (kicker/title/
 * subtitle + editable field groups) read from the live world document.
 */
import type { WorldDocument } from '@oread/shared';

export type FieldKind = 'ro' | 'long' | 'short';
export interface DetailField {
  label: string;
  value: string;
  kind: FieldKind;
}
export interface DetailGroup {
  heading: string;
  fields: DetailField[];
}
export interface NodeDetail {
  kicker: string;
  title: string;
  subtitle: string;
  hasImage: boolean;
  groups: DetailGroup[];
}

const F = (label: string, value: string, kind: FieldKind = 'short'): DetailField => ({
  label,
  value: value ?? '',
  kind,
});

export function nodeDetail(doc: WorldDocument | null, key: string | null): NodeDetail | null {
  if (!doc || !key) return null;
  const w = doc.world;

  if (key === 'premise') {
    return {
      kicker: 'Premise',
      title: 'The essence',
      subtitle: 'One sentence you could tell a stranger, and everything that unpacks from it.',
      hasImage: false,
      groups: [
        { heading: 'Logline', fields: [F('Logline', w.premise.logline, 'long')] },
        {
          heading: 'Details',
          fields: [
            F('Synopsis', w.premise.synopsis, 'long'),
            F('Themes', w.premise.themes.join(' · ')),
            F('Genre', w.premise.genre.join(' · ')),
            F('Tone', w.premise.tone),
          ],
        },
      ],
    };
  }

  if (key === 'lore') {
    return {
      kicker: 'Setting',
      title: 'Lore & backdrop',
      subtitle: 'The world beneath the world.',
      hasImage: false,
      groups: [
        {
          heading: 'Backdrop',
          fields: [F('Lore', w.setting.lore, 'long'), F('Time period', w.setting.timePeriod)],
        },
      ],
    };
  }

  if (key.startsWith('loc:')) {
    const loc = w.setting.locations.find((l) => l.id === key.slice(4));
    if (!loc) return null;
    return {
      kicker: 'Location',
      title: loc.name,
      subtitle: loc.id,
      hasImage: false,
      groups: [
        {
          heading: 'Location',
          fields: [
            F('Description', loc.description, 'long'),
            F('Significance', loc.significance),
            F('Tags', loc.tags.join(' · ')),
          ],
        },
      ],
    };
  }

  if (key.startsWith('char:')) {
    const ch = w.entities.characters.find((c) => c.id === key.slice(5));
    if (!ch) return null;
    return {
      kicker: `Character · ${ch.role}`,
      title: ch.name,
      subtitle: ch.definition.traits || ch.role,
      hasImage: true,
      groups: [
        {
          heading: 'Definition',
          fields: [
            F('Backstory', ch.definition.backstory, 'long'),
            F('Voice', ch.definition.voice),
            F('Desires', ch.definition.desires),
            F('Wounds', ch.definition.wounds),
            F('Contradiction', ch.definition.contradiction),
          ],
        },
        {
          heading: 'State',
          fields: [
            F('Location', ch.state.location),
            F('Status', ch.state.status),
            F('Currently knows', ch.state.knowledge.join('; ')),
          ],
        },
        {
          heading: 'Arc',
          fields: [
            F('Starting point', ch.arc.startingPoint),
            F('Trajectory', ch.arc.trajectory),
            F('Endpoint', ch.arc.endpoint),
          ],
        },
      ],
    };
  }

  if (key === 'canon') {
    return {
      kicker: 'Memory',
      title: 'Canon facts',
      subtitle: 'The compressed, immutable truth',
      hasImage: false,
      groups: [
        {
          heading: 'Facts',
          fields: w.memory.canon.map((c) => F(c.id, c.fact, 'ro')),
        },
      ],
    };
  }

  if (key === 'threads') {
    return {
      kicker: 'Memory',
      title: 'Open threads',
      subtitle: 'Promises made to the reader',
      hasImage: false,
      groups: [
        {
          heading: 'Threads',
          fields: w.memory.openThreads.map((t) => F(`${t.id} · ${t.status}`, t.description, 'ro')),
        },
      ],
    };
  }

  if (key === 'mem') {
    return {
      kicker: 'Memory',
      title: 'Event log',
      subtitle: 'Append-only record of what happened in the writing sessions',
      hasImage: false,
      groups: [
        {
          heading: 'Recent events',
          fields: w.memory.events.map((e) => F(`${e.id} · ${e.type}`, `${e.summary} (importance ${e.importance})`, 'ro')),
        },
      ],
    };
  }

  if (key === 'decisions') {
    return {
      kicker: 'Memory',
      title: 'Decisions',
      subtitle: 'Authorial choices, with reasoning',
      hasImage: false,
      groups: [
        {
          heading: 'Log',
          fields: w.memory.decisions.map((d) => F(d.id, `${d.decision} → ${d.reasoning}`, 'ro')),
        },
      ],
    };
  }

  if (key === 'session') {
    const sess = w.session;
    return {
      kicker: 'Session',
      title: 'Session & model',
      subtitle: 'How the studio behaves right now',
      hasImage: false,
      groups: [
        {
          heading: 'Voice',
          fields: [
            F('Narrator voice', sess.narratorVoice, 'ro'),
            F('Hard rules', sess.hardRules.join(' '), 'ro'),
            F('Style notes', sess.styleNotes, 'ro'),
          ],
        },
      ],
    };
  }

  // Fallback for keys without a dedicated editor yet.
  return {
    kicker: 'World',
    title: key,
    subtitle: 'This node has no dedicated editor yet.',
    hasImage: false,
    groups: [],
  };
}
