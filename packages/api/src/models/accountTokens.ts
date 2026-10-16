import type { Db } from '../db/index.ts';
import { nowIso, transaction } from '../db/index.ts';
import { generateSessionToken, sha256 } from '../auth/crypto.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import { togglTime } from '../lib/values.ts';
import { findUserByEmail, insertAccount, type NewAccount, type UserRole, type UserRow } from './users.ts';

export interface AccountTokenRow {
  id: number;
  token_hash: string;
  kind: 'invite' | 'password_reset';
  role: UserRole | null;
  note: string | null;
  user_id: number | null;
  created_by: number | null;
  created_at: string;
  expires_at: string;
  used_at: string | null;
}

/** The one answer for an unknown, expired, used or revoked invite, so a caller cannot tell them apart. */
export const INVITE_NOT_FOUND = 'This invite link is not valid. Ask your admin for a new one.';

export const MAX_INVITE_NOTE_LENGTH = 255;

/**
 * Creates an invite that expires after `days` and returns the token. The token is 256 random bits,
 * like a session token, and only its hash is stored, so this is the only time it exists.
 */
export function createInvite(
  db: Db,
  input: { role: UserRole; note: string | null; createdBy: number; days: number },
): { token: string; invite: AccountTokenRow } {
  const token = generateSessionToken();
  const now = new Date();
  const expires = new Date(now.getTime() + input.days * 86_400_000);
  const result = db.prepare(`
    INSERT INTO account_tokens (token_hash, kind, role, note, created_by, created_at, expires_at)
    VALUES (?, 'invite', ?, ?, ?, ?, ?)
  `).run(sha256(token), input.role, input.note, input.createdBy, now.toISOString(), expires.toISOString());
  const invite = db.prepare('SELECT * FROM account_tokens WHERE id = ?').get(Number(result.lastInsertRowid)) as unknown as AccountTokenRow;
  return { token, invite };
}

/** Unused, unexpired invites, oldest first. */
export function listPendingInvites(db: Db): AccountTokenRow[] {
  return db.prepare(`
    SELECT * FROM account_tokens WHERE kind = 'invite' AND used_at IS NULL AND expires_at > ? ORDER BY id
  `).all(nowIso()) as unknown as AccountTokenRow[];
}

/** Deletes an unused invite so its link stops working. False when there is no such invite. */
export function revokeInvite(db: Db, id: number): boolean {
  return Number(db.prepare("DELETE FROM account_tokens WHERE id = ? AND kind = 'invite' AND used_at IS NULL").run(id).changes) > 0;
}

/** The invite behind `token` when it is unused and unexpired. */
export function findUsableInvite(db: Db, token: string): AccountTokenRow | undefined {
  return db.prepare(`
    SELECT * FROM account_tokens
    WHERE token_hash = ? AND kind = 'invite' AND used_at IS NULL AND expires_at > ?
  `).get(sha256(token), nowIso()) as AccountTokenRow | undefined;
}

/**
 * Creates the invited account, its private workspace, the owner membership and its default
 * workspace, and marks the invite used, all in one transaction. The invite is checked again inside
 * it, so two requests cannot both use one token. A duplicate email is a 400 that leaves the invite
 * usable.
 */
export function acceptInvite(db: Db, token: string, account: Omit<NewAccount, 'password'> & { passwordHash: string }): UserRow {
  return transaction(db, () => {
    const invite = findUsableInvite(db, token);
    if (!invite?.role) throw notFound(INVITE_NOT_FOUND);
    if (findUserByEmail(db, account.email)) throw badRequest('An account with this email already exists');
    const user = insertAccount(db, { ...account, role: invite.role });
    db.prepare('UPDATE account_tokens SET used_at = ?, user_id = ? WHERE id = ?').run(nowIso(), user.id, invite.id);
    return user;
  });
}

/** What an admin sees of an invite. Never the token or its hash. */
export function serializeInvite(invite: AccountTokenRow) {
  return {
    id: invite.id,
    role: invite.role,
    note: invite.note,
    created_by: invite.created_by,
    created_at: togglTime(invite.created_at),
    expires_at: togglTime(invite.expires_at),
  };
}
