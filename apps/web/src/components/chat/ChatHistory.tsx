/**
 * Saved-chats dropdown for the current world. Picking a chat loads its
 * transcript into the composer (review / continue) — re-saving updates that
 * same row rather than duplicating it. Rendered as a popover under the
 * Studio header's "History" button.
 */
import { useStore } from '../../state/store.js';
import { MODES } from '../../state/modes.js';
import { NARRATOR } from '../../state/cast.js';
import type { ChatRow } from '@oread/shared';

const MODE_LABEL: Record<string, string> = {
  ...Object.fromEntries(MODES.map((m) => [m.key, m.label])),
  character: 'In-character',
};

/** "just now" / "3h ago" / "Jul 15" from an ISO timestamp. */
function relTime(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const d = new Date(then);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function ChatHistory({
  chats,
  activeChatId,
  onPick,
  onDelete,
  onClose,
}: {
  chats: ChatRow[];
  activeChatId: string | null;
  onPick: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}): JSX.Element {
  const store = useStore();

  const charName = (id: string | null): string | null => {
    if (!id || id === NARRATOR.id) return null;
    return store.cast.find((c) => c.id === id)?.name ?? id;
  };

  return (
    <>
      {/* click-away backdrop */}
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, zIndex: 40 }}
      />
      <div
        style={{
          position: 'absolute',
          top: '100%',
          right: 16,
          marginTop: -6,
          width: 300,
          maxHeight: 360,
          overflowY: 'auto',
          zIndex: 41,
          background: '#141818',
          border: '1px solid #262b2b',
          borderRadius: 12,
          boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
          padding: 6,
        }}
      >
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
          Saved Chats
        </div>
        {chats.length === 0 ? (
          <div style={{ fontSize: 12.5, color: '#6d7473', padding: '4px 8px 10px', lineHeight: 1.5 }}>
            No saved chats yet. Use Save Chat to keep a conversation here.
          </div>
        ) : (
          chats.map((c) => {
            const active = c.id === activeChatId;
            const who = charName(c.character_id);
            const label = c.title || MODE_LABEL[c.mode] || c.mode;
            return (
              <div
                key={c.id}
                style={{
                  display: 'flex',
                  alignItems: 'stretch',
                  gap: 2,
                  background: active ? '#1c2222' : 'transparent',
                  border: active ? '1px solid var(--accent,#2e9d9d)' : '1px solid transparent',
                  borderRadius: 9,
                  marginBottom: 2,
                }}
              >
                <button
                  onClick={() => onPick(c.id)}
                  style={{
                    flex: '1 1 auto',
                    minWidth: 0,
                    textAlign: 'left',
                    background: 'transparent',
                    border: 'none',
                    borderRadius: 9,
                    padding: '8px 10px',
                    cursor: 'pointer',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'baseline',
                      justifyContent: 'space-between',
                      gap: 8,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 13.5,
                        fontWeight: 600,
                        color: active ? 'var(--accent,#2e9d9d)' : '#e9ecea',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {label}
                    </span>
                    <span style={{ fontSize: 11, color: '#5f6664', flex: '0 0 auto' }}>
                      {relTime(c.saved_at)}
                    </span>
                  </div>
                  <div style={{ fontSize: 11.5, color: '#6d7473', marginTop: 3 }}>
                    {who ? `${who} · ` : ''}
                    {c.messages.length} message{c.messages.length === 1 ? '' : 's'}
                    {c.distilled ? ' · distilled' : ''}
                  </div>
                </button>
                <button
                  onClick={() => {
                    if (confirm(`Delete "${label}"? This can't be undone.`)) onDelete(c.id);
                  }}
                  title="Delete this chat"
                  style={{
                    flex: '0 0 auto',
                    alignSelf: 'center',
                    color: '#6d7473',
                    fontSize: 13,
                    padding: '6px 10px',
                    borderRadius: 8,
                    cursor: 'pointer',
                  }}
                >
                  🗑
                </button>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}
