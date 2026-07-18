/**
 * Debounced chapter-prose autosave — the ONLY autosaving writer in Oread.
 * Buffers writes with retry so transient failures survive (deploys are
 * zero-downtime but the queue must be resilient). Exposes a flush() so Switch
 * World / Switch Manuscript can force-persist before tearing down.
 */
import { useEffect, useRef, useCallback } from 'react';
import { chapters } from '../api/index.js';

export interface AutosaveController {
  queue: (chapterRowId: string, content: string) => void;
  flush: () => Promise<void>;
}

const DEBOUNCE_MS = 2500;
const RETRY_MS = 4000;

export function useAutosave(
  onSaved?: (chapterRowId: string) => void,
  onError?: (e: unknown) => void,
): AutosaveController {
  // pending[chapterRowId] = latest content awaiting write
  const pending = useRef<Map<string, string>>(new Map());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const writeAll = useCallback(async () => {
    const entries = [...pending.current.entries()];
    for (const [cid, content] of entries) {
      try {
        await chapters.saveContent(cid, content);
        // Only clear if unchanged since we started writing.
        if (pending.current.get(cid) === content) pending.current.delete(cid);
        onSaved?.(cid);
      } catch (e) {
        onError?.(e);
        // leave it in the queue; schedule a retry
        if (!timer.current) {
          timer.current = setTimeout(() => {
            timer.current = null;
            void writeAll();
          }, RETRY_MS);
        }
      }
    }
  }, [onSaved, onError]);

  const queue = useCallback(
    (chapterRowId: string, content: string) => {
      pending.current.set(chapterRowId, content);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        void writeAll();
      }, DEBOUNCE_MS);
    },
    [writeAll],
  );

  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    await writeAll();
  }, [writeAll]);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return { queue, flush };
}
