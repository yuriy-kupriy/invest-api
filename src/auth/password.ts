import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;
const KEY_LENGTH = 32;

/** `scrypt$<salt>$<hash>`, both base64url. Node's own scrypt — no bcrypt dependency for one function. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

// Compared against when the email is unknown or has no password, so "no such
// user" and "wrong password" cost the same scrypt run — no timing oracle.
const DUMMY_HASH = `scrypt$${Buffer.alloc(16).toString('base64url')}$${Buffer.alloc(KEY_LENGTH).toString('base64url')}`;

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  const [scheme, salt, hash] = (stored ?? DUMMY_HASH).split('$');
  if (scheme !== 'scrypt' || !salt || !hash) {
    return false;
  }
  const expected = Buffer.from(hash, 'base64url');
  const actual = await scrypt(password, Buffer.from(salt, 'base64url'), expected.length);
  return timingSafeEqual(actual, expected) && stored !== null;
}
