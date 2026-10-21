import express, { type Request, type Response, type Router } from 'express';
import { nowIso, transaction, type Db } from '../db/index.ts';
import { generateApiToken, hashPassword, readNewPassword, verifyPassword } from '../auth/crypto.ts';
import { requireAuth, stillSignedIn } from '../auth/middleware.ts';
import { passwordCounters } from '../auth/rateLimit.ts';
import { deleteOtherSessions } from '../auth/sessions.ts';
import type { Deps } from '../http/context.ts';
import { clientAddress, query, queryFlag, readJson, readJsonArray } from '../http/context.ts';
import { badRequest, forbidden, tooManyRequests } from '../lib/errors.ts';
import { optionalId, optionalRate, optionalString, parseDateOrInstant, parseId, parseIdList, togglTime } from '../lib/values.ts';
import { canonicalTimeZone, startOfDay } from '@tokkl/common/time';
import {
  createClient, deleteClient, getClient, listClients, restoreClient, serializeClient, setClientArchived, updateClient,
} from '../models/clients.ts';
import {
  createProject, deleteProject, getProject, listProjects, serializeProject, updateProject, type ProjectFilter,
} from '../models/projects.ts';
import { ROUNDING_MINUTES } from '../services/reports.ts';
import { getInstanceSettings } from '../models/settings.ts';
import { createTag, deleteTag, listTags, serializeTag, updateTag } from '../models/tags.ts';
import { createTask, deleteTask, getTask, listTasks, serializeTask, updateTask } from '../models/tasks.ts';
import {
  createTimeEntry, deleteTimeEntry, getRunningEntry, getTimeEntry, listTimeEntries, patchTimeEntries,
  serializeTimeEntry, stopTimeEntry, updateTimeEntry, type TimeEntryFilter,
} from '../models/timeEntries.ts';
import {
  findUserByEmail, getPreferences, getUser, serializeUser, type UserRow, validatePreferenceChanges,
} from '../models/users.ts';
import {
  countWorkspaceMembers, getWorkspace, getWorkspaceRole, isWorkspaceMember, listWorkspaceMembers,
  listWorkspacesForUser, memberWorkspace, serializeWorkspace, type WorkspaceRow,
} from '../models/workspaces.ts';

/** Without filters Toggl returns entries that started in the last 9 days. */
const DEFAULT_LIST_DAYS = 9;

/** The workspace in the URL, when the signed-in user is a member of it; 403 otherwise. */
function workspaceFor(db: Db, req: Request, res: Response): WorkspaceRow {
  return memberWorkspace(db, res.locals.user.id, parseId(req.params.wid));
}

/** `ws` in Toggl's shape, with its admin flag and role taken from `user`'s membership. */
function serializeWorkspaceFor(db: Db, user: UserRow, ws: WorkspaceRow) {
  return serializeWorkspace(ws, getWorkspaceRole(db, user.id, ws.id));
}

function boundary(value: string, field: string, user: UserRow): Date {
  const parsed = parseDateOrInstant(value, field);
  return 'instant' in parsed ? parsed.instant : startOfDay(parsed.date, user.timezone);
}

function changedSince(req: Request): string | undefined {
  const since = query(req, 'since');
  if (since === undefined) return undefined;
  const date = new Date(Number(since) * 1000);
  if (!/^\d+$/.test(since) || Number.isNaN(date.getTime())) {
    throw badRequest('Since is expected to be an unix timestamp, integer value');
  }
  return date.toISOString();
}

function modifiedSince<T extends { updated_at: string }>(rows: T[], since: string | undefined): T[] {
  return since === undefined ? rows : rows.filter((row) => row.updated_at >= since);
}

