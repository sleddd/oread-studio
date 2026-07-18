/**
 * DB integration tests — schema isolation + migration idempotency/restartability.
 *
 * These require a live Postgres. They SKIP cleanly when DATABASE_URL is unset,
 * so `npm test` is green everywhere. To run them, set DATABASE_URL to a
 * scratch database you don't mind mutating; the tests create + drop their own
 * user schemas and clean up public.users rows they insert.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

const HAS_DB = !!process.env.DATABASE_URL;
const maybe = HAS_DB ? test : test.skip;

let pool: import('pg').Pool;
const createdSchemas: string[] = [];
const createdUsers: string[] = [];

before(async () => {
  if (!HAS_DB) return;
  process.env.MASTER_KEY_V1 = process.env.MASTER_KEY_V1 ?? randomBytes(32).toString('base64');
  const { getPool } = await import('./pool.js');
  const { bootstrap } = await import('./bootstrap.js');
  pool = getPool();
  await bootstrap(() => {}); // install public schema + provisioner + migrations
});

after(async () => {
  if (!HAS_DB) return;
  for (const s of createdSchemas) {
    await pool.query(`DROP SCHEMA IF EXISTS "${s}" CASCADE`).catch(() => {});
  }
  for (const u of createdUsers) {
    await pool.query('DELETE FROM public.users WHERE id = $1', [u]).catch(() => {});
  }
  const { closePool } = await import('./pool.js');
  await closePool();
});

async function makeUser(): Promise<{ id: string; schema: string }> {
  const { signup } = await import('../auth/accounts.js');
  const email = `test_${randomBytes(6).toString('hex')}@oread.test`;
  const user = await signup({ email, name: 'Test', password: 'password123' });
  createdSchemas.push(user.schemaName);
  createdUsers.push(user.id);
  return { id: user.id, schema: user.schemaName };
}

maybe('schema isolation: user A cannot see user B\'s worlds via the store', async () => {
  const { PostgresStore } = await import('../storage/postgres-store.js');
  const { emptyWorld } = await import('../world/factory.js');
  const store = new PostgresStore();

  const a = await makeUser();
  const b = await makeUser();

  const wa = await store.createWorld({ schemaName: a.schema }, 'A-world', emptyWorld('A-world'));
  await store.createWorld({ schemaName: b.schema }, 'B-world', emptyWorld('B-world'));

  const aList = await store.listWorlds({ schemaName: a.schema });
  const bList = await store.listWorlds({ schemaName: b.schema });

  assert.ok(aList.some((w) => w.id === wa));
  assert.ok(!bList.some((w) => w.id === wa), "B must not see A's world");
  assert.equal(aList.every((w) => w.name === 'A-world'), true);
  assert.equal(bList.every((w) => w.name === 'B-world'), true);
});

maybe('schema isolation: search_path is reset to public after a request', async () => {
  const { withUserSchema } = await import('./pool.js');
  const a = await makeUser();
  await withUserSchema(a.schema, async (c) => {
    const { rows } = await c.query('SHOW search_path');
    assert.ok(String(rows[0].search_path).includes(a.schema));
  });
  // A fresh checkout should be back on public.
  const { rows } = await pool.query('SHOW search_path');
  assert.ok(String(rows[0].search_path).includes('public'));
});

maybe('schema isolation: invalid schema names are refused', async () => {
  const { withUserSchema } = await import('./pool.js');
  await assert.rejects(
    withUserSchema('public"; DROP TABLE users; --', async () => 1),
    /invalid schema name/,
  );
});

maybe('migration runner is idempotent: running twice changes nothing the second time', async () => {
  const { runMigrations } = await import('./migration-runner.js');
  await makeUser();
  const first = await runMigrations(() => {});
  const second = await runMigrations(() => {});
  assert.equal(second.migrationsApplied, 0, 'second run applies nothing');
  assert.equal(second.failures.length, 0);
  assert.ok(first.usersProcessed >= 1);
});

maybe('migration runner is restartable: a user below version gets re-applied', async () => {
  const { runMigrations } = await import('./migration-runner.js');
  const u = await makeUser();
  // Simulate an interrupted run: force this user's schema_version back to 0.
  await pool.query('UPDATE public.users SET schema_version = 0 WHERE id = $1', [u.id]);
  const res = await runMigrations(() => {});
  assert.ok(res.migrationsApplied >= 1, 'the reset user is re-migrated');
  const { rows } = await pool.query('SELECT schema_version FROM public.users WHERE id = $1', [u.id]);
  assert.ok(rows[0].schema_version >= 1, 'schema_version bumped back up');
});
