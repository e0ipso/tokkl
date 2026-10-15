import express, { type Request, type Response, type Router } from 'express';
import type { Db } from '../db/index.ts';
import { requireAuth } from '../auth/middleware.ts';
import type { Deps } from '../http/context.ts';
import { readJson } from '../http/context.ts';
import { badRequest, forbidden } from '../lib/errors.ts';
import { parseId } from '../lib/values.ts';
import { addDays } from '@tokkl/common/time';
import { getWorkspace, type WorkspaceRow } from '../models/workspaces.ts';
import { filterFromBody, resolutionFor, type Dimension } from '../services/reports.ts';
import { checkOrderBy, v3WeeklyFilter, type JobResult, type ReportJob } from '../services/reportJobs.ts';
import { reportRunner } from '../services/reportRunner.ts';

/** Toggl's Reports API v3 rejects ranges longer than a year. */
const TOGGL_MAX_DAYS = 366;

function workspaceFor(db: Db, req: Request): WorkspaceRow {
  const workspace = getWorkspace(db, parseId(req.params.wid));
  if (!workspace) throw forbidden('Workspace not found/accessible');
  return workspace;
}

const GROUPINGS: Record<string, Dimension> = {
  projects: 'project', clients: 'client', tags: 'tag', tasks: 'task', time_entries: 'description', users: 'none',
};

function dimension(value: unknown, fallback: string, field: string): [string, Dimension] {
  const name = value === undefined || value === null || value === '' ? fallback : String(value);
  const dim = GROUPINGS[name];
  if (!dim) throw badRequest(`Invalid '${field}' value, allowed values are: '${Object.keys(GROUPINGS).join(', ')}'`);
  return [name, dim];
}

/** Builds the response off the main thread (see reportRunner.ts) and sends it. */
async function send(deps: Deps, res: Response, ws: WorkspaceRow, job: ReportJob): Promise<void> {
  const result: JobResult = await reportRunner(deps.db).run(res.locals.user, ws, job);
  res.set(result.headers);
  if (result.type === 'csv') {
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${result.filename}"`);
  } else {
    res.type('json');
  }
  res.send(result.body);
}

/**
 * The parts of Toggl's Reports API v3 that make sense for one person: detailed (with paging),
 * totals, summary, weekly, and CSV exports.
 */
export function reportsV3Routes(deps: Deps): Router {
  const { db } = deps;
  const api = express.Router();
  api.use(requireAuth(deps));

  const v3Filter = (req: Request) => {
    const ws = workspaceFor(db, req);
    const body = readJson(req);
    return { ws, body, filter: filterFromBody(body, ws, TOGGL_MAX_DAYS) };
  };

  api.post('/workspace/:wid/search/time_entries', async (req, res) => {
    const { ws, body, filter } = v3Filter(req);
    checkOrderBy(body.order_by);
    const pageSize = Math.min(Math.max(Number(body.page_size ?? 50) || 50, 1), 1000);
    const firstRow = Math.max(Number(body.first_row_number ?? 1) || 1, 1);
    await send(deps, res, ws, { kind: 'v3-search', filter, orderBy: body.order_by, orderDir: body.order_dir, pageSize, firstRow });
  });

  api.post('/workspace/:wid/search/time_entries/totals', async (req, res) => {
    const { ws, body, filter } = v3Filter(req);
    const granularity = body.granularity === 'week' || body.granularity === 'month' ? body.granularity
      : resolutionFor(filter.startDate, filter.endDate);
    await send(deps, res, ws, { kind: 'v3-totals', filter, granularity, withGraph: Boolean(body.with_graph) });
  });

  api.post('/workspace/:wid/search/time_entries.csv', async (req, res) => {
    const { ws, body, filter } = v3Filter(req);
    checkOrderBy(body.order_by);
    await send(deps, res, ws, { kind: 'v3-csv', filter, orderBy: body.order_by, orderDir: body.order_dir, durationFormat: body.duration_format });
  });

  const summary = (req: Request, res: Response) => {
    const { ws, body, filter } = v3Filter(req);
    const [groupingName, grouping] = dimension(body.grouping, 'projects', 'grouping');
    const [subName, sub] = dimension(body.sub_grouping, 'time_entries', 'sub_grouping');
    if (grouping === sub) throw badRequest('grouping and sub_grouping must differ');
    res.set('X-Range-Start', filter.startDate);
    res.set('X-Range-End', filter.endDate);
    res.set('X-Grouping', groupingName);
    res.set('X-Sub-Grouping', subName);
    return { ws, body, filter, grouping, sub };
  };

  api.post('/workspace/:wid/summary/time_entries', async (req, res) => {
    const { ws, body, filter, grouping, sub } = summary(req, res);
    await send(deps, res, ws, { kind: 'v3-summary', filter, grouping, sub, includeIds: body.include_time_entry_ids === true });
  });

  api.post('/workspace/:wid/summary/time_entries.csv', async (req, res) => {
    const { ws, body, filter, grouping, sub } = summary(req, res);
    await send(deps, res, ws, { kind: 'v3-summary-csv', filter, grouping, sub, durationFormat: body.duration_format });
  });

  api.post('/workspace/:wid/weekly/time_entries', async (req, res) => {
    const ws = workspaceFor(db, req);
    const body = readJson(req);
    const start = typeof body.start_date === 'string' ? body.start_date : '';
    const range = filterFromBody({ ...body, end_date: body.end_date ?? (start ? addDays(start, 6) : undefined) }, ws, TOGGL_MAX_DAYS);
    const { filter, weekStart } = v3WeeklyFilter(range);
    await send(deps, res, ws, { kind: 'v3-weekly', filter, weekStart });
  });

  return api;
}

