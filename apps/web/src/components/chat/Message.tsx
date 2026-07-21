import type { ChatMessage } from '@oread/shared';
import { useStore } from '../../state/store.js';
import { suggestionColors } from '../../theme/tokens.js';
import { NARRATOR } from '../../state/cast.js';

/**
 * Citation URLs come from web-search results (attacker-influenceable). Only
 * allow http(s) into an href — a `javascript:`/`data:` URL in a citation would
 * otherwise be a one-click XSS. Returns the safe URL or null (render inert).
 */
function safeHttpUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

export function MessageItem({ m }: { m: ChatMessage }): JSX.Element {
  const store = useStore();
  const cast = store.cast.find((c) => c.id === m.char) ?? NARRATOR;

  if (m.role === 'user') {
    return (
      <div style={{ alignSelf: 'flex-end', maxWidth: '86%' }}>
        <div
          style={{
            background: 'var(--accent,#2e9d9d)',
            color: '#04201f',
            borderRadius: '16px 16px 4px 16px',
            padding: '11px 15px',
            fontSize: 14.5,
            lineHeight: 1.5,
            fontWeight: 500,
          }}
        >
          {m.text}
        </div>
        <div style={{ textAlign: 'right', fontSize: 10.5, color: '#4f5655', marginTop: 4 }}>{m.time}</div>
      </div>
    );
  }

  const avatarHeader = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
      <span
        style={{
          width: 22,
          height: 22,
          borderRadius: '50%',
          background: '#1a1f1f',
          border: '1.5px solid var(--accent,#2e9d9d)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 9.5,
          fontWeight: 700,
          color: '#cfe',
        }}
      >
        {cast.initials}
      </span>
      <span style={{ fontSize: 12.5, fontWeight: 600, color: '#9aa19f' }}>{cast.name}</span>
      <span style={{ fontSize: 10.5, color: '#4f5655' }}>{m.time}</span>
    </div>
  );

  if (m.kind === 'suggestion' && m.sug) {
    const sug = m.sug;
    const sm = suggestionColors[sug.type] ?? { c: '#8b918f', b: 'rgba(139,145,143,0.14)' };
    const pending = m.status === 'pending' || !m.status;
    return (
      <div style={{ alignSelf: 'flex-start', width: '100%' }}>
        {avatarHeader}
        <div style={{ background: '#14181a', border: '1px solid #233332', borderRadius: 12, overflow: 'hidden' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '9px 13px',
              borderBottom: '1px solid #1c2626',
              background: '#111617',
            }}
          >
            <span
              style={{
                fontSize: 10,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                fontWeight: 700,
                color: sm.c,
                background: sm.b,
                borderRadius: 5,
                padding: '2px 7px',
              }}
            >
              {sug.type}
            </span>
            <span style={{ fontSize: 11.5, color: '#6d7473', fontFamily: 'monospace' }}>
              {sug.target || 'target'}
            </span>
          </div>
          <div style={{ padding: '12px 13px' }}>
            {sug.original && (
              <div
                style={{
                  fontSize: 13.5,
                  lineHeight: 1.55,
                  color: '#8b918f',
                  textDecoration: 'line-through',
                  textDecorationColor: '#5a3535',
                  fontFamily: "'Newsreader',serif",
                  marginBottom: 9,
                }}
              >
                {sug.original}
              </div>
            )}
            {sug.proposed && (
              <div
                style={{
                  fontSize: 14.5,
                  lineHeight: 1.6,
                  color: '#e6e9e7',
                  fontFamily: "'Newsreader',serif",
                  borderLeft: '2px solid var(--accent,#2e9d9d)',
                  paddingLeft: 11,
                }}
              >
                {sug.proposed}
              </div>
            )}
            <div style={{ fontSize: 12.5, color: '#7d8382', marginTop: 11, fontStyle: 'italic' }}>
              {sug.rationale}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, padding: '0 13px 13px' }}>
            {pending ? (
              <>
                <button
                  onClick={() => void store.acceptSuggestion(m.id, store.mode === 'edit' && !!sug.proposed)}
                  style={{
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: '#04201f',
                    background: 'var(--accent,#2e9d9d)',
                    borderRadius: 8,
                    padding: '6px 13px',
                  }}
                >
                  {store.mode === 'edit' && sug.proposed ? 'Apply redline' : 'Accept'}
                </button>
                <button
                  onClick={() => store.rejectSuggestion(m.id)}
                  style={{
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: '#9aa19f',
                    border: '1px solid #262b2b',
                    borderRadius: 8,
                    padding: '6px 13px',
                  }}
                >
                  Reject
                </button>
              </>
            ) : (
              <span
                style={{
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: m.status === 'accepted' ? 'var(--accent,#2e9d9d)' : '#8b918f',
                  padding: '6px 0',
                }}
              >
                {m.status === 'accepted' ? '✓ Accepted' : 'Rejected'}
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  // prose / plain bubble
  const isProse = m.kind === 'prose';
  return (
    <div style={{ alignSelf: 'flex-start', maxWidth: '92%' }}>
      {avatarHeader}
      <div
        style={{
          background: '#1a1f1f',
          border: '1px solid #232929',
          borderRadius: '4px 16px 16px 16px',
          padding: '13px 16px',
          fontSize: isProse ? 15.5 : 14.5,
          lineHeight: 1.62,
          color: '#dfe3e1',
          fontFamily: isProse ? "'Newsreader', Georgia, serif" : "'Manrope', sans-serif",
          whiteSpace: 'pre-wrap',
        }}
      >
        {m.text}
      </div>
      {m.citations && m.citations.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div
            style={{
              fontSize: 10,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              fontWeight: 700,
              color: '#6d7473',
              marginBottom: 6,
            }}
          >
            Sources
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {m.citations.map((cite, i) => {
              const href = safeHttpUrl(cite.url);
              const label = `${i + 1}. ${cite.title}`;
              const base = {
                fontSize: 12,
                color: 'var(--accent,#2e9d9d)',
                textDecoration: 'none',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap' as const,
              };
              // Non-http(s) URLs (e.g. javascript:) are rendered as inert text.
              return href ? (
                <a
                  key={cite.url}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={href}
                  style={base}
                >
                  {label}
                </a>
              ) : (
                <span key={cite.url} title={cite.url} style={{ ...base, color: '#6d7473' }}>
                  {label}
                </span>
              );
            })}
          </div>
        </div>
      )}
      {isProse && (
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button
            onClick={() => void store.insertProse(m.text ?? '')}
            style={{
              fontSize: 12.5,
              fontWeight: 600,
              color: '#04201f',
              background: 'var(--accent,#2e9d9d)',
              borderRadius: 8,
              padding: '6px 12px',
            }}
          >
            Insert into manuscript
          </button>
          <button
            onClick={() => {
              void navigator.clipboard.writeText(m.text ?? '');
              store.showToast('Copied');
            }}
            style={{
              fontSize: 12.5,
              fontWeight: 600,
              color: '#9aa19f',
              border: '1px solid #262b2b',
              borderRadius: 8,
              padding: '6px 12px',
            }}
          >
            Copy
          </button>
        </div>
      )}
    </div>
  );
}
