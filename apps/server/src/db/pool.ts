/**
 * Postgres connection pool + the schema-per-user request pattern.
 *
 * SECURITY: `schema_name` is ALWAYS server-generated ('u_' + uuid hex), never
 * user input. `withUserSchema` additionally validates the format defensively
 * before interpolating it into `SET search_path`, so even a bug that let a
 * caller pass an arbitrary string cannot inject SQL here.
 */
import pg from 'pg';
import { env } from '../env.js';

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (pool) return pool;
  const connectionString = env.databaseUrl;
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is not set. Postgres is required unless OREAD_STORAGE=local ' +
        'and you avoid auth/DB endpoints.',
    );
  }
  const ssl =
    env.pgSslMode === 'require' || env.pgSslMode === 'prefer'
      ? { rejectUnauthorized: false }
      : undefined;
  pool = new Pool({ connectionString, ssl, max: 10 });
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/** A user schema name must be exactly 'u_' followed by 32 lowercase hex chars. */
const SCHEMA_NAME_RE = /^u_[0-9a-f]{32}$/;

export function isValidUserSchemaName(name: string): boolean {
  return SCHEMA_NAME_RE.test(name);
}

/**
 * Check out a connection, point search_path at the user's schema (plus
 * pg_catalog implicitly; public deliberately excluded), run `fn` with bare
 * table names, then reset search_path to public before returning the
 * connection to the pool.
 */
export async function withUserSchema<T>(
  schemaName: string,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  if (!isValidUserSchemaName(schemaName)) {
    // Never interpolate an unexpected value into SET search_path.
    throw new Error(`Refusing to use invalid schema name: ${schemaName}`);
  }
  const client = await getPool().connect();
  try {
    // pg_temp/pg_catalog are always searched; we set ONLY the user schema so
    // route code cannot accidentally read public user-data (there is none).
    await client.query(`SET search_path TO "${schemaName}"`);
    return await fn(client);
  } finally {
    try {
      await client.query('SET search_path TO public');
    } finally {
      client.release();
    }
  }
}

/** Run against the public schema (auth). */
export async function withPublic<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('SET search_path TO public');
    return await fn(client);
  } finally {
    client.release();
  }
}

export function generateSchemaName(): string {
  // 'u_' + 32 hex chars (uuid without dashes), matching the signup SQL.
  const hex = crypto.randomUUID().replace(/-/g, '');
  return `u_${hex}`;
}
