import { useState } from 'react';
import { useStore } from '../state/store.js';
import { worldSections } from '../state/worldTree.js';
import type { AddableKind } from '../state/worldEdits.js';
import { FORMAT_SPECS } from '@oread/shared';

/** The addable entity kinds offered under each World-tree section. */
const SECTION_ADDS: Record<string, { kind: AddableKind; label: string }[]> = {
  Setting: [
    { kind: 'location', label: '+ Location' },
    { kind: 'rule', label: '+ Rule' },
  ],
  Entities: [
    { kind: 'character', label: '+ Character' },
    { kind: 'relationship', label: '+ Relationship' },
    { kind: 'concept', label: '+ Concept' },
    { kind: 'source', label: '+ Source' },
  ],
  Structure: [
    { kind: 'scene', label: '+ Scene' },
    { kind: 'timeline', label: '+ Timeline event' },
  ],
  Memory: [
    { kind: 'event', label: '+ Event' },
    { kind: 'canon', label: '+ Canon' },
    { kind: 'thread', label: '+ Thread' },
    { kind: 'decision', label: '+ Decision' },
  ],
};

const accentDim = 'rgba(46,157,157,0.14)';

export function Navigator(): JSX.Element {
  const store = useStore();
  const tabStyle = (active: boolean) => ({
    flex: 1,
    padding: '8px 10px',
    borderRadius: 9,
    fontSize: 13.5,
    fontWeight: 600,
    textAlign: 'center' as const,
    transition: 'all .15s',
    background: active ? accentDim : 'transparent',
    color: active ? 'var(--accent,#2e9d9d)' : '#6d7473',
  });

  return (
    <aside
      style={{
        width: 290,
        flex: '0 0 auto',
        borderRight: '1px solid #1c2020',
        background: '#101313',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      <div style={{ display: 'flex', gap: 4, padding: '14px 16px 10px', flex: '0 0 auto' }}>
        <button onClick={() => store.setNavMode('outline')} style={tabStyle(store.navMode === 'outline')}>
          Manuscript
        </button>
        <button onClick={() => store.setNavMode('world')} style={tabStyle(store.navMode === 'world')}>
          World
        </button>
      </div>

      <div style={{ flex: '1 1 auto', overflowY: 'auto', padding: '6px 10px 16px' }}>
        {store.navMode === 'outline' ? <OutlineTab /> : <WorldTab />}
      </div>

      <div
        style={{
          flex: '0 0 auto',
          borderTop: '1px solid #1c2020',
          padding: '12px 14px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span style={{ fontSize: 12, color: '#5f6664' }}>All changes saved</span>
        <button
          onClick={() => void store.saveWorld()}
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: '#cfd3d1',
            border: '1px solid #2a3030',
            borderRadius: 8,
            padding: '7px 13px',
          }}
        >
          Save World
        </button>
      </div>
    </aside>
  );
}

function OutlineTab(): JSX.Element {
  const store = useStore();
  const [msPickerOpen, setMsPickerOpen] = useState(false);
  const ms = store.manuscriptsList.find((m) => m.id === store.manuscriptId);
  const chapterMeta = (chapterId: string) =>
    store.world?.world.structure.chapters.find((c) => c.id === chapterId);

  return (
    <>
      <div style={{ position: 'relative', padding: '2px 4px 12px' }}>
        <button
          onClick={() => setMsPickerOpen((v) => !v)}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: 9,
            padding: '10px 11px',
            borderRadius: 10,
            background: '#131717',
            border: '1px solid #1e2323',
            textAlign: 'left',
          }}
        >
          <span style={{ minWidth: 0, flex: '1 1 auto' }}>
            <span
              style={{
                display: 'block',
                fontSize: 10,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: '#5f6664',
                fontWeight: 700,
              }}
            >
              Manuscript
            </span>
            <span
              style={{
                display: 'block',
                fontSize: 14,
                fontWeight: 600,
                color: '#e9ecea',
                marginTop: 2,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {ms?.name ?? '—'}
            </span>
          </span>
          <span style={{ fontSize: 9, color: '#5f6664', flex: '0 0 auto' }}>▼</span>
        </button>
        {msPickerOpen && (
          <div
            style={{
              position: 'absolute',
              top: 'calc(100% + 6px)',
              left: 0,
              right: 0,
              background: '#141818',
              border: '1px solid #262b2b',
              borderRadius: 13,
              boxShadow: '0 18px 50px rgba(0,0,0,0.55)',
              padding: 8,
              zIndex: 40,
              animation: 'om-up .16s ease',
            }}
          >
            {store.manuscriptsList.map((m) => {
              const active = m.id === store.manuscriptId;
              return (
                <div
                  key={m.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    borderRadius: 9,
                    background: active ? accentDim : 'transparent',
                  }}
                >
                  <button
                    onClick={() => {
                      void store.openManuscript(m.id);
                      setMsPickerOpen(false);
                    }}
                    style={{
                      flex: '1 1 auto',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '8px 10px',
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
                          fontSize: 13.5,
                          fontWeight: 600,
                          color: '#e9ecea',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {m.name}
                      </span>
                      <span style={{ fontSize: 11, color: '#6d7473' }}>
                        {FORMAT_SPECS[m.format].label}
                      </span>
                    </span>
                  </button>
                  <select
                    title="Move to world"
                    value={m.world_id ?? ''}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      const v = e.target.value;
                      void store.reassignManuscript(m.id, v === '' ? null : v);
                      setMsPickerOpen(false);
                    }}
                    style={{
                      flex: '0 0 auto',
                      background: 'transparent',
                      border: 'none',
                      color: '#6d7473',
                      fontSize: 11,
                      maxWidth: 96,
                    }}
                  >
                    <option value="">(no world)</option>
                    {store.worldList.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                  <button
                    title="Rename manuscript"
                    onClick={() => {
                      const name = prompt('Rename manuscript', m.name);
                      if (name != null && name.trim() && name.trim() !== m.name) {
                        void store.renameManuscript(m.id, name);
                      }
                    }}
                    style={{ flex: '0 0 auto', color: '#6d7473', fontSize: 12.5, padding: '0 7px' }}
                  >
                    ✎
                  </button>
                  <button
                    title="Delete manuscript"
                    onClick={() => {
                      const last = store.manuscriptsList.length === 1;
                      const msg = last
                        ? `Delete manuscript “${m.name}”? Its chapters are removed permanently, and a fresh empty manuscript will replace it.`
                        : `Delete manuscript “${m.name}”? Its chapters are removed permanently.`;
                      if (confirm(msg)) {
                        void store.deleteManuscript(m.id);
                        setMsPickerOpen(false);
                      }
                    }}
                    style={{ flex: '0 0 auto', color: '#6d7473', fontSize: 14, padding: '0 9px' }}
                  >
                    ×
                  </button>
                </div>
              );
            })}
            <button
              onClick={() => {
                const name = prompt('Name your new manuscript', 'Untitled Manuscript');
                if (name === null) return; // cancelled
                void store.newManuscript(name);
                setMsPickerOpen(false);
              }}
              style={{
                width: '100%',
                textAlign: 'left',
                marginTop: 4,
                padding: '9px 11px',
                borderRadius: 9,
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--accent,#2e9d9d)',
                border: '1px dashed #22403f',
              }}
            >
              +&nbsp;&nbsp;New manuscript
            </button>
          </div>
        )}
      </div>

      <div
        style={{
          padding: '6px 8px 12px',
          fontSize: 11,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: '#5f6664',
          fontWeight: 600,
        }}
      >
        Chapters
      </div>
      {store.chaptersList.map((ch) => {
        const active = ch.id === store.chapterRowId && store.view === 'write';
        const meta = chapterMeta(ch.chapter_id);
        const statusLabel = ch.status.charAt(0).toUpperCase() + ch.status.slice(1);
        return (
          <button
            key={ch.id}
            onClick={() => store.openChapter(ch.id)}
            style={{
              width: '100%',
              textAlign: 'left',
              padding: '12px',
              borderRadius: 10,
              marginBottom: 4,
              transition: 'all .15s',
              background: active ? accentDim : '#131717',
              border: active ? '1px solid #234140' : '1px solid transparent',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontSize: 14.5, fontWeight: 600, color: active ? '#f1f3f2' : '#cfd3d1' }}>
                {meta?.title ?? 'Untitled Chapter'}
              </span>
              <span
                style={{
                  fontSize: 10.5,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: ch.status === 'drafting' ? 'var(--accent,#2e9d9d)' : '#6d7473',
                  fontWeight: 600,
                }}
              >
                {statusLabel}
              </span>
            </div>
            <div style={{ fontSize: 12.5, color: '#6d7473', marginTop: 4 }}>
              POV · {meta?.povCharacter || '—'}
            </div>
          </button>
        );
      })}
      <button
        onClick={() => void store.newChapter()}
        style={{
          width: '100%',
          textAlign: 'left',
          marginTop: 8,
          padding: '11px 12px',
          borderRadius: 9,
          fontSize: 13.5,
          color: '#6d7473',
          border: '1px dashed #2a3030',
        }}
      >
        +&nbsp;&nbsp;New chapter
      </button>
    </>
  );
}

function WorldTab(): JSX.Element {
  const store = useStore();
  const sections = worldSections(store.world);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    Premise: false,
    Setting: true,
    Entities: true,
    Structure: false,
    Memory: false,
    Session: false,
  });

  return (
    <>
      {sections.map((sec) => {
        const isOpen = !!expanded[sec.label];
        return (
          <div key={sec.label} style={{ marginBottom: 2 }}>
            <button
              onClick={() => setExpanded((e) => ({ ...e, [sec.label]: !e[sec.label] }))}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '9px 8px',
                borderRadius: 8,
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  color: '#5f6664',
                  width: 10,
                  display: 'inline-block',
                  transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                  transition: 'transform .15s',
                }}
              >
                ▶
              </span>
              <span
                style={{
                  fontSize: 12.5,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: '#9aa19f',
                  fontWeight: 600,
                }}
              >
                {sec.label}
              </span>
              <span
                style={{
                  marginLeft: 'auto',
                  fontSize: 11,
                  color: '#4f5655',
                  background: '#181c1c',
                  borderRadius: 20,
                  padding: '1px 8px',
                }}
              >
                {sec.items.length}
              </span>
            </button>
            {isOpen && (
              <div style={{ padding: '2px 0 6px 6px' }}>
                {sec.items.length === 0 && !SECTION_ADDS[sec.label] && (
                  <div style={{ fontSize: 12, color: '#4f5655', fontStyle: 'italic', padding: '6px 10px' }}>
                    Nothing here yet — add as you write.
                  </div>
                )}
                {sec.items.length === 0 && SECTION_ADDS[sec.label] && (
                  <div style={{ fontSize: 12, color: '#4f5655', fontStyle: 'italic', padding: '6px 10px' }}>
                    Nothing here yet.
                  </div>
                )}
                {sec.items.length > 0 &&
                  sec.items.map((it) => {
                    const active = store.selectedNode === it.key && store.view === 'world';
                    return (
                      <button
                        key={it.key}
                        onClick={() => store.selectNode(it.key)}
                        style={{
                          width: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 9,
                          padding: '8px 10px',
                          borderRadius: 8,
                          textAlign: 'left',
                          transition: 'all .12s',
                          background: active ? accentDim : 'transparent',
                        }}
                      >
                        <span
                          style={{
                            width: 5,
                            height: 5,
                            borderRadius: '50%',
                            background: active ? 'var(--accent,#2e9d9d)' : '#333a3a',
                            flex: '0 0 auto',
                          }}
                        />
                        <span
                          style={{
                            fontSize: 13.5,
                            color: active ? '#f1f3f2' : '#aeb4b2',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {it.label}
                        </span>
                        <span
                          style={{
                            marginLeft: 'auto',
                            fontSize: 10.5,
                            color: '#4f5655',
                            letterSpacing: '0.04em',
                          }}
                        >
                          {it.type}
                        </span>
                      </button>
                    );
                  })}
                {SECTION_ADDS[sec.label] && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '8px 6px 2px' }}>
                    {SECTION_ADDS[sec.label]!.map((a) => (
                      <button
                        key={a.kind}
                        onClick={() => store.addWorldEntity(a.kind)}
                        style={{
                          fontSize: 11.5,
                          fontWeight: 600,
                          color: 'var(--accent,#2e9d9d)',
                          border: '1px dashed #22403f',
                          borderRadius: 7,
                          padding: '4px 9px',
                        }}
                      >
                        {a.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
