/**
 * Conversion between stored prose HTML and plain text.
 *
 * Prose is authored in a rich-text editor and stored as HTML, but every AI mode
 * reads and writes plain text: the model should never see tags (they burn the
 * token budget and invite it to emit broken markup) and never emit them.
 * `proseToText` is the boundary on the way in, `textToProse` on the way back.
 *
 * These run on the server too, so they are plain string functions with no DOM
 * dependency.
 */

/**
 * Block tags, split by how much vertical space they mean in plain text.
 * Paragraphs and headings read as separate paragraphs (blank line between);
 * list rows are consecutive lines of one list, so they get a single newline.
 */
const PARA_TAGS = 'p|div|h[1-6]|blockquote|pre';
const LINE_TAGS = 'li|tr';

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  '#39': "'",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, code: string) => {
    const named = ENTITIES[code.toLowerCase()];
    if (named !== undefined) return named;
    if (code.startsWith('#x') || code.startsWith('#X')) {
      const n = Number.parseInt(code.slice(2), 16);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    if (code.startsWith('#')) {
      const n = Number.parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return m;
  });
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Stored prose HTML → the plain text the AI sees.
 *
 * Block boundaries become newlines (a paragraph break is meaningful to a
 * novelist and to the model), inline tags are dropped, and entities are
 * decoded. Content that is already plain text passes through unchanged, which
 * matters because existing chapters predate the rich-text editor.
 */
export function proseToText(html: string): string {
  if (!html) return '';
  // No tags at all: this is legacy plain-text prose, so leave it alone.
  if (!/<[a-zA-Z/!]/.test(html)) return html;

  let s = html;
  s = s.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  // Paragraph-level blocks are separated by a blank line; list rows by one
  // newline. Marking both edges keeps blocks apart however they are nested.
  s = s.replace(new RegExp(`</(?:${PARA_TAGS})\\s*>`, 'gi'), '\n\n');
  s = s.replace(new RegExp(`<(?:${PARA_TAGS})\\b[^>]*>`, 'gi'), '\n\n');
  // Between two rows of the same list, emit exactly one newline.
  s = s.replace(new RegExp(`</(?:${LINE_TAGS})\\s*>\\s*<(?:${LINE_TAGS})\\b[^>]*>`, 'gi'), '\n');
  s = s.replace(new RegExp(`</?(?:${LINE_TAGS})\\b[^>]*>`, 'gi'), '\n');
  s = s.replace(/<[^>]+>/g, '');
  s = decodeEntities(s);

  // Collapse the runs of blank lines the tag stripping leaves behind, but keep
  // a single blank line between paragraphs — it is the paragraph break.
  return s
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Plain text from the AI → prose HTML for the editor.
 *
 * Each blank-line-separated block becomes a paragraph and single newlines
 * become hard breaks, so inserted prose keeps the shape the model wrote. The
 * text is escaped: model output is never treated as markup.
 */
export function textToProse(text: string): string {
  if (!text.trim()) return '';
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/** True when stored content is HTML rather than legacy plain text. */
export function isProseHtml(content: string): boolean {
  return /<[a-zA-Z/!]/.test(content);
}

/**
 * Replace a plain-text span inside prose HTML.
 *
 * Edit and critique modes return a redline as plain text: "replace `original`
 * with this". But the stored prose is HTML, so the span the model quoted does
 * not appear literally in it — `<p>She <strong>ran</strong>.</p>` contains no
 * substring "She ran." This walks the HTML, tracking the plain-text offset of
 * every text node, and rewrites exactly the region the span covers.
 *
 * Tags inside the replaced region are dropped along with it (the model rewrote
 * that prose, so its old emphasis no longer applies), while everything outside
 * keeps its markup. Returns null when the span cannot be found, which the
 * caller reports as a stale suggestion rather than guessing.
 */
export function replaceTextSpan(
  html: string,
  original: string,
  replacement: string,
): string | null {
  if (!original) return null;
  if (!isProseHtml(html)) {
    const at = html.indexOf(original);
    return at === -1 ? null : html.slice(0, at) + replacement + html.slice(at + original.length);
  }

  // Index every text node by its offset in the plain-text projection.
  const parts: { html: string; isText: boolean; text: string; start: number }[] = [];
  let plain = '';
  const tagRe = /<[^>]+>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const pushText = (raw: string): void => {
    if (!raw) return;
    const decoded = decodeEntities(raw);
    parts.push({ html: raw, isText: true, text: decoded, start: plain.length });
    plain += decoded;
  };
  while ((m = tagRe.exec(html))) {
    pushText(html.slice(last, m.index));
    parts.push({ html: m[0], isText: false, text: '', start: plain.length });
    last = m.index + m[0].length;
  }
  pushText(html.slice(last));

  // Match on whitespace-insensitive text, since HTML collapses runs of space
  // that the plain-text the model saw may render differently.
  const norm = (s: string): string => s.replace(/\s+/g, ' ');
  const target = norm(original).trim();
  const at = norm(plain).indexOf(target);
  if (at === -1 || !target) return null;

  // Map the normalised offset back to a raw offset in `plain`.
  const rawIndex = (normOffset: number): number => {
    let seen = 0;
    let prevWasSpace = false;
    for (let i = 0; i < plain.length; i += 1) {
      const isSpace = /\s/.test(plain[i] ?? '');
      if (isSpace && prevWasSpace) continue;
      if (seen === normOffset) return i;
      seen += 1;
      prevWasSpace = isSpace;
    }
    return plain.length;
  };
  const from = rawIndex(at);
  const to = rawIndex(at + target.length);

  let out = '';
  let done = false;
  for (const part of parts) {
    if (!part.isText) {
      // Keep tags that sit outside the replaced region; drop those inside it.
      const inside = part.start > from && part.start < to;
      if (!inside) out += part.html;
      continue;
    }
    const end = part.start + part.text.length;
    if (end <= from || part.start >= to) {
      out += part.html;
      continue;
    }
    // This node overlaps the span: keep the head, emit the replacement once,
    // then keep the tail.
    const headLen = Math.max(0, from - part.start);
    if (headLen > 0) out += escapeHtml(part.text.slice(0, headLen));
    if (!done) {
      out += escapeHtml(replacement);
      done = true;
    }
    const tailFrom = Math.max(0, to - part.start);
    if (tailFrom < part.text.length) out += escapeHtml(part.text.slice(tailFrom));
  }
  return done ? out : null;
}

/** Append AI-written prose to existing prose, in whichever form it is stored. */
export function appendProse(existing: string, text: string): string {
  if (!existing.trim()) return isProseHtml(existing) ? textToProse(text) : text;
  return isProseHtml(existing)
    ? existing + textToProse(text)
    : `${existing}\n\n${text}`;
}
