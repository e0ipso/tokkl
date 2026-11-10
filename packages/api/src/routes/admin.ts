import { type Router } from 'express';
import type { Deps } from './context.ts';
import { createRouter } from '../http/router.ts';
import { jsonRead } from './context.ts';
import { readJson } from '../http/request.ts';
import { parseId, togglTime } from '../lib/values.ts';
import {
  parseAccessChange,
  parseDeletionConfirmation,
  parseInvite,
  parseSettingChanges,
} from '../commands/accounts.ts';
import { serializeAccount, serializeInvite, serializeSettings } from '../presenters/toggl.ts';
export function adminRoutes(deps: Pick<Deps, 'auth' | 'readFor' | 'accountsFor'>): Router {
  const api = createRouter();
  api.use(deps.auth.requireAuth, deps.auth.requireAdmin);
  api.get(
    '/users',
    jsonRead(deps, async (_req, _res, queries) => (await queries.accounts()).map(serializeAccount), true),
  );
  api.patch('/users/:id', async (req, res) =>
    res.json(
      serializeAccount(
        await deps.accountsFor(res.locals.auth).setAccess(parseId(req.params.id), parseAccessChange(readJson(req))),
      ),
    ),
  );
  api.delete('/users/:id', async (req, res) => {
    const id = parseId(req.params.id);
    const email = parseDeletionConfirmation(readJson(req));
    await deps.accountsFor(res.locals.auth).deleteAccount(id, email);
    return res.json({ ok: true });
  });
  api.post('/users/:id/sessions/revoke', async (req, res) => {
    await deps.accountsFor(res.locals.auth).revokeSessions(parseId(req.params.id));
    return res.json({ ok: true });
  });
  api.post('/users/:id/password-reset', async (req, res) => {
    const { token, reset } = await deps.accountsFor(res.locals.auth).createPasswordReset(parseId(req.params.id));
    return res.json({ url: `/reset/${token}`, expires_at: togglTime(reset.expiresAt) });
  });
  api.post('/invites', async (req, res) => {
    const request = parseInvite(readJson(req));
    const { token, invite } = await deps.accountsFor(res.locals.auth).createInvite(request);
    return res.json({ ...serializeInvite(invite), url: `/invite/${token}` });
  });
  api.get(
    '/invites',
    jsonRead(deps, async (_req, _res, queries) => (await queries.pendingInvites()).map(serializeInvite), true),
  );
  api.delete('/invites/:id', async (req, res) => {
    await deps.accountsFor(res.locals.auth).revokeInvite(parseId(req.params.id));
    return res.json({ ok: true });
  });
  api.get(
    '/settings',
    jsonRead(deps, async (_req, _res, queries) => serializeSettings(await queries.instanceSettings()), true),
  );
  api.put('/settings', async (req, res) =>
    res.json(
      serializeSettings(await deps.accountsFor(res.locals.auth).updateSettings(parseSettingChanges(readJson(req)))),
    ),
  );
  return api;
}
