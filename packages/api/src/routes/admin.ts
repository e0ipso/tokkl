import express, { type Router } from 'express';
import type { Deps } from '../http/context.ts';
import { readJson } from '../http/context.ts';
import { parseId, togglTime } from '../lib/values.ts';
import { serializeAccount, serializeInvite } from '../domain/accountValues.ts';
import { getInstanceSettings, serializeSettings } from '../domain/accounts.ts';
export function adminRoutes(deps: Deps): Router {
  const { storage, config } = deps;
  const api = express.Router();
  api.use(deps.auth.requireAuth, deps.auth.requireAdmin);
  api.get('/users', async (_req, res) => res.json((await storage.users.list()).map(serializeAccount)));
  api.patch('/users/:id', async (req, res) => res.json(serializeAccount(await deps.accountsFor(res.locals.auth).setAccess(res.locals.auth.user.id, parseId(req.params.id), readJson(req)))));
  api.delete('/users/:id', async (req, res) => {
    await deps.accountsFor(res.locals.auth).deleteAccount(res.locals.auth.user.id, parseId(req.params.id), readJson(req).email, deps.entryEffects);
    return res.json({ ok: true });
  });
  api.post('/users/:id/sessions/revoke', async (req, res) => {
    await deps.accountsFor(res.locals.auth).revokeSessions(res.locals.auth.user.id, parseId(req.params.id));
    return res.json({ ok: true });
  });
  api.post('/users/:id/password-reset', async (req, res) => {
    const { token, reset } = await deps.accountsFor(res.locals.auth).createPasswordReset(res.locals.auth.user.id, parseId(req.params.id));
    return res.json({ url: `/reset/${token}`, expires_at: togglTime(reset.expiresAt) });
  });
  api.post('/invites', async (req, res) => {
    const body = readJson(req);
    const { token, invite } = await deps.accountsFor(res.locals.auth).createInvite(res.locals.auth.user.id, { role: body.role, note: body.note }, config.sessionDays);
    return res.json({ ...serializeInvite(invite), url: `/invite/${token}` });
  });
  api.get('/invites', async (_req, res) => res.json((await storage.tokens.listPendingInvites(new Date().toISOString())).map(serializeInvite)));
  api.delete('/invites/:id', async (req, res) => { await deps.accountsFor(res.locals.auth).revokeInvite(res.locals.auth.user.id, parseId(req.params.id)); return res.json({ ok: true }); });
  api.get('/settings', async (_req, res) => res.json(serializeSettings(await getInstanceSettings(storage, config.sessionDays))));
  api.put('/settings', async (req, res) => res.json(serializeSettings(await deps.accountsFor(res.locals.auth).updateSettings(res.locals.auth.user.id, readJson(req), config.sessionDays))));
  return api;
}
