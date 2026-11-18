import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth.js';

async function fixture(t, options = {}) {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'boundarylab-qa-'));
  const dataFile = path.join(folder, 'database.json');
  const { server, store } = createApp({ dataFile, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await rm(folder, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function call(route, { method = 'GET', body, cookie, headers = {} } = {}) {
    const response = await fetch(base + route, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers
      },
      ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {})
    });
    return {
      status: response.status,
      body: response.status === 204 ? null : await response.json(),
      cookie: response.headers.get('set-cookie')
    };
  }
  async function register(username = 'standard_user', password = 'DemoPassword123!') {
    return call('/api/register', { method: 'POST', body: { username, password } });
  }
  async function login(username = 'standard_user', password = 'DemoPassword123!') {
    return call('/api/login', { method: 'POST', body: { username, password } });
  }
  return { folder, dataFile, store, base, call, register, login };
}

function extractCookie(setCookieHeader) {
  return setCookieHeader.split(';')[0];
}

test('01 Public endpoint is available without a session (200)', async t => {
  const { call } = await fixture(t);
  const result = await call('/api/public');
  assert.equal(result.status, 200);
  assert.equal(result.body.access, 'public');
  assert.equal((await call('/health')).status, 200);
});

test('02 Protected and admin endpoints reject guests (401)', async t => {
  const { call } = await fixture(t);
  assert.equal((await call('/api/me')).status, 401);
  assert.equal((await call('/api/user/dashboard')).status, 401);
  assert.equal((await call('/api/admin/users')).status, 401);
});

test('03 Registration succeeds as User, hashes password, and never returns hashes', async t => {
  const { register, dataFile } = await fixture(t);
  const secret = 'MyUniqueSecurePassword123!';
  const response = await register('alice', secret);
  assert.equal(response.status, 201);
  assert.equal(response.body.user.role, 'user');
  assert.equal(Object.hasOwn(response.body.user, 'passwordHash'), false);
  const db = JSON.parse(await readFile(dataFile, 'utf8'));
  assert.equal(db.users.length, 1);
  assert.equal(db.users[0].passwordHash.startsWith('pbkdf2_sha256$600000$'), true);
  assert.equal(JSON.stringify(db).includes(secret), false);
});

test('04 Each password has a unique random salt', async t => {
  const { register, store } = await fixture(t);
  const samePassword = 'TheSameStrongDemoPassword!';
  assert.equal((await register('alice', samePassword)).status, 201);
  assert.equal((await register('bob', samePassword)).status, 201);
  const db = await store.read();
  assert.notEqual(db.users[0].passwordHash, db.users[1].passwordHash);
  assert.notEqual(db.users[0].passwordHash.split('$')[2], db.users[1].passwordHash.split('$')[2]);
});

test('05 Login creates an HttpOnly session; dashboard allows User; admin denies User (403)', async t => {
  const { register, login, call, store } = await fixture(t);
  await register();
  const signedIn = await login();
  assert.equal(signedIn.status, 200);
  assert.equal(signedIn.body.user.role, 'user');
  assert.match(signedIn.cookie, /HttpOnly/);
  assert.match(signedIn.cookie, /SameSite=Strict/);
  const sessionCookie = extractCookie(signedIn.cookie);
  const token = sessionCookie.split('=')[1];
  const db = await store.read();
  assert.equal(db.sessions.length, 1);
  assert.equal(JSON.stringify(db.sessions).includes(token), false);
  assert.equal((await call('/api/me', { cookie: sessionCookie })).status, 200);
  assert.equal((await call('/api/user/dashboard', { cookie: sessionCookie })).status, 200);
  const forbidden = await call('/api/admin/users', { cookie: sessionCookie });
  assert.equal(forbidden.status, 403);
  assert.match(forbidden.body.error, /admin role required/);
});

