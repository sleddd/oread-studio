/**
 * The app store. Holds the single open world + its manuscripts/chapters, the
 * chat client-state (unsaved until Save Chat), settings, and toast. Switch
 * World / Switch Manuscript flush the pending prose autosave first.
 *
 * This is intentionally one cohesive store (the app has one active world), but
 * the UI is composed of many small components that each read a slice — no giant
 * component monolith.
 */
import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useMemo,
  type ReactNode,
} from 'react';
import type {
  WorldDocument,
  ManuscriptRow,
  ChapterRow,
  ChatMessage,
  ChatRow,
  WritingFormat,
  Suggestion,
  PersistedChatMode,
  CredentialMeta,
  Provider,
} from '@oread/shared';
import { countWords } from '@oread/shared';
import * as apiWorlds from '../api/index.js';
import { streamGenerate } from '../api/streaming.js';
import { applyAccent } from '../theme/tokens.js';
import { useAutosave } from './useAutosave.js';
import { DEFAULT_CFG, type ModeCfg } from './modes.js';
import { castFor, NARRATOR, type CastMember } from './cast.js';
import { setByPath } from './nodeDetail.js';
import { addEntity, deleteEntity, type AddableKind } from './worldEdits.js';
import type { ChatMode } from '@oread/shared';
import type { ProseTypeface } from '@oread/shared';
import type { WorldSummary } from '../api/index.js';

