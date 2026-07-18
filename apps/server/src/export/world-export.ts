/**
 * Export helpers. A portable world.json bundles the world document + its
 * manuscripts/chapters, with credentialId pointers left as DANGLING references
 * — never embedded key material. A full export additionally lists chats and
 * revisions.
 */
import type { WorldDocument } from '@oread/shared';
import type { WorldStore, StoreCtx } from '../storage/types.js';

/** Strip anything that could carry secret material and null out credentialIds. */
function sanitizeWorld(doc: WorldDocument): WorldDocument {
  const clone: WorldDocument = structuredClone(doc);
  const configs = clone.world.session?.modeConfigs;
  if (configs) {
    for (const key of Object.keys(configs) as (keyof typeof configs)[]) {
      const cfg = configs[key] as unknown as Record<string, unknown>;
      // Leave the pointer as a dangling reference marker, never a real id that
      // maps to a (different user's) credential on import.
      cfg.credentialId = null;
      // defensively drop any stray secret-looking fields
      for (const suspect of ['apiKey', 'key', 'secret', 'token']) delete cfg[suspect];
    }
  }
  return clone;
}

export interface WorldExport {
  format: 'oread.world/v1';
  exportedAt: string;
  world: WorldDocument;
  manuscripts: Array<{
    name: string;
    format: string;
    order: number;
    chapters: Array<{ chapterId: string; content: string; status: string; order: number }>;
  }>;
}

export async function buildWorldExport(
  store: WorldStore,
  ctx: StoreCtx,
  worldId: string,
): Promise<WorldExport | null> {
  const doc = await store.getWorld(ctx, worldId);
  if (!doc) return null;
  const manuscripts = await store.listManuscripts(ctx, worldId);
  const out: WorldExport['manuscripts'] = [];
  for (const ms of manuscripts) {
    const chapters = await store.listChapters(ctx, ms.id);
    out.push({
      name: ms.name,
      format: ms.format,
      order: ms.order,
      chapters: chapters.map((c) => ({
        chapterId: c.chapter_id,
        content: c.content,
        status: c.status,
        order: c.order,
      })),
    });
  }
  return {
    format: 'oread.world/v1',
    exportedAt: new Date().toISOString(),
    world: sanitizeWorld(doc),
    manuscripts: out,
  };
}
