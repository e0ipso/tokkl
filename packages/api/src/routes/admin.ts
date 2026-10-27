import express, { type Router } from 'express';
import { nowIso, transaction } from '../db/index.ts';
import { requireAdmin, requireAuth } from '../auth/middleware.ts';
import { normalizeEmail } from '../auth/rateLimit.ts';
import { deleteOtherSessions } from '../auth/sessions.ts';
import type { Deps } from '../http/context.ts';
import { readJson } from '../http/context.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import { optionalBool, optionalString, parseId, togglTime } from '../lib/values.ts';
import {
  createInvite, createPasswordReset, listPendingInvites, MAX_INVITE_NOTE_LENGTH, revokeInvite, revokeInvitesCreatedBy,
  serializeInvite,
} from '../models/accountTokens.ts';
import { deleteSoleMemberWorkspaces } from '../models/workspaces.ts';
import {
  countActiveAdmins, getUser, isActiveAdmin, isActiveUser, listUsers, serializeAccount, type UserRole,
} from '../models/users.ts';
import { getInstanceSettings, readSettingChanges, updateInstanceSettings } from '../models/settings.ts';

interface AccountChanges {
  role?: UserRole;
  disabled?: boolean;
}

function readAccountChanges(body: Record<string, unknown>): AccountChanges {
  if (body.role !== undefined && body.role !== 'admin' && body.role !== 'user') {
    throw badRequest('Invalid role: expected admin or user');
  }
  const changes: AccountChanges = { role: body.role, disabled: optionalBool(body.disabled, 'disabled') };
  if (changes.role === undefined && changes.disabled === undefined) throw badRequest('Expected role or disabled');
  return changes;
}

/** Instance administration. Every route needs an active admin, signed in like any other API call. */
export function adminRoutes(deps: Deps): Router {
  const { db, config, timerStreams } = deps;
  const api = express.Router();
  api.use(requireAuth(deps), requireAdmin);

  api.get('/users', (req, res) => res.json(listUsers(db).map(serializeAccount)));

  api.patch('/users/:id', (req, res) => {
    const id = parseId(req.params.id);
    const changes = readAccountChanges(readJson(req));
    // The count and the update share one write transaction, so two requests cannot both remove
    // what each sees as the second-to-last active admin.
    const updated = transaction(db, () => {
      const user = getUser(db, id);
      if (!user) throw notFound('User not found');
      const role = changes.role ?? user.role;
      const disabledAt = changes.disabled === undefined
        ? user.disabled_at
        : changes.disabled ? user.disabled_at ?? nowIso() : null;
      const staysActiveAdmin = role === 'admin' && disabledAt === null;
      if (isActiveAdmin(user) && !staysActiveAdmin && countActiveAdmins(db) <= 1) {
        throw badRequest('At least one active admin must remain');
      }
      db.prepare('UPDATE users SET role = ?, disabled_at = ?, updated_at = ? WHERE id = ?')
        .run(role, disabledAt, nowIso(), id);
      if (changes.disabled) deleteOtherSessions(db, id);
      return getUser(db, id)!;
    });
    timerStreams.recheck(id);
    return res.json(serializeAccount(updated));
  });

  /**
   * Deletes an account for good, with every workspace it alone belongs to. The body must repeat the
   * account's email. Disabling is the reversible option.
   */
  api.delete('/users/:id', (req, res) => {
    const id = parseId(req.params.id);
    const { email } = readJson(req);
    transaction(db, () => {
      const user = getUser(db, id);
      if (!user) throw notFound('User not found');
      if (typeof email !== 'string' || normalizeEmail(email) !== normalizeEmail(user.email)) {
        throw badRequest("Enter the account's email to confirm the deletion");
      }
      if (isActiveAdmin(user) && countActiveAdmins(db) <= 1) throw badRequest('At least one active admin must remain');
      if (id === res.locals.user.id) throw badRequest('You cannot delete your own account');
      deleteSoleMemberWorkspaces(db, id);
      revokeInvitesCreatedBy(db, id);
      // Sessions, memberships, remaining time entries and the tokens tied to the account cascade.
      db.prepare('DELETE FROM users WHERE id = ?').run(id);
    });
    timerStreams.recheck(id);
    return res.json({ ok: true });
  });

  // Signs the account out of every browser. Its API token keeps working.
  api.post('/users/:id/sessions/revoke', (req, res) => {
    const id = parseId(req.params.id);
    if (!getUser(db, id)) throw notFound('User not found');
    deleteOtherSessions(db, id);
    timerStreams.recheck(id);
    return res.json({ ok: true });
  });

  /**
   * Issues a one-time link that lets the account set a new password, and revokes its earlier unused
   * links. The admin never sees or chooses the password.
   */
  api.post('/users/:id/password-reset', (req, res) => {
    const id = parseId(req.params.id);
    const { token, reset } = transaction(db, () => {
      const user = getUser(db, id);
      if (!user) throw notFound('User not found');
      if (!isActiveUser(user)) throw badRequest('Enable the account before resetting its password');
      return createPasswordReset(db, { userId: id, createdBy: res.locals.user.id });
    });
    // The only response that ever carries the token.
    return res.json({ url: `/reset/${token}`, expires_at: togglTime(reset.expires_at) });
  });

  api.post('/invites', (req, res) => {
    const body = readJson(req);
    if (body.role !== 'admin' && body.role !== 'user') throw badRequest('Invalid role: expected admin or user');
    const note = optionalString(body.note, 'note', MAX_INVITE_NOTE_LENGTH)?.trim() || null;
    const days = getInstanceSettings(db, config).invite_days;
    const { token, invite } = createInvite(db, { role: body.role, note, createdBy: res.locals.user.id, days });
    // The only response that ever carries the token.
    return res.json({ ...serializeInvite(invite), url: `/invite/${token}` });
  });

  api.get('/invites', (req, res) => res.json(listPendingInvites(db).map(serializeInvite)));

  api.delete('/invites/:id', (req, res) => {
    if (!revokeInvite(db, parseId(req.params.id))) throw notFound('Invite not found');
    return res.json({ ok: true });
  });

  api.get('/settings', (req, res) => res.json(getInstanceSettings(db, config)));

  api.put('/settings', (req, res) => {
    updateInstanceSettings(db, readSettingChanges(readJson(req)), res.locals.user.id);
    return res.json(getInstanceSettings(db, config));
  });

  return api;
}