function timeEntryFilter(req: Request, user: UserRow): TimeEntryFilter {
  const since = changedSince(req);
  const before = query(req, 'before');
  const startDate = query(req, 'start_date');
  const endDate = query(req, 'end_date');
  const filter: TimeEntryFilter = {};

  if (since !== undefined) filter.changedSince = new Date(since);
  if ((startDate === undefined) !== (endDate === undefined)) {
    throw badRequest('start_date and end_date must be used together');
  }
  if (startDate !== undefined && endDate !== undefined) {
    filter.from = boundary(startDate, 'start_date', user);
    filter.to = boundary(endDate, 'end_date', user);
    if (filter.to < filter.from) throw badRequest('end_date must not be earlier than start_date');
  }
  if (before !== undefined) filter.to = boundary(before, 'before', user);
  if (!filter.changedSince && !filter.from && !filter.to) {
    filter.from = new Date(Date.now() - DEFAULT_LIST_DAYS * 86_400_000);
  }
  return filter;
}

function projectFilter(req: Request): ProjectFilter {
  const active = query(req, 'active');
  const billable = query(req, 'billable');
  const clientIds = query(req, 'client_ids');
  return {
    active: active === 'both' ? 'both' : active === 'false' ? false : active === 'true' ? true : 'both',
    billable: billable === undefined ? undefined : billable === 'true',
    name: query(req, 'name') || query(req, 'search') || undefined,
    clientIds: clientIds ? parseIdList(clientIds, 1000) : undefined,
    sinceIso: changedSince(req),
  };
}

/**
 * Applies Toggl's page/per_page parameters when a client sends them. Without them the whole list is
 * returned; Toggl pages by default, but one person's projects and tags fit in a single response.
 */
function paginate<T>(req: Request, items: T[], defaultPerPage: number): T[] {
  const page = query(req, 'page');
  const perPageParam = query(req, 'per_page');
  if (page === undefined && perPageParam === undefined) return items;
  const perPage = Math.min(Math.max(Number(perPageParam ?? defaultPerPage) || defaultPerPage, 1), 200);
  const pageNumber = Math.max(Number(page ?? 1) || 1, 1);
  return items.slice((pageNumber - 1) * perPage, pageNumber * perPage);
}