test('06 Admin seeded on the server can access both protected and admin routes (200)', async t => {
  const { store, login, call, register } = await fixture(t);
  await register('alice', 'GoodUserPassword1234!');
  await store.createUser({ username: 'security_admin', passwordHash: await hashPassword('AdminSecurePassword123!'), role: 'admin' });
  const session = await login('security_admin', 'AdminSecurePassword123!');
  assert.equal(session.status, 200);
  const cookie = extractCookie(session.cookie);
  assert.equal((await call('/api/user/dashboard', { cookie })).status, 200);
  const result = await call('/api/admin/users', { cookie });
  assert.equal(result.status, 200);
  assert.equal(result.body.count, 2);
  assert.equal(result.body.users.some(u => u.role === 'admin'), true);
  assert.equal(result.body.users.every(u => !('passwordHash' in u)), true);
});

test('07 Logging out invalidates the server session, not just the browser cookie', async t => {
  const { register, login, call, store } = await fixture(t);
  await register();
  const signedIn = await login();
  const oldCookie = extractCookie(signedIn.cookie);
  assert.equal((await call('/api/logout', { method: 'POST', body: {}, cookie: oldCookie })).status, 204);
  assert.equal((await call('/api/me', { cookie: oldCookie })).status, 401);
  assert.equal((await store.read()).sessions.length, 0);
});

test('08 Invalid login returns generic, identical 401 for known and unknown users', async t => {
  const { register, login } = await fixture(t);
  await register();
  const wrongPassword = await login('standard_user', 'InvalidPassword123!');
  const unknownUser = await login('unknown_user', 'InvalidPassword123!');
  assert.equal(wrongPassword.status, 401);
  assert.equal(unknownUser.status, 401);
  assert.deepEqual(wrongPassword.body, unknownUser.body);
  assert.equal(wrongPassword.body.error, 'Invalid username or password');
});

test('09 Registration refuses role injection and empty fields', async t => {
  const { register, call, store } = await fixture(t);
  const selfAdmin = await call('/api/register', { method: 'POST', body: { username: 'malicious', password: 'SomePassword12345!', role: 'admin' } });
  assert.equal(selfAdmin.status, 400);
  const missing = await call('/api/register', { method: 'POST', body: { username: '', password: '' } });
  assert.equal(missing.status, 400);
  const invalidName = await register("' OR '1'='1' --", 'GoodPassword1234!');
  assert.equal(invalidName.status, 400);
  assert.equal((await store.read()).users.length, 0);
});

test('10 SQL-like input never bypasses login or crashes the server', async t => {
  const { register, login, call } = await fixture(t);
  await register();
  const attack = await login('standard_user', "' OR '1'='1' --");
  assert.equal(attack.status, 401);
  assert.equal((await call('/health')).status, 200);
});

test('11 Unexpected origins and non-JSON POSTs are rejected', async t => {
  const { call } = await fixture(t);
  const crossOrigin = await call('/api/register', { method: 'POST', body: { username: 'alice', password: 'SomePassword123!' }, headers: { Origin: 'https://evil.example' } });
  assert.equal(crossOrigin.status, 403);
  const badType = await call('/api/register', { method: 'POST', body: '{}', headers: { 'Content-Type': 'text/plain' } });
  assert.equal(badType.status, 415);
});

test('12 Malformed JSON and oversized bodies fail safely', async t => {
  const { call } = await fixture(t);
  const malformed = await call('/api/register', { method: 'POST', body: '{oops' });
  assert.equal(malformed.status, 400);
  const huge = await call('/api/register', { method: 'POST', body: JSON.stringify({ username:'a'.repeat(17_000), password:'pass' }) });
  assert.equal(huge.status, 413);
});

test('13 Repeated failed logins trigger 429 rate limiting', async t => {
  const { login } = await fixture(t);
  for (let i = 0; i < 12; i++) assert.equal((await login('not_found', 'WrongPassword123!')).status, 401);
  assert.equal((await login('not_found', 'WrongPassword123!')).status, 429);
});

test('14 Production session cookies include Secure and __Host- prefix', async t => {
  const { store, login } = await fixture(t, { production: true });
  await store.createUser({ username:'alice', passwordHash: await hashPassword('DemoPassword123!'), role:'user' });
  const result = await login('alice', 'DemoPassword123!');
  assert.equal(result.status, 200);
  assert.match(result.cookie, /^__Host-bl_session=/);
  assert.match(result.cookie, /Secure/);
});
