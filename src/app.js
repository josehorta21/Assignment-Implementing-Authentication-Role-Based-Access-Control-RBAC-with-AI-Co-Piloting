import { createServer as createHttpServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createSessionToken, hashPassword, hashSessionToken, safeUser,
  validatePassword, validateUsername, verifyPassword, normalizeUsername
} from './auth.js';
import { FileStore } from './store.js';

const baseDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(baseDir, '..', 'public');
const SESSION_MS = 30 * 60 * 1000;
const MAX_BODY_BYTES = 16 * 1024;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LIMIT = 12;

function respond(res, code, payload, extraHeaders = {}) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders
  });
  res.end(code === 204 ? '' : JSON.stringify(payload));
}

function secureHeaders(res) {
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
}

function getCookie(req, cookieName) {
  const cookies = (req.headers.cookie || '').split(';');
  for (const pair of cookies) {
    const index = pair.indexOf('=');
    if (index > -1 && pair.slice(0, index).trim() === cookieName) return pair.slice(index + 1).trim();
  }
  return null;
}

function setSessionCookie(token, cookieName, production) {
  return `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=1800${production ? '; Secure' : ''}`;
}

function clearSessionCookie(cookieName, production) {
  return `${cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${production ? '; Secure' : ''}`;
}

function isTrustedOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // Non-browser API clients. Browser JSON requests provide Origin.
  try {
    const parsed = new URL(origin);
    return parsed.host === req.headers.host && (parsed.protocol === 'http:' || parsed.protocol === 'https:');
  } catch {
    return false;
  }
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error('Request body too large');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch { /* Handled below. */ }
  const error = new Error('Invalid JSON object');
  error.status = 400;
  throw error;
}

async function tryAuth(req, store, cookieName) {
  const token = getCookie(req, cookieName);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const tokenHash = hashSessionToken(token);
  const session = await store.findSession(tokenHash);
  if (!session) return null;
  const user = await store.findUserById(session.userId);
  return user ? { user, tokenHash } : null;
}

function requireAuth(res, auth) {
  if (!auth) {
    respond(res, 401, { error: 'Authentication required' });
    return false;
  }
  return true;
}

function requireAdmin(res, auth) {
  if (!requireAuth(res, auth)) return false;
  if (auth.user.role !== 'admin') {
    respond(res, 403, { error: 'Forbidden: admin role required' });
    return false;
  }
  return true;
}

