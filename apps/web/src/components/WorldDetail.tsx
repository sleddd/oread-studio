import { useEffect, useState } from 'react';
import { useStore } from '../state/store.js';
import { nodeDetail, asText, parseMultiDelimList, type EditableField } from '../state/nodeDetail.js';
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
  // Read-only ISO timestamp rendered in the viewer's locale ("28 July 2026 at
  // 14:32"). The stored value stays the exact ISO string — this is display only.
  if (f.kind === 'date') {
    return (
      <div
        style={{
          ...fieldBox,
          color: '#c9cdcb',
          border: '1px solid #1c2121',
        }}
      >
        {formatTimestamp(f.value)}
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
  // Checkbox whose LABEL states the negative of the stored flag (canon
  // "Can be changed by another character" over `immutable`): show !value, write
  // !checked. Keeps the stored field and its AI semantics untouched.
  if (f.kind === 'boolInv') {
    const checked = !f.value;
    return (
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#c9cdcb', fontSize: 14 }}>
        <input type="checkbox" checked={checked} onChange={(e) => set(!e.target.checked)} />
        {checked ? 'Yes — another character can change it' : 'No — this is fixed canon'}
      </label>
    );
  }
  if (f.kind === 'multi') {
    const arr = Array.isArray(f.value) ? (f.value as string[]) : [];
    return <MultiSelect value={arr} options={f.options ?? []} onChange={set} noun={f.noun} />;
  }
  // Single choice whose display label differs from the stored value — used for
  // relationship members, which store a character id but must read as a name.
  if (f.kind === 'pick') {
    return <PickOne field={f} onChange={set} />;
  }
  /**
   * Free prose over a field that happens to be stored as string[]. You write
   * paragraphs; only BLANK lines separate entries, so pressing Enter inside a
   * thought doesn't chop it into two list items. Round-trips: entries join back
   * with a blank line between them.
   */
  if (f.kind === 'proselist') {
    const arr = Array.isArray(f.value) ? (f.value as string[]) : [];
    return (
      <LineListEditor
        value={arr}
        onCommit={set}
        join={(v) => v.join('\n\n')}
        parse={parseParagraphs}
        placeholder="Write freely — leave a blank line to start a new entry"
      />
    );
  }
  // string[] edited as ONE free textarea, one entry per line. Parses on blur so
  // Enter and blank lines behave normally while typing.
  if (f.kind === 'longlist') {
    const arr = Array.isArray(f.value) ? (f.value as string[]) : [];
    return (
      <LineListEditor
        value={arr}
        onCommit={set}
        parse={parseLines}
        placeholder="Write freely — one entry per line"
      />
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

    // multiDelim (banned words/phrases): free-typing, parse on blur, accepts
    // pasted quoted/comma lists.
    if (f.multiDelim) {
      return (
        <LineListEditor
          value={arr}
          onCommit={set}
          parse={parseMultiDelimList}
          placeholder={
            'One per line, or paste a list — "got it," "ha," … or spine, cedar, pine.\nCleans up when you click away.'
          }
        />
      );
    }

    const useNewlines = sep === '\n';

    // Newline-separated lists (AI rules, beats, knowledge…): free-typing textarea
    // that parses only on blur, so Enter / blank lines / spaces all work.
    if (useNewlines) {
      return <LineListEditor value={arr} onCommit={set} parse={parseLines} placeholder="One per line" />;
    }

    // "·"-separated single-line list (parses live; a single-token separator is
    // harmless to type through).
    const text = arr.join(' · ');
    const onChange = (raw: string) =>
      set(
        raw
          .split('·')
          .map((s) => s.trim())
          .filter((s) => s.length > 0),
      );
    return (
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
 * Free-typing editor for one-per-line string lists (AI rules, banned words/
 * phrases, beats, knowledge…). Holds raw text locally and parses into the stored
 * string[] only on BLUR — so pressing Enter, typing spaces, or leaving a blank
 * line all work normally instead of being eaten by the parser on every keystroke
 * (which was stripping empty lines and blocking new lines). The draft re-syncs
 * from the store only while NOT focused, so switching nodes refreshes it without
 * fighting your typing. `parse` turns the raw text into the cleaned entries.
 */
function LineListEditor({
  value,
  onCommit,
  parse,
  placeholder,
  join,
}: {
  value: string[];
  onCommit: (v: string[]) => void;
  parse: (raw: string) => string[];
  placeholder: string;
  /** how stored entries become editable text; defaults to one per line */
  join?: (v: string[]) => string;
}): JSX.Element {
  const toText = join ?? ((v: string[]) => v.join('\n'));
  const [draft, setDraft] = useState(toText(value));
  const [focused, setFocused] = useState(false);

  // Re-seed from the store when the underlying list changes and we're not editing.
  useEffect(() => {
    if (!focused) setDraft(toText(value));
    // toText is derived from the `join` prop, which is stable per call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, focused]);

  const commit = () => {
    setFocused(false);
    const parsed = parse(draft);
    onCommit(parsed);
    setDraft(toText(parsed)); // normalize what's shown to the cleaned entries
  };

  return (
    <textarea
      value={draft}
      onFocus={() => setFocused(true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      placeholder={placeholder}
      style={{ ...fieldBox, minHeight: 96, resize: 'vertical' }}
    />
  );
}

/**
 * Single choice whose display label differs from the stored value — relationship
 * members store a character id but must read as a name.
 *
 * Choosing "+ Add a new character…" takes a name and MINTS A REAL CHARACTER, then
 * selects it. That's required here rather than optional: the field stores an id,
 * so a free-text name with nothing behind it would be a dangling reference.
 */
function PickOne({
  field,
  onChange,
}: {
  field: EditableField;
  onChange: (v: string) => void;
}): JSX.Element {
  const store = useStore();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');

  const choices = field.choices ?? [];
  const current = String(field.value ?? '');
  // A value with no matching choice (a since-deleted character) would otherwise
  // show as blank and be silently overwritten on the next save — surface it.
  const orphan = current && !choices.some((c) => c.value === current);

  const commitNew = () => {
    const id = store.addCharacterNamed(draft);
    setDraft('');
    setAdding(false);
    if (id) onChange(id);
  };

  if (adding) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitNew}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commitNew();
          } else if (e.key === 'Escape') {
            setDraft('');
            setAdding(false);
          }
        }}
        placeholder={`New ${field.noun ?? 'entry'} name, then Enter`}
        style={fieldBox}
      />
    );
  }

  return (
    <select
      value={current}
      onChange={(e) => {
        const v = e.target.value;
        if (v === '__new__') setAdding(true);
        else onChange(v);
      }}
      style={fieldBox}
    >
      <option value="">(nobody selected)</option>
      {choices.map((c) => (
        <option key={c.value} value={c.value}>
          {c.label}
        </option>
      ))}
      {orphan && <option value={current}>(unknown — {current})</option>}
      <option value="__new__">+ Add a new {field.noun ?? 'entry'}…</option>
    </select>
  );
}

/**
 * Multi-select over a known option list that still accepts entries outside it.
 * Selections are chips you can remove; the dropdown offers the remaining options
 * plus an "+ Add …" escape hatch that takes a free-text entry. Values outside
 * `options` (typed before this was a picker, or added here) render as chips just
 * the same, so nothing already stored is lost.
 *
 * `noun` names what is being picked ("character", "concept", "source"), so the
 * prompts read correctly wherever this is used — the list is not always people.
 */
function MultiSelect({
  value,
  options,
  onChange,
  noun = 'entry',
}: {
  value: string[];
  options: string[];
  onChange: (v: string[]) => void;
  noun?: string;
}): JSX.Element {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');

  const add = (name: string) => {
    const n = name.trim();
    // Case-insensitive dedupe so "Sam" and "sam" don't both land in the list.
    if (!n || value.some((v) => v.toLowerCase() === n.toLowerCase())) return;
    onChange([...value, n]);
  };
  const remove = (name: string) => onChange(value.filter((v) => v !== name));

  const remaining = options.filter(
    (o) => !value.some((v) => v.toLowerCase() === o.toLowerCase()),
  );

  const commitNew = () => {
    add(draft);
    setDraft('');
    setAdding(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {value.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {value.map((v) => (
            <span
              key={v}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 13.5,
                color: '#e0e3e1',
                background: 'rgba(46,157,157,0.14)',
                border: '1px solid #232929',
                borderRadius: 999,
                padding: '4px 6px 4px 11px',
              }}
            >
              {v}
              <button
                type="button"
                onClick={() => remove(v)}
                aria-label={`Remove ${v}`}
                title={`Remove ${v}`}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: '#9aa3a1',
                  cursor: 'pointer',
                  fontSize: 15,
                  lineHeight: 1,
                  padding: '0 4px',
                }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {adding ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitNew}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitNew();
            } else if (e.key === 'Escape') {
              setDraft('');
              setAdding(false);
            }
          }}
          placeholder={`New ${noun}, then Enter`}
          style={fieldBox}
        />
      ) : (
        <select
          value=""
          onChange={(e) => {
            const v = e.target.value;
            if (!v) return;
            if (v === '__new__') setAdding(true);
            else add(v);
          }}
          style={fieldBox}
        >
          <option value="">
            {value.length ? 'Add another…' : `Select a ${noun}…`}
          </option>
          {remaining.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
          <option value="__new__">+ Add a new {noun}…</option>
        </select>
      )}
    </div>
  );
}

/**
 * Human-readable form of a stored ISO timestamp, in the viewer's own locale and
 * timezone — e.g. "28 July 2026 at 14:32" / "July 28, 2026 at 2:32 PM".
 *
 * Falls back to the raw text if the value isn't a parseable date, so a hand-edited
 * or legacy world document shows what it actually holds rather than "Invalid Date".
 */
function formatTimestamp(v: unknown): string {
  const raw = asText(v);
  if (!raw.trim()) return '—';
  const t = Date.parse(raw);
  if (Number.isNaN(t)) return raw;
  return new Date(t).toLocaleString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Split free prose into entries on BLANK lines, so a single newline stays inside
 * the paragraph you're writing. Each entry keeps its internal line breaks.
 */
function parseParagraphs(raw: string): string[] {
  return raw
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Split a one-per-line block: trim each line, drop blanks. Used on blur. */
function parseLines(raw: string): string[] {
  return raw
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
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
