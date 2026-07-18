/**
 * Bootstrap installs everything that lives in the PUBLIC schema and the
 * server-side function definitions: the users/sessions tables, the migration
 * registry, the provisioner, and every migration function. Idempotent —
 * every base file uses IF NOT EXISTS / CREATE OR REPLACE.
 *
 * This does NOT touch any user schema. `db:migrate` (the runner) applies the
 * migration functions across user schemas.
 */
import { withPublic } from './pool.js';
import { readSql, listMigrations, BASE_SQL_FILES } from './sql-files.js';

export async function bootstrap(log: (m: string) => void = console.log): Promise<void> {
  await withPublic(async (client) => {
    for (const file of BASE_SQL_FILES) {
      log(`[bootstrap] applying ${file}`);
      await client.query(readSql(file));
    }
    // Install/refresh every migration function definition (CREATE OR REPLACE).
    for (const mig of listMigrations()) {
      log(`[bootstrap] installing ${mig.name} (fn public.${mig.fnName})`);
      await client.query(mig.sql);
      await client.query(
        `INSERT INTO public.schema_migrations (version, name)
         VALUES ($1, $2)
         ON CONFLICT (version) DO UPDATE SET name = EXCLUDED.name`,
        [mig.version, mig.name],
      );
    }
  });
  log('[bootstrap] done');
}
