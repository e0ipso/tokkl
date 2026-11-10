import type { Router } from 'express';
import type { Deps } from '../context.ts';
import { jsonRead } from '../context.ts';
import { clientAddress, readJson } from '../../http/request.ts';
import { changedSince, lenientNumber, query, queryFlag } from '../../http/params.ts';
import { createRouter } from '../../http/router.ts';
import { passwordAttempt } from '../../auth/middleware.ts';
import { getPreferences } from '../../domain/accountValues.ts';
import { parsePreferenceChanges, parseProfileUpdate } from '../../commands/accounts.ts';
import type { RelatedData, WorkspaceProject } from '../../domain/queries.ts';
import { parseId } from '../../lib/values.ts';
import {
  serializeClient,
  serializeOrganization,
  serializeProject,
  serializeTag,
  serializeTask,
  serializeTimeEntry,
  serializeUser,
  serializeWorkspace,
} from '../../presenters/toggl.ts';
import { entryPresentation, timeEntryFilter } from './shared.ts';

const presentProject = ({ project, defaultCurrency }: WorkspaceProject) => serializeProject(project, defaultCurrency);

function presentRelated(related: RelatedData) {
  return {
    workspaces: related.workspaces.map(({ workspace, role }) => serializeWorkspace(workspace, role)),
    clients: related.clients.map(serializeClient),
    projects: related.projects.map(presentProject),
    tags: related.tags.map(serializeTag),
    tasks: related.tasks.map(serializeTask),
    time_entries: related.timeEntries.map(entry => serializeTimeEntry(entry)),
  };
}

export function meRoutes(deps: Pick<Deps, 'readFor' | 'accountsFor' | 'preferencesFor' | 'loginLimiter'>): Router {
  const api = createRouter();
  api.get(
    '/me',
    jsonRead(deps, async (req, res, queries) => {
      const user = res.locals.auth.user;
      const body = {
        ...serializeUser(user, { includeToken: true }),
        role: user.role,
        time_resolution_minutes: (await queries.instanceSettings()).timeResolutionMinutes,
      };
      return queryFlag(req, 'with_related_data')
        ? { ...body, ...presentRelated(await queries.relatedData(user)) }
        : body;
    }),
  );
  api.put('/me', async (req, res) => {
    const { user } = res.locals.auth;
    const updated = await deps
      .accountsFor(res.locals.auth)
      .updateProfile(
        parseProfileUpdate(readJson(req)),
        passwordAttempt(deps.loginLimiter, user.email, clientAddress(req)),
      );
    res.json(serializeUser(updated, { includeToken: true }));
  });
  api.post('/me/reset_token', async (_req, res) => {
    res.json(await deps.accountsFor(res.locals.auth).rotateApiToken());
  });
  api.get(
    ['/me/preferences', '/me/preferences/:client'],
    jsonRead(deps, (_req, res) => getPreferences(res.locals.auth.user)),
  );
  api.post(['/me/preferences', '/me/preferences/:client'], async (req, res) => {
    const changes = parsePreferenceChanges(readJson(req));
    res.json(await deps.preferencesFor(res.locals.auth).savePreferences(changes));
  });
  api.get(
    '/me/workspaces',
    jsonRead(deps, async (req, res, queries) =>
      (await queries.memberWorkspaces(res.locals.auth.user.id, changedSince(req))).map(({ workspace, role }) =>
        serializeWorkspace(workspace, role),
      ),
    ),
  );
  api.get(
    '/me/organizations',
    jsonRead(deps, async (_req, res, queries) =>
      (await queries.organizations(res.locals.auth.user.id)).map(({ workspace, owner, memberCount }) =>
        serializeOrganization(workspace, owner, memberCount),
      ),
    ),
  );
  api.get(
    '/me/features',
    jsonRead(deps, async (_req, res, queries) =>
      (await queries.memberWorkspaces(res.locals.auth.user.id)).map(({ workspace }) => ({
        workspace_id: workspace.id,
        features: [],
      })),
    ),
  );
  api.get(
    '/me/projects',
    jsonRead(deps, async (req, res, queries) => {
      const filter = { includeArchived: queryFlag(req, 'include_archived'), changedSince: changedSince(req) };
      return (await queries.memberProjects(res.locals.auth.user.id, filter)).map(presentProject);
    }),
  );
  api.get(
    '/me/clients',
    jsonRead(deps, async (req, res, queries) =>
      (await queries.memberClients(res.locals.auth.user.id, changedSince(req))).map(serializeClient),
    ),
  );
  api.get(
    '/me/tags',
    jsonRead(deps, async (req, res, queries) =>
      (await queries.memberTags(res.locals.auth.user.id, changedSince(req))).map(serializeTag),
    ),
  );
  api.get(
    '/me/tasks',
    jsonRead(deps, async (req, res, queries) => {
      const filter = { includeInactive: queryFlag(req, 'include_not_active'), changedSince: changedSince(req) };
      // Offset paging, unlike the workspace task list; without per_page every task is returned.
      const offset = Math.max(lenientNumber(query(req, 'offset'), 0), 0);
      const size = query(req, 'per_page');
      const limit = size === undefined ? undefined : Math.max(lenientNumber(size, 1), 1);
      const userId = res.locals.auth.user.id;
      const tasks =
        offset === 0 && limit === undefined
          ? await queries.memberTasks(userId, filter)
          : await queries.memberTasksFrom(userId, filter, offset, limit);
      return tasks.map(serializeTask);
    }),
  );
  api.get(
    '/me/time_entries',
    jsonRead(deps, async (req, res, queries) => {
      const user = res.locals.auth.user;
      return (await queries.timeEntries(user.id, timeEntryFilter(req, user))).map(entry =>
        serializeTimeEntry(entry, entryPresentation(req, res)),
      );
    }),
  );
  api.get(
    '/me/time_entries/current',
    jsonRead(deps, async (req, res, queries) => {
      const entry = await queries.runningEntry(res.locals.auth.user.id);
      return entry ? serializeTimeEntry(entry, entryPresentation(req, res)) : null;
    }),
  );
  api.get(
    '/me/time_entries/:id',
    jsonRead(deps, async (req, res, queries) =>
      serializeTimeEntry(
        await queries.timeEntry(res.locals.auth.user.id, parseId(req.params.id)),
        entryPresentation(req, res),
      ),
    ),
  );
  return api;
}
