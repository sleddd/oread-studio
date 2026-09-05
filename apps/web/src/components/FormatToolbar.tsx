import type { Editor } from '@tiptap/react';

/**
 * Formatting controls for the manuscript editor.
 *
 * Each button runs a Tiptap command and reflects the mark under the cursor, so
 * the toolbar shows the state of the text the author is standing in.
 */

interface ToolbarItem {
  label: string;
  title: string;
  /** Mark/node name for the active check, with any attributes it needs. */
  active: [string] | [string, Record<string, unknown>];
  run: (chain: ReturnType<Editor['chain']>) => ReturnType<Editor['chain']>;
  glyph?: React.CSSProperties;
}

const GROUPS: ToolbarItem[][] = [
  [
    { label: 'B', title: 'Bold  ⌘B', active: ['bold'], run: (c) => c.toggleBold(), glyph: { fontWeight: 800 } },
    { label: 'I', title: 'Italic  ⌘I', active: ['italic'], run: (c) => c.toggleItalic(), glyph: { fontStyle: 'italic', fontFamily: "'Newsreader',serif" } },
    { label: 'S', title: 'Strikethrough', active: ['strike'], run: (c) => c.toggleStrike(), glyph: { textDecoration: 'line-through' } },
  ],
  [
    { label: 'H1', title: 'Heading', active: ['heading', { level: 1 }], run: (c) => c.toggleHeading({ level: 1 }) },
    { label: 'H2', title: 'Subheading', active: ['heading', { level: 2 }], run: (c) => c.toggleHeading({ level: 2 }) },
    { label: '❝', title: 'Block quote', active: ['blockquote'], run: (c) => c.toggleBlockquote() },
  ],
  [
    { label: '•', title: 'Bulleted list', active: ['bulletList'], run: (c) => c.toggleBulletList() },
    { label: '1.', title: 'Numbered list', active: ['orderedList'], run: (c) => c.toggleOrderedList() },
  ],
];

interface Props {
  editor: Editor | null;
  disabled: boolean;
}

export function FormatToolbar({ editor, disabled }: Props): JSX.Element {
  const off = disabled || !editor;

  return (
    <div
      role="toolbar"
      aria-label="Text formatting"
      style={{
        flex: '0 0 auto',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        flexWrap: 'wrap',
        padding: '8px 34px',
        borderBottom: '1px solid #16191a',
        opacity: off ? 0.4 : 1,
        pointerEvents: off ? 'none' : 'auto',
      }}
    >
      {GROUPS.map((group, gi) => (
        <div key={gi} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {gi > 0 && <div style={{ width: 1, height: 18, background: '#1e2222', margin: '0 6px' }} />}
          {group.map((item) => {
            const active = !off && editor.isActive(...(item.active as [string, Record<string, unknown>]));
            return (
              <button
                key={item.label}
                type="button"
                title={item.title}
                aria-label={item.title}
                aria-pressed={active}
                disabled={off}
                // Keep the selection in the document when the button is clicked.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => item.run(editor!.chain().focus()).run()}
                style={{
                  minWidth: 30,
                  height: 28,
                  padding: '0 8px',
                  borderRadius: 7,
                  border: `1px solid ${active ? 'var(--accent,#2e9d9d)' : '#1e2323'}`,
                  background: active ? 'rgba(46,157,157,0.14)' : '#131717',
                  color: active ? 'var(--accent,#2e9d9d)' : '#8b918f',
                  fontSize: 13,
                  lineHeight: 1,
                  cursor: off ? 'default' : 'pointer',
                  ...item.glyph,
                }}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
