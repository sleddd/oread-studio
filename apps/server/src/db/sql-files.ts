/**
 * Locate and read the authoritative SQL files under db/sql/. The runner and
 * bootstrap execute these — the .sql files are the source of truth, not
 * duplicated TS strings.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** Walk up from apps/server/src/db to the repo root that contains db/sql. */
function findSqlDir(): string {
  let dir = here;
  for (let i = 0; i < 8; i++) {
    const candidate = resolve(dir, 'db', 'sql');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('Could not locate db/sql directory from ' + here);
}

const SQL_DIR = findSqlDir();

export function readSql(relative: string): string {
  return readFileSync(join(SQL_DIR, relative), 'utf8');
}

export interface MigrationFile {
  version: number;
  name: string;
  /** the function name defined in the file, e.g. migrate_001 */
  fnName: string;
  sql: string;
}

/** All migration files in db/sql/migrations, ordered by numeric version prefix. */
export function listMigrations(): MigrationFile[] {
  const dir = join(SQL_DIR, 'migrations');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .map((f) => {
      const version = Number(f.split('_')[0]);
      const name = f.replace(/\.sql$/, '');
      const sql = readFileSync(join(dir, f), 'utf8');
      const m = /CREATE OR REPLACE FUNCTION public\.(migrate_\w+)/.exec(sql);
      if (!m) {
        throw new Error(`Migration ${f} defines no public.migrate_* function`);
      }
      return { version, name, fnName: m[1]!, sql };
    })
    .sort((a, b) => a.version - b.version);
}

/** The base (non-migration) SQL files, in apply order. */
export const BASE_SQL_FILES = [
  '000_public.sql',
  '005_migrations_registry.sql',
  '010_provision.sql',
];
