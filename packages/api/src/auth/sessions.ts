import type { Db } from '../db/index.ts';
import { getUser, type UserRow } from '../models/users.ts';
import { generateSessionToken, sha256 } from './crypto.ts';

export const SESSION_COOKIE = 'tokkl_session';
/** Session cookie name from before the rename to Tokkl. Still read, so an upgrade does not log anyone out. */
export const LEGACY_SESSION_COOKIE = 'tt_session';

export function createSession(db: Db, userId: number, days: number, userAgent: string): { token: string; expires: Date } {
  const token = generateSessionToken();
  const now = new Date();
  const expires = new Date(now.getTime() + days * 86_400_000);
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)')
    .run(sha256(token), userId, now.toISOString(), expires.toISOString(), userAgent.slice(0, 255));
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now.toISOString());
  return { token, expires };
}

export function findSessionUser(db: Db, token: string): UserRow | undefined {
  const session = db.prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?').get(sha256(token)) as
    | { user_id: number; expires_at: string }
    | undefined;
  if (!session || session.expires_at < new Date().toISOString()) return undefined;
  return getUser(db, session.user_id);
}

export function deleteSession(db: Db, token: string): void {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

export function deleteOtherSessions(db: Db, userId: number, keepToken?: string): void {
  if (keepToken) {
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(userId, sha256(keepToken));
  } else {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }
}
