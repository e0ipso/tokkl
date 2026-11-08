import type { Request, Router } from 'express';
import type { Deps } from '../context.ts';
import { jsonRead } from '../context.ts';
import { readJson } from '../../http/request.ts';
import {
  parseClientChanges,
  parseClientRestore,
  parseNewClient,
  parseNewProject,
  parseNewTask,
  parseProjectChanges,
  parseTagName,
  parseTaskChanges,
} from '../../commands/catalogs.ts';
import {
  changedSince,
  optionalPageWindow,
  pageWindow,
  query,
  queryChoice,
  queryIds,
  queryText,
} from '../../http/params.ts';
import { createRouter } from '../../http/router.ts';
import { invalidInput } from '../../lib/errors.ts';
import { slicePage } from '../../lib/pagination.ts';
import { parseId } from '../../lib/values.ts';
import type { SortOrder, TaskSearch, TaskSortField } from '../../domain/queries.ts';
import { serializeClient, serializeProject, serializeTag, serializeTask } from '../../presenters/toggl.ts';
import type { ProjectFilter } from '../../storage/contracts.ts';
import { authorizedWorkspace } from './shared.ts';

type CatalogRouteDeps = Pick<Deps, 'readFor' | 'catalogsFor'>;

const PROJECT_PAGES = { defaultPerPage: 151, maxPerPage: 200 };
const TASK_PAGES = { defaultPerPage: 50, maxPerPage: 200 };
const TAG_PAGES = { defaultPerPage: 200, maxPerPage: 200 };

/** Toggl's `active`: `true`, `false`, or anything else for both. */
function projectFilter(req: Request): ProjectFilter {
  const active = query(req, 'active'),
    billable = query(req, 'billable');
  return {
    active: active === 'false' ? false : active === 'true' ? true : 'both',
    billable: billable === undefined ? undefined : billable === 'true',
    name: queryText(req, 'name') ?? queryText(req, 'search'),
    clientIds: queryIds(req, 'client_ids', 1000),
    changedSince: changedSince(req),
  };
}

/** The workspace task list's filter and order. `active` is `true`, `false`, `both` or absent. */
function taskSearch(req: Request): TaskSearch {
  const active = query(req, 'active');
  const pid = query(req, 'pid');
  const projectId = pid ? parseId(pid) : undefined;
  const since = changedSince(req);
  const sortField = query(req, 'sort_field') ?? 'name';
  const sortOrder = (query(req, 'sort_order') ?? 'ASC').toUpperCase();
  if (sortField !== 'name' && sortField !== 'created_at') throw invalidInput('Invalid sort_field');
  if (sortOrder !== 'ASC' && sortOrder !== 'DESC') throw invalidInput('Invalid sort_order');
  return {
    projectId,
    active: active === undefined || active === 'both' ? undefined : active === 'true',
    changedSince: since,
    search: query(req, 'search'),
    sortField: sortField satisfies TaskSortField,
    sortOrder: sortOrder satisfies SortOrder,
  };
}

function projectRoutes(deps: CatalogRouteDeps, api: Router): void {
  api.get(
    '/workspaces/:wid/projects',
    jsonRead(deps, async (req, res, queries) => {
      const ws = await queries.workspace(res.locals.auth.user.id, parseId(req.params.wid));
      const filter = projectFilter(req);
      const window = optionalPageWindow(req, PROJECT_PAGES);
      const projects = window
        ? await queries.workspaceProjectsPage(ws, filter, window)
        : await queries.workspaceProjects(ws, filter);
      return projects.map(({ project }) => serializeProject(project, ws.defaultCurrency));
    }),
  );
  api.get(
    '/workspaces/:wid/projects/:pid',
    jsonRead(deps, async (req, res, queries) => {
      const ws = await queries.workspace(res.locals.auth.user.id, parseId(req.params.wid));
      return serializeProject(await queries.workspaceProject(ws, parseId(req.params.pid)), ws.defaultCurrency);
    }),
  );
  api.post('/workspaces/:wid/projects', async (req, res) => {
    const ws = await authorizedWorkspace(deps, req, res);
    const project = parseNewProject(readJson(req));
    const created = await deps.catalogsFor(res.locals.auth).createProject(ws.id, project);
    res.json(serializeProject(created, ws.defaultCurrency));
  });
  api.put('/workspaces/:wid/projects/:pid', async (req, res) => {
    const ws = await authorizedWorkspace(deps, req, res);
    const changes = parseProjectChanges(readJson(req));
    const project = await deps.catalogsFor(res.locals.auth).updateProject(ws.id, parseId(req.params.pid), changes);
    res.json(serializeProject(project, ws.defaultCurrency));
  });
  api.delete('/workspaces/:wid/projects/:pid', async (req, res) => {
    const ws = await authorizedWorkspace(deps, req, res);
    const deleteEntries = query(req, 'teDeletionMode') === 'delete';
    await deps.catalogsFor(res.locals.auth).deleteProject(ws.id, parseId(req.params.pid), deleteEntries);
    res.status(200).end();
  });
}

