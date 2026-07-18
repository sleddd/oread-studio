/**
 * Session tokens. The RAW token is sent to the client (in an httpOnly cookie);
 * only its SHA-256 hash is stored server-side. On each request we hash the
 * presented token and look it up — a DB leak never yields usable tokens.
 */
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

/** Generate a high-entropy opaque session token (base64url). */
export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** Constant-time compare of two hex digests. */
export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
