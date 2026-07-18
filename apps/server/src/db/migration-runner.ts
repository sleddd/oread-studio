/**
 * The migration runner — load-bearing.
 *
 * For every user in public.users, applies each migration whose version is
 * greater than that user's schema_version, calling the migration's plpgsql
 * function with the user's schema name, then bumps schema_version to the
 * migration's version.
 *
 * Guarantees:
 *  - Idempotent: migration functions are written idempotent; re-running is safe.
 *  - Restartable: each (user, migration) is its own transaction. If it dies at
 *    user 4,000 of 10,000, re-running resumes — already-migrated users are
 *    skipped because their schema_version is already at/above the version.
 *  - Per-user isolation of failure: one user's failure is logged and does not
 *    abort the whole run (the runner continues; exit code reflects failures).
 *
 * Runs in Render's pre-deploy command. Bootstrap must have installed the
 * migration function definitions first (db:bootstrap).
 */
import { getPool } from './pool.js';
import { listMigrations } from './sql-files.js';

export interface MigrationRunResult {
  usersProcessed: number;
  migrationsApplied: number;
  failures: { schema: string; version: number; error: string }[];
}

export async function runMigrations(
  log: (m: string) => void = console.log,
): Promise<MigrationRunResult> {
  const migrations = listMigrations();
  const pool = getPool();
  const result: MigrationRunResult = {
    usersProcessed: 0,
    migrationsApplied: 0,
    failures: [],
  };

  if (migrations.length === 0) {
    log('[migrate] no migrations found');
    return result;
  }

  // Ensure the function definitions exist/are current (idempotent).
  await pool.query('SELECT 1'); // connectivity check
  {
    const c = await pool.connect();
    try {
      await c.query('SET search_path TO public');
      for (const mig of migrations) {
        await c.query(mig.sql);
      }
    } finally {
      c.release();
    }
  }

  const { rows: users } = await pool.query<{
    id: string;
    schema_name: string;
    schema_version: number;
  }>('SELECT id, schema_name, schema_version FROM public.users ORDER BY created_at ASC');

  for (const user of users) {
    result.usersProcessed++;
    for (const mig of migrations) {
      if (user.schema_version >= mig.version) continue; // already applied
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SET LOCAL search_path TO public');
        // Apply the migration function to this user's schema.
        await client.query(`SELECT public.${mig.fnName}($1)`, [user.schema_name]);
        // Bump this user's schema_version.
        await client.query(
          'UPDATE public.users SET schema_version = $1 WHERE id = $2',
          [mig.version, user.id],
        );
        await client.query('COMMIT');
        result.migrationsApplied++;
        user.schema_version = mig.version;
        log(`[migrate] ${user.schema_name} → v${mig.version} (${mig.name})`);
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        const msg = err instanceof Error ? err.message : String(err);
        result.failures.push({
          schema: user.schema_name,
          version: mig.version,
          error: msg,
        });
        log(`[migrate] FAILED ${user.schema_name} v${mig.version}: ${msg}`);
        // Stop applying further migrations to THIS user (later ones may depend
        // on this one), but continue with other users.
        break;
      } finally {
        client.release();
      }
    }
  }

  log(
    `[migrate] done — ${result.usersProcessed} users, ${result.migrationsApplied} applied, ${result.failures.length} failures`,
  );
  return result;
}