function nowTime(): string {
  const d = new Date();
  let h = d.getHours();
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${h}:${p(d.getMinutes())}:${p(d.getSeconds())} ${ap}`;
}

let uid = 1000;
const nextId = () => ++uid;

/**
 * Modes that may research the live web. Mirrors the server's `mayResearch`
 * contract (permissions.ts) — the server is authoritative; this only decides
 * whether to show/send the toggle. Discuss covers character chat too.
 */
const MODE_ALLOWS_RESEARCH = (m: ChatMode): boolean => m === 'discuss' || m === 'draft';

export type NavMode = 'outline' | 'world';
export type CenterView = 'write' | 'world';

interface StoreState {
  // account
  authed: boolean;
  // world runtime (one open at a time)
  worldList: WorldSummary[];
  worldId: string | null;
  /** true when viewing the unattached (no-world) manuscripts */
  unattachedView: boolean;
  unattachedList: ManuscriptRow[];
  world: WorldDocument | null;
  manuscriptsList: ManuscriptRow[];
  manuscriptId: string | null;
  chaptersList: ChapterRow[];
  chapterRowId: string | null;
  // ui
  navMode: NavMode;
  view: CenterView;
  selectedNode: string | null;
  format: WritingFormat;
  accent: string;
  proseTypeface: ProseTypeface;
  // credentials (account-wide)
  credentialsList: CredentialMeta[];
  // chat client-state (unsaved until Save Chat)
  character: string;
  mode: ChatMode;
  cfg: ModeCfg;
  msgs: ChatMessage[];
  /** id of the saved chat this transcript came from / was last saved as (null = new, never-saved). */
  activeChatId: string | null;
  /** saved chats for the open world (for the history picker). */
  savedChats: ChatRow[];
  thinking: boolean;
  /** research the web on the next turn (Discuss/Draft only) */
  research: boolean;
  toast: string | null;
}

export interface StoreApi extends StoreState {
  cast: CastMember[];
  activeChapter: ChapterRow | null;
  // account
  setAuthed: (v: boolean) => void;
  refreshWorlds: () => Promise<WorldSummary[]>;
  logout: () => Promise<void>;
  // credentials
  refreshCredentials: () => Promise<void>;
  addCredential: (input: {
    provider: Provider;
    label: string;
    secret?: string;
    accountId?: string;
    region?: string;
    baseUrl?: string;
  }) => Promise<void>;
  removeCredential: (id: string) => Promise<void>;
  // world switching (flush autosave first)
  openWorld: (id: string) => Promise<void>;
  newWorld: () => Promise<void>;
  importWorld: (doc: WorldDocument) => Promise<void>;
  saveWorld: () => Promise<void>;
  deleteWorld: (id: string) => Promise<void>;
  deleteManuscript: (mid: string) => Promise<void>;
  openUnattached: () => Promise<void>;
  reassignManuscript: (mid: string, worldId: string | null) => Promise<void>;
  unattachedCount: number;
  // manuscript / chapter
  openManuscript: (mid: string) => Promise<void>;
  newManuscript: (name?: string) => Promise<void>;
  renameManuscript: (mid: string, name: string) => Promise<void>;
  openChapter: (cid: string) => void;
  newChapter: () => Promise<void>;
  renameChapter: (cid: string, title: string) => Promise<void>;
  deleteChapter: (cid: string) => Promise<void>;
  setChapterText: (text: string) => void;
  saveDraft: () => Promise<void>;
  setFormat: (f: WritingFormat) => void;
  // world detail
  selectNode: (key: string | null) => void;
  goWrite: () => void;
  setNavMode: (m: NavMode) => void;
  editWorldField: (path: string, value: unknown) => void;
  addWorldEntity: (kind: AddableKind) => void;
  deleteWorldNode: (key: string) => void;
  // settings
  setAccent: (hex: string) => void;
  setProseTypeface: (t: ProseTypeface) => void;
  // chat
  setCharacter: (id: string) => void;
  setMode: (m: ChatMode) => void;
  setCfg: (mode: ChatMode, key: string, value: string) => void;
  setResearch: (on: boolean) => void;
  send: (text: string) => Promise<void>;
  insertProse: (text: string) => Promise<void>;
  acceptSuggestion: (msgId: number | string, apply: boolean) => Promise<void>;
  rejectSuggestion: (msgId: number | string) => void;
  saveChat: () => Promise<void>;
  /** Start a fresh conversation (discards the current unsaved transcript). */
  newChat: () => void;
  /** Load a saved chat into the composer to review / continue it. */
  loadChat: (id: string) => Promise<void>;
  /** Delete a saved chat. */
  deleteChat: (id: string) => Promise<void>;
  /** Refresh the saved-chats list for the open world. */
  refreshSavedChats: () => Promise<void>;
  // toast
  showToast: (t: string) => void;
}

const Ctx = createContext<StoreApi | null>(null);
export const useStore = (): StoreApi => {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore outside provider');
  return s;
};

export function StoreProvider({ children }: { children: ReactNode }): JSX.Element {
  const [s, setS] = useState<StoreState>({
    authed: false,
    worldList: [],
    worldId: null,
    unattachedView: false,
    unattachedList: [],
    world: null,
    manuscriptsList: [],
    manuscriptId: null,
    chaptersList: [],
    chapterRowId: null,
    navMode: 'outline',
    view: 'write',
    selectedNode: null,
    format: 'novel',
    accent: '#2e9d9d',
    proseTypeface: 'Serif',
    credentialsList: [],
    character: 'narrator',
    mode: 'cowrite',
    research: false,
    cfg: DEFAULT_CFG,
    msgs: [],
    activeChatId: null,
    savedChats: [],
    thinking: false,
    toast: null,
  });
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const patch = useCallback((p: Partial<StoreState>) => setS((prev) => ({ ...prev, ...p })), []);

  const showToast = useCallback((t: string) => {
    patch({ toast: t });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => patch({ toast: null }), 2200);
  }, [patch]);

  const autosave = useAutosave(undefined, () => showToast('Reconnecting… changes will retry'));

  const refreshWorlds = useCallback(async (): Promise<WorldSummary[]> => {
    const [{ worlds }, { manuscripts }] = await Promise.all([
      apiWorlds.worlds.list(),
      apiWorlds.manuscripts.unattached(),
    ]);
    patch({ worldList: worlds, unattachedList: manuscripts });
    return worlds;
  }, [patch]);

  const openUnattached = useCallback(async () => {
    await autosave.flush();
    const { manuscripts } = await apiWorlds.manuscripts.unattached();
    const firstMs = manuscripts[0] ?? null;
    const chs = firstMs ? (await apiWorlds.chapters.list(firstMs.id)).chapters : [];
    patch({
      worldId: null,
      unattachedView: true,
      world: null,
      manuscriptsList: manuscripts,
      unattachedList: manuscripts,
      manuscriptId: firstMs?.id ?? null,
      chaptersList: chs,
      chapterRowId: chs[0]?.id ?? null,
      format: firstMs?.format ?? 'novel',
      view: 'write',
      navMode: 'outline',
      selectedNode: null,
      character: NARRATOR.id,
    });
    showToast('Unattached manuscripts');
  }, [autosave, patch, showToast]);

  const loadManuscriptChapters = useCallback(
    async (worldId: string, mid: string): Promise<ChapterRow[]> => {
      const { chapters } = await apiWorlds.chapters.list(mid);
      return chapters;
    },
    [],
  );

  const openWorld = useCallback(
    async (id: string) => {
      await autosave.flush();
      const [{ world }, { manuscripts }] = await Promise.all([
        apiWorlds.worlds.get(id),
        apiWorlds.manuscripts.list(id),
      ]);
      const firstMs = manuscripts[0] ?? null;
      const [chs, chatList] = await Promise.all([
        firstMs ? loadManuscriptChapters(id, firstMs.id) : Promise.resolve([]),
        apiWorlds.chats.list(id).then((r) => r.chats).catch(() => [] as ChatRow[]),
      ]);
      patch({
        worldId: id,
        unattachedView: false,
        world,
        manuscriptsList: manuscripts,
        manuscriptId: firstMs?.id ?? null,
        chaptersList: chs,
        chapterRowId: chs[0]?.id ?? null,
        format: firstMs?.format ?? 'novel',
        view: 'write',
        navMode: 'outline',
        selectedNode: null,
        character: castFor(world)[0]?.id ?? NARRATOR.id,
        // fresh chat context for the newly-opened world
        msgs: [],
        activeChatId: null,
        savedChats: chatList,
        thinking: false,
      });
      showToast(`Switched to “${world.world.identity.name}”`);
    },
    [autosave, loadManuscriptChapters, patch, showToast],
  );

  const newWorld = useCallback(async () => {
    await autosave.flush();
    const { id } = await apiWorlds.worlds.create('Untitled World');
    await refreshWorlds();
    await openWorld(id);
    showToast('New world created');
  }, [autosave, openWorld, refreshWorlds, showToast]);

  const importWorld = useCallback(
    async (doc: WorldDocument) => {
      await autosave.flush();
      // Create an empty world (server assigns the row id + seeds a manuscript),
      // then overwrite its document with the imported one and open it.
      const name = doc.world.identity.name || 'Imported World';
      const { id } = await apiWorlds.worlds.create(name);
      await apiWorlds.worlds.save(id, doc);
      await refreshWorlds();
      await openWorld(id);
      showToast(`Imported “${name}”`);
    },
    [autosave, openWorld, refreshWorlds, showToast],
  );

  const saveWorld = useCallback(async () => {
    if (!s.worldId || !s.world) return;
    await apiWorlds.worlds.save(s.worldId, s.world);
    showToast('World saved');
  }, [s.worldId, s.world, showToast]);

  const logout = useCallback(async () => {
    try {
      await apiWorlds.auth.logout();
    } finally {
      patch({ authed: false, worldId: null, world: null, worldList: [], msgs: [], activeChatId: null, savedChats: [] });
    }
  }, [patch]);

  const refreshCredentials = useCallback(async () => {
    const { credentials } = await apiWorlds.credentials.list();
    patch({ credentialsList: credentials });
  }, [patch]);

  const addCredential = useCallback(
    async (input: {
      provider: Provider;
      label: string;
      secret?: string;
      accountId?: string;
      region?: string;
      baseUrl?: string;
    }) => {
      await apiWorlds.credentials.create(input);
      await refreshCredentials();
      showToast('Credential saved');
    },
    [refreshCredentials, showToast],
  );

  const removeCredential = useCallback(
    async (id: string) => {
      await apiWorlds.credentials.remove(id);
      await refreshCredentials();
      showToast('Credential removed');
    },
    [refreshCredentials, showToast],
  );

  const deleteWorld = useCallback(
    async (id: string) => {
      await apiWorlds.worlds.remove(id);
      // Manuscripts are DETACHED (not deleted) — refresh worlds + unattached.
      await refreshWorlds();
      if (id === s.worldId) {
        const { worlds } = await apiWorlds.worlds.list();
        if (worlds.length > 0) await openWorld(worlds[0]!.id);
        else await openUnattached();
      }
      showToast('World deleted · its manuscripts moved to Unattached');
    },
    // openWorld / openUnattached / refreshWorlds captured at call time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s.worldId, showToast],
  );

  const reassignManuscript = useCallback(
    async (mid: string, worldId: string | null) => {
      await autosave.flush();
      await apiWorlds.manuscripts.reassign(mid, worldId);
      await refreshWorlds();
      // If the reassigned manuscript was the open one, follow it to its new home.
      if (mid === s.manuscriptId) {
        if (worldId) await openWorld(worldId);
        else await openUnattached();
      } else if (s.worldId) {
        // refresh the current world's manuscript list
        const { manuscripts } = await apiWorlds.manuscripts.list(s.worldId);
        patch({ manuscriptsList: manuscripts });
      } else if (s.unattachedView) {
        await openUnattached();
      }
      showToast(worldId ? 'Moved to world' : 'Moved to Unattached');
    },
    // openWorld / openUnattached / refreshWorlds captured at call time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s.manuscriptId, s.worldId, s.unattachedView, autosave, patch, showToast],
  );

  const deleteManuscript = useCallback(
    async (mid: string) => {
      await autosave.flush();
      await apiWorlds.manuscripts.remove(mid);
      if (s.unattachedView) {
        await refreshWorlds();
        await openUnattached();
        showToast('Manuscript deleted');
        return;
      }
      if (!s.worldId) return;
      const { manuscripts } = await apiWorlds.manuscripts.list(s.worldId);
      patch({ manuscriptsList: manuscripts });
      if (mid === s.manuscriptId) {
        if (manuscripts.length > 0) {
          await openManuscript(manuscripts[0]!.id);
        } else {
          // No manuscripts left — create a fresh one so the world always has one.
          await newManuscript();
        }
      }
      showToast('Manuscript deleted');
    },
    // openManuscript / newManuscript / openUnattached / refreshWorlds captured at call time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s.worldId, s.manuscriptId, s.unattachedView, autosave, patch, showToast],
  );

  const openManuscript = useCallback(
    async (mid: string) => {
      await autosave.flush();
      const chs = (await apiWorlds.chapters.list(mid)).chapters;
      const ms = s.manuscriptsList.find((m) => m.id === mid);
      patch({
        manuscriptId: mid,
        chaptersList: chs,
        chapterRowId: chs[0]?.id ?? null,
        format: ms?.format ?? 'novel',
        view: 'write',
        selectedNode: null,
      });
      if (ms) showToast(`Opened “${ms.name}”`);
    },
    [s.worldId, s.manuscriptsList, autosave, loadManuscriptChapters, patch, showToast],
  );

  const newManuscript = useCallback(async (name?: string) => {
    if (!s.worldId) return;
    await autosave.flush();
    const { manuscript } = await apiWorlds.manuscripts.create(s.worldId, {
      name: name?.trim() || 'Untitled Manuscript',
      format: 'novel',
    });
    const { manuscripts } = await apiWorlds.manuscripts.list(s.worldId);
    patch({ manuscriptsList: manuscripts });
    await openManuscript(manuscript.id);
    showToast('New manuscript created');
  }, [s.worldId, autosave, openManuscript, patch, showToast]);

  const renameManuscript = useCallback(
    async (mid: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      await apiWorlds.manuscripts.update(mid, { name: trimmed });
      setS((prev) => ({
        ...prev,
        manuscriptsList: prev.manuscriptsList.map((m) =>
          m.id === mid ? { ...m, name: trimmed } : m,
        ),
        unattachedList: prev.unattachedList.map((m) =>
          m.id === mid ? { ...m, name: trimmed } : m,
        ),
      }));
      showToast('Manuscript renamed');
    },
    [showToast],
  );

  const openChapter = useCallback(
    (cid: string) => patch({ chapterRowId: cid, view: 'write', selectedNode: null }),
    [patch],
  );

  const newChapter = useCallback(async () => {
    if (!s.manuscriptId) return;
    const chapterId = `ch_${nextId()}`;
    // Works whether attached (worldId) or unattached (null) — chapter follows its manuscript.
    const { chapter } = await apiWorlds.chapters.createInManuscript(s.manuscriptId, {
      chapterId,
      status: 'outline',
    });
    const { chapters: chs } = await apiWorlds.chapters.list(s.manuscriptId);
    patch({ chaptersList: chs, chapterRowId: chapter.id, view: 'write', selectedNode: null });
    showToast('Chapter added');
  }, [s.manuscriptId, patch, showToast]);

  const renameChapter = useCallback(
    async (cid: string, title: string) => {
      const trimmed = title.trim();
      if (!trimmed || !s.world) return;
      const row = s.chaptersList.find((c) => c.id === cid);
      if (!row) return;
      // Title lives in the world doc's chapter meta (keyed by chapter_id). A
      // freshly-created chapter has a DB row but no meta yet, so upsert one.
      const draft = structuredClone(s.world);
      const chapters = draft.world.structure.chapters;
      const meta = chapters.find((c) => c.id === row.chapter_id);
      if (meta) {
        meta.title = trimmed;
      } else {
        chapters.push({
          id: row.chapter_id,
          order: row.order ?? chapters.length,
          title: trimmed,
          status: row.status,
          summary: '',
          purpose: '',
          povCharacter: '',
          sceneIds: [],
          wordCount: row.word_count ?? 0,
        });
      }
      draft.world.identity.lastModified = new Date().toISOString();
      patch({ world: draft });
      // Persist immediately so the rename sticks without a separate Save World.
      if (s.worldId) {
        await apiWorlds.worlds.save(s.worldId, draft);
      }
      showToast('Chapter renamed');
    },
    [s.world, s.worldId, s.chaptersList, patch, showToast],
  );

  const deleteChapter = useCallback(
    async (cid: string) => {
      if (!s.manuscriptId) return;
      await autosave.flush();
      const row = s.chaptersList.find((c) => c.id === cid);
      await apiWorlds.chapters.remove(cid);
      const { chapters: chs } = await apiWorlds.chapters.list(s.manuscriptId);
      setS((prev) => {
        // Drop the chapter's meta from the world doc too (if attached).
        let world = prev.world;
        if (world && row) {
          const draft = structuredClone(world);
          draft.world.structure.chapters = draft.world.structure.chapters.filter(
            (c) => c.id !== row.chapter_id,
          );
          world = draft;
        }
        const stillOpen = prev.chapterRowId && chs.some((c) => c.id === prev.chapterRowId);
        return {
          ...prev,
          world,
          chaptersList: chs,
          chapterRowId: stillOpen ? prev.chapterRowId : chs[0]?.id ?? null,
        };
      });
      showToast('Chapter deleted');
    },
    [s.manuscriptId, s.chaptersList, autosave, showToast],
  );

  const setChapterText = useCallback(
    (text: string) => {
      if (!s.chapterRowId) return;
      setS((prev) => ({
        ...prev,
        chaptersList: prev.chaptersList.map((c) =>
          c.id === prev.chapterRowId ? { ...c, content: text, word_count: countWords(text) } : c,
        ),
      }));
      autosave.queue(s.chapterRowId, text);
    },
    [s.chapterRowId, autosave],
  );

  // Force-persist the current chapter prose now, instead of waiting for the
  // debounced autosave. flush() writes whatever is pending in the queue.
  const saveDraft = useCallback(async () => {
    if (!s.chapterRowId) return;
    try {
      await autosave.flush();
      showToast('Draft saved');
    } catch {
      showToast('Save failed — will keep retrying');
    }
  }, [s.chapterRowId, autosave, showToast]);

  const setFormat = useCallback(
    (f: WritingFormat) => {
      patch({ format: f });
      if (s.manuscriptId) void apiWorlds.manuscripts.update(s.manuscriptId, { format: f });
    },
    [s.manuscriptId, patch],
  );

  const setAccent = useCallback(
    (hex: string) => {
      applyAccent(hex);
      patch({ accent: hex });
    },
    [patch],
  );

  // ── chat ──
  const activeChapter = useMemo(
    () => s.chaptersList.find((c) => c.id === s.chapterRowId) ?? null,
    [s.chaptersList, s.chapterRowId],
  );

  const runGenerate = useCallback(
    async (userText: string) => {
      if (!s.worldId) return;
      const userMsg: ChatMessage = { id: nextId(), role: 'user', text: userText, time: nowTime() };
      setS((prev) => ({ ...prev, msgs: [...prev.msgs, userMsg], thinking: true }));

      const mode: PersistedChatMode =
        s.mode === 'discuss' && s.character !== NARRATOR.id ? 'character' : s.mode;

      try {
        const history = [...s.msgs, userMsg]
          .filter((m) => m.text)
          .map((m) => ({ role: m.role, content: m.text! }));
        const done = await streamGenerate(
          {
            worldId: s.worldId,
            mode,
            characterId: s.character === NARRATOR.id ? null : s.character,
            messages: history,
            targetChapterId: s.chapterRowId ?? '',
            allowWebSearch: s.research && MODE_ALLOWS_RESEARCH(s.mode),
          },
          () => {
            /* could show live tokens; we reveal on done for parity with prototype */
          },
        );
        const base: ChatMessage = { id: nextId(), role: 'assistant', char: s.character, time: nowTime() };
        let assistant: ChatMessage;
        if (done.kind === 'suggestion' && done.suggestion) {
          assistant = { ...base, kind: 'suggestion', sug: done.suggestion, status: 'pending' };
        } else {
          assistant = {
            ...base,
            kind: done.kind === 'prose' ? 'prose' : 'text',
            text: done.text,
            citations: done.citations,
          };
        }
        setS((prev) => ({ ...prev, msgs: [...prev.msgs, assistant], thinking: false }));
      } catch (e) {
        setS((prev) => ({ ...prev, thinking: false }));
        showToast(e instanceof Error ? e.message : 'generation failed');
      }
    },
    [s.worldId, s.mode, s.character, s.msgs, s.chapterRowId, s.research, showToast],
  );

  const insertProse = useCallback(
    async (text: string) => {
      if (!s.chapterRowId) return;
      const cur = activeChapter?.content ?? '';
      const merged = cur ? `${cur}\n\n${text}` : text;
      setChapterText(merged);
      await autosave.flush();
      patch({ view: 'write', selectedNode: null });
      showToast('Inserted into the manuscript');
    },
    [s.chapterRowId, activeChapter, setChapterText, autosave, patch, showToast],
  );

  const acceptSuggestion = useCallback(
    async (msgId: number | string, apply: boolean) => {
      const msg = s.msgs.find((m) => m.id === msgId);
      const sug = msg?.sug as Suggestion | undefined;
      if (apply && sug?.proposed && s.chapterRowId) {
        // Applying goes through the server so the pre_ai_edit revision is taken.
        try {
          await apiWorlds.chapters.get(s.chapterRowId); // ensure exists
          const res = await fetch('/api/ai/apply', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({
              mode: 'edit',
              chapterRowId: s.chapterRowId,
              text: sug.proposed,
              reason: 'pre_ai_edit',
            }),
          });
          if (res.ok) {
            const body = await res.json();
            setS((prev) => ({
              ...prev,
              chaptersList: prev.chaptersList.map((c) =>
                c.id === prev.chapterRowId ? body.chapter : c,
              ),
            }));
          }
        } catch {
          /* toast below */
        }
      }
      setS((prev) => ({
        ...prev,
        msgs: prev.msgs.map((m) => (m.id === msgId ? { ...m, status: 'accepted' } : m)),
      }));
      showToast(apply ? 'Applied to the manuscript' : 'Suggestion accepted');
    },
    [s.msgs, s.chapterRowId, showToast],
  );

  const rejectSuggestion = useCallback(
    (msgId: number | string) => {
      setS((prev) => ({
        ...prev,
        msgs: prev.msgs.map((m) => (m.id === msgId ? { ...m, status: 'rejected' } : m)),
      }));
    },
    [],
  );

  const refreshSavedChats = useCallback(async () => {
    if (!s.worldId) return;
    try {
      const { chats } = await apiWorlds.chats.list(s.worldId);
      patch({ savedChats: chats });
    } catch {
      /* non-fatal — history just won't refresh */
    }
  }, [s.worldId, patch]);

  const saveChat = useCallback(async () => {
    if (!s.worldId || s.msgs.length === 0) {
      showToast('Nothing to save yet');
      return;
    }
    const mode: PersistedChatMode =
      s.mode === 'discuss' && s.character !== NARRATOR.id ? 'character' : s.mode;
    // Continuing a loaded chat updates it in place (chatId); a fresh chat inserts.
    const { chat, newEvents } = await apiWorlds.chats.save({
      chatId: s.activeChatId ?? undefined,
      worldId: s.worldId,
      title: null,
      mode,
      characterId: s.character === NARRATOR.id ? null : s.character,
      messages: s.msgs,
      chapterContext: activeChapter?.chapter_id ?? '',
    });
    // reload world so distilled memory events appear in the World tab
    if (newEvents > 0) {
      const { world } = await apiWorlds.worlds.get(s.worldId);
      patch({ world });
    }
    patch({ activeChatId: chat.id });
    void refreshSavedChats();
    showToast(newEvents > 0 ? `Chat saved · ${newEvents} memory event(s)` : 'Chat saved');
  }, [s.worldId, s.msgs, s.mode, s.character, s.activeChatId, activeChapter, patch, refreshSavedChats, showToast]);

  // Start a fresh conversation. Chat is client-state (unsaved until Save Chat),
  // so this discards the current transcript unless it was saved — the caller warns.
  const newChat = useCallback(() => {
    patch({ msgs: [], activeChatId: null, thinking: false });
    showToast('New chat');
  }, [patch, showToast]);

  // Delete a saved chat. If it's the one currently loaded, keep the transcript
  // in the composer but detach activeChatId — a later Save creates a fresh row
  // rather than trying to update the now-deleted one.
  const deleteChat = useCallback(
    async (id: string) => {
      await apiWorlds.chats.remove(id);
      setS((prev) => ({
        ...prev,
        savedChats: prev.savedChats.filter((c) => c.id !== id),
        activeChatId: prev.activeChatId === id ? null : prev.activeChatId,
      }));
      showToast('Chat deleted');
    },
    [showToast],
  );

  // Load a saved chat into the composer to review / continue it. Re-saving
  // updates that same row (via activeChatId) rather than duplicating it.
  const loadChat = useCallback(
    async (id: string) => {
      const existing = s.savedChats.find((c) => c.id === id);
      const chat = existing ?? (s.worldId ? (await apiWorlds.chats.list(s.worldId)).chats.find((c) => c.id === id) : undefined);
      if (!chat) {
        showToast('Chat not found');
        return;
      }
      patch({
        msgs: chat.messages,
        activeChatId: chat.id,
        mode: chat.mode === 'character' ? 'discuss' : chat.mode,
        character: chat.character_id ?? NARRATOR.id,
        thinking: false,
      });
      showToast('Chat loaded');
    },
    [s.savedChats, s.worldId, patch, showToast],
  );

  // ── world document editing (persisted by Save World) ──
  const editWorldField = useCallback(
    (path: string, value: unknown) => {
      setS((prev) => {
        if (!prev.world) return prev;
        const draft = structuredClone(prev.world);
        setByPath(draft, path, value);
        draft.world.identity.lastModified = new Date().toISOString();
        return { ...prev, world: draft };
      });
    },
    [],
  );

  const addWorldEntity = useCallback(
    (kind: AddableKind) => {
      setS((prev) => {
        if (!prev.world) return prev;
        const { doc, nodeKey } = addEntity(prev.world, kind);
        return { ...prev, world: doc, selectedNode: nodeKey, view: 'world', navMode: 'world' };
      });
      showToast('Added — remember to Save World');
    },
    [showToast],
  );

  const deleteWorldNode = useCallback(
    (key: string) => {
      // Deleting one item from a collective memory list (event/canon/thread/
      // decision): stay on that list node so the user can keep pruning. Deleting a
      // whole node (chapter/scene/character/etc.): deselect and return to the
      // writing view, since the selected node no longer exists.
      const staysInPlace = /^(event|canon|thread|decision):/.test(key);
      setS((prev) => {
        if (!prev.world) return prev;
        return {
          ...prev,
          world: deleteEntity(prev.world, key),
          selectedNode: staysInPlace ? prev.selectedNode : null,
          view: staysInPlace ? prev.view : 'write',
        };
      });
      showToast('Deleted — remember to Save World');
    },
    [showToast],
  );

  const value: StoreApi = {
    ...s,
    cast: castFor(s.world),
    activeChapter,
    setAuthed: (v) => patch({ authed: v }),
    refreshWorlds,
    logout,
    refreshCredentials,
    addCredential,
    removeCredential,
    openWorld,
    newWorld,
    importWorld,
    saveWorld,
    deleteWorld,
    deleteManuscript,
    openUnattached,
    reassignManuscript,
    unattachedCount: s.unattachedList.length,
    openManuscript,
    newManuscript,
    renameManuscript,
    openChapter,
    newChapter,
    renameChapter,
    deleteChapter,
    setChapterText,
    saveDraft,
    setFormat,
    selectNode: (key) => patch({ selectedNode: key, view: key ? 'world' : 'write' }),
    goWrite: () => patch({ view: 'write', selectedNode: null }),
    setNavMode: (m) => patch({ navMode: m }),
    editWorldField,
    addWorldEntity,
    deleteWorldNode,
    setAccent,
    setProseTypeface: (t) => patch({ proseTypeface: t }),
    setCharacter: (id) => patch({ character: id }),
    setMode: (m) => patch({ mode: m }),
    setCfg: (mode, key, val) =>
      setS((prev) => ({ ...prev, cfg: { ...prev.cfg, [mode]: { ...prev.cfg[mode], [key]: val } } })),
    setResearch: (on) => patch({ research: on }),
    send: runGenerate,
    insertProse,
    acceptSuggestion,
    rejectSuggestion,
    saveChat,
    newChat,
    loadChat,
    deleteChat,
    refreshSavedChats,
    showToast,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
