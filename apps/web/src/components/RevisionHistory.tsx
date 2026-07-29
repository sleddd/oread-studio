/**
 * Chapter revision history popover. Every prose write snapshots the PREVIOUS
 * content first, so this list is the chapter's full history, newest first.
 *
 * Reasons carry different weight and are labelled accordingly:
 *  - manual      an explicit Save Draft (or the auto-snapshot taken before a
 *                restore) — a deliberate draft point, never pruned
 *  - pre_ai_*    the text as it stood immediately before an AI-applied change
 *  - autosave    a debounced typing checkpoint; prunable after N days
 *
 * Selecting a revision previews it read-only; Restore writes it back as the live
 * prose (the replaced version is itself snapshotted first, so restore is undoable).
 */
import { useEffect, useState } from 'react';
import { useStore } from '../state/store.js';
import type { ChapterRevisionRow, RevisionReason } from '@oread/shared';

const REASON_LABEL: Record<RevisionReason, string> = {
  manual: 'Draft point',
  pre_ai_edit: 'Before AI edit',
  pre_ai_draft: 'Before AI draft',
  autosave: 'Autosave',
};

/** Draft points and pre-AI snapshots are the ones worth spotting in a long list. */
const REASON_COLOR: Record<RevisionReason, string> = {
  manual: 'var(--accent,#2e9d9d)',
  pre_ai_edit: '#c98a4b',
  pre_ai_draft: '#c98a4b',
  autosave: '#6d7473',
};

/** "just now" / "3h ago" / "Jul 15, 2:04 PM" from an ISO timestamp. */
function relTime(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(then).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function RevisionHistory({ onClose }: { onClose: () => void }): JSX.Element {
  const store = useStore();
  const [revisions, setRevisions] = useState<ChapterRevisionRow[] | null>(null);
  const [selected, setSelected] = useState<ChapterRevisionRow | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void store.listRevisions().then((rs) => {
      if (live) setRevisions(rs);
    });
    return () => {
      live = false;
    };
  }, [store]);

  const restore = async (r: ChapterRevisionRow) => {
    if (
      !confirm(
        `Restore this ${REASON_LABEL[r.reason].toLowerCase()} from ${relTime(r.created_at)}?\n\n` +
          'The current text is saved to history first, so you can undo this.',
      )
    ) {
      return;
    }
    setBusy(true);
    await store.restoreRevision(r.id);
    setBusy(false);
    onClose();
  };

  return (
    <>
      {/* click-away backdrop */}
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
      <div
        style={{
          position: 'absolute',
          top: '100%',
          right: 16,
          marginTop: -6,
          width: selected ? 560 : 320,
          maxHeight: 420,
          display: 'flex',
          zIndex: 41,
          background: '#141818',
          border: '1px solid #262b2b',
          borderRadius: 12,
          boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
          overflow: 'hidden',
        }}
      >
        {/* ── list ── */}
        <div style={{ width: 320, flex: '0 0 auto', overflowY: 'auto', padding: 6 }}>
          <div
            style={{
              fontSize: 11,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: '#6d7473',
              fontWeight: 700,
              padding: '6px 8px 8px',
            }}
          >
            Revision History
          </div>

          {revisions === null ? (
            <div style={{ fontSize: 12.5, color: '#6d7473', padding: '4px 8px 10px' }}>Loading…</div>
          ) : revisions.length === 0 ? (
            <div
              style={{ fontSize: 12.5, color: '#6d7473', padding: '4px 8px 10px', lineHeight: 1.5 }}
            >
              No revisions yet. A version is kept every time this chapter is saved — as you type,
              on Save Draft, and before any AI change.
            </div>
          ) : (
            revisions.map((r) => {
              const active = selected?.id === r.id;
              return (
                <button
                  key={r.id}
                  onClick={() => setSelected(active ? null : r)}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    borderRadius: 9,
                    border: '1px solid transparent',
                    background: active ? 'rgba(46,157,157,0.12)' : 'transparent',
                    padding: '8px 9px',
                    marginBottom: 2,
                    cursor: 'pointer',
                  }}
                >
                  <div
                    style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 3 }}
                  >
                    <span
                      style={{
                        fontSize: 12.5,
                        fontWeight: 700,
                        color: REASON_COLOR[r.reason] ?? '#6d7473',
                      }}
                    >
                      {REASON_LABEL[r.reason] ?? r.reason}
                    </span>
                    <span style={{ fontSize: 11.5, color: '#6d7473', marginLeft: 'auto' }}>
                      {relTime(r.created_at)}
                    </span>
                  </div>
                  <div style={{ fontSize: 11.5, color: '#6d7473' }}>
                    {r.word_count.toLocaleString()} word{r.word_count === 1 ? '' : 's'}
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* ── preview of the selected revision ── */}
        {selected && (
          <div
            style={{
              flex: '1 1 auto',
              minWidth: 0,
              borderLeft: '1px solid #232929',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div
              style={{
                flex: '1 1 auto',
                overflowY: 'auto',
                padding: '12px 14px',
                fontSize: 13,
                lineHeight: 1.65,
                color: '#c9cdcb',
                whiteSpace: 'pre-wrap',
                fontFamily: "'Newsreader',serif",
              }}
            >
              {selected.content.trim() || '(this version was empty)'}
            </div>
            <div
              style={{
                flex: '0 0 auto',
                borderTop: '1px solid #232929',
                padding: 10,
                display: 'flex',
                justifyContent: 'flex-end',
              }}
            >
              <button
                onClick={() => void restore(selected)}
                disabled={busy}
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: '#04201f',
                  background: 'var(--accent,#2e9d9d)',
                  borderRadius: 8,
                  padding: '7px 14px',
                  opacity: busy ? 0.5 : 1,
                  cursor: busy ? 'default' : 'pointer',
                }}
              >
                {busy ? 'Restoring…' : 'Restore this version'}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
