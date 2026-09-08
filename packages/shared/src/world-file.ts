/**
 * Reading a world JSON file back in.
 *
 * Import used to accept only a bare `World` or `{ world: World }`. The Export
 * world.json button emits neither: `buildWorldExport` wraps a whole
 * `WorldDocument` in an envelope, so identity sits at `world.world.identity`.
 * The old reader saw a truthy `parsed.world`, took the wrapped branch, and
 * looked for identity one level too high — so the file the app exported was
 * exactly the file it refused, with "missing world.identity".
 *
 * Every shape the app has ever written is normalised here, in shared, so the
 * importer and the exporter cannot drift apart again.
 */
import type { WorldDocument, World } from './world.js';

/** A manuscript and its chapters, as carried by an export envelope. */
export interface WorldFileManuscript {
  name: string;
  format: string;
  order: number;
  chapters: Array<{ chapterId: string; content: string; status: string; order: number }>;
}

export interface ParsedWorldFile {
  doc: WorldDocument;
  /** Empty for a bare document — only an export envelope carries prose. */
  manuscripts: WorldFileManuscript[];
}

function hasIdentity(v: unknown): v is World {
  const w = v as World | undefined;
  return !!w && typeof w === 'object' && !!w.identity && typeof w.identity === 'object';
}

/**
 * Normalise any world JSON the app has produced into a document + its prose.
 *
 * Accepts, innermost first: a bare `World`, a `{ world: World }` document, and
 * the `{ format: 'oread.world/v1', world: WorldDocument, manuscripts }`
 * envelope that the export route serves.
 *
 * @throws if no recognisable world identity is found at any depth.
 */
export function parseWorldFile(parsed: unknown): ParsedWorldFile {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('that file is not a JSON object');
  }
  const root = parsed as Record<string, unknown>;

  // Export envelope: { world: { world: {...} }, manuscripts: [...] }.
  const inner = (root.world as Record<string, unknown> | undefined)?.world;
  if (hasIdentity(inner)) {
    const raw = Array.isArray(root.manuscripts) ? (root.manuscripts as WorldFileManuscript[]) : [];
    // Defend against a hand-edited envelope: keep only well-formed entries.
    const manuscripts = raw
      .filter((m) => m && typeof m === 'object')
      .map((m) => ({
        name: typeof m.name === 'string' && m.name ? m.name : 'Untitled Manuscript',
        format: typeof m.format === 'string' && m.format ? m.format : 'novel',
        order: typeof m.order === 'number' ? m.order : 0,
        chapters: (Array.isArray(m.chapters) ? m.chapters : []).filter(
          (c) => c && typeof c === 'object' && typeof c.chapterId === 'string',
        ),
      }));
    return { doc: { world: inner }, manuscripts };
  }

  // A plain document: { world: {...} }.
  if (hasIdentity(root.world)) return { doc: { world: root.world }, manuscripts: [] };

  // A bare world: { identity: {...}, ... }.
  if (hasIdentity(root)) return { doc: { world: root }, manuscripts: [] };

  throw new Error('no world identity found — is this an Oread world.json?');
}
