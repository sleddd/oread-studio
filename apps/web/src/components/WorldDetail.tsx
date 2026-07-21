import { useEffect, useState } from 'react';
import { useStore } from '../state/store.js';
import { nodeDetail, asText, type EditableField } from '../state/nodeDetail.js';
import { PROVIDER_MODELS } from '@oread/shared';
import { credentials as credApi } from '../api/index.js';

const fieldBox = {
  width: '100%',
  fontSize: 15,
  lineHeight: 1.6,
  color: '#e0e3e1',
  background: '#121616',
  border: '1px solid #232929',
  borderRadius: 10,
  padding: '11px 14px',
} as const;

function FieldEditor({ f }: { f: EditableField }): JSX.Element {
  const store = useStore();
  const set = (v: unknown) => store.editWorldField(f.path, v);

  // Credential picker: selecting a credential sets credentialId AND provider,
  // and seeds a default model for that provider if none is set yet.
  if (f.kind === 'credential') {
    return (
      <select
        value={String(f.value ?? '')}
        onChange={(e) => {
          const id = e.target.value;
          const cred = store.credentialsList.find((c) => c.id === id);
          store.editWorldField('world.session.model.credentialId', id || null);
          store.editWorldField('world.session.model.provider', cred?.provider ?? null);
          if (cred) {
            const current = store.world?.world.session.model.model;
            if (!current) {
              store.editWorldField(
                'world.session.model.model',
                PROVIDER_MODELS[cred.provider][0]?.id ?? null,
              );
            }
          }
        }}
        style={fieldBox}
      >
        <option value="">(no credential — uses mock replies)</option>
        {store.credentialsList.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label} · {c.provider}
          </option>
        ))}
      </select>
    );
  }

  // Model picker: options from the selected credential's provider, + custom.
  if (f.kind === 'model') {
    return <ModelPicker value={String(f.value ?? '')} onChange={(v) => set(v || null)} />;
  }

  if (f.kind === 'ro') {
    return (
      <div
        style={{
          ...fieldBox,
          color: '#c9cdcb',
          border: '1px solid #1c2121',
          whiteSpace: 'pre-wrap',
        }}
      >
        {asText(f.value)}
      </div>
    );
  }
  if (f.kind === 'long') {
    return (
      <textarea
        value={asText(f.value)}
        onChange={(e) => set(e.target.value)}
        style={{ ...fieldBox, minHeight: 88, resize: 'vertical' }}
      />
    );
  }
  if (f.kind === 'bool') {
    return (
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#c9cdcb', fontSize: 14 }}>
        <input type="checkbox" checked={!!f.value} onChange={(e) => set(e.target.checked)} />
        {f.value ? 'true' : 'false'}
      </label>
    );
  }
  if (f.kind === 'num') {
    return (
      <input
        type="number"
        value={Number(f.value ?? 0)}
        onChange={(e) => set(Number(e.target.value))}
        style={fieldBox}
      />
    );
  }
  if (f.kind === 'enum') {
    return (
      <select value={String(f.value ?? '')} onChange={(e) => set(e.target.value || null)} style={fieldBox}>
        {(f.options ?? []).map((o) => (
          <option key={o} value={o}>
            {o === '' ? '(none)' : o}
          </option>
        ))}
      </select>
    );
  }
  if (f.kind === 'list') {
    const sep = f.sep ?? ' · ';
    const arr = Array.isArray(f.value) ? (f.value as string[]) : [];
    const useNewlines = sep === '\n';
    const text = arr.join(useNewlines ? '\n' : ' · ');
    const onChange = (raw: string) =>
      set(
        raw
          .split(useNewlines ? '\n' : '·')
          .map((s) => s.trim())
          .filter((s) => s.length > 0),
      );
    return useNewlines ? (
      <textarea
        value={text}
        onChange={(e) => onChange(e.target.value)}
        placeholder="one per line"
        style={{ ...fieldBox, minHeight: 72, resize: 'vertical' }}
      />
    ) : (
      <input
        value={text}
        onChange={(e) => onChange(e.target.value)}
        placeholder="separate with ·"
        style={fieldBox}
      />
    );
  }
  // text
  return <input value={asText(f.value)} onChange={(e) => set(e.target.value)} style={fieldBox} />;
}

/**
 * Model dropdown — shows ALL models the selected credential's provider offers
 * (fetched live from the provider), plus a custom escape hatch. Falls back to
 * the curated catalog if the live list can't be fetched.
 */