export function togglV9Routes(deps: Deps): Router {
  const { db, config, loginLimiter } = deps;
  const api = express.Router();
  api.use(requireAuth(deps));

  // ----- /me ------------------------------------------------------------------------------------
  api.get('/me', (req, res) => {
    const user = res.locals.user;
    // role and time_resolution_minutes are Tokkl's own fields: the instance role the web app needs to
    // show the admin area, and the instance time resolution, which only an admin changes.
    // Every Toggl field keeps its name, type and meaning.
    const body: Record<string, unknown> = {
      ...serializeUser(user, { includeToken: true }),
      role: user.role,
      time_resolution_minutes: getInstanceSettings(db, config).time_resolution_minutes,
    };
    if (queryFlag(req, 'with_related_data')) {
      const workspaces = listWorkspacesForUser(db, user.id);
      body.workspaces = workspaces.map((ws) => serializeWorkspaceFor(db, user, ws));
      body.clients = workspaces.flatMap((ws) => listClients(db, ws.id).map(serializeClient));
      body.projects = workspaces.flatMap((ws) => listProjects(db, ws.id).map((p) => serializeProject(p, ws.default_currency)));
      body.tags = workspaces.flatMap((ws) => listTags(db, ws.id).map(serializeTag));
      body.tasks = workspaces.flatMap((ws) => listTasks(db, ws.id).map(serializeTask));
      body.time_entries = listTimeEntries(db, user.id, { from: new Date(Date.now() - DEFAULT_LIST_DAYS * 86_400_000) })
        .map((te) => serializeTimeEntry(te));
    }
    return res.json(body);
  });

  api.put('/me', async (req, res) => {
    const user = res.locals.user;
    const body = readJson(req);
    const email = optionalString(body.email, 'email', 255)?.trim();
    if (email !== undefined && !/^[^@\s]+@[^@\s]+$/.test(email)) throw badRequest('Invalid email');
    const fullname = optionalString(body.fullname, 'fullname', 255);
    const requestedZone = optionalString(body.timezone, 'timezone', 64);
    const timezone = requestedZone === undefined ? undefined : canonicalTimeZone(requestedZone);
    if (timezone === null) throw badRequest('Invalid timezone');
    let beginningOfWeek = user.beginning_of_week;
    if (body.beginning_of_week !== undefined) {
      if (!Number.isInteger(body.beginning_of_week) || (body.beginning_of_week as number) < 0 || (body.beginning_of_week as number) > 6) {
        throw badRequest('Invalid beginning_of_week');
      }
      beginningOfWeek = body.beginning_of_week as number;
    }
    const defaultWorkspaceId = optionalId(body.default_workspace_id, 'default_workspace_id');
    if (defaultWorkspaceId && !isWorkspaceMember(db, user.id, defaultWorkspaceId)) throw badRequest('Invalid default_workspace_id');

    let passwordHash = user.password_hash;
    if (body.password !== undefined) {
      const password = readNewPassword(body.password);
      // No length cap on the current password, so an owner whose older setup accepted a longer one can
      // still rotate it. Login and Basic auth do the same; the request body limit bounds it.
      const current = optionalString(body.current_password, 'current_password', Number.POSITIVE_INFINITY) ?? '';
      const counters = passwordCounters(user.email, clientAddress(req));
      const valid = await loginLimiter.attempt(counters, () => verifyPassword(current, user.password_hash));
      if (valid === null) throw tooManyRequests('Too many failed attempts, try again later', loginLimiter.retryAfterSeconds(counters));
      if (!valid) throw badRequest('Current password is not valid');
      passwordHash = await hashPassword(password);
      // Nothing below awaits, so a reset or another password change cannot commit between this check
      // and the UPDATE. One that committed while scrypt ran refuses the request, as an ended session would.
      if (!stillSignedIn(db, res.locals, user)) throw forbidden('Incorrect username and/or password');
    }

    // Checked after the last await, so no other request can take the address before the UPDATE.
    // findUserByEmail matches case-insensitively, like the column's UNIQUE constraint.
    if (email !== undefined) {
      const owner = findUserByEmail(db, email);
      if (owner && owner.id !== user.id) throw badRequest('Email already in use');
    }

    transaction(db, () => {
      db.prepare(`
        UPDATE users SET email = ?, fullname = ?, timezone = ?, beginning_of_week = ?, default_workspace_id = ?,
          password_hash = ?, updated_at = ?
        WHERE id = ?
      `).run(email ?? user.email, fullname ?? user.fullname, timezone ?? user.timezone, beginningOfWeek,
        defaultWorkspaceId ?? user.default_workspace_id, passwordHash, nowIso(), user.id);
      // A new password replaces the API token, so a token saved on a lost or leaked device stops working,
      // and signs out every other browser; the one making the change stays signed in. The response
      // carries the new token, so a caller signed in with the old one can go on with it.
      if (passwordHash !== user.password_hash) {
        db.prepare('UPDATE users SET api_token = ? WHERE id = ?').run(generateApiToken(), user.id);
        deleteOtherSessions(db, user.id, res.locals.authMethod === 'session' ? res.locals.sessionToken : undefined);
      }
    });
    return res.json(serializeUser(getUser(db, user.id)!, { includeToken: true }));
  });

  api.post('/me/reset_token', (req, res) => {
    const token = generateApiToken();
    db.prepare('UPDATE users SET api_token = ?, updated_at = ? WHERE id = ?').run(token, nowIso(), res.locals.user.id);
    return res.json(token);
  });

  api.get('/me/preferences', (req, res) => res.json(getPreferences(res.locals.user)));
  api.get('/me/preferences/:client', (req, res) => res.json(getPreferences(res.locals.user)));

  const savePreferences = async (req: Request, res: express.Response) => {
    const user = res.locals.user;
    const body = readJson(req);
    validatePreferenceChanges(body);
    const merged = { ...(JSON.parse(user.preferences) as Record<string, unknown>), ...body };
    const serialized = JSON.stringify(merged);
    if (serialized.length > 64 * 1024) throw badRequest('Preferences are too large');
    db.prepare('UPDATE users SET preferences = ?, updated_at = ? WHERE id = ?').run(serialized, nowIso(), user.id);
    return res.json(getPreferences(getUser(db, user.id)!));
  };
  api.post('/me/preferences', savePreferences);
  api.post('/me/preferences/:client', savePreferences);

  api.get('/me/workspaces', (req, res) => {
    const user = res.locals.user;
    return res.json(modifiedSince(listWorkspacesForUser(db, user.id), changedSince(req))
      .map((ws) => serializeWorkspaceFor(db, user, ws)));
  });

  api.get('/me/organizations', (req, res) => res.json(listWorkspacesForUser(db, res.locals.user.id).map((ws) => {
    const owner = getWorkspaceRole(db, res.locals.user.id, ws.id) === 'owner';
    return {
      id: ws.id,
      name: ws.name,
      pricing_plan_id: 0,
      pricing_plan_name: 'Self-hosted',
      created_at: togglTime(ws.created_at),
      at: togglTime(ws.updated_at),
      server_deleted_at: null,
      is_multi_workspace_enabled: false,
      suspended_at: null,
      user_count: countWorkspaceMembers(db, ws.id),
      trial_info: null,
      is_chargify: false,
      is_unified: false,
      max_workspaces: 1,
      admin: owner,
      owner,
      permissions: null,
    };
  })));

  api.get('/me/features', (req, res) =>
    res.json(listWorkspacesForUser(db, res.locals.user.id).map((ws) => ({ workspace_id: ws.id, features: [] }))));

  api.get('/me/projects', (req, res) => {
    const includeArchived = queryFlag(req, 'include_archived');
    const sinceIso = changedSince(req);
    return res.json(listWorkspacesForUser(db, res.locals.user.id).flatMap((ws) =>
      listProjects(db, ws.id, { active: includeArchived ? 'both' : true, sinceIso })
        .map((p) => serializeProject(p, ws.default_currency))));
  });

  api.get('/me/clients', (req, res) => {
    const since = changedSince(req);
    return res.json(listWorkspacesForUser(db, res.locals.user.id).flatMap((ws) =>
      modifiedSince(listClients(db, ws.id), since).map(serializeClient)));
  });

  api.get('/me/tags', (req, res) => {
    const since = changedSince(req);
    return res.json(listWorkspacesForUser(db, res.locals.user.id).flatMap((ws) =>
      modifiedSince(listTags(db, ws.id), since).map(serializeTag)));
  });

  api.get('/me/tasks', (req, res) => {
    const includeDone = queryFlag(req, 'include_not_active');
    const since = changedSince(req);
    const offset = Math.max(Number(query(req, 'offset') ?? 0) || 0, 0);
    const perPageParam = query(req, 'per_page');
    const tasks = listWorkspacesForUser(db, res.locals.user.id).flatMap((ws) =>
      modifiedSince(listTasks(db, ws.id, undefined, includeDone ? undefined : true), since));
    const perPage = perPageParam === undefined ? tasks.length : Math.max(Number(perPageParam) || 1, 1);
    return res.json(tasks.slice(offset, offset + perPage).map(serializeTask));
  });

  api.get('/me/time_entries', (req, res) => {
    const user = res.locals.user;
    const meta = queryFlag(req, 'meta');
    const entries = listTimeEntries(db, user.id, timeEntryFilter(req, user));
    return res.json(entries.map((te) => serializeTimeEntry(te, { meta, user })));
  });

  api.get('/me/time_entries/current', (req, res) => {
    const running = getRunningEntry(db, res.locals.user.id);
    return res.json(running ? serializeTimeEntry(running, { meta: queryFlag(req, 'meta'), user: res.locals.user }) : null);
  });

  api.get('/me/time_entries/:id', (req, res) => {
    const entry = getTimeEntry(db, res.locals.user.id, parseId(req.params.id));
    return res.json(serializeTimeEntry(entry, { meta: queryFlag(req, 'meta'), user: res.locals.user }));
  });

  // ----- workspaces -----------------------------------------------------------------------------
  api.get('/workspaces/:wid', (req, res) => res.json(serializeWorkspaceFor(db, res.locals.user, workspaceFor(db, req, res))));

  api.put('/workspaces/:wid', async (req, res) => {
    const ws = workspaceFor(db, req, res);
    const body = readJson(req);
    const name = optionalString(body.name, 'name', 140)?.trim() || ws.name;
    const currency = optionalString(body.default_currency, 'default_currency', 3);
    if (currency !== undefined && !/^[A-Za-z]{3}$/.test(currency)) throw badRequest('Invalid default_currency');
    // optionalRate refuses JSON overflow such as 1e400, which parses to Infinity, and rates above the cap.
    const newRate = optionalRate(body.default_hourly_rate, 'default_hourly_rate');
    const rate = newRate === undefined ? ws.default_hourly_rate : newRate;
    let rounding = ws.rounding;
    if (body.rounding !== undefined) {
      if (![-1, 0, 1].includes(body.rounding as number)) throw badRequest('Invalid rounding');
      rounding = body.rounding as number;
    }
    let roundingMinutes = ws.rounding_minutes;
    if (body.rounding_minutes !== undefined) {
      if (!ROUNDING_MINUTES.includes(body.rounding_minutes as number)) {
        throw badRequest(`Invalid rounding_minutes, allowed values are: ${ROUNDING_MINUTES.join(', ')}`);
      }
      roundingMinutes = body.rounding_minutes as number;
    }
    db.prepare(`
      UPDATE workspaces SET name = ?, default_currency = ?, default_hourly_rate = ?, rounding = ?, rounding_minutes = ?,
        updated_at = ? WHERE id = ?
    `).run(name, (currency ?? ws.default_currency).toUpperCase(), rate, rounding, roundingMinutes, nowIso(), ws.id);
    return res.json(serializeWorkspaceFor(db, res.locals.user, getWorkspace(db, ws.id)!));
  });

  api.get('/workspaces/:wid/users', (req, res) => {
    const ws = workspaceFor(db, req, res);
    return res.json(listWorkspaceMembers(db, ws.id).map((member) => ({
      id: member.id, email: member.email, fullname: member.fullname, timezone: member.timezone,
      admin: member.role === 'owner', inactive: false,
    })));
  });

  // Time entries
  api.post('/workspaces/:wid/time_entries', async (req, res) => {
    const ws = workspaceFor(db, req, res);
    const entry = createTimeEntry(db, res.locals.user, ws.id, readJson(req));
    return res.json(serializeTimeEntry(entry, { meta: queryFlag(req, 'meta'), user: res.locals.user }));
  });

  api.put('/workspaces/:wid/time_entries/:id', async (req, res) => {
    const ws = workspaceFor(db, req, res);
    const entry = updateTimeEntry(db, res.locals.user, ws.id, parseId(req.params.id), readJson(req));
    return res.json(serializeTimeEntry(entry, { meta: queryFlag(req, 'meta'), user: res.locals.user }));
  });

  api.patch('/workspaces/:wid/time_entries/:id/stop', (req, res) => {
    const ws = workspaceFor(db, req, res);
    const stop = req.body ? readJson(req).stop : undefined;
    const entry = stopTimeEntry(db, res.locals.user, ws.id, parseId(req.params.id), stop);
    return res.json(serializeTimeEntry(entry, { meta: queryFlag(req, 'meta'), user: res.locals.user }));
  });

  api.patch('/workspaces/:wid/time_entries/:ids', async (req, res) => {
    const ws = workspaceFor(db, req, res);
    const ids = parseIdList(req.params.ids);
    const operations = readJsonArray(req);
    return res.json(transaction(db, () => patchTimeEntries(db, res.locals.user, ws.id, ids, operations)));
  });

  api.delete('/workspaces/:wid/time_entries/:id', (req, res) => {
    const ws = workspaceFor(db, req, res);
    deleteTimeEntry(db, res.locals.user.id, ws.id, parseId(req.params.id));
    return res.status(200).end();
  });

  // Projects
  api.get('/workspaces/:wid/projects', (req, res) => {
    const ws = workspaceFor(db, req, res);
    const projects = paginate(req, listProjects(db, ws.id, projectFilter(req)), 151);
    return res.json(projects.map((p) => serializeProject(p, ws.default_currency)));
  });
  api.get('/workspaces/:wid/projects/:pid', (req, res) => {
    const ws = workspaceFor(db, req, res);
    return res.json(serializeProject(getProject(db, ws.id, parseId(req.params.pid)), ws.default_currency));
  });
  api.post('/workspaces/:wid/projects', async (req, res) => {
    const ws = workspaceFor(db, req, res);
    const body = readJson(req);
    return res.json(serializeProject(transaction(db, () => createProject(db, ws.id, body)), ws.default_currency));
  });
  api.put('/workspaces/:wid/projects/:pid', async (req, res) => {
    const ws = workspaceFor(db, req, res);
    const body = readJson(req);
    const project = transaction(db, () => updateProject(db, ws.id, parseId(req.params.pid), body));
    return res.json(serializeProject(project, ws.default_currency));
  });
  api.delete('/workspaces/:wid/projects/:pid', (req, res) => {
    const ws = workspaceFor(db, req, res);
    const mode = query(req, 'teDeletionMode');
    transaction(db, () => deleteProject(db, ws.id, parseId(req.params.pid), mode === 'delete'));
    return res.status(200).end();
  });

  // Tasks
  // Toggl wraps this listing in a paging envelope, unlike the per-project one below.
  api.get('/workspaces/:wid/tasks', (req, res) => {
    const ws = workspaceFor(db, req, res);
    const active = query(req, 'active');
    const pid = query(req, 'pid');
    const search = query(req, 'search')?.toLowerCase();
    let tasks = listTasks(db, ws.id, pid ? parseId(pid) : undefined,
      active === undefined || active === 'both' ? undefined : active === 'true');
    tasks = modifiedSince(tasks, changedSince(req));
    if (search) tasks = tasks.filter((task) => task.name.toLowerCase().includes(search));
    const sortField = query(req, 'sort_field') ?? 'name';
    const sortOrder = (query(req, 'sort_order') ?? 'ASC').toUpperCase();
    if (sortField !== 'name' && sortField !== 'created_at') throw badRequest('Invalid sort_field');
    if (sortOrder !== 'ASC' && sortOrder !== 'DESC') throw badRequest('Invalid sort_order');
    const direction = sortOrder === 'ASC' ? 1 : -1;
    tasks.sort((a, b) => direction * ((sortField === 'name'
      ? a.name.toLowerCase().localeCompare(b.name.toLowerCase()) : a.created_at.localeCompare(b.created_at)) || a.id - b.id));
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
  api.get('/workspaces/:wid/projects/:pid/tasks', (req, res) => {
    const ws = workspaceFor(db, req, res);
    const pid = parseId(req.params.pid);
    getProject(db, ws.id, pid);
    // Toggl: active=true lists open tasks only; false or absent lists all of them.
    const onlyActive = query(req, 'active') === 'true';
    return res.json(listTasks(db, ws.id, pid, onlyActive ? true : undefined).map(serializeTask));
  });
  api.get('/workspaces/:wid/projects/:pid/tasks/:tid', (req, res) => {
    const ws = workspaceFor(db, req, res);
    return res.json(serializeTask(getTask(db, ws.id, parseId(req.params.tid), parseId(req.params.pid))));
  });
  api.post('/workspaces/:wid/projects/:pid/tasks', async (req, res) => {
    const ws = workspaceFor(db, req, res);
    return res.json(serializeTask(createTask(db, ws.id, parseId(req.params.pid), readJson(req))));
  });
  api.put('/workspaces/:wid/projects/:pid/tasks/:tid', async (req, res) => {
    const ws = workspaceFor(db, req, res);
    const task = updateTask(db, ws.id, parseId(req.params.pid), parseId(req.params.tid), readJson(req));
    return res.json(serializeTask(task));
  });
  api.delete('/workspaces/:wid/projects/:pid/tasks/:tid', (req, res) => {
    const ws = workspaceFor(db, req, res);
    deleteTask(db, ws.id, parseId(req.params.pid), parseId(req.params.tid));
    return res.status(200).end();
  });

  // Clients
  api.get('/workspaces/:wid/clients', (req, res) => {
    const ws = workspaceFor(db, req, res);
    const status = query(req, 'status');
    if (status !== undefined && status !== 'active' && status !== 'archived' && status !== 'both') {
      throw badRequest('Client status is invalid');
    }
    return res.json(listClients(db, ws.id,
      status === 'both' || status === 'archived' ? status : 'active', query(req, 'name') || undefined).map(serializeClient));
  });
  api.get('/workspaces/:wid/clients/:cid', (req, res) => {
    const ws = workspaceFor(db, req, res);
    return res.json(serializeClient(getClient(db, ws.id, parseId(req.params.cid))));
  });
  api.post('/workspaces/:wid/clients', async (req, res) => {
    const ws = workspaceFor(db, req, res);
    return res.json(serializeClient(createClient(db, ws.id, readJson(req))));
  });
  api.put('/workspaces/:wid/clients/:cid', async (req, res) => {
    const ws = workspaceFor(db, req, res);
    return res.json(serializeClient(updateClient(db, ws.id, parseId(req.params.cid), readJson(req))));
  });
  api.post('/workspaces/:wid/clients/:cid/archive', (req, res) => {
    const ws = workspaceFor(db, req, res);
    return res.json(transaction(db, () => setClientArchived(db, ws.id, parseId(req.params.cid), true)));
  });
  api.post('/workspaces/:wid/clients/:cid/restore', async (req, res) => {
    const ws = workspaceFor(db, req, res);
    const cid = parseId(req.params.cid);
    const body = req.body ? readJson(req) : {};
    return res.json(serializeClient(transaction(db, () => restoreClient(db, ws.id, cid, body))));
  });
  api.delete('/workspaces/:wid/clients/:cid', (req, res) => {
    const ws = workspaceFor(db, req, res);
    deleteClient(db, ws.id, parseId(req.params.cid));
    return res.status(200).end();
  });

  // Tags
  api.get('/workspaces/:wid/tags', (req, res) => {
    const ws = workspaceFor(db, req, res);
    return res.json(paginate(req, listTags(db, ws.id, query(req, 'search') || undefined), 200).map(serializeTag));
  });
  api.post('/workspaces/:wid/tags', async (req, res) => {
    const ws = workspaceFor(db, req, res);
    return res.json(serializeTag(createTag(db, ws.id, readJson(req))));
  });
  api.put('/workspaces/:wid/tags/:tid', async (req, res) => {
    const ws = workspaceFor(db, req, res);
    return res.json(serializeTag(updateTag(db, ws.id, parseId(req.params.tid), readJson(req))));
  });
  api.delete('/workspaces/:wid/tags/:tid', (req, res) => {
    const ws = workspaceFor(db, req, res);
    transaction(db, () => deleteTag(db, ws.id, parseId(req.params.tid)));
    return res.status(200).end();
  });

  return api;
}

