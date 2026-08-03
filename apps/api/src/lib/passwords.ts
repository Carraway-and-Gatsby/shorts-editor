import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

const KEY_LENGTH = 32;

/** scrypt 기반 비밀번호 해시: `salt.hash` (base64url) */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;
  return `${salt.toString('base64url')}.${derived.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltPart, hashPart] = stored.split('.');
  if (!saltPart || !hashPart) {
    return false;
  }
  const salt = Buffer.from(saltPart, 'base64url');
  const expected = Buffer.from(hashPart, 'base64url');
  const derived = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