function ModelPicker({ value, onChange }: { value: string; onChange: (v: string) => void }): JSX.Element {
  const store = useStore();
  const model = store.world?.world.session.model;
  const credentialId = model?.credentialId ?? null;
  const provider = model?.provider ?? null;

  const [options, setOptions] = useState<{ id: string; label?: string }[]>([]);
  const [source, setSource] = useState<'live' | 'curated' | 'loading'>('loading');

  useEffect(() => {
    let cancelled = false;
    if (!credentialId) {
      setOptions(provider ? PROVIDER_MODELS[provider] : []);
      setSource('curated');
      return;
    }
    setSource('loading');
    void credApi
      .models(credentialId)
      .then((r) => {
        if (cancelled) return;
        setOptions(r.models);
        setSource(r.source);
      })
      .catch(() => {
        if (cancelled) return;
        setOptions(provider ? PROVIDER_MODELS[provider] : []);
        setSource('curated');
      });
    return () => {
      cancelled = true;
    };
  }, [credentialId, provider]);

  const known = options.some((o) => o.id === value);
  const [custom, setCustom] = useState(false);

  if (!provider) {
    return (
      <div style={{ ...fieldBox, color: '#6d7473' }}>Select a credential first to pick a model.</div>
    );
  }
  if (custom) {
    return (
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={value}
          placeholder="custom model id"
          onChange={(e) => onChange(e.target.value)}
          style={{ ...fieldBox, flex: 1 }}
        />
        <button
          onClick={() => {
            setCustom(false);
            onChange(options[0]?.id ?? '');
          }}
          style={{ fontSize: 12, color: '#9aa19f', border: '1px solid #262b2b', borderRadius: 8, padding: '0 10px' }}
        >
          list
        </button>
      </div>
    );
  }
  return (
    <>
      <select
        value={value}
        onChange={(e) => {
          if (e.target.value === '__custom__') {
            setCustom(true);
            onChange('');
          } else {
            onChange(e.target.value);
          }
        }}
        style={fieldBox}
      >
        {value !== '' && !known && <option value={value}>{value} (current)</option>}
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label ?? o.id}
          </option>
        ))}
        <option value="__custom__">custom…</option>
      </select>
      <div style={{ fontSize: 11, color: '#4f5655', marginTop: 4 }}>
        {source === 'loading'
          ? 'Loading models…'
          : source === 'live'
            ? `${options.length} models from provider`
            : 'curated list (add a credential for the full list)'}
      </div>
    </>
  );
}

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
        <div style={{ display: 'flex', gap: 8 }}>
          {detail.deletable && store.selectedNode && (
            <button
              onClick={() => store.deleteWorldNode(store.selectedNode!)}
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: '#d1617f',
                border: '1px solid #3a2530',
                borderRadius: 8,
                padding: '7px 13px',
              }}
            >
              Delete
            </button>
          )}
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
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingBottom: 12,
                  borderBottom: '1px solid #1a1e1e',
                  marginBottom: 14,
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    color: '#6d7473',
                    fontWeight: 700,
                  }}
                >
                  {g.heading}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {g.addKind && (
                    <button
                      onClick={() => store.addWorldEntity(g.addKind as never)}
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: 'var(--accent,#2e9d9d)',
                        border: '1px dashed #22403f',
                        borderRadius: 7,
                        padding: '4px 10px',
                      }}
                    >
                      + Add
                    </button>
                  )}
                  {g.deleteKey && (
                    <button
                      onClick={() => {
                        if (confirm('Delete this item? Remember to Save World to persist.')) {
                          store.deleteWorldNode(g.deleteKey!);
                        }
                      }}
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: '#d1617f',
                        border: '1px solid #3a2530',
                        borderRadius: 7,
                        padding: '4px 10px',
                      }}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {g.fields.length === 0 ? (
                  <div style={{ fontSize: 13, color: '#4f5655', fontStyle: 'italic' }}>
                    Nothing here yet — use “+ Add”.
                  </div>
                ) : (
                  g.fields.map((f, fi) => (
                    <div key={`${f.path}-${fi}`}>
                      <div style={{ fontSize: 12.5, color: '#7d8382', fontWeight: 600, marginBottom: 6 }}>
                        {f.label}
                      </div>
                      <FieldEditor f={f} />
                    </div>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
