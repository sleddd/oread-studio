/**
 * TOTP (optional 2FA). The secret is stored ENCRYPTED (envelope-sealed) in
 * public.users.totp_secret as a JSON blob of the sealed record — same
 * discipline as credentials. Enable is a two-step flow: generate → user
 * confirms with a code → we persist + set totp_enabled.
 */
import { TOTP, Secret } from 'otpauth';
import { getPool } from '../db/pool.js';
import { seal, open, type SealedRecord } from '../crypto/envelope.js';

const ISSUER = 'Oread Studio';

function makeTotp(secret: Secret, label: string): TOTP {
  return new TOTP({
    issuer: ISSUER,
    label,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret,
  });
}

function serializeSealed(rec: SealedRecord): string {
  return JSON.stringify({
    ciphertext: rec.ciphertext.toString('base64'),
    iv: rec.iv.toString('base64'),
    authTag: rec.authTag.toString('base64'),
    wrappedDek: rec.wrappedDek.toString('base64'),
    dekIv: rec.dekIv.toString('base64'),
    masterKeyVer: rec.masterKeyVer,
  });
}

function deserializeSealed(json: string): SealedRecord {
  const o = JSON.parse(json);
  return {
    ciphertext: Buffer.from(o.ciphertext, 'base64'),
    iv: Buffer.from(o.iv, 'base64'),
    authTag: Buffer.from(o.authTag, 'base64'),
    wrappedDek: Buffer.from(o.wrappedDek, 'base64'),
    dekIv: Buffer.from(o.dekIv, 'base64'),
    masterKeyVer: o.masterKeyVer,
  };
}

/** Step 1: generate a new secret + otpauth URI to show as a QR. Not yet enabled. */
export function generateTotpSecret(email: string): {
  secretBase32: string;
  otpauthUri: string;
} {
  const secret = new Secret({ size: 20 });
  const totp = makeTotp(secret, email);
  return { secretBase32: secret.base32, otpauthUri: totp.toString() };
}

export function verifyTotpCode(secretBase32: string, code: string): boolean {
  const totp = makeTotp(Secret.fromBase32(secretBase32), 'verify');
  // window 1 tolerates ±1 period of clock drift
  const delta = totp.validate({ token: code.trim(), window: 1 });
  return delta !== null;
}

/** Step 2: persist the (encrypted) secret and flip totp_enabled after the user confirms a code. */
export async function enableTotp(
  userId: string,
  secretBase32: string,
  confirmCode: string,
): Promise<boolean> {
  if (!verifyTotpCode(secretBase32, confirmCode)) return false;
  const sealed = serializeSealed(seal(secretBase32));
  await getPool().query(
    'UPDATE public.users SET totp_secret = $1, totp_enabled = true WHERE id = $2',
    [sealed, userId],
  );
  return true;
}

export async function disableTotp(userId: string): Promise<void> {
  await getPool().query(
    'UPDATE public.users SET totp_secret = NULL, totp_enabled = false WHERE id = $1',
    [userId],
  );
}

/** Verify a login-time code against the stored encrypted secret. */
export function verifyStoredTotp(sealedJson: string, code: string): boolean {
  const secretBase32 = open(deserializeSealed(sealedJson));
  return verifyTotpCode(secretBase32, code);
}