export function createApp({ dataFile = '.data/boundarylab.json', production = false } = {}) {
  const store = new FileStore(dataFile);
  const cookieName = production ? '__Host-bl_session' : 'bl_session';
  const loginAttempts = new Map();
  const server = createHttpServer(async (req, res) => {
    secureHeaders(res);
    try {
      const pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
      const method = req.method;

      if (method === 'GET' && pathname === '/api/public') {
        return respond(res, 200, { service: 'BoundaryLab Security API', access: 'public', status: 'operational' });
      }
      if (method === 'GET' && pathname === '/health') {
        return respond(res, 200, { ok: true });
      }

      if (pathname.startsWith('/api/')) {
        if (method === 'POST') {
          if (!isTrustedOrigin(req)) return respond(res, 403, { error: 'Untrusted request origin' });
          if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) {
            return respond(res, 415, { error: 'Content-Type must be application/json' });
          }
        }
        if (method === 'POST' && pathname === '/api/register') {
          const body = await readJson(req);
          if (Object.hasOwn(body, 'role')) return respond(res, 400, { error: 'Role cannot be assigned during registration' });
          if (!validateUsername(body.username)) return respond(res, 400, { error: 'Username must be 3–32 characters: letters, digits, . _ or -, beginning with a letter' });
          if (!validatePassword(body.password)) return respond(res, 400, { error: 'Password must be 12–128 characters' });
          // Public registration always receives the least-privileged role.
          const passwordHash = await hashPassword(body.password);
          const user = await store.createUser({ username: body.username, passwordHash, role: 'user' });
          if (!user) return respond(res, 409, { error: 'Unable to register this username' });
          return respond(res, 201, { user, message: 'Account created. Sign in to continue.' });
        }
        if (method === 'POST' && pathname === '/api/login') {
          const ip = req.socket.remoteAddress || 'unknown';
          const now = Date.now();
          const bucket = (loginAttempts.get(ip) || []).filter(timestamp => timestamp > now - LOGIN_WINDOW_MS);
          if (bucket.length >= LOGIN_LIMIT) return respond(res, 429, { error: 'Too many login attempts. Please try again later.' });
          const body = await readJson(req);
          if (typeof body.username !== 'string' || typeof body.password !== 'string' || body.password.length > 128 || body.password.length === 0) {
            return respond(res, 400, { error: 'Username and password are required' });
          }
          const user = validateUsername(body.username)
            ? await store.findUserByUsername(normalizeUsername(body.username)) : null;
          const valid = await verifyPassword(body.password, user?.passwordHash);
          if (!valid) {
            bucket.push(now);
            loginAttempts.set(ip, bucket);
            return respond(res, 401, { error: 'Invalid username or password' });
          }
          // On login, never reuse a caller-supplied preexisting session ID.
          const oldAuth = await tryAuth(req, store, cookieName);
          if (oldAuth) await store.revokeSession(oldAuth.tokenHash);
          const token = createSessionToken();
          await store.saveSession({ tokenHash: hashSessionToken(token), userId: user.id, expiresAt: new Date(now + SESSION_MS).toISOString() });
          return respond(res, 200, { user: safeUser(user), message: 'Signed in successfully' }, { 'Set-Cookie': setSessionCookie(token, cookieName, production) });
        }
        if (method === 'POST' && pathname === '/api/logout') {
          const auth = await tryAuth(req, store, cookieName);
          if (auth) await store.revokeSession(auth.tokenHash);
          return respond(res, 204, null, { 'Set-Cookie': clearSessionCookie(cookieName, production) });
        }
        if (method === 'GET' && pathname === '/api/me') {
          const auth = await tryAuth(req, store, cookieName);
          if (!requireAuth(res, auth)) return;
          return respond(res, 200, { user: safeUser(auth.user) });
        }
        if (method === 'GET' && pathname === '/api/user/dashboard') {
          const auth = await tryAuth(req, store, cookieName);
          if (!requireAuth(res, auth)) return;
          return respond(res, 200, { message: `Welcome to your protected dashboard, ${auth.user.username}.`, user: safeUser(auth.user), boundary: 'authenticated' });
        }
        if (method === 'GET' && pathname === '/api/admin/users') {
          const auth = await tryAuth(req, store, cookieName);
          if (!requireAdmin(res, auth)) return;
          const users = await store.listSafeUsers();
          return respond(res, 200, { users, count: users.length, boundary: 'admin-only' });
        }
        return respond(res, 404, { error: 'API route not found' });
      }

      if (method === 'GET') {
        const assets = {
          '/': ['index.html', 'text/html; charset=utf-8'],
          '/index.html': ['index.html', 'text/html; charset=utf-8'],
          '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
          '/app.js': ['app.js', 'application/javascript; charset=utf-8']
        };
        const asset = assets[pathname];
        if (asset) {
          const content = await readFile(path.join(publicDir, asset[0]));
          res.writeHead(200, { 'Content-Type': asset[1], 'Cache-Control': 'no-cache' });
          res.end(content);
          return;
        }
      }
      respond(res, 404, { error: 'Not found' });
    } catch (error) {
      if (!res.headersSent) respond(res, error.status || 500, { error: error.status ? error.message : 'Internal server error' });
      if (!error.status) console.error('[BoundaryLab] request failed:', error?.message);
    }
  });
  return { server, store };
}
