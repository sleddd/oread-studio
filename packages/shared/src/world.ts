/**
 * The Oread world document. `worlds.data` (Postgres JSONB) or a `world.json`
 * file holds exactly this shape under a top-level `world` key. Chapter *prose*
 * does NOT live here — it lives in the `chapters` table; structure.chapters[]
 * carries only chapter metadata.
 */

// ─── identity ───────────────────────────────────────────────
export type WorldMode = 'fiction' | 'nonfiction' | 'roleplay' | 'hybrid';

export interface WorldIdentity {
  id: string;
  name: string;
  version: string;
  mode: WorldMode;
  created: string; // ISO
  lastModified: string; // ISO
}

// ─── premise ────────────────────────────────────────────────
export interface WorldPremise {
  logline: string;
  synopsis: string;
  themes: string[];
  genre: string[];
  tone: string;
  /** nonfiction only */
  thesis?: string;
}

// ─── setting ────────────────────────────────────────────────
export interface WorldLocation {
  id: string;
  name: string;
  description: string;
  significance: string;
  tags: string[];
}

export interface WorldRule {
  id: string;
  statement: string;
  implications: string;
  canBreak: boolean;
}

export interface WorldSetting {
  lore: string;
  timePeriod: string;
  locations: WorldLocation[];
  rules: WorldRule[];
}

// ─── entities ───────────────────────────────────────────────
export interface CharacterDefinition {
  backstory: string;
  traits: string;
  voice: string;
  knowledgeSkills: string;
  desires: string;
  wounds: string;
  contradiction: string;
}

export interface CharacterState {
  /**
   * Where the character currently is. A list — a character can be in more than
   * one place (a ship and its cabin, a city and a room).
   *
   * Accepts a bare `string` too: world documents written before this became a
   * list still hold one. Read it through `characterLocations()` rather than
   * touching it directly, so both shapes are handled in one place.
   */
  location: string[] | string;
  status: string;
  emotionalState: string;
  /** The character does NOT know things absent from this array (enforced in character chat). */
  knowledge: string[];
  inventory: string[];
}

export interface CharacterArc {
  startingPoint: string;
  trajectory: string;
  endpoint: string;
}

export interface Character {
  id: string;
  name: string;
  role: string;
  definition: CharacterDefinition;
  state: CharacterState;
  arc: CharacterArc;
  /** optional portrait URL; UI falls back to the hatch placeholder */
  image?: string;
}

export interface Relationship {
  id: string;
  /** exactly two character ids */
  between: [string, string];
  type: string;
  description: string;
  tension: string;
  /** references into memory.events */
  history: string[];
}

export interface Faction {
  id: string;
  name: string;
  description: string;
  goals: string;
  members: string[];
  tags: string[];
}

/** nonfiction backbone */
export interface Concept {
  id: string;
  name: string;
  definition: string;
  sources: string[];
  relatedConcepts: string[];
  authorPosition: string;
}

export interface Source {
  id: string;
  citation: string;
  keyClaims: string[];
  notes: string;
  reliability: string;
}

export interface WorldEntities {
  characters: Character[];
  relationships: Relationship[];
  factions: Faction[];
  concepts: Concept[];
  sources: Source[];
}

// ─── structure ──────────────────────────────────────────────
export type ChapterStatus = 'outline' | 'drafting' | 'revised' | 'final';

/** Chapter *metadata*. Prose content lives in the `chapters` table, keyed by `id`. */
export interface ChapterMeta {
  id: string;
  order: number;
  title: string;
  status: ChapterStatus;
  summary: string;
  purpose: string;
  povCharacter: string;
  /** @deprecated Legacy. Retained so older world docs keep round-tripping; no UI. */
  sceneIds?: string[];
  wordCount: number;
}

/**
 * @deprecated Legacy shape. Scenes were removed from the structure model — the
 * type stays so existing world documents keep parsing, but nothing creates,
 * reads, or edits scenes through the interface.
 */
export interface Scene {
  id: string;
  chapterId: string;
  location: string;
  charactersPresent: string[];
  summary: string;
  beats: string[];
  timelinePosition: string;
}

/**
 * @deprecated Legacy shape. The timeline was removed from the structure model —
 * retained only so existing world documents keep parsing.
 */
export interface TimelineEntry {
  id: string;
  when: string;
  event: string;
  revealedIn: string;
}

export interface WorldStructure {
  chapters: ChapterMeta[];
  /** @deprecated Legacy — preserved on read/write, never surfaced in the UI. */
  scenes?: Scene[];
  /** @deprecated Legacy — preserved on read/write, never surfaced in the UI. */
  timeline?: TimelineEntry[];
}

// ─── memory (three layers + decisions) ──────────────────────
export type MemoryEventType =
  | 'plot'
  | 'character-development'
  | 'worldbuilding'
  | 'decision'
  | 'retcon'
  | 'research-finding';

export interface MemoryEvent {
  id: string;
  timestamp: string; // ISO
  type: MemoryEventType;
  /** one line */
  summary: string;
  detail: string;
  entities: string[];
  chapterContext: string;
  /** retcon pointer to a superseded event id — the superseded event is never deleted */
  supersedes?: string;
  /** 1–5 */
  importance: number;
}

export interface CanonFact {
  id: string;
  fact: string;
  establishedBy: string[];
  immutable: boolean;
}

export type ThreadStatus = 'open' | 'resolved' | 'abandoned';

export interface OpenThread {
  id: string;
  description: string;
  plantedIn: string;
  mustResolveBy: string;
  status: ThreadStatus;
  resolvedIn?: string;
}

export interface Decision {
  id: string;
  decision: string;
  reasoning: string;
  date: string;
}

export interface WorldMemory {
  events: MemoryEvent[];
  canon: CanonFact[];
  openThreads: OpenThread[];
  decisions: Decision[];
}

// ─── suggestions (Track Changes) ────────────────────────────
export type SuggestionType =
  | 'rewrite'
  | 'cut'
  | 'expand'
  | 'flag'
  | 'continuity-error';

export type SuggestionStatus = 'pending' | 'accepted' | 'rejected';

export interface Suggestion {
  id: string;
  /** target chapter id */
  target: string;
  anchor: { start: number; end: number };
  type: SuggestionType;
  original: string;
  proposed: string | null;
  rationale: string;
  status: SuggestionStatus;
  createdIn: string;
}

// ─── the document ───────────────────────────────────────────
export interface World {
  identity: WorldIdentity;
  premise: WorldPremise;
  setting: WorldSetting;
  entities: WorldEntities;
  structure: WorldStructure;
  memory: WorldMemory;
  suggestions: Suggestion[];
  session: import('./session.js').WorldSession;
}

/** The top-level shape of `worlds.data` / a `world.json` file. */
export interface WorldDocument {
  world: World;
}

/**
 * Read `character.state.location` as a list, whichever shape it's stored in.
 *
 * It became a list so a character can be in several places at once; documents
 * written before that hold a single string. Every reader goes through here so
 * neither shape needs handling at the call site. Blank entries are dropped, so a
 * legacy `location: ''` reads as `[]` rather than `['']`.
 */
export function characterLocations(state: Pick<CharacterState, 'location'>): string[] {
  const raw = state.location;
  const list = Array.isArray(raw) ? raw : [raw];
  return list.filter((l): l is string => typeof l === 'string' && l.trim() !== '');
}
