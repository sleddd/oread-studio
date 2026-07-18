/**
 * Cast derivation: the world's characters plus the always-present Narrator.
 * The chat's active "character" is one of these.
 */
import type { WorldDocument } from '@oread/shared';

export interface CastMember {
  id: string;
  name: string;
  initials: string;
  role: string;
}

export const NARRATOR: CastMember = {
  id: 'narrator',
  name: 'The Narrator',
  initials: '✎',
  role: 'Omniscient voice · your muse',
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export function castFor(world: WorldDocument | null): CastMember[] {
  const chars = (world?.world.entities.characters ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    initials: initials(c.name),
    role: c.role,
  }));
  return [...chars, NARRATOR];
}
