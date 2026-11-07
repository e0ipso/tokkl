import { type Router } from 'express';
import type { Deps } from '../http/context.ts';
import { createRouter } from '../http/router.ts';
import { jsonRead, readJson } from '../http/context.ts';
import { parseId, togglTime } from '../lib/values.ts';
import {
  parseAccessChange,
  parseDeletionConfirmation,
  parseInvite,
  parseSettingChanges,
} from '../commands/accounts.ts';
import { serializeAccount, serializeInvite, serializeSettings } from '../presenters/toggl.ts';
export function adminRoutes(deps: Deps): Router {
  const { config } = deps;
  const api = createRouter();
  api.use(deps.auth.requireAuth, deps.auth.requireAdmin);
  api.get(
    '/users',
    jsonRead(deps, async (_req, _res, queries) => (await queries.accounts()).map(serializeAccount), true),
  );
  api.patch('/users/:id', async (req, res) =>
    res.json(
      serializeAccount(
        await deps
          .accountsFor(res.locals.auth)
          .setAccess(res.locals.auth.user.id, parseId(req.params.id), parseAccessChange(readJson(req))),
      ),
    ),
  );
  api.delete('/users/:id', async (req, res) => {
    const id = parseId(req.params.id);
    const email = parseDeletionConfirmation(readJson(req));
    await deps.accountsFor(res.locals.auth).deleteAccount(res.locals.auth.user.id, id, email, deps.entryEffects);
    return res.json({ ok: true });
  });
  api.post('/users/:id/sessions/revoke', async (req, res) => {
    await deps.accountsFor(res.locals.auth).revokeSessions(res.locals.auth.user.id, parseId(req.params.id));
    return res.json({ ok: true });
  });
  api.post('/users/:id/password-reset', async (req, res) => {
    const { token, reset } = await deps
      .accountsFor(res.locals.auth)
      .createPasswordReset(res.locals.auth.user.id, parseId(req.params.id));
    return res.json({ url: `/reset/${token}`, expires_at: togglTime(reset.expiresAt) });
  });
  api.post('/invites', async (req, res) => {
    const request = parseInvite(readJson(req));
    const { token, invite } = await deps
      .accountsFor(res.locals.auth)
      .createInvite(res.locals.auth.user.id, request, config.sessionDays);
    return res.json({ ...serializeInvite(invite), url: `/invite/${token}` });
  });
  api.get(
    '/invites',
    jsonRead(deps, async (_req, _res, queries) => (await queries.pendingInvites()).map(serializeInvite), true),
  );
  api.delete('/invites/:id', async (req, res) => {
    await deps.accountsFor(res.locals.auth).revokeInvite(res.locals.auth.user.id, parseId(req.params.id));
    return res.json({ ok: true });
  });
  api.get(
    '/settings',
    jsonRead(deps, async (_req, _res, queries) => serializeSettings(await queries.instanceSettings()), true),
  );
  api.put('/settings', async (req, res) =>
    res.json(
      serializeSettings(
        await deps
          .accountsFor(res.locals.auth)
          .updateSettings(res.locals.auth.user.id, parseSettingChanges(readJson(req)), config.sessionDays),
      ),
    ),
  );
  return api;
}
