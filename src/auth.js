import { pbkdf2 as pbkdf2Callback, randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const pbkdf2 = promisify(pbkdf2Callback);
export const PASSWORD_ITERATIONS = 600_000;
const HASH_BYTES = 32;
// Used only to consume approximately equal CPU time for unknown usernames.
const DUMMY_SALT = Buffer.from('a8d5af301b36724c1ca5df3f488be11c', 'hex');
const DUMMY_HASH = Buffer.alloc(HASH_BYTES, 0x5a);

export function validateUsername(username) {
  return typeof username === 'string' && /^[a-zA-Z][a-zA-Z0-9._-]{2,31}$/.test(username);
}

export function validatePassword(password) {
  return typeof password === 'string' && password.length >= 12 && password.length <= 128 && Buffer.byteLength(password, 'utf8') <= 256;
}

export function normalizeUsername(username) {
  return username.toLowerCase();
}

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await pbkdf2(password, salt, PASSWORD_ITERATIONS, HASH_BYTES, 'sha256');
  return `pbkdf2_sha256$${PASSWORD_ITERATIONS}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  // Never let a malformed or absent database record skip the expensive work.
  const fields = typeof stored === 'string' ? stored.split('$') : [];
  const valid = fields.length === 4 && fields[0] === 'pbkdf2_sha256' && fields[1] === String(PASSWORD_ITERATIONS) && /^[a-f0-9]{32}$/i.test(fields[2]) && /^[a-f0-9]{64}$/i.test(fields[3]);
  const salt = valid ? Buffer.from(fields[2], 'hex') : DUMMY_SALT;
  const expected = valid ? Buffer.from(fields[3], 'hex') : DUMMY_HASH;
  const actual = await pbkdf2(password, salt, PASSWORD_ITERATIONS, HASH_BYTES, 'sha256');
  return valid && timingSafeEqual(actual, expected);
}

export function createSessionToken() {
  return randomBytes(32).toString('hex');
}

export function hashSessionToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function safeUser(user) {
  return { id: user.id, username: user.username, role: user.role, createdAt: user.createdAt };
}
