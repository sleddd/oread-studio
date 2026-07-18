import { useRef } from 'react';
import { useStore } from '../state/store.js';
import type { WorldDocument } from '@oread/shared';

export function WorldPicker({ onClose }: { onClose: () => void }): JSX.Element {
  const store = useStore();
  const fileRef = useRef<HTMLInputElement>(null);

  const onImportFile = async (file: File) => {
    let doc: WorldDocument;
    try {
      const parsed = JSON.parse(await file.text());
      // Accept both a bare world doc and one wrapped in { world: ... }.
      doc = (parsed && parsed.world ? parsed : { world: parsed }) as WorldDocument;
      if (!doc.world?.identity) throw new Error('missing world.identity');
    } catch (e) {
      alert(`Could not read that file as a world JSON: ${(e as Error).message}`);
      return;
    }
    try {
      await store.importWorld(doc);
      onClose();
    } catch (e) {
      alert(`Import failed: ${(e as Error).message}`);
    }
  };
  return (
    <div
      style={{
        position: 'absolute',
        top: 'calc(100% + 10px)',
        left: 0,
        width: 280,
        background: '#141818',
        border: '1px solid #262b2b',
        borderRadius: 14,
        boxShadow: '0 18px 50px rgba(0,0,0,0.55)',
        padding: 8,
        zIndex: 60,
        animation: 'om-up .16s ease',
      }}
    >
      <div
        style={{
          fontSize: 10.5,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: '#6d7473',
          fontWeight: 700,
          padding: '6px 8px 8px',
        }}
      >
        Worlds
      </div>
      {store.worldList.map((w) => {
        const active = w.id === store.worldId;
        return (
          <div
            key={w.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              borderRadius: 9,
              background: active ? 'rgba(46,157,157,0.14)' : 'transparent',
            }}
          >
            <button
              onClick={() => {
                void store.openWorld(w.id);
                onClose();
              }}
              style={{
                flex: '1 1 auto',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '9px 10px',
                borderRadius: 9,
                textAlign: 'left',
                background: 'transparent',
                minWidth: 0,
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: active ? 'var(--accent,#2e9d9d)' : '#333a3a',
                  flex: '0 0 auto',
                }}
              />
              <span style={{ minWidth: 0 }}>
                <span
                  style={{
                    display: 'block',
                    fontSize: 14,
                    fontWeight: 600,
                    color: '#e9ecea',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {w.name}
                </span>
                <span style={{ fontSize: 11.5, color: '#6d7473' }}>
                  {w.manuscriptCount} manuscript{w.manuscriptCount === 1 ? '' : 's'}
                </span>
              </span>
            </button>
            <button
              title="Delete world"
              onClick={() => {
                if (confirm(`Delete world “${w.name}”? This removes its manuscripts, chapters, and chats permanently.`)) {
                  void store.deleteWorld(w.id);
                }
              }}
              style={{ flex: '0 0 auto', color: '#6d7473', fontSize: 15, padding: '0 10px' }}
            >
              ×
            </button>
          </div>
        );
      })}
      {store.unattachedCount > 0 && (
        <button
          onClick={() => {
            void store.openUnattached();
            onClose();
          }}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '9px 10px',
            borderRadius: 9,
            textAlign: 'left',
            marginTop: 2,
            background: store.unattachedView ? 'rgba(46,157,157,0.14)' : 'transparent',
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#333a3a', flex: '0 0 auto' }} />
          <span style={{ minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: '#aeb4b2' }}>
              Unattached manuscripts
            </span>
            <span style={{ fontSize: 11.5, color: '#6d7473' }}>
              {store.unattachedCount} without a world
            </span>
          </span>
        </button>
      )}
      <button
        onClick={() => {
          void store.newWorld();
          onClose();
        }}
        style={{
          width: '100%',
          textAlign: 'left',
          marginTop: 4,
          padding: '10px 11px',
          borderRadius: 9,
          fontSize: 13.5,
          fontWeight: 600,
          color: 'var(--accent,#2e9d9d)',
          border: '1px dashed #22403f',
        }}
      >
        +&nbsp;&nbsp;New world
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = ''; // allow re-selecting the same file
          if (file) void onImportFile(file);
        }}
      />
      <button
        onClick={() => fileRef.current?.click()}
        style={{
          width: '100%',
          textAlign: 'left',
          marginTop: 6,
          padding: '9px 11px',
          borderRadius: 9,
          fontSize: 13,
          fontWeight: 600,
          color: '#9aa19f',
          border: '1px solid #262b2b',
        }}
      >
        ↥&nbsp;&nbsp;Import world.json
      </button>
      {store.worldId && (
        <a
          href={`/api/worlds/${store.worldId}/export`}
          onClick={onClose}
          style={{
            display: 'block',
            marginTop: 6,
            padding: '9px 11px',
            borderRadius: 9,
            fontSize: 13,
            fontWeight: 600,
            color: '#9aa19f',
            border: '1px solid #262b2b',
          }}
        >
          ↧&nbsp;&nbsp;Export world.json
        </a>
      )}
    </div>
  );
}
