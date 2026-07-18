import { useStore } from '../state/store.js';
import { WRITING_FORMATS, FORMAT_SPECS, editorTypography } from '@oread/shared';
import type { WritingFormat } from '@oread/shared';

const chapterActionStyle = (enabled: boolean, fontSize: number) => ({
  flex: '0 0 auto' as const,
  color: '#6d7473',
  fontSize,
  borderRadius: 8,
  border: '1px solid #1e2323',
  background: '#131717',
  padding: '0 9px',
  height: 30,
  display: 'flex',
  alignItems: 'center',
  opacity: enabled ? 1 : 0.4,
  cursor: enabled ? 'pointer' : 'default',
});

export function WriteView(): JSX.Element {
  const store = useStore();
  const chapter = store.activeChapter;
  const meta = store.world?.world.structure.chapters.find((c) => c.id === chapter?.chapter_id);
  const type = editorTypography(store.format, store.proseTypeface);
  const status = chapter?.status ?? 'outline';
  const wordCount = chapter?.word_count ?? 0;

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
          gap: '16px 20px',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ minWidth: 180, flex: '1 1 auto' }}>
          <div
            style={{
              fontSize: 11,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: '#5f6664',
              fontWeight: 600,
            }}
          >
            Chapter · {status.charAt(0).toUpperCase() + status.slice(1)}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, minWidth: 0 }}>
            <div
              style={{
                fontFamily: "'Newsreader',serif",
                fontSize: 23,
                fontWeight: 500,
                color: '#eef0ef',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                minWidth: 0,
              }}
            >
              {meta?.title ?? 'Untitled'}
            </div>
            <button
              title="Rename chapter"
              disabled={!chapter}
              onClick={() => {
                if (!chapter) return;
                const next = prompt('Rename chapter', meta?.title ?? '');
                if (next != null && next.trim() && next.trim() !== meta?.title) {
                  void store.renameChapter(chapter.id, next);
                }
              }}
              style={chapterActionStyle(!!chapter, 13)}
            >
              ✎
            </button>
            <button
              title="Delete chapter"
              disabled={!chapter}
              onClick={() => {
                if (!chapter) return;
                if (confirm(`Delete chapter “${meta?.title ?? 'Untitled'}”? Its prose is removed permanently.`)) {
                  void store.deleteChapter(chapter.id);
                }
              }}
              style={chapterActionStyle(!!chapter, 15)}
            >
              ×
            </button>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, flex: '0 0 auto' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
            <div
              style={{
                fontSize: 10,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: '#5f6664',
                fontWeight: 600,
              }}
            >
              Format
            </div>
            <select
              value={store.format}
              onChange={(e) => store.setFormat(e.target.value as WritingFormat)}
              style={{
                background: '#16191a',
                border: '1px solid #262b2b',
                borderRadius: 8,
                color: '#e9ecea',
                fontSize: 14,
                fontWeight: 600,
                padding: '7px 12px',
              }}
            >
              {WRITING_FORMATS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
          <div style={{ width: 1, height: 34, background: '#1e2222' }} />
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#cfd3d1' }}>
              {wordCount.toLocaleString()}
            </div>
            <div style={{ fontSize: 11, color: '#5f6664' }}>words</div>
          </div>
          <div style={{ width: 1, height: 34, background: '#1e2222' }} />
          <button
            onClick={() => void store.saveDraft()}
            disabled={!chapter}
            title="Save this chapter now (also autosaves as you type)"
            style={{
              fontSize: 13.5,
              fontWeight: 700,
              color: '#04201f',
              background: 'var(--accent,#2e9d9d)',
              borderRadius: 9,
              padding: '8px 16px',
              opacity: chapter ? 1 : 0.5,
              cursor: chapter ? 'pointer' : 'default',
            }}
          >
            Save Draft
          </button>
        </div>
      </div>
      <div
        style={{
          flex: '1 1 auto',
          overflowY: 'auto',
          display: 'flex',
          justifyContent: 'center',
          padding: '44px 34px 120px',
        }}
      >
        <div style={{ width: '100%', maxWidth: type.width }}>
          <textarea
            value={chapter?.content ?? ''}
            onChange={(e) => store.setChapterText(e.target.value)}
            spellCheck={false}
            placeholder={FORMAT_SPECS[store.format].placeholder}
            style={{
              width: '100%',
              minHeight: '60vh',
              background: 'transparent',
              border: 'none',
              resize: 'none',
              color: '#e6e9e7',
              fontFamily: type.font,
              fontSize: type.size,
              lineHeight: type.lineHeight,
              letterSpacing: '0.005em',
            }}
          />
        </div>
      </div>
    </>
  );
}
