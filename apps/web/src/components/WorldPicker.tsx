import { useStore } from '../state/store.js';

export function WorldPicker({ onClose }: { onClose: () => void }): JSX.Element {
  const store = useStore();
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
          <button
            key={w.id}
            onClick={() => {
              void store.openWorld(w.id);
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
              background: active ? 'rgba(46,157,157,0.14)' : 'transparent',
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
        );
      })}
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
