import { useStore } from '../state/store.js';
import { ACCENTS } from '../theme/tokens.js';
import { WRITING_FORMATS } from '@oread/shared';
import type { ProseTypeface } from '@oread/shared';
import type { WritingFormat } from '@oread/shared';

const TYPEFACES: ProseTypeface[] = ['Serif', 'Sans', 'Monospace'];

export function SettingsPopover({ onClose: _onClose }: { onClose: () => void }): JSX.Element {
  const store = useStore();
  const label = {
    fontSize: 11,
    letterSpacing: '0.14em',
    textTransform: 'uppercase' as const,
    color: '#6d7473',
    fontWeight: 700,
    marginBottom: 10,
  };
  return (
    <div
      style={{
        position: 'absolute',
        top: 'calc(100% + 10px)',
        right: 0,
        width: 300,
        background: '#141818',
        border: '1px solid #262b2b',
        borderRadius: 14,
        boxShadow: '0 18px 50px rgba(0,0,0,0.55)',
        padding: '16px 16px 18px',
        zIndex: 60,
        animation: 'om-up .16s ease',
      }}
    >
      <div style={label}>Accent</div>
      <div style={{ display: 'flex', gap: 9, marginBottom: 20 }}>
        {ACCENTS.map((a) => {
          const active = store.accent === a.hex;
          return (
            <button
              key={a.hex}
              title={a.name}
              onClick={() => store.setAccent(a.hex)}
              style={{
                width: 54,
                height: 44,
                borderRadius: 9,
                background: a.hex,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: active ? `0 0 0 2px #141818, 0 0 0 4px ${a.hex}` : undefined,
                border: active ? undefined : '1px solid rgba(255,255,255,0.08)',
              }}
            >
              {active && <span style={{ color: '#fff', fontSize: 14, fontWeight: 800 }}>✓</span>}
            </button>
          );
        })}
      </div>

      <div style={label}>Prose typeface</div>
      <div
        style={{
          display: 'flex',
          gap: 5,
          background: '#0f1212',
          border: '1px solid #1c2121',
          borderRadius: 10,
          padding: 4,
          marginBottom: 20,
        }}
      >
        {TYPEFACES.map((t) => {
          const active = store.proseTypeface === t;
          return (
            <button
              key={t}
              onClick={() => store.setProseTypeface(t)}
              style={{
                flex: 1,
                padding: '8px 4px',
                borderRadius: 7,
                fontSize: 12.5,
                fontWeight: 600,
                background: active ? 'var(--accent,#2e9d9d)' : 'transparent',
                color: active ? '#04201f' : '#7d8382',
              }}
            >
              {t}
            </button>
          );
        })}
      </div>

      <div style={label}>Writing format</div>
      <select
        value={store.format}
        onChange={(e) => store.setFormat(e.target.value as WritingFormat)}
        style={{
          width: '100%',
          background: '#0f1212',
          border: '1px solid #262b2b',
          borderRadius: 9,
          color: '#e9ecea',
          fontSize: 14,
          fontWeight: 600,
          padding: '10px 12px',
        }}
      >
        {WRITING_FORMATS.map((f) => (
          <option key={f.value} value={f.value}>
            {f.label}
          </option>
        ))}
      </select>
    </div>
  );
}