function taskRoutes(deps: CatalogRouteDeps, api: Router): void {
  // Toggl wraps this listing in a paging envelope, unlike the per-project one below.
  api.get(
    '/workspaces/:wid/tasks',
    jsonRead(deps, async (req, res, queries) => {
      const ws = await queries.workspace(res.locals.auth.user.id, parseId(req.params.wid));
      const search = taskSearch(req);
      const tasks = await queries.searchTasks(ws, search);
      const window = pageWindow(query(req, 'page'), query(req, 'per_page'), TASK_PAGES);
      return {
        data: slicePage(tasks, window).map(serializeTask),
        page: window.page,
        per_page: window.perPage,
        sort_field: search.sortField,
        sort_order: search.sortOrder,
        total_count: tasks.length,
      };
    }),
  );
  api.get(
    '/workspaces/:wid/projects/:pid/tasks',
    jsonRead(deps, async (req, res, queries) => {
      const ws = await queries.workspace(res.locals.auth.user.id, parseId(req.params.wid));
      // Toggl: active=true lists open tasks only; false or absent lists all of them.
      const tasks = await queries.projectTasks(ws, parseId(req.params.pid), query(req, 'active') === 'true');
      return tasks.map(serializeTask);
    }),
  );
  api.get(
    '/workspaces/:wid/projects/:pid/tasks/:tid',
    jsonRead(deps, async (req, res, queries) => {
      const ws = await queries.workspace(res.locals.auth.user.id, parseId(req.params.wid));
      const id = parseId(req.params.tid);
      return serializeTask(await queries.projectTask(ws, parseId(req.params.pid), id));
    }),
  );
  api.post('/workspaces/:wid/projects/:pid/tasks', async (req, res) => {
    const ws = await authorizedWorkspace(deps, req, res);
    const pid = parseId(req.params.pid);
    const task = parseNewTask(readJson(req));
    const created = await deps.catalogsFor(res.locals.auth).createTask(ws.id, pid, task);
    res.json(serializeTask(created));
  });
  api.put('/workspaces/:wid/projects/:pid/tasks/:tid', async (req, res) => {
    const ws = await authorizedWorkspace(deps, req, res);
    const pid = parseId(req.params.pid),
      tid = parseId(req.params.tid);
    const changes = parseTaskChanges(readJson(req));
    const task = await deps.catalogsFor(res.locals.auth).updateTask(ws.id, pid, tid, changes);
    res.json(serializeTask(task));
  });
  api.delete('/workspaces/:wid/projects/:pid/tasks/:tid', async (req, res) => {
    const ws = await authorizedWorkspace(deps, req, res);
    await deps.catalogsFor(res.locals.auth).deleteTask(ws.id, parseId(req.params.pid), parseId(req.params.tid));
    res.status(200).end();
  });
}

