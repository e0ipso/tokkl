import type { Db } from '../db/index.ts';
import { nowIso, transaction } from '../db/index.ts';
import { generateSessionToken, sha256 } from '../auth/crypto.ts';
import { deleteOtherSessions } from '../auth/sessions.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import { togglTime } from '../lib/values.ts';
import { findUserByEmail, getUser, insertAccount, isActiveUser, type NewAccount, type UserRole, type UserRow } from './users.ts';

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
 * The one answer for an unknown, expired, used or revoked reset link, or one for a disabled account,
 * so a caller cannot tell them apart.
 */
export const RESET_NOT_FOUND = 'This password reset link is not valid. Ask your admin for a new one.';

/** How long a password reset link works. */
export const PASSWORD_RESET_HOURS = 24;

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

/** Deletes every unused invite `userId` created, so their links stop working once the account is gone. */
export function revokeInvitesCreatedBy(db: Db, userId: number): void {
  db.prepare("DELETE FROM account_tokens WHERE created_by = ? AND kind = 'invite' AND used_at IS NULL").run(userId);
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

/**
 * Creates a password reset link for `userId` that expires after PASSWORD_RESET_HOURS and returns
 * the token. The user's earlier unused links are deleted in the same transaction, so only the newest
 * one works. Like an invite, only the token's hash is stored.
 */
export function createPasswordReset(db: Db, input: { userId: number; createdBy: number }): { token: string; reset: AccountTokenRow } {
  const token = generateSessionToken();
  const now = new Date();
  const expires = new Date(now.getTime() + PASSWORD_RESET_HOURS * 3_600_000);
  return transaction(db, () => {
    db.prepare("DELETE FROM account_tokens WHERE user_id = ? AND kind = 'password_reset' AND used_at IS NULL").run(input.userId);
    const result = db.prepare(`
      INSERT INTO account_tokens (token_hash, kind, user_id, created_by, created_at, expires_at)
      VALUES (?, 'password_reset', ?, ?, ?, ?)
    `).run(sha256(token), input.userId, input.createdBy, now.toISOString(), expires.toISOString());
    const reset = db.prepare('SELECT * FROM account_tokens WHERE id = ?').get(Number(result.lastInsertRowid)) as unknown as AccountTokenRow;
    return { token, reset };
  });
}

/** The account a reset `token` belongs to, when the link is unused and unexpired and the account is not disabled. */
export function findResetUser(db: Db, token: string): UserRow | undefined {
  const reset = db.prepare(`
    SELECT user_id FROM account_tokens
    WHERE token_hash = ? AND kind = 'password_reset' AND used_at IS NULL AND expires_at > ?
  `).get(sha256(token), nowIso()) as { user_id: number | null } | undefined;
  const user = reset?.user_id ? getUser(db, reset.user_id) : undefined;
  return user && isActiveUser(user) ? user : undefined;
}

/**
 * Sets the password of the account behind a reset `token`, marks the token used and deletes every
 * session of the account, in one transaction. The token and the account are checked again inside it,
 * so two requests cannot both use one link, and an account disabled meanwhile is refused.
 */
export function resetPassword(db: Db, token: string, passwordHash: string): UserRow {
  return transaction(db, () => {
    const user = findResetUser(db, token);
    if (!user) throw notFound(RESET_NOT_FOUND);
    const now = nowIso();
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(passwordHash, now, user.id);
    db.prepare('UPDATE account_tokens SET used_at = ? WHERE token_hash = ?').run(now, sha256(token));
    deleteOtherSessions(db, user.id);
    return user;
  });
}
