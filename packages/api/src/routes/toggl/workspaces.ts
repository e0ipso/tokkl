import type { Router } from 'express';
import type { Deps } from '../../http/context.ts';
import { jsonRead } from '../../http/context.ts';
import { readJson } from '../../http/request.ts';
import { createRouter } from '../../http/router.ts';
import { parseId } from '../../lib/values.ts';
import { serializeWorkspace, serializeWorkspaceMember } from '../../presenters/toggl.ts';
import { parseWorkspaceChanges } from '../../commands/accounts.ts';
import { authorizedWorkspace } from './shared.ts';

/** A workspace's settings and its members. */
export function workspaceRoutes(deps: Deps): Router {
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
    // Membership is checked before the body is read, as on every workspace write.
    const { id } = await authorizedWorkspace(deps, req, res);
    const changes = parseWorkspaceChanges(readJson(req));
    const workspace = await deps.accountsFor(res.locals.auth).updateWorkspace(userId, id, changes);
    const role = await deps.readFor(res.locals.auth, queries => queries.workspaceRole(userId, workspace.id));
    res.json(serializeWorkspace(workspace, role));
  });
  api.get(
    '/workspaces/:wid/users',
    jsonRead(deps, async (req, res, queries) =>
      (await queries.workspaceMembers(res.locals.auth.user.id, parseId(req.params.wid))).map(serializeWorkspaceMember),
    ),
  );
  return api;
}
