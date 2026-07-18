/**
 * Envelope encryption (AES-256-GCM).
 *
 * Model: a per-item Data Encryption Key (DEK) encrypts the plaintext; the DEK
 * is itself wrapped (encrypted) by a Master Key loaded from the environment.
 * Only the wrapped DEK + ciphertext are stored. `master_key_ver` records which
 * master key wrapped the DEK, so keys can be rotated without bulk re-encryption
 * (old items decrypt with their recorded version; new items use the active one).
 *
 * Plaintext is decrypted in memory at request time only — never logged, never
 * cached.
 */
import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from 'node:crypto';
import { env } from '../env.js';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12; // GCM standard
const KEY_LEN = 32; // 256-bit

export interface SealedRecord {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  wrappedDek: Buffer;
  dekIv: Buffer;
  masterKeyVer: number;
}

function masterKey(ver: number): Buffer {
  const b64 = env.masterKey(ver);
  if (!b64) {
    throw new Error(`MASTER_KEY_V${ver} is not set`);
  }
  const key = Buffer.from(b64, 'base64');
  if (key.length !== KEY_LEN) {
    throw new Error(
      `MASTER_KEY_V${ver} must decode to ${KEY_LEN} bytes (got ${key.length})`,
    );
  }
  return key;
}

function encryptWith(key: Buffer, plaintext: Buffer): {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
} {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { ciphertext, iv, authTag };
}

function decryptWith(
  key: Buffer,
  ciphertext: Buffer,
  iv: Buffer,
  authTag: Buffer,
): Buffer {
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/** Seal a plaintext string into an envelope using the active master key version. */
export function seal(plaintext: string): SealedRecord {
  const ver = env.masterKeyActiveVer;
  const mk = masterKey(ver);
  // 1. Fresh DEK, encrypt the plaintext with it.
  const dek = randomBytes(KEY_LEN);
  const { ciphertext, iv, authTag } = encryptWith(dek, Buffer.from(plaintext, 'utf8'));
  // 2. Wrap the DEK with the master key. Store the DEK's GCM tag appended to
  //    the wrapped bytes so a single BYTEA round-trips.
  const dekIv = randomBytes(IV_LEN);
  const wrapCipher = createCipheriv(ALGO, mk, dekIv);
  const wrappedBody = Buffer.concat([wrapCipher.update(dek), wrapCipher.final()]);
  const wrapTag = wrapCipher.getAuthTag();
  const wrappedDek = Buffer.concat([wrappedBody, wrapTag]);
  return { ciphertext, iv, authTag, wrappedDek, dekIv, masterKeyVer: ver };
}

/** Open a sealed record back into plaintext. */
export function open(rec: SealedRecord): string {
  const mk = masterKey(rec.masterKeyVer);
  // Unwrap the DEK (last 16 bytes are the GCM tag).
  const tagLen = 16;
  const wrappedBody = rec.wrappedDek.subarray(0, rec.wrappedDek.length - tagLen);
  const wrapTag = rec.wrappedDek.subarray(rec.wrappedDek.length - tagLen);
  const dek = decryptWith(mk, wrappedBody, rec.dekIv, wrapTag);
  // Decrypt the payload.
  const plain = decryptWith(dek, rec.ciphertext, rec.iv, rec.authTag);
  return plain.toString('utf8');
}
