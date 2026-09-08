import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWorldFile } from './world-file.js';

const world = { identity: { name: 'Kestrel' }, entities: {} } as never;

/**
 * The bug this file exists for: the Export world.json button produced a file
 * that Import rejected with "missing world.identity". The export envelope puts
 * a whole WorldDocument under `world`, so identity sits two levels deep — the
 * old reader saw a truthy `parsed.world`, assumed one level, and found nothing.
 */
test('the export envelope round-trips back in', () => {
  const envelope = {
    format: 'oread.world/v1',
    exportedAt: '2026-09-08T00:00:00.000Z',
    world: { world },
    manuscripts: [
      {
        name: 'Book One',
        format: 'novel',
        order: 0,
        chapters: [{ chapterId: 'ch_001', content: 'Snow.', status: 'final', order: 0 }],
      },
    ],
  };
  const { doc, manuscripts } = parseWorldFile(envelope);
  assert.equal(doc.world.identity.name, 'Kestrel');
  assert.equal(manuscripts.length, 1);
  assert.deepEqual(
    manuscripts[0]?.chapters.map((c) => c.content),
    ['Snow.'],
  );
});

test('a plain { world } document still imports', () => {
  assert.equal(parseWorldFile({ world }).doc.world.identity.name, 'Kestrel');
});

test('a bare world still imports', () => {
  assert.equal(parseWorldFile(world).doc.world.identity.name, 'Kestrel');
});

// Prose only ever rides along in an envelope; the other shapes carry none.
test('a document with no envelope reports no manuscripts', () => {
  assert.deepEqual(parseWorldFile({ world }).manuscripts, []);
});

test('a file with no identity anywhere is rejected, not half-imported', () => {
  assert.throws(() => parseWorldFile({ nope: true }), /no world identity/);
  assert.throws(() => parseWorldFile(null), /not a JSON object/);
});

// A hand-edited envelope should not crash the import loop.
test('malformed manuscript entries are repaired rather than trusted', () => {
  const { manuscripts } = parseWorldFile({
    world: { world },
    manuscripts: [{ chapters: [{ chapterId: 'ch_001', content: 'x', status: 'final', order: 0 }, null] }],
  });
  assert.equal(manuscripts[0]?.name, 'Untitled Manuscript');
  assert.equal(manuscripts[0]?.format, 'novel');
  assert.equal(manuscripts[0]?.chapters.length, 1);
});

/**
 * Why an imported world always starts on canned replies.
 *
 * The exporter nulls credentialId on purpose so a shared world never carries
 * key material. Import must PRESERVE that null rather than helpfully restoring
 * a pointer — the author re-picks a credential instead. The app now says so out
 * loud when it falls back to mock replies.
 */
test('import keeps the credential dangling, never rehydrates one', () => {
  const withModel = {
    identity: { name: 'Kestrel' },
    session: { model: { credentialId: null, provider: 'anthropic', model: 'claude-opus-5' } },
  } as never;
  const { doc } = parseWorldFile({ world: { world: withModel }, manuscripts: [] });
  assert.equal(doc.world.session?.model?.credentialId, null);
});
