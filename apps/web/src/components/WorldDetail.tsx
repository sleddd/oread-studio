import { useStore } from '../state/store.js';
import { nodeDetail } from '../state/nodeDetail.js';

export function WorldDetail(): JSX.Element | null {
  const store = useStore();
  const detail = nodeDetail(store.world, store.selectedNode);
  if (!detail) return null;

  const askAbout = () => {
    store.setMode('discuss');
    void store.send(`Tell me about ${detail.title}.`);
    store.goWrite();
  };

  return (
    <>
      <div
        style={{
          flex: '0 0 auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 34px',
          borderBottom: '1px solid #16191a',
          gap: '12px 16px',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: '1 1 auto' }}>
          <button
            onClick={() => store.goWrite()}
            style={{ fontSize: 13, color: '#8b918f', display: 'flex', alignItems: 'center', gap: 6, flex: '0 0 auto' }}
          >
            ‹ Manuscript
          </button>
          <span style={{ color: '#333a3a' }}>/</span>
          <span style={{ fontSize: 13, color: '#6d7473' }}>
            {detail.kicker} · {detail.title}
          </span>
        </div>
        <button
          onClick={askAbout}
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--accent,#2e9d9d)',
            border: '1px solid #22403f',
            borderRadius: 8,
            padding: '7px 13px',
          }}
        >
          Discuss this →
        </button>
      </div>

      <div style={{ flex: '1 1 auto', overflowY: 'auto', padding: '38px 34px 120px' }}>
        <div style={{ maxWidth: 820, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 22, marginBottom: 30 }}>
            {detail.hasImage && (
              <div
                style={{
                  width: 118,
                  height: 118,
                  flex: '0 0 auto',
                  borderRadius: 14,
                  background:
                    'repeating-linear-gradient(135deg,#171b1b,#171b1b 7px,#141818 7px,#141818 14px)',
                  border: '1px solid #242929',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#4f5655' }}>portrait</span>
              </div>
            )}
            <div style={{ flex: '1 1 auto' }}>
              <div
                style={{
                  fontSize: 11,
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  color: 'var(--accent,#2e9d9d)',
                  fontWeight: 600,
                }}
              >
                {detail.kicker}
              </div>
              <div
                style={{
                  fontFamily: "'Newsreader',serif",
                  fontSize: 34,
                  fontWeight: 500,
                  color: '#f1f3f2',
                  marginTop: 4,
                  lineHeight: 1.1,
                }}
              >
                {detail.title}
              </div>
              <div style={{ fontSize: 15, color: '#8b918f', marginTop: 8, lineHeight: 1.5 }}>
                {detail.subtitle}
              </div>
            </div>
          </div>

          {detail.groups.map((g, gi) => (
            <div key={gi} style={{ marginBottom: 26 }}>
              <div
                style={{
                  fontSize: 12,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: '#6d7473',
                  fontWeight: 700,
                  paddingBottom: 12,
                  borderBottom: '1px solid #1a1e1e',
                  marginBottom: 14,
                }}
              >
                {g.heading}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {g.fields.map((f, fi) => (
                  <div key={fi}>
                    <div style={{ fontSize: 12.5, color: '#7d8382', fontWeight: 600, marginBottom: 6 }}>
                      {f.label}
                    </div>
                    {f.kind === 'ro' ? (
                      <div
                        style={{
                          fontSize: 15,
                          lineHeight: 1.6,
                          color: '#c9cdcb',
                          background: '#121616',
                          border: '1px solid #1c2121',
                          borderRadius: 10,
                          padding: '12px 14px',
                          whiteSpace: 'pre-wrap',
                        }}
                      >
                        {f.value}
                      </div>
                    ) : f.kind === 'long' ? (
                      <textarea
                        defaultValue={f.value}
                        style={{
                          width: '100%',
                          minHeight: 88,
                          resize: 'vertical',
                          fontSize: 15,
                          lineHeight: 1.6,
                          color: '#e0e3e1',
                          background: '#121616',
                          border: '1px solid #232929',
                          borderRadius: 10,
                          padding: '12px 14px',
                        }}
                      />
                    ) : (
                      <input
                        defaultValue={f.value}
                        style={{
                          width: '100%',
                          fontSize: 15,
                          color: '#e0e3e1',
                          background: '#121616',
                          border: '1px solid #232929',
                          borderRadius: 10,
                          padding: '11px 14px',
                        }}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
