/**
 * Derives the collapsible World-tree sections + item lists from the live world
 * document. Empty sections render the "Nothing here yet" state.
 */
import type { WorldDocument } from '@oread/shared';

export interface TreeItem {
  key: string;
  label: string;
  type: string;
}
export interface TreeSection {
  label: string;
  items: TreeItem[];
}

export function worldSections(doc: WorldDocument | null): TreeSection[] {
  const w = doc?.world;
  if (!w) return [];
  return [
    { label: 'Premise', items: [{ key: 'premise', label: 'Overview', type: 'premise' }] },
    {
      label: 'Setting',
      items: [
        ...(w.setting.lore ? [{ key: 'lore', label: 'Lore & backdrop', type: 'lore' }] : []),
        ...w.setting.locations.map((l) => ({ key: `loc:${l.id}`, label: l.name, type: 'location' })),
        ...w.setting.rules.map((r) => ({ key: `rule:${r.id}`, label: r.statement.slice(0, 32), type: 'rule' })),
      ],
    },
    {
      label: 'Entities',
      items: [
        ...w.entities.characters.map((c) => ({ key: `char:${c.id}`, label: c.name, type: 'character' })),
        ...w.entities.relationships.map((r) => ({ key: `rel:${r.id}`, label: r.type, type: 'relation' })),
        ...w.entities.concepts.map((c) => ({ key: `concept:${c.id}`, label: c.name, type: 'concept' })),
        ...w.entities.sources.map((s) => ({ key: `source:${s.id}`, label: s.citation.slice(0, 28), type: 'source' })),
      ],
    },
    {
      label: 'Structure',
      items: [
        ...w.structure.chapters.map((c) => ({ key: `ch:${c.id}`, label: c.title, type: 'chapter' })),
        ...w.structure.scenes.map((s) => ({ key: `scene:${s.id}`, label: s.summary.slice(0, 28), type: 'scene' })),
        ...(w.structure.timeline.length ? [{ key: 'timeline', label: 'Timeline', type: 'timeline' }] : []),
      ],
    },
    {
      label: 'Memory',
      items: [
        { key: 'mem', label: 'Event log', type: 'events' },
        { key: 'canon', label: 'Canon facts', type: 'canon' },
        { key: 'threads', label: 'Open threads', type: 'threads' },
        { key: 'decisions', label: 'Decisions', type: 'decisions' },
      ],
    },
    { label: 'Session', items: [{ key: 'session', label: 'Session & model', type: 'session' }] },
  ];
}
