import type { Router } from 'express';
import type { Deps } from '../../http/context.ts';
import { jsonRead, readJson } from '../../http/context.ts';
import { createRouter } from '../../http/router.ts';
import { parseId } from '../../lib/values.ts';
import { serializeWorkspace, serializeWorkspaceMember } from '../../presenters/toggl.ts';

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
    const workspace = await deps
      .accountsFor(res.locals.auth)
      .updateWorkspace(userId, parseId(req.params.wid), readJson(req));
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
