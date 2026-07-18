import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listMigrations, BASE_SQL_FILES, readSql } from './sql-files.js';

test('base SQL files are readable and non-empty', () => {
  for (const f of BASE_SQL_FILES) {
    const sql = readSql(f);
    assert.ok(sql.length > 0, `${f} should be non-empty`);
  }
});

test('provisioner defines the 3-level schema tables', () => {
  const sql = readSql('010_provision.sql');
  for (const tbl of ['manuscripts', 'chapters', 'chapter_revisions', 'worlds', 'chats', 'credentials', 'world_snapshots']) {
    assert.ok(sql.includes(`.${tbl} (`), `provisioner should create ${tbl}`);
  }
});

test('migrations are discovered, ordered, and each defines a migrate_* fn', () => {
  const migs = listMigrations();
  assert.ok(migs.length >= 1, 'at least one migration');
  // ordered ascending
  for (let i = 1; i < migs.length; i++) {
    assert.ok(migs[i]!.version > migs[i - 1]!.version, 'versions strictly ascending');
  }
  for (const m of migs) {
    assert.match(m.fnName, /^migrate_\d+$/, 'fn name shape');
    assert.ok(m.sql.includes(`public.${m.fnName}`), 'fn defined in file');
  }
});

test('baseline migration is version 1', () => {
  const migs = listMigrations();
  assert.equal(migs[0]!.version, 1);
});
