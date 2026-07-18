/**
 * Account + session data layer (public schema). Signup provisions the user's
 * schema inside the SAME transaction as the users row — if provisioning fails,
 * the whole signup rolls back (no orphan user, no orphan schema).
 */
import { getPool } from '../db/pool.js';
import { hashPassword, verifyPassword } from './password.js';
import { generateSessionToken, hashToken } from './tokens.js';
import { env } from '../env.js';

export interface UserRow {
  id: string;
  email: string;
  name: string;
  schema_name: string;
  schema_version: number;
  totp_enabled: boolean;
  totp_secret: string | null;
  password_hash: string;
}

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  schemaName: string;
  totpEnabled: boolean;
}

function toPublic(u: UserRow): PublicUser {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    schemaName: u.schema_name,
    totpEnabled: u.totp_enabled,
  };
}

export class SignupError extends Error {}

/**
 * Create a user and provision their schema in one transaction.
 * schema_name is generated server-side by the SQL (gen_random_uuid hex).
 */
export async function signup(params: {
  email: string;
  name: string;
  password: string;
}): Promise<PublicUser> {
  const email = params.email.trim().toLowerCase();
  const name = params.name.trim();
  if (!email || !name || !params.password) {
    throw new SignupError('email, name and password are required');
  }
  const passwordHash = await hashPassword(params.password);

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL search_path TO public');

    let user: { id: string; schema_name: string };
    try {
      const { rows } = await client.query<{ id: string; schema_name: string }>(
        `INSERT INTO public.users (email, name, password_hash, schema_name)
         VALUES ($1, $2, $3, 'u_' || replace(gen_random_uuid()::text, '-', ''))
         RETURNING id, schema_name`,
        [email, name, passwordHash],
      );
      user = rows[0]!;
    } catch (err: unknown) {
      // unique_violation on email
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code?: string }).code === '23505'
      ) {
        throw new SignupError('An account with that email already exists');
      }
      throw err;
    }

    await client.query('SELECT public.provision_user_schema($1)', [
      user.schema_name,
    ]);

    // Bring the fresh schema up to the latest migration version so the
    // provisioner + migration runner stay consistent (provisioner already
    // creates current shape; set schema_version to the highest known migration).
    await client.query(
      `UPDATE public.users
       SET schema_version = COALESCE((SELECT max(version) FROM public.schema_migrations), 1)
       WHERE id = $1`,
      [user.id],
    );

    await client.query('COMMIT');

    const { rows } = await getPool().query<UserRow>(
      'SELECT * FROM public.users WHERE id = $1',
      [user.id],
    );
    return toPublic(rows[0]!);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const { rows } = await getPool().query<UserRow>(
    'SELECT * FROM public.users WHERE email = $1',
    [email.trim().toLowerCase()],
  );
  return rows[0] ?? null;
}

export async function findUserById(id: string): Promise<UserRow | null> {
  const { rows } = await getPool().query<UserRow>(
    'SELECT * FROM public.users WHERE id = $1',
    [id],
  );
  return rows[0] ?? null;
}

/** Verify email + password. Returns the user row on success, null otherwise. */
export async function verifyCredentials(
  email: string,
  password: string,
): Promise<UserRow | null> {
  const user = await findUserByEmail(email);
  if (!user) {
    // Still spend time hashing to reduce timing oracle on account existence.
    await verifyPassword(
      '$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      password,
    );
    return null;
  }
  const ok = await verifyPassword(user.password_hash, password);
  return ok ? user : null;
}

export async function touchLastLogin(userId: string): Promise<void> {
  await getPool().query(
    'UPDATE public.users SET last_login_at = now() WHERE id = $1',
    [userId],
  );
}

// ─── sessions ───────────────────────────────────────────────
export interface SessionInfo {
  user: PublicUser;
  userRow: UserRow;
  sessionId: string;
}

/** Create a session; returns the RAW token to set as a cookie. */
export async function createSession(userId: string): Promise<string> {
  const raw = generateSessionToken();
  const tokenHash = hashToken(raw);
  const ttlDays = env.sessionTtlDays;
  await getPool().query(
    `INSERT INTO public.sessions (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + ($3 || ' days')::interval)`,
    [userId, tokenHash, String(ttlDays)],
  );
  return raw;
}

/** Validate a raw token; returns the session + user, or null. Updates last_seen. */
export async function validateSession(raw: string): Promise<SessionInfo | null> {
  const tokenHash = hashToken(raw);
  const { rows } = await getPool().query<{ id: string; user_id: string }>(
    `SELECT id, user_id FROM public.sessions
     WHERE token_hash = $1 AND expires_at > now()`,
    [tokenHash],
  );
  const sess = rows[0];
  if (!sess) return null;
  await getPool().query(
    'UPDATE public.sessions SET last_seen_at = now() WHERE id = $1',
    [sess.id],
  );
  const userRow = await findUserById(sess.user_id);
  if (!userRow) return null;
  return { user: toPublic(userRow), userRow, sessionId: sess.id };
}

export async function revokeSession(raw: string): Promise<void> {
  await getPool().query('DELETE FROM public.sessions WHERE token_hash = $1', [
    hashToken(raw),
  ]);
}

export { toPublic };
