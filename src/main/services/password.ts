/**
 * Password hashing.
 *
 * scrypt from Node's own crypto: no dependency to keep current, and a function
 * that is deliberately slow and memory-hungry, so a stolen database file is not
 * a list of passwords. The parameters are stored alongside the hash, so raising
 * them later does not invalidate what is already there.
 *
 * Comparison is constant-time. A shop's till is not a likely target for a
 * timing attack, but the correct comparison costs nothing to write.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const COST = 16384; // N: 2^14, about 50ms on a shop's computer.
const BLOCK_SIZE = 8; // r
const PARALLELISM = 1; // p
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_LENGTH);
  const key = scryptSync(password.normalize('NFKC'), salt, KEY_LENGTH, {
    N: COST,
    r: BLOCK_SIZE,
    p: PARALLELISM,
  });
  return [
    'scrypt',
    COST,
    BLOCK_SIZE,
    PARALLELISM,
    salt.toString('base64'),
    key.toString('base64'),
  ].join('$');
}

export function verifyPassword(password: string, stored: string | null): boolean {
  if (!stored) return false;

  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, costText, blockText, parallelText, saltText, keyText] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];

  const salt = Buffer.from(saltText, 'base64');
  const expected = Buffer.from(keyText, 'base64');
  if (salt.length === 0 || expected.length === 0) return false;

  let actual: Buffer;
  try {
    actual = scryptSync(password.normalize('NFKC'), salt, expected.length, {
      N: Number(costText),
      r: Number(blockText),
      p: Number(parallelText),
    });
  } catch {
    // A stored hash with impossible parameters is a corrupt row, not a match.
    return false;
  }

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