/** The largest page the web app's detailed report may request. */
const APP_MAX_PAGE_SIZE = 500;

function positiveInt(value: unknown, fallback: number, field: string): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw badRequest(`Invalid '${field}' value`);
  return value;
}

/** Report endpoint for the web app: totals, a time series and groupings in one response. */
export function appReportRoutes(deps: Deps): Router {
  const { db } = deps;
  const api = express.Router();

  /** The account's workspace, the request body and its filter, with the app's range allowance. */
  const appFilter = (req: Request, res: Response) => {
    const user = res.locals.user;
    const ws = getWorkspace(db, user.default_workspace_id)!;
    const body = readJson(req);
    // The web app always applies the workspace rounding setting; the request can still override it.
    const filter = filterFromBody({ rounding: ws.rounding, rounding_minutes: ws.rounding_minutes, ...body }, ws);
    return { user, ws, body, filter };
  };

  api.post('/report/weekly', requireAuth(deps), async (req, res) => {
    const { ws, body, filter } = appFilter(req, res);
    const rows = body.rows ?? 'projects';
    if (rows !== 'projects' && rows !== 'clients') throw badRequest("Invalid 'rows' value, allowed values are: 'projects, clients'");
    await send(deps, res, ws, { kind: 'app-weekly', filter, rows });
  });

  api.post('/report', requireAuth(deps), async (req, res) => {
    const { ws, body, filter } = appFilter(req, res);
    const [, grouping] = dimension(body.grouping, 'projects', 'grouping');
    const [, sub] = dimension(body.sub_grouping, 'time_entries', 'sub_grouping');
    await send(deps, res, ws, { kind: 'app-report', filter, grouping, sub });
  });

  /** The detailed report's sort order, checked before any entry is read. */
  const detailedOrder = (body: Record<string, unknown>) => {
    const sort = body.sort ?? 'date';
    if (sort !== 'date' && sort !== 'duration' && sort !== 'description') {
      throw badRequest("Invalid 'sort' value, allowed values are: 'date, duration, description'");
    }
    const dir = body.dir ?? 'desc';
    if (dir !== 'asc' && dir !== 'desc') throw badRequest("Invalid 'dir' value, allowed values are: 'asc, desc'");
    return { sort, dir } as const;
  };

  api.post('/report/entries', requireAuth(deps), async (req, res) => {
    const { ws, body, filter } = appFilter(req, res);
    const { sort, dir } = detailedOrder(body);
    const pageSize = positiveInt(body.page_size, 100, 'page_size');
    if (pageSize > APP_MAX_PAGE_SIZE) throw badRequest(`'page_size' must be at most ${APP_MAX_PAGE_SIZE}`);
    const page = positiveInt(body.page, 1, 'page');
    await send(deps, res, ws, { kind: 'app-entries', filter, sort, dir, pageSize, page });
  });

  // CSV exports of the report the web app shows: its range allowance, filters and rounding.
  api.post('/report/detailed.csv', requireAuth(deps), async (req, res) => {
    const { ws, body, filter } = appFilter(req, res);
    const { sort, dir } = detailedOrder(body);
    await send(deps, res, ws, { kind: 'app-detailed-csv', filter, sort, dir, durationFormat: body.duration_format });
  });

  api.post('/report/summary.csv', requireAuth(deps), async (req, res) => {
    const { ws, body, filter } = appFilter(req, res);
    const [, grouping] = dimension(body.grouping, 'projects', 'grouping');
    const [, sub] = dimension(body.sub_grouping, 'time_entries', 'sub_grouping');
    await send(deps, res, ws, { kind: 'app-summary-csv', filter, grouping, sub, durationFormat: body.duration_format });
  });

  return api;
}
