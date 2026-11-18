import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { normalizeUsername, safeUser } from './auth.js';

const emptyDatabase = () => ({ schemaVersion: 1, users: [], sessions: [] });

export class FileStore {
  constructor(filename) {
    this.filename = path.resolve(filename);
    this.pending = Promise.resolve();
  }

  async read() {
    try {
      const db = JSON.parse(await fs.readFile(this.filename, 'utf8'));
      if (!db || !Array.isArray(db.users) || !Array.isArray(db.sessions)) {
        throw new Error('Invalid storage file format');
      }
      return db;
    } catch (error) {
      if (error.code === 'ENOENT') return emptyDatabase();
      throw error;
    }
  }

  async mutate(mutator) {
    const operation = this.pending.then(async () => {
      const db = await this.read();
      const result = mutator(db);
      const folder = path.dirname(this.filename);
      await fs.mkdir(folder, { recursive: true, mode: 0o700 });
      const tempfile = `${this.filename}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(tempfile, JSON.stringify(db, null, 2) + '\n', { mode: 0o600 });
        await fs.rename(tempfile, this.filename);
      } catch (error) {
        await fs.rm(tempfile, { force: true }).catch(() => {});
        throw error;
      }
      return result;
    });
    this.pending = operation.then(() => {}, () => {});
    return operation;
  }

  async createUser({ username, passwordHash, role = 'user' }) {
    return this.mutate(db => {
      const normalized = normalizeUsername(username);
      if (db.users.some(user => user.username === normalized)) return null;
      const user = {
        id: randomUUID(), username: normalized, role,
        passwordHash, createdAt: new Date().toISOString()
      };
      db.users.push(user);
      return safeUser(user);
    });
  }

  async findUserByUsername(username) {
    const db = await this.read();
    return db.users.find(user => user.username === normalizeUsername(username)) ?? null;
  }

  async findUserById(id) {
    const db = await this.read();
    return db.users.find(user => user.id === id) ?? null;
  }

  async saveSession({ tokenHash, userId, expiresAt }) {
    return this.mutate(db => {
      db.sessions = db.sessions.filter(session => new Date(session.expiresAt).getTime() > Date.now());
      db.sessions.push({ tokenHash, userId, expiresAt });
    });
  }

  async findSession(tokenHash) {
    const db = await this.read();
    const session = db.sessions.find(item => item.tokenHash === tokenHash);
    if (!session || new Date(session.expiresAt).getTime() <= Date.now()) return null;
    return session;
  }

  async revokeSession(tokenHash) {
    return this.mutate(db => {
      db.sessions = db.sessions.filter(session => session.tokenHash !== tokenHash);
    });
  }

  async listSafeUsers() {
    const db = await this.read();
    return db.users.map(safeUser);
  }
}
