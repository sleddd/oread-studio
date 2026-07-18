/**
 * Argon2id password hashing. Uses @node-rs/argon2 (native, no build step).
 */
import { hash, verify } from '@node-rs/argon2';

// Algorithm.Argon2id === 2. Use the literal to avoid importing the ambient
// const enum (incompatible with verbatimModuleSyntax).
const ARGON2ID = 2 as const;

const OPTS = {
  algorithm: ARGON2ID,
  // OWASP-ish defaults; tune per host.
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTS);
}

export async function verifyPassword(
  storedHash: string,
  plain: string,
): Promise<boolean> {
  try {
    return await verify(storedHash, plain);
  } catch {
    return false;
  }
}
