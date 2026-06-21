import Database from 'better-sqlite3';
import {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

export function createAuthStore(options = {}) {
  const dbPath = options.dbPath ?? defaultDbPath();
  const sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;

  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);

  const statements = {
    createUser: db.prepare(`
      INSERT INTO users (login, email, display_name, password_hash, created_at, last_seen_at)
      VALUES (@login, @email, @displayName, @passwordHash, @now, @now)
    `),
    userByLogin: db.prepare(`
      SELECT id, login, email, display_name, password_hash, created_at, last_seen_at
      FROM users
      WHERE login = ?
    `),
    userByEmail: db.prepare(`
      SELECT id, login, email, display_name, created_at, last_seen_at
      FROM users
      WHERE email = ?
    `),
    userById: db.prepare(`
      SELECT id, login, email, display_name, created_at, last_seen_at
      FROM users
      WHERE id = ?
    `),
    touchUser: db.prepare(`
      UPDATE users SET last_seen_at = ? WHERE id = ?
    `),
    createSession: db.prepare(`
      INSERT INTO sessions (token_hash, user_id, expires_at, created_at, last_seen_at, user_agent)
      VALUES (@tokenHash, @userId, @expiresAt, @now, @now, @userAgent)
    `),
    sessionByToken: db.prepare(`
      SELECT
        sessions.token_hash,
        sessions.expires_at,
        users.id,
        users.login,
        users.email,
        users.display_name,
        users.created_at,
        users.last_seen_at
      FROM sessions
      JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = ?
    `),
    touchSession: db.prepare(`
      UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?
    `),
    deleteSession: db.prepare(`
      DELETE FROM sessions WHERE token_hash = ?
    `),
    deleteExpiredSessions: db.prepare(`
      DELETE FROM sessions WHERE expires_at <= ?
    `),
  };

  function register({ login, email, password, displayName }, meta = {}) {
    const normalizedLogin = normalizeLogin(login);
    const normalizedEmail = normalizeEmail(email);
    const normalizedPassword = normalizePassword(password);
    const normalizedDisplayName = normalizeDisplayName(displayName || login);
    const now = Date.now();
    const passwordHash = hashPassword(normalizedPassword);

    if (statements.userByLogin.get(normalizedLogin)) {
      throw new Error('Этот логин уже занят.');
    }
    if (statements.userByEmail.get(normalizedEmail)) {
      throw new Error('Эта почта уже зарегистрирована.');
    }

    let info;
    try {
      info = statements.createUser.run({
        login: normalizedLogin,
        email: normalizedEmail,
        displayName: normalizedDisplayName,
        passwordHash,
        now,
      });
    } catch (error) {
      if (String(error?.code ?? '').includes('SQLITE_CONSTRAINT')) {
        throw new Error('Этот логин уже занят.');
      }
      throw error;
    }

    const user = statements.userById.get(info.lastInsertRowid);
    const session = createSession(user.id, meta);
    return { user: publicUser(user), token: session.token };
  }

  function login({ login, password }, meta = {}) {
    const normalizedLogin = normalizeLogin(login);
    const normalizedPassword = normalizePassword(password);
    const row = statements.userByLogin.get(normalizedLogin);
    if (!row || !verifyPassword(normalizedPassword, row.password_hash)) {
      throw new Error('Неверный логин или пароль.');
    }

    const now = Date.now();
    statements.touchUser.run(now, row.id);
    const session = createSession(row.id, meta);
    return { user: publicUser({ ...row, last_seen_at: now }), token: session.token };
  }

  function createSession(userId, meta = {}) {
    cleanupExpiredSessions();
    const token = randomBytes(32).toString('base64url');
    const now = Date.now();
    statements.createSession.run({
      tokenHash: hashToken(token),
      userId,
      expiresAt: now + sessionTtlMs,
      now,
      userAgent: String(meta.userAgent ?? '').slice(0, 240),
    });
    return { token };
  }

  function getUserBySessionToken(token) {
    if (!token) return null;
    cleanupExpiredSessions();
    const tokenHash = hashToken(token);
    const row = statements.sessionByToken.get(tokenHash);
    if (!row) return null;
    const now = Date.now();
    if (row.expires_at <= now) {
      statements.deleteSession.run(tokenHash);
      return null;
    }
    statements.touchSession.run(now, tokenHash);
    statements.touchUser.run(now, row.id);
    return publicUser({ ...row, last_seen_at: now });
  }

  function deleteSession(token) {
    if (!token) return;
    statements.deleteSession.run(hashToken(token));
  }

  function cleanupExpiredSessions() {
    statements.deleteExpiredSessions.run(Date.now());
  }

  cleanupExpiredSessions();

  return {
    dbPath,
    register,
    login,
    getUserBySessionToken,
    deleteSession,
    cleanupExpiredSessions,
  };
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      login TEXT NOT NULL UNIQUE,
      email TEXT,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      user_agent TEXT NOT NULL DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
  `);

  const userColumns = db.prepare('PRAGMA table_info(users)').all().map((column) => column.name);
  if (!userColumns.includes('email')) {
    db.exec('ALTER TABLE users ADD COLUMN email TEXT');
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL');
}

function defaultDbPath() {
  const here = dirname(fileURLToPath(import.meta.url));
  return process.env.RRAM_DB_PATH || join(here, '..', 'data', 'rram.sqlite');
}

function normalizeLogin(value) {
  const login = String(value ?? '').trim().toLowerCase();
  if (!/^[a-z0-9_]{3,24}$/.test(login)) {
    throw new Error('Логин: 3-24 символа, латиница, цифры или _.');
  }
  return login;
}

function normalizeEmail(value) {
  const email = String(value ?? '').trim().toLowerCase();
  if (email.length < 5 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Введите корректную почту для регистрации.');
  }
  return email;
}

function normalizePassword(value) {
  const password = String(value ?? '');
  if (password.length < 6 || password.length > 128) {
    throw new Error('Пароль должен быть от 6 до 128 символов.');
  }
  return password;
}

function normalizeDisplayName(value) {
  const name = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (name.length < 1 || name.length > 32) {
    throw new Error('Имя игрока должно быть от 1 до 32 символов.');
  }
  return name;
}

function hashPassword(password) {
  const salt = randomBytes(16).toString('base64url');
  const key = scryptSync(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  }).toString('base64url');
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt}$${key}`;
}

function verifyPassword(password, encoded) {
  const parts = String(encoded ?? '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, salt, expectedKey] = parts;
  const actual = scryptSync(password, salt, Buffer.from(expectedKey, 'base64url').length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT_MAXMEM,
  });
  const expected = Buffer.from(expectedKey, 'base64url');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function hashToken(token) {
  return createHash('sha256').update(String(token)).digest('base64url');
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    login: row.login,
    email: row.email ?? null,
    displayName: row.display_name,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  };
}
