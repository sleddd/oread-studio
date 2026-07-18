import { useState } from 'react';
import { useStore } from '../state/store.js';
import { SettingsPopover } from './SettingsPopover.js';
import { WorldPicker } from './WorldPicker.js';

export function Header(): JSX.Element {
  const store = useStore();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [worldPickerOpen, setWorldPickerOpen] = useState(false);

  const worldName = store.world?.world.identity.name ?? '—';

  return (
    <>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 26px',
          borderBottom: '1px solid #1c2020',
          flex: '0 0 auto',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: 'var(--accent,#2e9d9d)',
              boxShadow: '0 0 10px var(--accent,#2e9d9d)',
            }}
          />
          <div
            style={{
              fontWeight: 600,
              fontSize: 19,
              letterSpacing: '0.36em',
              color: '#f3f5f4',
              paddingLeft: 2,
            }}
          >
            OREAD
          </div>
          <div style={{ width: 1, height: 20, background: '#262b2b', margin: '0 6px' }} />
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setWorldPickerOpen((v) => !v)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 13,
                color: '#aeb4b2',
                padding: '4px 6px',
                borderRadius: 7,
              }}
            >
              <span style={{ letterSpacing: '0.02em' }}>{worldName}</span>
              <span style={{ fontSize: 9, color: '#5f6664' }}>▼</span>
            </button>
            {worldPickerOpen && <WorldPicker onClose={() => setWorldPickerOpen(false)} />}
          </div>
        </div>
        <nav
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 26,
            color: '#aeb4b2',
            fontSize: 14.5,
            fontWeight: 500,
          }}
        >
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setSettingsOpen((v) => !v)}
              title="Settings"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                color: settingsOpen ? '#e9ecea' : '#aeb4b2',
                fontSize: 14.5,
                fontWeight: 500,
                border: `1px solid ${settingsOpen ? '#3a4241' : '#262b2b'}`,
                borderRadius: 8,
                padding: '6px 12px',
              }}
            >
              <span
                style={{ width: 12, height: 12, borderRadius: 3, background: 'var(--accent,#2e9d9d)' }}
              />
              Settings
            </button>
            {settingsOpen && <SettingsPopover onClose={() => setSettingsOpen(false)} />}
          </div>
          <button
            onClick={() => void store.logout()}
            title="Log out"
            style={{ color: '#aeb4b2', fontSize: 14.5, fontWeight: 500 }}
          >
            Log out
          </button>
        </nav>
      </header>
      {(settingsOpen || worldPickerOpen) && (
        <div
          onClick={() => {
            setSettingsOpen(false);
            setWorldPickerOpen(false);
          }}
          style={{ position: 'fixed', inset: 0, zIndex: 55 }}
        />
      )}
    </>
  );
}
