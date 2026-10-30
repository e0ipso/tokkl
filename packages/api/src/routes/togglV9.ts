import express, { type Request, type Response, type Router } from 'express';
import type { Deps } from '../http/context.ts';
import { clientAddress, query, queryFlag, readJson, readJsonArray } from '../http/context.ts';
import { passwordAttempt } from '../auth/storageMiddleware.ts';
import { badRequest } from '../lib/errors.ts';
import { parseDateOrInstant, parseId, parseIdList, togglTime } from '../lib/values.ts';
import { startOfDay } from '@tokkl/common/time';
import type { EntryFilter, ProjectFilter } from '../storage/contracts.ts';
import type { User, Workspace } from '../storage/domain.ts';
import { getPreferences, serializeUser, serializeWorkspace } from '../domain/accountValues.ts';
import { getInstanceSettings, memberWorkspace } from '../domain/accounts.ts';
import * as catalog from '../domain/catalogs.ts';
import { createTimeEntry, updateTimeEntry, stopTimeEntry, deleteTimeEntry, patchTimeEntries, serializeTimeEntry, getTimeEntry } from '../domain/timeEntries.ts';
const { createClient, updateClient, deleteClient, restoreClient, setClientArchived, getClient, serializeClient, createProject, updateProject, deleteProject, getProject, serializeProject, createTask, updateTask, deleteTask, getTask, serializeTask, createTag, updateTag, deleteTag, serializeTag } = catalog;
const DEFAULT_LIST_DAYS = 9;
function changedSince(req: Request): string | undefined {
  const since = query(req, 'since');
  if (since === undefined)
    return undefined;
  const date = new Date(Number(since) * 1000);
  if (!/^\d+$/.test(since) || Number.isNaN(date.getTime()))
    throw badRequest('Since is expected to be an unix timestamp, integer value');
  return date.toISOString();
}
function modifiedSince<T extends {
  updatedAt: string;
}>(rows: T[], since: string | undefined): T[] { return since === undefined ? rows : rows.filter(row => row.updatedAt >= since); }
function boundary(value: string, field: string, user: User): string { const parsed = parseDateOrInstant(value, field); return ('instant' in parsed ? parsed.instant : startOfDay(parsed.date, user.timezone)).toISOString(); }
function timeEntryFilter(req: Request, user: User): EntryFilter {
  const filter: EntryFilter = {};
  const since = changedSince(req), before = query(req, 'before'), start = query(req, 'start_date'), end = query(req, 'end_date');
  if (since !== undefined)
    filter.changedSince = since;
  if ((start === undefined) !== (end === undefined))
    throw badRequest('start_date and end_date must be used together');
  if (start !== undefined && end !== undefined) {
    filter.from = boundary(start, 'start_date', user);
    filter.to = boundary(end, 'end_date', user);
    if (filter.to < filter.from)
      throw badRequest('end_date must not be earlier than start_date');
  }
  if (before !== undefined)
    filter.to = boundary(before, 'before', user);
  if (!filter.changedSince && !filter.from && !filter.to)
    filter.from = new Date(Date.now() - DEFAULT_LIST_DAYS * 86400000).toISOString();
  return filter;
}
function projectFilter(req: Request): ProjectFilter {
  const active = query(req, 'active'), billable = query(req, 'billable'), clientIds = query(req, 'client_ids');
  return { active: active === 'false' ? false : active === 'true' ? true : 'both', billable: billable === undefined ? undefined : billable === 'true', name: query(req, 'name') || query(req, 'search') || undefined, clientIds: clientIds ? parseIdList(clientIds, 1000) : undefined, changedSince: changedSince(req) };
}
function paginate<T>(req: Request, items: T[], defaultPerPage: number): T[] {
  const page = query(req, 'page'), size = query(req, 'per_page');
  if (page === undefined && size === undefined)
    return items;
  const perPage = Math.min(Math.max(Number(size ?? defaultPerPage) || defaultPerPage, 1), 200), n = Math.max(Number(page ?? 1) || 1, 1);
  return items.slice((n - 1) * perPage, n * perPage);
}
export function togglV9Routes(deps: Deps): Router {
  const { storage: db, config } = deps;
  const api = express.Router();
  api.use(deps.auth.requireAuth);
  const workspaceFor = (req: Request, res: Response) => memberWorkspace(db, res.locals.auth.user.id, parseId(req.params.wid));
  const workspaceDto = async (user: User, ws: Workspace) => serializeWorkspace(ws, await db.workspaces.getRole(user.id, ws.id));
  api.get('/me', async (req, res) => {
    const user = res.locals.auth.user;
    const body: Record<string, unknown> = { ...serializeUser(user, { includeToken: true }), role: user.role, time_resolution_minutes: (await getInstanceSettings(db, config.sessionDays)).timeResolutionMinutes };
    if (queryFlag(req, 'with_related_data')) {
      const workspaces = await db.workspaces.listForUser(user.id);
      body.workspaces = await Promise.all(workspaces.map(ws => workspaceDto(user, ws)));
      body.clients = (await Promise.all(workspaces.map(async (ws) => (await db.clients.list(ws.id)).map(serializeClient)))).flat();
      body.projects = (await Promise.all(workspaces.map(async (ws) => (await db.projects.list(ws.id)).map(p => serializeProject(p, ws.defaultCurrency))))).flat();
      body.tags = (await Promise.all(workspaces.map(async (ws) => (await db.tags.list(ws.id)).map(serializeTag)))).flat();
      body.tasks = (await Promise.all(workspaces.map(async (ws) => (await db.tasks.list(ws.id)).map(serializeTask)))).flat();
      body.time_entries = (await db.entries.list(user.id, { from: new Date(Date.now() - DEFAULT_LIST_DAYS * 86400000).toISOString() })).map(e => serializeTimeEntry(e));
    }
    return res.json(body);
  });
  api.put('/me', async (req, res) => res.json(serializeUser(await deps.accountsFor(res.locals.auth).updateProfile(res.locals.auth.user, res.locals.auth.credential, readJson(req), deps.entryEffects, passwordAttempt(deps.loginLimiter, res.locals.auth.user.email, clientAddress(req))), { includeToken: true })));
  api.post('/me/reset_token', async (req, res) => res.json(await deps.accountsFor(res.locals.auth).rotateApiToken(res.locals.auth.user, res.locals.auth.credential)));
  api.get(['/me/preferences', '/me/preferences/:client'], (req, res) => res.json(getPreferences(res.locals.auth.user)));
  api.post(['/me/preferences', '/me/preferences/:client'], async (req, res) => res.json(await deps.accountsFor(res.locals.auth).savePreferences(res.locals.auth.user.id, readJson(req))));
  api.get('/me/workspaces', async (req, res) => res.json(await Promise.all(modifiedSince(await db.workspaces.listForUser(res.locals.auth.user.id), changedSince(req)).map(ws => workspaceDto(res.locals.auth.user, ws)))));
  api.get('/me/organizations', async (req, res) => res.json(await Promise.all((await db.workspaces.listForUser(res.locals.auth.user.id)).map(async (ws) => {
    const owner = await db.workspaces.getRole(res.locals.auth.user.id, ws.id) === 'owner';
    return { id: ws.id, name: ws.name, pricing_plan_id: 0, pricing_plan_name: 'Self-hosted', created_at: togglTime(ws.createdAt), at: togglTime(ws.updatedAt), server_deleted_at: null, is_multi_workspace_enabled: false, suspended_at: null, user_count: await db.workspaces.countMembers(ws.id), trial_info: null, is_chargify: false, is_unified: false, max_workspaces: 1, admin: owner, owner, permissions: null };
  }))));
  api.get('/me/features', async (req, res) => res.json((await db.workspaces.listForUser(res.locals.auth.user.id)).map(ws => ({ workspace_id: ws.id, features: [] }))));
  api.get('/me/projects', async (req, res) => res.json((await Promise.all((await db.workspaces.listForUser(res.locals.auth.user.id)).map(async (ws) => (await db.projects.list(ws.id, { active: queryFlag(req, 'include_archived') ? 'both' : true, changedSince: changedSince(req) })).map(p => serializeProject(p, ws.defaultCurrency))))).flat()));
  api.get('/me/clients', async (req, res) => res.json((await Promise.all((await db.workspaces.listForUser(res.locals.auth.user.id)).map(async (ws) => modifiedSince(await db.clients.list(ws.id), changedSince(req)).map(serializeClient)))).flat()));
  api.get('/me/tags', async (req, res) => res.json((await Promise.all((await db.workspaces.listForUser(res.locals.auth.user.id)).map(async (ws) => modifiedSince(await db.tags.list(ws.id), changedSince(req)).map(serializeTag)))).flat()));
  api.get('/me/tasks', async (req, res) => {
    const tasks = (await Promise.all((await db.workspaces.listForUser(res.locals.auth.user.id)).map(async (ws) => modifiedSince(await db.tasks.list(ws.id, { active: queryFlag(req, 'include_not_active') ? undefined : true }), changedSince(req))))).flat();
    const offset = Math.max(Number(query(req, 'offset') ?? 0) || 0, 0), size = query(req, 'per_page');
    const perPage = size === undefined ? tasks.length : Math.max(Number(size) || 1, 1);
    return res.json(tasks.slice(offset, offset + perPage).map(serializeTask));
  });
  api.get('/me/time_entries', async (req, res) => res.json((await db.entries.list(res.locals.auth.user.id, timeEntryFilter(req, res.locals.auth.user))).map(e => serializeTimeEntry(e, { meta: queryFlag(req, 'meta'), user: res.locals.auth.user }))));
  api.get('/me/time_entries/current', async (req, res) => { const e = await db.entries.running(res.locals.auth.user.id); return res.json(e ? serializeTimeEntry(e, { meta: queryFlag(req, 'meta'), user: res.locals.auth.user }) : null); });
  api.get('/me/time_entries/:id', async (req, res) => res.json(serializeTimeEntry(await getTimeEntry(db, res.locals.auth.user.id, parseId(req.params.id)), { meta: queryFlag(req, 'meta'), user: res.locals.auth.user })));
  api.get('/workspaces/:wid', async (req, res) => res.json(await workspaceDto(res.locals.auth.user, await workspaceFor(req, res))));
  api.put('/workspaces/:wid', async (req, res) => res.json(await workspaceDto(res.locals.auth.user, await deps.accountsFor(res.locals.auth).updateWorkspace(res.locals.auth.user.id, parseId(req.params.wid), readJson(req)))));
  api.get('/workspaces/:wid/users', async (req, res) => { const ws = await workspaceFor(req, res); return res.json((await db.workspaces.listMembers(ws.id)).map(m => ({ id: m.userId, email: m.email, fullname: m.fullName, timezone: m.timezone, admin: m.role === 'owner', inactive: false }))); });
  // Time entries
  api.post('/workspaces/:wid/time_entries', async (req, res) => {
    const ws = await workspaceFor(req, res);
    const entry = (await deps.entryWrite(res.locals.auth, ctx => createTimeEntry(ctx, res.locals.auth.user, ws.id, readJson(req), deps.publish)));
    return res.json(serializeTimeEntry(entry, { meta: queryFlag(req, 'meta'), user: res.locals.auth.user }));
  });
  api.put('/workspaces/:wid/time_entries/:id', async (req, res) => {
    const ws = await workspaceFor(req, res);
    const entry = (await deps.entryWrite(res.locals.auth, ctx => updateTimeEntry(ctx, res.locals.auth.user, ws.id, parseId(req.params.id), readJson(req), deps.publish)));
    return res.json(serializeTimeEntry(entry, { meta: queryFlag(req, 'meta'), user: res.locals.auth.user }));
  });
  api.patch('/workspaces/:wid/time_entries/:id/stop', async (req, res) => {
    const ws = await workspaceFor(req, res);
    const stop = req.body ? readJson(req).stop : undefined;
    const entry = (await deps.entryWrite(res.locals.auth, ctx => stopTimeEntry(ctx, res.locals.auth.user, ws.id, parseId(req.params.id), deps.publish, stop)));
    return res.json(serializeTimeEntry(entry, { meta: queryFlag(req, 'meta'), user: res.locals.auth.user }));
  });
  api.patch('/workspaces/:wid/time_entries/:ids', async (req, res) => {
    const ws = await workspaceFor(req, res);
    const ids = parseIdList(req.params.ids);
    const operations = readJsonArray(req);
    return res.json((await deps.entryWrite(res.locals.auth, ctx => patchTimeEntries(ctx, res.locals.auth.user, ws.id, ids, operations, deps.publish))));
  });
  api.delete('/workspaces/:wid/time_entries/:id', async (req, res) => {
    const ws = await workspaceFor(req, res);
    (await deps.entryWrite(res.locals.auth, ctx => deleteTimeEntry(ctx, res.locals.auth.user.id, ws.id, parseId(req.params.id), deps.publish)));
    return res.status(200).end();
  });
  // Projects
  api.get('/workspaces/:wid/projects', async (req, res) => {
    const ws = await workspaceFor(req, res);
    const projects = paginate(req, (await db.projects.list(ws.id, projectFilter(req))), 151);
    return res.json(projects.map((p) => serializeProject(p, ws.defaultCurrency)));
  });
  api.get('/workspaces/:wid/projects/:pid', async (req, res) => {
    const ws = await workspaceFor(req, res);
    return res.json(serializeProject((await getProject(db, ws.id, parseId(req.params.pid))), ws.defaultCurrency));
  });
  api.post('/workspaces/:wid/projects', async (req, res) => {
    const ws = await workspaceFor(req, res);
    const body = readJson(req);
    return res.json(serializeProject((await deps.catalogWrite(res.locals.auth, ws.id, (ctx, effects) => createProject(ctx, ws.id, body))), ws.defaultCurrency));
  });
  api.put('/workspaces/:wid/projects/:pid', async (req, res) => {
    const ws = await workspaceFor(req, res);
    const body = readJson(req);
    const project = (await deps.catalogWrite(res.locals.auth, ws.id, (ctx, effects) => updateProject(ctx, ws.id, parseId(req.params.pid), body, effects)));
    return res.json(serializeProject(project, ws.defaultCurrency));
  });
  api.delete('/workspaces/:wid/projects/:pid', async (req, res) => {
    const ws = await workspaceFor(req, res);
    const mode = query(req, 'teDeletionMode');
    (await deps.catalogWrite(res.locals.auth, ws.id, (ctx, effects) => deleteProject(ctx, ws.id, parseId(req.params.pid), mode === 'delete', effects)));
    return res.status(200).end();
  });
  // Tasks
  // Toggl wraps this listing in a paging envelope, unlike the per-project one below.
  api.get('/workspaces/:wid/tasks', async (req, res) => {
    const ws = await workspaceFor(req, res);
    const active = query(req, 'active');
    const pid = query(req, 'pid');
    const search = query(req, 'search')?.toLowerCase();
    let tasks = (await db.tasks.list(ws.id, { projectId: pid ? parseId(pid) : undefined, active: active === undefined || active === 'both' ? undefined : active === 'true' }));
    tasks = modifiedSince(tasks, changedSince(req));
    if (search)
      tasks = tasks.filter((task) => task.name.toLowerCase().includes(search));
    const sortField = query(req, 'sort_field') ?? 'name';
    const sortOrder = (query(req, 'sort_order') ?? 'ASC').toUpperCase();
    if (sortField !== 'name' && sortField !== 'created_at')
      throw badRequest('Invalid sort_field');
    if (sortOrder !== 'ASC' && sortOrder !== 'DESC')
      throw badRequest('Invalid sort_order');
    const direction = sortOrder === 'ASC' ? 1 : -1;
    tasks.sort((a, b) => direction * ((sortField === 'name'
      ? a.name.toLowerCase().localeCompare(b.name.toLowerCase()) : a.createdAt.localeCompare(b.createdAt)) || a.id - b.id));
    const page = Math.max(Number(query(req, 'page') ?? 1) || 1, 1);
    const perPage = Math.min(Math.max(Number(query(req, 'per_page') ?? 50) || 50, 1), 200);
    return res.json({
      data: tasks.slice((page - 1) * perPage, page * perPage).map(serializeTask),
      page,
      per_page: perPage,
      sort_field: sortField,
      sort_order: sortOrder,
      total_count: tasks.length,
    });
  });
  api.get('/workspaces/:wid/projects/:pid/tasks', async (req, res) => {
    const ws = await workspaceFor(req, res);
    const pid = parseId(req.params.pid);
    (await getProject(db, ws.id, pid));
    // Toggl: active=true lists open tasks only; false or absent lists all of them.
    const onlyActive = query(req, 'active') === 'true';
    return res.json((await db.tasks.list(ws.id, { projectId: pid, active: onlyActive ? true : undefined })).map(serializeTask));
  });
  api.get('/workspaces/:wid/projects/:pid/tasks/:tid', async (req, res) => {
    const ws = await workspaceFor(req, res);
    return res.json(serializeTask((await getTask(db, ws.id, parseId(req.params.tid), parseId(req.params.pid)))));
  });
  api.post('/workspaces/:wid/projects/:pid/tasks', async (req, res) => {
    const ws = await workspaceFor(req, res);
    return res.json(serializeTask((await deps.catalogWrite(res.locals.auth, ws.id, (ctx, effects) => createTask(ctx, ws.id, parseId(req.params.pid), readJson(req))))));
  });
  api.put('/workspaces/:wid/projects/:pid/tasks/:tid', async (req, res) => {
    const ws = await workspaceFor(req, res);
    const task = (await deps.catalogWrite(res.locals.auth, ws.id, (ctx, effects) => updateTask(ctx, ws.id, parseId(req.params.pid), parseId(req.params.tid), readJson(req), effects)));
    return res.json(serializeTask(task));
  });
  api.delete('/workspaces/:wid/projects/:pid/tasks/:tid', async (req, res) => {
    const ws = await workspaceFor(req, res);
    (await deps.catalogWrite(res.locals.auth, ws.id, (ctx, effects) => deleteTask(ctx, ws.id, parseId(req.params.pid), parseId(req.params.tid), effects)));
    return res.status(200).end();
  });
  // Clients
  api.get('/workspaces/:wid/clients', async (req, res) => {
    const ws = await workspaceFor(req, res);
    const status = query(req, 'status');
    if (status !== undefined && status !== 'active' && status !== 'archived' && status !== 'both') {
      throw badRequest('Client status is invalid');
    }
    return res.json((await db.clients.list(ws.id, { status: status === 'both' || status === 'archived' ? status : 'active', name: query(req, 'name') || undefined })).map(serializeClient));
  });
  api.get('/workspaces/:wid/clients/:cid', async (req, res) => {
    const ws = await workspaceFor(req, res);
    return res.json(serializeClient((await getClient(db, ws.id, parseId(req.params.cid)))));
  });
  api.post('/workspaces/:wid/clients', async (req, res) => {
    const ws = await workspaceFor(req, res);
    return res.json(serializeClient((await deps.catalogWrite(res.locals.auth, ws.id, (ctx, effects) => createClient(ctx, ws.id, readJson(req))))));
  });
  api.put('/workspaces/:wid/clients/:cid', async (req, res) => {
    const ws = await workspaceFor(req, res);
    return res.json(serializeClient((await deps.catalogWrite(res.locals.auth, ws.id, (ctx, effects) => updateClient(ctx, ws.id, parseId(req.params.cid), readJson(req), effects)))));
  });
  api.post('/workspaces/:wid/clients/:cid/archive', async (req, res) => {
    const ws = await workspaceFor(req, res);
    return res.json((await deps.catalogWrite(res.locals.auth, ws.id, (ctx, effects) => setClientArchived(ctx, ws.id, parseId(req.params.cid), true, effects))));
  });
  api.post('/workspaces/:wid/clients/:cid/restore', async (req, res) => {
    const ws = await workspaceFor(req, res);
    const cid = parseId(req.params.cid);
    const body = req.body ? readJson(req) : {};
    return res.json(serializeClient((await deps.catalogWrite(res.locals.auth, ws.id, (ctx, effects) => restoreClient(ctx, ws.id, cid, body, effects)))));
  });
  api.delete('/workspaces/:wid/clients/:cid', async (req, res) => {
    const ws = await workspaceFor(req, res);
    (await deps.catalogWrite(res.locals.auth, ws.id, (ctx, effects) => deleteClient(ctx, ws.id, parseId(req.params.cid), effects)));
    return res.status(200).end();
  });
  // Tags
  api.get('/workspaces/:wid/tags', async (req, res) => {
    const ws = await workspaceFor(req, res);
    return res.json(paginate(req, (await db.tags.list(ws.id, query(req, 'search') || undefined)), 200).map(serializeTag));
  });
  api.post('/workspaces/:wid/tags', async (req, res) => {
    const ws = await workspaceFor(req, res);
    return res.json(serializeTag((await deps.catalogWrite(res.locals.auth, ws.id, (ctx, effects) => createTag(ctx, ws.id, readJson(req))))));
  });
  api.put('/workspaces/:wid/tags/:tid', async (req, res) => {
    const ws = await workspaceFor(req, res);
    return res.json(serializeTag((await deps.catalogWrite(res.locals.auth, ws.id, (ctx, effects) => updateTag(ctx, ws.id, parseId(req.params.tid), readJson(req), effects)))));
  });
  api.delete('/workspaces/:wid/tags/:tid', async (req, res) => {
    const ws = await workspaceFor(req, res);
    (await deps.catalogWrite(res.locals.auth, ws.id, (ctx, effects) => deleteTag(ctx, ws.id, parseId(req.params.tid), effects)));
    return res.status(200).end();
  });
  return api;
}
