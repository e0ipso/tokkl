import type { Router } from 'express';
import type { Deps } from '../context.ts';
import { jsonRead } from '../context.ts';
import { readJson } from '../../http/request.ts';
import { createRouter } from '../../http/router.ts';
import { parseId } from '../../lib/values.ts';
import { serializeWorkspace, serializeWorkspaceMember } from '../../presenters/toggl.ts';
import { parseWorkspaceChanges } from '../../commands/accounts.ts';

/** A workspace's settings and its members. */
export function workspaceRoutes(deps: Pick<Deps, 'readFor' | 'accountsFor'>): Router {
  const api = createRouter();
  api.get(
    '/workspaces/:wid',
    jsonRead(deps, async (req, res, queries) => {
      const { workspace, role } = await queries.memberWorkspace(res.locals.auth.user.id, parseId(req.params.wid));
      return serializeWorkspace(workspace, role);
    }),
  );
  api.put('/workspaces/:wid', async (req, res) => {
    const userId = res.locals.auth.user.id;
    // Ownership is checked before the body is read, as membership is on every other workspace write.
    const { id } = await deps.readFor(res.locals.auth, queries =>
      queries.ownedWorkspace(userId, parseId(req.params.wid)),
    );
    const changes = parseWorkspaceChanges(readJson(req));
    // The update commits only for the workspace's owner, so the reply speaks for an owner.
    const workspace = await deps.accountsFor(res.locals.auth).updateWorkspace(id, changes);
    res.json(serializeWorkspace(workspace, 'owner'));
  });
  api.get(
    '/workspaces/:wid/users',
    jsonRead(deps, async (req, res, queries) =>
      (await queries.workspaceMembers(res.locals.auth.user.id, parseId(req.params.wid))).map(serializeWorkspaceMember),
    ),
  );
  return api;
}
