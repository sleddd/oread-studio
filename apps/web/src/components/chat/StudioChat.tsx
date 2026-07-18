import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../state/store.js';
import { MODES, CFG_DEFS, modeAction, composerPlaceholder } from '../../state/modes.js';
import { MessageItem } from './Message.js';

export function StudioChat({ onCollapse }: { onCollapse: () => void }): JSX.Element {
  const store = useStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState('');

  // Auto-scroll to bottom on new messages / thinking — set scrollTop directly
  // (NOT scrollIntoView), per the prototype.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) requestAnimationFrame(() => (el.scrollTop = el.scrollHeight));
  }, [store.msgs, store.thinking]);

  const activeChar = store.cast.find((c) => c.id === store.character) ?? store.cast[store.cast.length - 1]!;
  const activeMode = MODES.find((m) => m.key === store.mode)!;
  // Web research is offered only in Discuss and Draft (mirrors server contract).
  const canResearch = store.mode === 'discuss' || store.mode === 'draft';
  const chapterTitle =
    store.world?.world.structure.chapters.find((c) => c.id === store.activeChapter?.chapter_id)?.title ??
    'this chapter';
  const action = modeAction(store.mode, store.cfg, chapterTitle);

  const doSend = () => {
    const t = input.trim();
    if (!t) return;
    setInput('');
    void store.send(t);
  };

  return (
    <aside
      style={{
        width: 392,
        flex: '0 0 auto',
        borderLeft: '1px solid #1c2020',
        background: '#101313',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      {/* header */}
      <div style={{ flex: '0 0 auto', padding: '14px 16px 12px', borderBottom: '1px solid #1a1e1e' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <span
            style={{
              fontSize: 12,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: '#7d8382',
              fontWeight: 700,
            }}
          >
            Studio
          </span>
          <button onClick={onCollapse} title="Collapse" style={{ color: '#5f6664', fontSize: 15, padding: '2px 6px' }}>
            ›
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {store.cast.map((c) => {
            const active = store.character === c.id;
            return (
              <button
                key={c.id}
                onClick={() => store.setCharacter(c.id)}
                title={c.name}
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: '50%',
                  fontSize: 13,
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all .15s',
                  background: active ? 'var(--accent,#2e9d9d)' : '#1a1f1f',
                  color: active ? '#04201f' : '#8b918f',
                  boxShadow: active ? '0 0 0 2px #101313, 0 0 0 4px var(--accent,#2e9d9d)' : undefined,
                  border: active ? undefined : '1.5px solid #2a3030',
                }}
              >
                {c.initials}
              </button>
            );
          })}
          <div style={{ marginLeft: 4, minWidth: 0 }}>
            <div style={{ fontSize: 14.5, fontWeight: 700, color: '#e9ecea' }}>{activeChar.name}</div>
            <div style={{ fontSize: 12, color: '#6d7473' }}>{activeChar.role}</div>
          </div>
        </div>
      </div>

      {/* mode pills + config */}
      <div style={{ flex: '0 0 auto', padding: '12px 14px 10px', borderBottom: '1px solid #1a1e1e' }}>
        <div
          style={{
            display: 'flex',
            gap: 5,
            background: '#0f1212',
            border: '1px solid #1c2121',
            borderRadius: 11,
            padding: 4,
          }}
        >
          {MODES.map((m) => {
            const active = store.mode === m.key;
            return (
              <button
                key={m.key}
                onClick={() => store.setMode(m.key)}
                style={{
                  flex: 1,
                  padding: '8px 4px',
                  borderRadius: 8,
                  fontSize: 12.5,
                  fontWeight: 600,
                  transition: 'all .12s',
                  background: active ? 'var(--accent,#2e9d9d)' : 'transparent',
                  color: active ? '#04201f' : '#7d8382',
                }}
              >
                {m.label}
              </button>
            );
          })}
        </div>
        <div style={{ fontSize: 12.5, color: '#7d8382', lineHeight: 1.4, marginTop: 10, padding: '0 2px' }}>
          {activeMode.hint}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 11 }}>
          {CFG_DEFS[store.mode].map((d) => (
            <label
              key={d.key}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                background: '#141818',
                border: '1px solid #1e2323',
                borderRadius: 8,
                padding: '5px 9px',
              }}
            >
              <span style={{ fontSize: 11, color: '#6d7473', letterSpacing: '0.02em' }}>{d.label}</span>
              <select
                value={store.cfg[store.mode][d.key]}
                onChange={(e) => store.setCfg(store.mode, d.key, e.target.value)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: 'var(--accent,#2e9d9d)',
                  padding: '0 20px 0 0',
                }}
              >
                {d.options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </div>

      {/* messages */}
      <div
        ref={scrollRef}
        style={{
          flex: '1 1 auto',
          overflowY: 'auto',
          padding: '20px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        {store.msgs.map((m) => (
          <MessageItem key={m.id} m={m} />
        ))}
        {store.thinking && (
          <div style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 8 }}>
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
              {activeChar.initials}
            </span>
            <div
              style={{
                background: '#1a1f1f',
                border: '1px solid #232929',
                borderRadius: 14,
                padding: '11px 15px',
                display: 'flex',
                gap: 5,
              }}
            >
              <Dot delay="0s" />
              <Dot delay="0.2s" />
              <Dot delay="0.4s" />
            </div>
          </div>
        )}
      </div>

      {/* composer */}
      <div style={{ flex: '0 0 auto', borderTop: '1px solid #1a1e1e', padding: '12px 14px 14px' }}>
        {action && (
          <>
            <button
              onClick={() => void store.send(action.prompt)}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 9,
                background: 'var(--accent,#2e9d9d)',
                color: '#04201f',
                fontSize: 13.5,
                fontWeight: 700,
                borderRadius: 11,
                padding: '11px 14px',
                marginBottom: 9,
              }}
            >
              <span style={{ fontSize: 14 }}>{action.icon}</span>
              {action.label}
            </button>
            <div style={{ fontSize: 11.5, color: '#5f6664', textAlign: 'center', marginBottom: 11 }}>
              {action.sub}
            </div>
          </>
        )}
        <div style={{ background: '#141818', border: '1px solid #232929', borderRadius: 14, padding: '10px 12px' }}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                doSend();
              }
            }}
            rows={4}
            placeholder={composerPlaceholder(store.mode, activeChar.name)}
            style={{
              width: '100%',
              minHeight: 88,
              resize: 'vertical',
              background: 'transparent',
              border: 'none',
              fontSize: 14.5,
              lineHeight: 1.5,
              color: '#e9ecea',
            }}
          />
          {/* action row: Research toggle (left) · Clear / Save Chat / Send (right) */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              marginTop: 6,
            }}
          >
            {canResearch ? (
              <button
                onClick={() => store.setResearch(!store.research)}
                title={
                  store.research
                    ? 'Web research on — the AI may search for real facts and cite them'
                    : 'Web research off'
                }
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  flex: '0 0 auto',
                  fontSize: 11,
                  fontWeight: 600,
                  borderRadius: 8,
                  padding: '4px 8px',
                  background: store.research ? 'var(--accent,#2e9d9d)' : '#141818',
                  color: store.research ? '#04201f' : '#7d8382',
                  border: store.research ? undefined : '1px solid #262b2b',
                }}
              >
                <span style={{ fontSize: 12 }}>🔎</span>
                Research
              </button>
            ) : (
              <span />
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => {
                  if (store.msgs.length === 0) return;
                  if (confirm('Clear this conversation? Unsaved messages are discarded. Use Save Chat first to keep them.')) {
                    store.clearChat();
                  }
                }}
                disabled={store.msgs.length === 0}
                title="Start a fresh chat"
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: store.msgs.length === 0 ? '#4f5655' : '#9aa19f',
                  border: '1px solid #262b2b',
                  borderRadius: 9,
                  padding: '5px 11px',
                  cursor: store.msgs.length === 0 ? 'default' : 'pointer',
                }}
              >
                Clear
              </button>
              <button
                onClick={() => void store.saveChat()}
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: '#9aa19f',
                  border: '1px solid #262b2b',
                  borderRadius: 9,
                  padding: '5px 11px',
                }}
              >
                Save Chat
              </button>
              <button
                onClick={doSend}
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: '#04201f',
                  background: 'var(--accent,#2e9d9d)',
                  borderRadius: 9,
                  padding: '5px 15px',
                }}
              >
                Send
              </button>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}

function Dot({ delay }: { delay: string }): JSX.Element {
  return (
    <span
      style={{
        width: 6,
        height: 6,
        borderRadius: '50%',
        background: '#6d7473',
        animation: `om-dot 1.2s infinite ${delay}`,
      }}
    />
  );
}

export function ChatRail({ onExpand }: { onExpand: () => void }): JSX.Element {
  return (
    <button
      onClick={onExpand}
      style={{
        width: 44,
        flex: '0 0 auto',
        borderLeft: '1px solid #1c2020',
        background: '#101313',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 14,
        color: '#8b918f',
      }}
    >
      <span style={{ fontSize: 16 }}>‹</span>
      <span
        style={{
          writingMode: 'vertical-rl',
          transform: 'rotate(180deg)',
          fontSize: 12,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          fontWeight: 700,
        }}
      >
        Studio
      </span>
    </button>
  );
}
