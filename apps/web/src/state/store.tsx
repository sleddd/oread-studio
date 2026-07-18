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
  WritingFormat,
  Suggestion,
  PersistedChatMode,
} from '@oread/shared';
import { countWords } from '@oread/shared';
import * as apiWorlds from '../api/index.js';
import { streamGenerate } from '../api/streaming.js';
import { applyAccent } from '../theme/tokens.js';
import { useAutosave } from './useAutosave.js';
import { DEFAULT_CFG, type ModeCfg } from './modes.js';
import { castFor, NARRATOR, type CastMember } from './cast.js';
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

export type NavMode = 'outline' | 'world';
export type CenterView = 'write' | 'world';

interface StoreState {
  // account
  authed: boolean;
  // world runtime (one open at a time)
  worldList: WorldSummary[];
  worldId: string | null;
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
  // chat client-state (unsaved until Save Chat)
  character: string;
  mode: ChatMode;
  cfg: ModeCfg;
  msgs: ChatMessage[];
  thinking: boolean;
  toast: string | null;
}

export interface StoreApi extends StoreState {
  cast: CastMember[];
  activeChapter: ChapterRow | null;
  // account
  setAuthed: (v: boolean) => void;
  refreshWorlds: () => Promise<void>;
  // world switching (flush autosave first)
  openWorld: (id: string) => Promise<void>;
  newWorld: () => Promise<void>;
  saveWorld: () => Promise<void>;
  // manuscript / chapter
  openManuscript: (mid: string) => Promise<void>;
  newManuscript: () => Promise<void>;
  openChapter: (cid: string) => void;
  newChapter: () => Promise<void>;
  setChapterText: (text: string) => void;
  setFormat: (f: WritingFormat) => void;
  // world detail
  selectNode: (key: string | null) => void;
  goWrite: () => void;
  setNavMode: (m: NavMode) => void;
  // settings
  setAccent: (hex: string) => void;
  setProseTypeface: (t: ProseTypeface) => void;
  // chat
  setCharacter: (id: string) => void;
  setMode: (m: ChatMode) => void;
  setCfg: (mode: ChatMode, key: string, value: string) => void;
  send: (text: string) => Promise<void>;
  insertProse: (text: string) => Promise<void>;
  acceptSuggestion: (msgId: number | string, apply: boolean) => Promise<void>;
  rejectSuggestion: (msgId: number | string) => void;
  saveChat: () => Promise<void>;
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
    character: 'narrator',
    mode: 'cowrite',
    cfg: DEFAULT_CFG,
    msgs: [],
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

  const refreshWorlds = useCallback(async () => {
    const { worlds } = await apiWorlds.worlds.list();
    patch({ worldList: worlds });
  }, [patch]);

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
      const chs = firstMs ? await loadManuscriptChapters(id, firstMs.id) : [];
      patch({
        worldId: id,
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

  const saveWorld = useCallback(async () => {
    if (!s.worldId || !s.world) return;
    await apiWorlds.worlds.save(s.worldId, s.world);
    showToast('World saved');
  }, [s.worldId, s.world, showToast]);

  const openManuscript = useCallback(
    async (mid: string) => {
      if (!s.worldId) return;
      await autosave.flush();
      const chs = await loadManuscriptChapters(s.worldId, mid);
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

  const newManuscript = useCallback(async () => {
    if (!s.worldId) return;
    await autosave.flush();
    const { manuscript } = await apiWorlds.manuscripts.create(s.worldId, {
      name: 'Untitled Manuscript',
      format: 'novel',
    });
    const { manuscripts } = await apiWorlds.manuscripts.list(s.worldId);
    patch({ manuscriptsList: manuscripts });
    await openManuscript(manuscript.id);
    showToast('New manuscript created');
  }, [s.worldId, autosave, openManuscript, patch, showToast]);

  const openChapter = useCallback(
    (cid: string) => patch({ chapterRowId: cid, view: 'write', selectedNode: null }),
    [patch],
  );

  const newChapter = useCallback(async () => {
    if (!s.worldId || !s.manuscriptId) return;
    const chapterId = `ch_${nextId()}`;
    const { chapter } = await apiWorlds.chapters.create(s.worldId, s.manuscriptId, {
      chapterId,
      status: 'outline',
    });
    const chs = await loadManuscriptChapters(s.worldId, s.manuscriptId);
    patch({ chaptersList: chs, chapterRowId: chapter.id, view: 'write', selectedNode: null });
    showToast('Chapter added');
  }, [s.worldId, s.manuscriptId, loadManuscriptChapters, patch, showToast]);

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
          assistant = { ...base, kind: done.kind === 'prose' ? 'prose' : 'text', text: done.text };
        }
        setS((prev) => ({ ...prev, msgs: [...prev.msgs, assistant], thinking: false }));
      } catch (e) {
        setS((prev) => ({ ...prev, thinking: false }));
        showToast(e instanceof Error ? e.message : 'generation failed');
      }
    },
    [s.worldId, s.mode, s.character, s.msgs, s.chapterRowId, showToast],
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

  const saveChat = useCallback(async () => {
    if (!s.worldId || s.msgs.length === 0) {
      showToast('Nothing to save yet');
      return;
    }
    const mode: PersistedChatMode =
      s.mode === 'discuss' && s.character !== NARRATOR.id ? 'character' : s.mode;
    const { newEvents } = await apiWorlds.chats.save({
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
    showToast(newEvents > 0 ? `Chat saved · ${newEvents} memory event(s)` : 'Chat saved');
  }, [s.worldId, s.msgs, s.mode, s.character, activeChapter, patch, showToast]);

  const value: StoreApi = {
    ...s,
    cast: castFor(s.world),
    activeChapter,
    setAuthed: (v) => patch({ authed: v }),
    refreshWorlds,
    openWorld,
    newWorld,
    saveWorld,
    openManuscript,
    newManuscript,
    openChapter,
    newChapter,
    setChapterText,
    setFormat,
    selectNode: (key) => patch({ selectedNode: key, view: key ? 'world' : 'write' }),
    goWrite: () => patch({ view: 'write', selectedNode: null }),
    setNavMode: (m) => patch({ navMode: m }),
    setAccent,
    setProseTypeface: (t) => patch({ proseTypeface: t }),
    setCharacter: (id) => patch({ character: id }),
    setMode: (m) => patch({ mode: m }),
    setCfg: (mode, key, val) =>
      setS((prev) => ({ ...prev, cfg: { ...prev.cfg, [mode]: { ...prev.cfg[mode], [key]: val } } })),
    send: runGenerate,
    insertProse,
    acceptSuggestion,
    rejectSuggestion,
    saveChat,
    showToast,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
