/**
 * Password hashing with Node's built-in scrypt (no native deps).
 * Stored format: "scrypt$<saltHex>$<hashHex>". Plaintext is never stored.
 */
import { randomBytes, scrypt as _scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(_scrypt) as (pw: string | Buffer, salt: Buffer, keylen: number) => Promise<Buffer>;
const KEYLEN = 64;

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(plain, salt, KEYLEN);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1]!, 'hex');
  const expected = Buffer.from(parts[2]!, 'hex');
  const derived = await scrypt(plain, salt, expected.length);
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}