function clientRoutes(deps: CatalogRouteDeps, api: Router): void {
  api.get(
    '/workspaces/:wid/clients',
    jsonRead(deps, async (req, res, queries) => {
      const ws = await queries.workspace(res.locals.auth.user.id, parseId(req.params.wid));
      const status = queryChoice(req, 'status', ['active', 'archived', 'both'], 'active', 'Client status is invalid');
      return (await queries.workspaceClients(ws, { status, name: queryText(req, 'name') })).map(serializeClient);
    }),
  );
  api.get(
    '/workspaces/:wid/clients/:cid',
    jsonRead(deps, async (req, res, queries) => {
      const ws = await queries.workspace(res.locals.auth.user.id, parseId(req.params.wid));
      return serializeClient(await queries.workspaceClient(ws, parseId(req.params.cid)));
    }),
  );
  api.post('/workspaces/:wid/clients', async (req, res) => {
    const ws = await authorizedWorkspace(deps, req, res);
    const client = parseNewClient(readJson(req));
    res.json(serializeClient(await deps.catalogsFor(res.locals.auth).createClient(ws.id, client)));
  });
  api.put('/workspaces/:wid/clients/:cid', async (req, res) => {
    const ws = await authorizedWorkspace(deps, req, res);
    const cid = parseId(req.params.cid);
    const changes = parseClientChanges(readJson(req));
    const client = await deps.catalogsFor(res.locals.auth).updateClient(ws.id, cid, changes);
    res.json(serializeClient(client));
  });
  // Toggl answers an archive with the ids of the projects it archived.
  api.post('/workspaces/:wid/clients/:cid/archive', async (req, res) => {
    const ws = await authorizedWorkspace(deps, req, res);
    res.json(await deps.catalogsFor(res.locals.auth).archiveClient(ws.id, parseId(req.params.cid)));
  });
  api.post('/workspaces/:wid/clients/:cid/restore', async (req, res) => {
    const ws = await authorizedWorkspace(deps, req, res);
    const cid = parseId(req.params.cid);
    const restore = parseClientRestore(req.body ? readJson(req) : {});
    const client = await deps.catalogsFor(res.locals.auth).restoreClient(ws.id, cid, restore);
    res.json(serializeClient(client));
  });
  api.delete('/workspaces/:wid/clients/:cid', async (req, res) => {
    const ws = await authorizedWorkspace(deps, req, res);
    await deps.catalogsFor(res.locals.auth).deleteClient(ws.id, parseId(req.params.cid));
    res.status(200).end();
  });
}

function tagRoutes(deps: CatalogRouteDeps, api: Router): void {
  api.get(
    '/workspaces/:wid/tags',
    jsonRead(deps, async (req, res, queries) => {
      const ws = await queries.workspace(res.locals.auth.user.id, parseId(req.params.wid));
      const tags = await queries.workspaceTags(ws, queryText(req, 'search'));
      const window = optionalPageWindow(req, TAG_PAGES);
      return (window ? slicePage(tags, window) : tags).map(serializeTag);
    }),
  );
  api.post('/workspaces/:wid/tags', async (req, res) => {
    const ws = await authorizedWorkspace(deps, req, res);
    const name = parseTagName(readJson(req));
    res.json(serializeTag(await deps.catalogsFor(res.locals.auth).createTag(ws.id, name)));
  });
  api.put('/workspaces/:wid/tags/:tid', async (req, res) => {
    const ws = await authorizedWorkspace(deps, req, res);
    const tid = parseId(req.params.tid);
    const name = parseTagName(readJson(req));
    const tag = await deps.catalogsFor(res.locals.auth).updateTag(ws.id, tid, name);
    res.json(serializeTag(tag));
  });
  api.delete('/workspaces/:wid/tags/:tid', async (req, res) => {
    const ws = await authorizedWorkspace(deps, req, res);
    await deps.catalogsFor(res.locals.auth).deleteTag(ws.id, parseId(req.params.tid));
    res.status(200).end();
  });
}

/** Projects, tasks, clients and tags of a workspace. */
export function catalogRoutes(deps: CatalogRouteDeps): Router {
  const api = createRouter();
  projectRoutes(deps, api);
  taskRoutes(deps, api);
  clientRoutes(deps, api);
  tagRoutes(deps, api);
  return api;
}
