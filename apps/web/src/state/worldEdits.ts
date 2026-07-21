/**
 * World-document editing: entity factories (add) + a field-binding model so the
 * detail view can read/write any field directly on the live world document.
 *
 * A FieldBinding exposes get()/set() over the world doc. Setting mutates a
 * draft copy the caller commits back to the store; Save World persists it.
 */
import type {
  WorldDocument,
  Character,
  WorldLocation,
  WorldRule,
  Relationship,
  Concept,
  Source,
  CanonFact,
  OpenThread,
  Decision,
  Scene,
  TimelineEntry,
  MemoryEvent,
} from '@oread/shared';

let seq = 0;
export function newId(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}${seq}`;
}

// ─── entity factories ───────────────────────────────────────
export function makeCharacter(): Character {
  return {
    id: newId('char'),
    name: 'New Character',
    role: 'supporting',
    definition: {
      backstory: '',
      traits: '',
      voice: '',
      knowledgeSkills: '',
      desires: '',
      wounds: '',
      contradiction: '',
    },
    state: { location: '', status: '', emotionalState: '', knowledge: [], inventory: [] },
    arc: { startingPoint: '', trajectory: '', endpoint: '' },
  };
}
export function makeLocation(): WorldLocation {
  return { id: newId('loc'), name: 'New Location', description: '', significance: '', tags: [] };
}
export function makeRule(): WorldRule {
  return { id: newId('rule'), statement: 'New rule', implications: '', canBreak: true };
}
export function makeRelationship(chars: Character[]): Relationship {
  return {
    id: newId('rel'),
    between: [chars[0]?.id ?? '', chars[1]?.id ?? ''],
    type: 'relationship',
    description: '',
    tension: '',
    history: [],
  };
}
export function makeConcept(): Concept {
  return {
    id: newId('con'),
    name: 'New Concept',
    definition: '',
    sources: [],
    relatedConcepts: [],
    authorPosition: '',
  };
}
export function makeSource(): Source {
  return { id: newId('src'), citation: 'New source', keyClaims: [], notes: '', reliability: '' };
}
export function makeCanon(): CanonFact {
  return { id: newId('canon'), fact: 'New canon fact', establishedBy: [], immutable: true };
}
export function makeThread(): OpenThread {
  return {
    id: newId('thread'),
    description: 'New open thread',
    plantedIn: '',
    mustResolveBy: '',
    status: 'open',
  };
}
export function makeDecision(): Decision {
  return { id: newId('dec'), decision: 'New decision', reasoning: '', date: new Date().toISOString().slice(0, 10) };
}
export function makeScene(): Scene {
  return {
    id: newId('scn'),
    chapterId: '',
    location: '',
    charactersPresent: [],
    summary: 'New scene',
    beats: [],
    timelinePosition: '',
  };
}
export function makeTimelineEntry(): TimelineEntry {
  return { id: newId('tl'), when: '', event: 'New event', revealedIn: '' };
}
export function makeEvent(): MemoryEvent {
  return {
    id: newId('mem'),
    timestamp: new Date().toISOString(),
    type: 'plot',
    summary: 'New event',
    detail: '',
    entities: [],
    chapterContext: '',
    importance: 3,
  };
}

/** Which section a node key belongs to, for the "+ Add" buttons in the tree. */
export type AddableKind =
  | 'character'
  | 'location'
  | 'rule'
  | 'relationship'
  | 'concept'
  | 'source'
  | 'canon'
  | 'thread'
  | 'decision'
  | 'scene'
  | 'timeline'
  | 'event';

/** Append a new entity of `kind` to a draft world doc; returns [draft, nodeKey]. */
export function addEntity(
  doc: WorldDocument,
  kind: AddableKind,
): { doc: WorldDocument; nodeKey: string } {
  const d = structuredClone(doc);
  const w = d.world;
  switch (kind) {
    case 'character': {
      const c = makeCharacter();
      w.entities.characters.push(c);
      return { doc: d, nodeKey: `char:${c.id}` };
    }
    case 'location': {
      const l = makeLocation();
      w.setting.locations.push(l);
      return { doc: d, nodeKey: `loc:${l.id}` };
    }
    case 'rule': {
      const r = makeRule();
      w.setting.rules.push(r);
      return { doc: d, nodeKey: `rule:${r.id}` };
    }
    case 'relationship': {
      const r = makeRelationship(w.entities.characters);
      w.entities.relationships.push(r);
      return { doc: d, nodeKey: `rel:${r.id}` };
    }
    case 'concept': {
      const c = makeConcept();
      w.entities.concepts.push(c);
      return { doc: d, nodeKey: `concept:${c.id}` };
    }
    case 'source': {
      const s = makeSource();
      w.entities.sources.push(s);
      return { doc: d, nodeKey: `source:${s.id}` };
    }
    case 'canon': {
      w.memory.canon.push(makeCanon());
      return { doc: d, nodeKey: 'canon' };
    }
    case 'thread': {
      w.memory.openThreads.push(makeThread());
      return { doc: d, nodeKey: 'threads' };
    }
    case 'decision': {
      w.memory.decisions.push(makeDecision());
      return { doc: d, nodeKey: 'decisions' };
    }
    case 'event': {
      w.memory.events.push(makeEvent());
      return { doc: d, nodeKey: 'mem' };
    }
    case 'scene': {
      w.structure.scenes.push(makeScene());
      return { doc: d, nodeKey: 'scene:' + w.structure.scenes[w.structure.scenes.length - 1]!.id };
    }
    case 'timeline': {
      w.structure.timeline.push(makeTimelineEntry());
      return { doc: d, nodeKey: 'timeline' };
    }
  }
}

/** Delete the entity identified by a node key; returns the new draft. */
export function deleteEntity(doc: WorldDocument, nodeKey: string): WorldDocument {
  const d = structuredClone(doc);
  const w = d.world;
  const [type, id] = nodeKey.split(':');
  if (type === 'char') w.entities.characters = w.entities.characters.filter((c) => c.id !== id);
  else if (type === 'loc') w.setting.locations = w.setting.locations.filter((l) => l.id !== id);
  else if (type === 'rule') w.setting.rules = w.setting.rules.filter((r) => r.id !== id);
  else if (type === 'rel') w.entities.relationships = w.entities.relationships.filter((r) => r.id !== id);
  else if (type === 'concept') w.entities.concepts = w.entities.concepts.filter((c) => c.id !== id);
  else if (type === 'source') w.entities.sources = w.entities.sources.filter((s) => s.id !== id);
  else if (type === 'scene') w.structure.scenes = w.structure.scenes.filter((s) => s.id !== id);
  else if (type === 'ch') w.structure.chapters = w.structure.chapters.filter((c) => c.id !== id);
  // Memory items use collective list nodes (mem/canon/threads/decisions), so
  // per-item deletes carry a typed 'event:'/'canon:'/'thread:'/'decision:' key.
  // (Removing outline metadata; prose ChapterRows live in a separate table.)
  else if (type === 'event') w.memory.events = w.memory.events.filter((e) => e.id !== id);
  else if (type === 'canon') w.memory.canon = w.memory.canon.filter((c) => c.id !== id);
  else if (type === 'thread') w.memory.openThreads = w.memory.openThreads.filter((t) => t.id !== id);
  else if (type === 'decision') w.memory.decisions = w.memory.decisions.filter((d) => d.id !== id);
  return d;
}
