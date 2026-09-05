import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proseToText, textToProse, countWords } from './index.js';

test('paragraphs become blank-line-separated plain text', () => {
  assert.equal(proseToText('<p>One.</p><p>Two.</p>'), 'One.\n\nTwo.');
});

test('inline tags are dropped, their words kept', () => {
  assert.equal(proseToText('<p>She <strong>ran</strong> <em>home</em>.</p>'), 'She ran home.');
});

test('a hard break becomes a newline, not a paragraph break', () => {
  assert.equal(proseToText('<p>One<br>Two</p>'), 'One\nTwo');
});

test('entities are decoded so the AI reads real characters', () => {
  assert.equal(proseToText('<p>Tom &amp; Jerry &quot;hi&quot; &#39;x&#39;</p>'), 'Tom & Jerry "hi" \'x\'');
});

// Chapters written before the rich-text editor are stored as plain text and
// must survive untouched — including prose that merely contains a `<`.
test('legacy plain text passes through unchanged', () => {
  assert.equal(proseToText('She ran home.\n\nThen she stopped.'), 'She ran home.\n\nThen she stopped.');
  assert.equal(proseToText('x < y and y > z'), 'x < y and y > z');
});

// A heading is its own paragraph (blank line after it), but the rows of one
// list are consecutive lines — spacing the AI reads as structure.
test('headings separate as paragraphs; list rows stay consecutive', () => {
  assert.equal(proseToText('<h1>Ch 1</h1><ul><li>a</li><li>b</li></ul>'), 'Ch 1\n\na\nb');
});

test('script and style content never reaches the AI', () => {
  assert.equal(proseToText('<p>a</p><script>alert(1)</script><p>b</p>'), 'a\n\nb');
});

test('AI plain text becomes paragraphs', () => {
  assert.equal(textToProse('One.\n\nTwo.'), '<p>One.</p><p>Two.</p>');
});

test('single newlines inside a block become hard breaks', () => {
  assert.equal(textToProse('One\nTwo'), '<p>One<br>Two</p>');
});

// Model output is data, never markup: an injected tag must not become live HTML.
test('AI output is escaped, not trusted as markup', () => {
  assert.equal(textToProse('<script>alert(1)</script>'), '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
});

test('text survives a round trip through HTML', () => {
  for (const t of ['One.\n\nTwo.', 'A single line.', 'Tom & Jerry', 'a\nb\n\nc']) {
    assert.equal(proseToText(textToProse(t)), t, t);
  }
});

// word_count is stored and shown to the author; tags must never inflate it.
test('word count ignores markup', () => {
  assert.equal(countWords('<p>She <strong>ran</strong> home.</p>'), 3);
  assert.equal(countWords('She ran home.'), 3);
  assert.equal(countWords(''), 0);
  assert.equal(countWords('<p></p>'), 0);
});

import { replaceTextSpan, appendProse } from './index.js';

// Edit/critique modes quote a plain-text span and ask for it to be replaced,
// but the stored prose is HTML — the quoted span never appears literally in it.
test('replaces a span that spans formatting tags', () => {
  const html = '<p>She <strong>ran</strong> home.</p>';
  const out = replaceTextSpan(html, 'She ran home.', 'She walked home.');
  assert.equal(out, '<p>She walked home.</p>');
});

test('markup outside the replaced span is preserved', () => {
  const html = '<p>Keep <em>this</em>.</p><p>Change <strong>that</strong>.</p>';
  const out = replaceTextSpan(html, 'Change that.', 'Rewrote it.');
  assert.equal(out, '<p>Keep <em>this</em>.</p><p>Rewrote it.</p>');
});

test('only the first occurrence is replaced', () => {
  const html = '<p>same</p><p>same</p>';
  assert.equal(replaceTextSpan(html, 'same', 'X'), '<p>X</p><p>same</p>');
});

test('a replacement is escaped, never injected as markup', () => {
  const out = replaceTextSpan('<p>hello</p>', 'hello', '<script>x</script>');
  assert.equal(out, '<p>&lt;script&gt;x&lt;/script&gt;</p>');
});

// A stale suggestion must be refused, not applied to the wrong place.
test('a span that no longer exists returns null', () => {
  assert.equal(replaceTextSpan('<p>She ran home.</p>', 'He drove away.', 'x'), null);
  assert.equal(replaceTextSpan('<p>a</p>', '', 'x'), null);
});

test('legacy plain-text prose still replaces correctly', () => {
  assert.equal(replaceTextSpan('She ran home.', 'ran', 'walked'), 'She walked home.');
  assert.equal(replaceTextSpan('She ran home.', 'nope', 'x'), null);
});

test('the replaced text reads back as the AI intended', () => {
  const html = '<p>The <em>old</em> door was <strong>open</strong>.</p>';
  const out = replaceTextSpan(html, 'The old door was open.', 'The door was shut.');
  assert.equal(proseToText(out ?? ''), 'The door was shut.');
});

test('appendProse matches the storage form it is given', () => {
  assert.equal(appendProse('<p>One.</p>', 'Two.'), '<p>One.</p><p>Two.</p>');
  assert.equal(appendProse('One.', 'Two.'), 'One.\n\nTwo.');
  assert.equal(appendProse('', 'Two.'), 'Two.');
});

// Legacy chapters are plain text with blank-line paragraph breaks. Handing that
// to a rich-text editor as HTML collapses every newline into one giant
// paragraph — which then makes a heading apply to the entire chapter.
test('legacy plain text converts to one paragraph per block', () => {
  const legacy = 'Chapter 1\n\nThe letter arrives.\n\nShe was awake.';
  assert.equal(
    textToProse(legacy),
    '<p>Chapter 1</p><p>The letter arrives.</p><p>She was awake.</p>',
  );
});

test('paragraph structure survives the editor round trip', () => {
  const legacy = 'One.\n\nTwo.\n\nThree.';
  const asHtml = textToProse(legacy);
  assert.equal((asHtml.match(/<p>/g) ?? []).length, 3);
  assert.equal(proseToText(asHtml), legacy);
});

// The revision preview and any other read-only view of prose render plain text,
// so stored HTML has to be projected — it was showing raw tags to the author.
test('a stored chapter previews as readable prose, not markup', () => {
  const stored = '<h1>Chapter 1</h1><p>The letter <strong>arrives</strong>.</p>';
  const preview = proseToText(stored);
  assert.ok(!preview.includes('<'), `preview still contains markup: ${preview}`);
  assert.equal(preview, 'Chapter 1\n\nThe letter arrives.');
});

// "Insert into the manuscript" adds AI plain text to stored prose. Joining the
// two with a blank line left an unwrapped paragraph inside the markup.
test('inserting AI prose into an HTML chapter stays well-formed', () => {
  const out = appendProse('<p>One.</p>', 'Two.\n\nThree.');
  assert.equal(out, '<p>One.</p><p>Two.</p><p>Three.</p>');
  assert.equal(proseToText(out), 'One.\n\nTwo.\n\nThree.');
});
