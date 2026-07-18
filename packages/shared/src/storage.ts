/**
 * Row shapes for the per-user schema tables and the file backend.
 * Three-level content model: world → named manuscripts → chapters.
 */
import type { WorldDocument } from './world.js';
import type { PersistedChatMode } from './session.js';

export type WritingFormat =
  | 'novel'
  | 'short'
  | 'screenplay'
  | 'poetry'
  | 'chat'
  | 'essay';

export const WRITING_FORMATS: { value: WritingFormat; label: string }[] = [
  { value: 'novel', label: 'Novel' },
  { value: 'short', label: 'Short Story' },
  { value: 'screenplay', label: 'Screenplay' },
  { value: 'poetry', label: 'Poetry' },
  { value: 'chat', label: 'Chat / RP' },
  { value: 'essay', label: 'Essay' },
];

export type ChapterStatusDb = 'outline' | 'drafting' | 'revised' | 'final';

// ─── worlds ─────────────────────────────────────────────────
export interface WorldRow {
  id: string;
  name: string;
  data: WorldDocument;
  schema_version: string;
  created_at: string;
  updated_at: string;
}

export type SnapshotReason =
  | 'manual'
  | 'pre_ai_write'
  | 'pre_migration'
  | 'autosnapshot';

/** Snapshots are stored as JSON-Patch deltas (+ occasional full). */
export interface WorldSnapshotRow {
  id: string;
  world_id: string;
  /** 'full' carries the whole document; 'delta' carries a JSON-Patch from the prior snapshot. */
  kind: 'full' | 'delta';
  data: unknown;
  reason: SnapshotReason;
  created_at: string;
}

// ─── manuscripts (named grouping) ───────────────────────────
export interface ManuscriptRow {
  id: string;
  /** null when the manuscript is unattached (no world) */
  world_id: string | null;
  name: string;
  format: WritingFormat;
  order: number;
  created_at: string;
  updated_at: string;
}

// ─── chapters (prose) ───────────────────────────────────────
export interface ChapterRow {
  id: string;
  /** null when the owning manuscript is unattached */
  world_id: string | null;
  manuscript_id: string;
  /** matches world.structure.chapters[].id */
  chapter_id: string;
  content: string;
  word_count: number;
  status: ChapterStatusDb;
  order: number;
  created_at: string;
  updated_at: string;
}

export type RevisionReason =
  | 'autosave'
  | 'pre_ai_edit'
  | 'pre_ai_draft'
  | 'manual';

export interface ChapterRevisionRow {
  id: string;
  chapter_id: string; // FK to chapters.id (uuid)
  content: string;
  word_count: number;
  reason: RevisionReason;
  created_at: string;
}

// ─── chats ──────────────────────────────────────────────────
/** A web source the model consulted while researching (Discuss/Draft). */
export interface WebCitation {
  url: string;
  title: string;
}

export interface ChatMessage {
  id: number | string;
  role: 'user' | 'assistant';
  kind?: 'text' | 'prose' | 'suggestion';
  char?: string;
  text?: string;
  sug?: import('./world.js').Suggestion;
  status?: 'pending' | 'accepted' | 'rejected';
  /** web sources cited when the turn used research (only present if any) */
  citations?: WebCitation[];
  time: string;
}

export interface ChatRow {
  id: string;
  world_id: string;
  title: string | null;
  mode: PersistedChatMode;
  character_id: string | null;
  messages: ChatMessage[];
  distilled: boolean;
  saved_at: string;
}

// ─── credentials ────────────────────────────────────────────
export type Provider =
  | 'anthropic'
  | 'openai'
  | 'bedrock'
  | 'cloudflare'
  | 'local';

/** Metadata only — ciphertext/keys never leave the server. */
export interface CredentialMeta {
  id: string;
  provider: Provider;
  label: string;
  master_key_ver: number;
  created_at: string;
  last_used_at: string | null;
}
