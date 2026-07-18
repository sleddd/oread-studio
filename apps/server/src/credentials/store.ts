/**
 * Credentials store (per-user schema). Provider keys are envelope-sealed before
 * storage; plaintext is produced only at request time inside `resolveAuth`, and
 * never logged or cached.
 *
 * The `local` provider needs no secret; its credential rows may carry an empty
 * secret (or a base URL) — sealing still applies uniformly.
 */
import { withUserSchema } from '../db/pool.js';
import { seal, open, type SealedRecord } from '../crypto/envelope.js';
import type { Provider, CredentialMeta } from '@oread/shared';
import type { StoreCtx } from '../storage/types.js';
import type { ProviderAuth } from '../ai/provider.js';

export interface NewCredential {
  provider: Provider;
  label: string;
  secret: string;
  /** cloudflare */
  accountId?: string;
  /** bedrock */
  region?: string;
  /** local */
  baseUrl?: string;
}

/**
 * Extra (non-secret) auth fields are packed into the sealed plaintext as JSON so
 * a single credential row round-trips everything a provider needs.
 */
interface SealedPayload {
  secret: string;
  accountId?: string;
  region?: string;
  baseUrl?: string;
}

export async function listCredentials(ctx: StoreCtx): Promise<CredentialMeta[]> {
  return withUserSchema(ctx.schemaName, async (c) => {
    const { rows } = await c.query<CredentialMeta>(
      `SELECT id, provider, label, master_key_ver, created_at, last_used_at
       FROM credentials ORDER BY created_at DESC`,
    );
    return rows;
  });
}

export async function createCredential(
  ctx: StoreCtx,
  input: NewCredential,
): Promise<CredentialMeta> {
  const payload: SealedPayload = {
    secret: input.secret,
    accountId: input.accountId,
    region: input.region,
    baseUrl: input.baseUrl,
  };
  const rec: SealedRecord = seal(JSON.stringify(payload));
  return withUserSchema(ctx.schemaName, async (c) => {
    const { rows } = await c.query<CredentialMeta>(
      `INSERT INTO credentials
         (provider, label, ciphertext, iv, auth_tag, wrapped_dek, dek_iv, master_key_ver)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, provider, label, master_key_ver, created_at, last_used_at`,
      [
        input.provider,
        input.label,
        rec.ciphertext,
        rec.iv,
        rec.authTag,
        rec.wrappedDek,
        rec.dekIv,
        rec.masterKeyVer,
      ],
    );
    return rows[0]!;
  });
}

export async function deleteCredential(ctx: StoreCtx, id: string): Promise<void> {
  await withUserSchema(ctx.schemaName, async (c) => {
    await c.query('DELETE FROM credentials WHERE id = $1', [id]);
  });
}

/**
 * Resolve + decrypt a credential into ProviderAuth for a single request.
 * Bumps last_used_at. The returned auth must not be logged or cached.
 */
export async function resolveAuth(
  ctx: StoreCtx,
  credentialId: string,
): Promise<{ provider: Provider; auth: ProviderAuth } | null> {
  return withUserSchema(ctx.schemaName, async (c) => {
    const { rows } = await c.query<{
      provider: Provider;
      ciphertext: Buffer;
      iv: Buffer;
      auth_tag: Buffer;
      wrapped_dek: Buffer;
      dek_iv: Buffer;
      master_key_ver: number;
    }>(
      `SELECT provider, ciphertext, iv, auth_tag, wrapped_dek, dek_iv, master_key_ver
       FROM credentials WHERE id = $1`,
      [credentialId],
    );
    const row = rows[0];
    if (!row) return null;
    const plaintext = open({
      ciphertext: row.ciphertext,
      iv: row.iv,
      authTag: row.auth_tag,
      wrappedDek: row.wrapped_dek,
      dekIv: row.dek_iv,
      masterKeyVer: row.master_key_ver,
    });
    const payload = JSON.parse(plaintext) as SealedPayload;
    await c.query('UPDATE credentials SET last_used_at = now() WHERE id = $1', [
      credentialId,
    ]);
    return {
      provider: row.provider,
      auth: {
        secret: payload.secret,
        accountId: payload.accountId,
        region: payload.region,
        baseUrl: payload.baseUrl,
      },
    };
  });
}
