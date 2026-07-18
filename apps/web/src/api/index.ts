/**
 * Typed API surface grouped by resource. This is the seam the UI depends on;
 * the AI streaming call is separate (streaming.ts).
 */
import { api } from './client.js';
import type {
  WorldDocument,
  ManuscriptRow,
  ChapterRow,
  ChapterRevisionRow,
  ChatRow,
  CredentialMeta,
  WritingFormat,
  ChapterStatusDb,
  Provider,
  ChatMessage,
  PersistedChatMode,
} from '@oread/shared';

export interface WorldSummary {
  id: string;
  name: string;
  manuscriptCount: number;
  updated_at: string;
}
export interface PublicUser {
  id: string;
  email: string;
  name: string;
  schemaName: string;
  totpEnabled: boolean;
}

export const auth = {
  me: () => api.get<{ user: PublicUser }>('/api/auth/me'),
  signup: (b: { email: string; name: string; password: string }) =>
    api.post<{ user: PublicUser }>('/api/auth/signup', b),
  login: (b: { email: string; password: string; totp?: string }) =>
    api.post<{ user: PublicUser }>('/api/auth/login', b),
  logout: () => api.post<{ ok: boolean }>('/api/auth/logout'),
  changePassword: (b: { currentPassword: string; newPassword: string }) =>
    api.post<{ ok: boolean }>('/api/auth/change-password', b),
};

export const worlds = {
  list: () => api.get<{ worlds: WorldSummary[] }>('/api/worlds'),
  get: (id: string) => api.get<{ world: WorldDocument }>(`/api/worlds/${id}`),
  create: (name?: string) => api.post<{ id: string }>('/api/worlds', { name }),
  save: (id: string, world: WorldDocument) =>
    api.put<{ ok: boolean }>(`/api/worlds/${id}`, { world }),
  remove: (id: string) => api.del<{ ok: boolean }>(`/api/worlds/${id}`),
  snapshot: (id: string) => api.post<{ ok: boolean }>(`/api/worlds/${id}/snapshot`),
};

export const manuscripts = {
  list: (worldId: string) =>
    api.get<{ manuscripts: ManuscriptRow[] }>(`/api/worlds/${worldId}/manuscripts`),
  create: (worldId: string, b: { name?: string; format?: WritingFormat }) =>
    api.post<{ manuscript: ManuscriptRow }>(`/api/worlds/${worldId}/manuscripts`, b),
  update: (mid: string, b: { name?: string; format?: WritingFormat; order?: number }) =>
    api.patch<{ ok: boolean }>(`/api/manuscripts/${mid}`, b),
  remove: (mid: string) => api.del<{ ok: boolean }>(`/api/manuscripts/${mid}`),
  unattached: () => api.get<{ manuscripts: ManuscriptRow[] }>('/api/manuscripts/unattached'),
  reassign: (mid: string, worldId: string | null) =>
    api.post<{ ok: boolean }>(`/api/manuscripts/${mid}/reassign`, { worldId }),
};

export const chapters = {
  list: (mid: string) => api.get<{ chapters: ChapterRow[] }>(`/api/manuscripts/${mid}/chapters`),
  get: (cid: string) => api.get<{ chapter: ChapterRow }>(`/api/chapters/${cid}`),
  create: (worldId: string, mid: string, b: { chapterId: string; content?: string; status?: ChapterStatusDb }) =>
    api.post<{ chapter: ChapterRow }>(`/api/worlds/${worldId}/manuscripts/${mid}/chapters`, b),
  createInManuscript: (mid: string, b: { chapterId: string; content?: string; status?: ChapterStatusDb }) =>
    api.post<{ chapter: ChapterRow }>(`/api/manuscripts/${mid}/chapters`, b),
  saveContent: (cid: string, content: string) =>
    api.put<{ chapter: ChapterRow }>(`/api/chapters/${cid}/content`, { content }),
  updateMeta: (cid: string, b: { status?: ChapterStatusDb; order?: number; chapter_id?: string }) =>
    api.patch<{ ok: boolean }>(`/api/chapters/${cid}`, b),
  remove: (cid: string) => api.del<{ ok: boolean }>(`/api/chapters/${cid}`),
  revisions: (cid: string) =>
    api.get<{ revisions: ChapterRevisionRow[] }>(`/api/chapters/${cid}/revisions`),
};

export const credentials = {
  list: () => api.get<{ credentials: CredentialMeta[] }>('/api/credentials'),
  create: (b: { provider: Provider; label: string; secret?: string; accountId?: string; region?: string; baseUrl?: string }) =>
    api.post<{ credential: CredentialMeta }>('/api/credentials', b),
  remove: (id: string) => api.del<{ ok: boolean }>(`/api/credentials/${id}`),
  models: (id: string) =>
    api.get<{ models: { id: string; label?: string }[]; source: 'live' | 'curated' }>(
      `/api/credentials/${id}/models`,
    ),
};

export const chats = {
  list: (worldId: string) => api.get<{ chats: ChatRow[] }>(`/api/worlds/${worldId}/chats`),
  save: (b: {
    worldId: string;
    title: string | null;
    mode: PersistedChatMode;
    characterId: string | null;
    messages: ChatMessage[];
    chapterContext?: string;
  }) => api.post<{ chat: ChatRow; newEvents: number }>('/api/chats', b),
};

export const exports = {
  worldJson: (id: string) => `/api/worlds/${id}/export`,
};
