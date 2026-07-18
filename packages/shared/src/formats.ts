/**
 * Format-driven editor typography (single source of truth for web + any
 * server-side rendering). Mirrors the prototype's FORMATS + renderVals logic.
 */
import type { WritingFormat } from './storage.js';

export type ProseTypeface = 'Serif' | 'Sans' | 'Monospace';

export interface FormatSpec {
  label: string;
  placeholder: string;
  /** forced font family, if the format overrides the prose-typeface setting */
  forced?: 'mono' | 'sans';
}

export const FORMAT_SPECS: Record<WritingFormat, FormatSpec> = {
  novel: { label: 'Novel', placeholder: 'Begin your chapter…' },
  short: { label: 'Short Story', placeholder: 'Open the story…' },
  screenplay: {
    label: 'Screenplay',
    placeholder: 'INT. BEANSTALK COFFEE — MORNING',
    forced: 'mono',
  },
  poetry: { label: 'Poetry', placeholder: 'A line, and then the next…' },
  chat: {
    label: 'Chat / RP',
    placeholder: 'Type an action or a line of dialogue…',
    forced: 'sans',
  },
  essay: { label: 'Essay', placeholder: 'State the thing you mean to argue…' },
};

export interface EditorTypography {
  font: string;
  size: string;
  lineHeight: string;
  width: string;
}

const SERIF = "'Newsreader', Georgia, serif";
const SANS = "'Manrope', sans-serif";
const MONO = "'Courier New', monospace";

/** Resolve editor typography from the manuscript format + the prose-typeface setting. */
export function editorTypography(
  format: WritingFormat,
  typeface: ProseTypeface,
): EditorTypography {
  const spec = FORMAT_SPECS[format];
  if (spec.forced === 'mono') {
    return { font: MONO, size: '16px', lineHeight: '1.7', width: '640px' };
  }
  if (spec.forced === 'sans') {
    return { font: SANS, size: '16px', lineHeight: '1.65', width: '640px' };
  }
  const font =
    typeface === 'Sans' ? SANS : typeface === 'Monospace' ? MONO : SERIF;
  const width = format === 'poetry' ? '560px' : '700px';
  return { font, size: '18.5px', lineHeight: '1.75', width };
}

export function countWords(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}
