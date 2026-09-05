import { useEditor, EditorContent } from '@tiptap/react';
import type { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { useEffect, useRef } from 'react';
import { isProseHtml, textToProse } from '@oread/shared';
import type { EditorTypography } from '@oread/shared';

/**
 * The manuscript editor.
 *
 * Rich text, stored as HTML in the chapter's TEXT column. Bold is bold on the
 * page — there is no markup for the author to look at. The AI never sees this
 * HTML: `proseToText` strips it at the request boundary (see routes/ai.ts), so
 * every mode contract still reads and writes plain prose.
 */

/**
 * Chapters written before the rich-text editor are stored as plain text with
 * blank-line paragraph breaks. Handing that straight to Tiptap parses it as
 * HTML, which collapses every newline and yields ONE paragraph — the whole
 * chapter as a single block, where a heading applies to all of it. Convert
 * first so legacy prose opens with its paragraphs intact.
 */
function toEditorHtml(stored: string): string {
  return isProseHtml(stored) ? stored : textToProse(stored);
}

interface Props {
  /** Stored prose HTML (or legacy plain text, which Tiptap parses fine). */
  value: string;
  placeholder: string;
  typography: EditorTypography;
  disabled: boolean;
  onChange: (html: string) => void;
  /** Receives the editor instance so the toolbar can drive it. */
  onEditor: (editor: Editor | null) => void;
}

export function ProseEditor({
  value,
  placeholder,
  typography,
  disabled,
  onChange,
  onEditor,
}: Props): JSX.Element {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // The manuscript is prose: these would only add noise to the toolbar
        // and to the stored markup.
        codeBlock: false,
        horizontalRule: false,
      }),
      Placeholder.configure({ placeholder }),
    ],
    content: toEditorHtml(value),
    editable: !disabled,
    onUpdate: ({ editor: e, transaction }) => {
      // Only report what the AUTHOR changed. Loading a chapter — especially a
      // legacy plain-text one, which is converted to paragraphs on the way in —
      // also fires onUpdate, and passing that on would queue an autosave and
      // silently rewrite prose nobody touched.
      if (!transaction.docChanged || settingContent.current) return;
      onChange(e.getHTML());
    },
    editorProps: {
      attributes: {
        // Tiptap renders into this element; the typography comes from the
        // manuscript's format so screenplays stay monospaced, poetry narrow…
        style: [
          `font-family:${typography.font}`,
          `font-size:${typography.size}`,
          `line-height:${typography.lineHeight}`,
          'letter-spacing:0.005em',
          'min-height:60vh',
          'outline:none',
          'color:#e6e9e7',
        ].join(';'),
      },
    },
  });

  /** True while we are pushing external content in, so onUpdate can ignore it. */
  const settingContent = useRef(false);

  // Hand the instance up so the toolbar can query marks and run commands.
  useEffect(() => {
    onEditor(editor);
    return () => onEditor(null);
  }, [editor, onEditor]);

  /**
   * Pull external changes in (switching chapters, restoring a revision, an
   * AI-applied edit). Guarded on a real difference: writing the editor's own
   * HTML back would reset the cursor on every keystroke.
   */
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const next = toEditorHtml(value);
    if (next === editor.getHTML()) return;
    settingContent.current = true;
    editor.commands.setContent(next, false);
    settingContent.current = false;
  }, [value, editor]);

  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.setEditable(!disabled);
  }, [disabled, editor]);

  return <EditorContent editor={editor} />;
}
