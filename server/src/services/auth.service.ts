import { createHash, randomBytes } from 'node:crypto';
import type Database from 'better-sqlite3';
import { config } from '../config.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAGIC_TTL_MS = 60_000;
const SESSION_TTL_MS = 30 * 86_400_000;

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function shortCode(): string {
  const bytes = randomBytes(8);
  let code = '';
  for (const byte of bytes) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

function normalizeCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export interface LoginToken {
  token: string;
  code: string;
  expiresAt: number;
  url: string;
}

export function createLoginToken(db: Database.Database): LoginToken {
  const token = randomBytes(32).toString('hex');
  const code = shortCode();
  const expiresAt = Date.now() + MAGIC_TTL_MS;
  db.prepare(
    `INSERT INTO auth_tokens (token_hash, short_code_hash, kind, expires_at, used, created_at)
     VALUES (?, ?, 'magic_link', ?, 0, ?)`,
  ).run(sha256(token), sha256(normalizeCode(code)), expiresAt, Date.now());
  return { token, code, expiresAt, url: `${config.PUBLIC_URL.replace(/\/$/, '')}/auth/login?token=${token}` };
}

export function createSession(db: Database.Database): string {
  const token = randomBytes(32).toString('hex');
  db.prepare(
    `INSERT INTO auth_tokens (token_hash, short_code_hash, kind, expires_at, used, created_at)
     VALUES (?, NULL, 'session', ?, 0, ?)`,
  ).run(sha256(token), Date.now() + SESSION_TTL_MS, Date.now());
  return token;
}

function consumeMagicRow(db: Database.Database, where: string, value: string): string | null {
  const row = db
    .prepare(`SELECT token_hash FROM auth_tokens WHERE ${where} = ? AND kind = 'magic_link' AND used = 0 AND expires_at > ?`)
    .get(value, Date.now()) as { token_hash: string } | undefined;
  if (!row) return null;
  db.prepare('UPDATE auth_tokens SET used = 1 WHERE token_hash = ?').run(row.token_hash);
  return createSession(db);
}

export function consumeMagicToken(db: Database.Database, token: string): string | null {
  return consumeMagicRow(db, 'token_hash', sha256(token));
}

export function consumeShortCode(db: Database.Database, code: string): string | null {
  const normalized = normalizeCode(code);
  if (normalized.length !== 8) return null;
  return consumeMagicRow(db, 'short_code_hash', sha256(normalized));
}

export function validateSession(db: Database.Database, token: string | undefined): boolean {
  if (!token) return false;
  const row = db
    .prepare(`SELECT 1 FROM auth_tokens WHERE token_hash = ? AND kind = 'session' AND expires_at > ?`)
    .get(sha256(token), Date.now());
  return row !== undefined;
}

export function revokeSession(db: Database.Database, token: string | undefined): void {
  if (!token) return;
  db.prepare('DELETE FROM auth_tokens WHERE token_hash = ?').run(sha256(token));
}

export function cleanupExpiredTokens(db: Database.Database): void {
  db.prepare('DELETE FROM auth_tokens WHERE expires_at <= ? AND kind = ?').run(Date.now() - 86_400_000, 'magic_link');
}
