/**
 * DB CLI. Opt-in, explicit commands — these are the ONLY things that run DDL
 * against DATABASE_URL. Never invoked implicitly by the server.
 *
 *   tsx src/db/cli.ts bootstrap   # install public schema + provisioner + migration fns
 *   tsx src/db/cli.ts migrate     # apply pending migrations across all user schemas
 *   tsx src/db/cli.ts status      # show migration versions + per-user schema_version spread
 */
import { env } from '../env.js';
import { getPool, closePool } from './pool.js';
import { bootstrap } from './bootstrap.js';
import { runMigrations } from './migration-runner.js';
import { listMigrations } from './sql-files.js';

async function requireDb(): Promise<void> {
  if (!env.databaseUrl) {
    console.error('DATABASE_URL is not set. Refusing to run DB commands.');
    process.exit(2);
  }
}

async function status(): Promise<void> {
  const pool = getPool();
  const migs = listMigrations();
  console.log(
    'Known migrations:',
    migs.map((m) => `${m.version}:${m.name}`).join(', ') || '(none)',
  );
  const { rows } = await pool.query<{ schema_version: number; n: string }>(
    'SELECT schema_version, count(*) AS n FROM public.users GROUP BY schema_version ORDER BY schema_version',
  );
  if (rows.length === 0) {
    console.log('No users yet.');
  } else {
    for (const r of rows) console.log(`schema_version ${r.schema_version}: ${r.n} user(s)`);
  }
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  await requireDb();
  try {
    switch (cmd) {
      case 'bootstrap':
        await bootstrap();
        break;
      case 'migrate': {
        const res = await runMigrations();
        if (res.failures.length > 0) process.exitCode = 1;
        break;
      }
      case 'status':
        await status();
        break;
      default:
        console.error('Usage: cli.ts <bootstrap|migrate|status>');
        process.exit(2);
    }
  } finally {
    await closePool();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
