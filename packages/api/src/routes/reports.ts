import { type Request, type Response, type Router } from 'express';
import type { Deps } from './context.ts';
import { createRouter } from '../http/router.ts';
import { readJson } from '../http/request.ts';
import { calendarInput, invalidInput } from '../lib/errors.ts';
import { parseId } from '../lib/values.ts';
import { addDays } from '@tokkl/common/time';
import type { Workspace } from '../storage/domain.ts';
import { resolutionFor } from '../services/reportAggregates.ts';
import {
  parseDetailedOrder,
  parseDurationFormat,
  parseGrouping,
  parseOrderBy,
  parsePositiveInt,
  parseReportFilter,
  parseSortDirection,
} from '../commands/reports.ts';
import { v3WeeklyFilter, type JobResult, type ReportJob } from '../services/reportJobs.ts';
import type { ReportSlot } from '../services/reportRunner.ts';
import { lenientNumber } from '../http/params.ts';

type ReportRouteDeps = Pick<Deps, 'auth' | 'readFor' | 'reports'>;

/** Toggl's Reports API v3 rejects ranges longer than a year. */
const TOGGL_MAX_DAYS = 366;
/** The detailed search's page size when none is sent, and the largest it clamps to. */
const TOGGL_DEFAULT_PAGE_SIZE = 50;
const TOGGL_MAX_PAGE_SIZE = 1000;

/** The workspace in the URL, when the signed-in user is a member of it; 403 otherwise. */
function workspaceFor(deps: ReportRouteDeps, req: Request, res: Response): Promise<Workspace> {
  return deps.readFor(res.locals.auth, queries => queries.workspace(res.locals.auth.user.id, parseId(req.params.wid)));
}

/**
 * A report handler that holds a place in the report queue from the start, so a full queue answers
 * before the handler reads the workspace or parses the request.
 */
function queued(
  deps: ReportRouteDeps,
  handler: (req: Request, res: Response, slot: ReportSlot) => Promise<void>,
): (req: Request, res: Response) => Promise<void> {
  return (req, res) => deps.reports.reserve({ signal: res.locals.workSignal }, slot => handler(req, res, slot));
}

/** Builds the response in the report runner and sends it. */
async function send(slot: ReportSlot, res: Response, ws: Workspace, job: ReportJob): Promise<void> {
  const result: JobResult = await slot.run(res.locals.auth.user.id, ws.id, job, { authentication: res.locals.auth });
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
export function reportsV3Routes(deps: ReportRouteDeps): Router {
  const api = createRouter();
  api.use(deps.auth.requireAuth);

  const v3Filter = async (req: Request, res: Response) => {
    const ws = await workspaceFor(deps, req, res);
    const body = readJson(req);
    return { ws, body, filter: parseReportFilter(body, ws, TOGGL_MAX_DAYS) };
  };

  api.post(
    '/workspace/:wid/search/time_entries',
    queued(deps, async (req, res, slot) => {
      const { ws, body, filter } = await v3Filter(req, res);
      const orderBy = parseOrderBy(body.order_by);
      const pageSize = Math.min(
        Math.max(lenientNumber(body.page_size, TOGGL_DEFAULT_PAGE_SIZE), 1),
        TOGGL_MAX_PAGE_SIZE,
      );
      const firstRow = Math.max(lenientNumber(body.first_row_number, 1), 1);
      await send(slot, res, ws, {
        kind: 'v3-search',
        filter,
        orderBy,
        orderDir: parseSortDirection(body.order_dir),
        pageSize,
        firstRow,
      });
    }),
  );

  api.post(
    '/workspace/:wid/search/time_entries/totals',
    queued(deps, async (req, res, slot) => {
      const { ws, body, filter } = await v3Filter(req, res);
      const requestedResolution = body.granularity ?? body.resolution;
      if (
        requestedResolution != null &&
        requestedResolution !== 'day' &&
        requestedResolution !== 'week' &&
        requestedResolution !== 'month'
      ) {
        throw invalidInput("Invalid granularity or resolution: expected 'day', 'week' or 'month'");
      }
      const granularity = requestedResolution ?? resolutionFor(filter.startDate, filter.endDate);
      await send(slot, res, ws, { kind: 'v3-totals', filter, granularity, withGraph: Boolean(body.with_graph) });
    }),
  );

  api.post(
    '/workspace/:wid/search/time_entries.csv',
    queued(deps, async (req, res, slot) => {
      const { ws, body, filter } = await v3Filter(req, res);
      const orderBy = parseOrderBy(body.order_by);
      await send(slot, res, ws, {
        kind: 'v3-csv',
        filter,
        orderBy,
        orderDir: parseSortDirection(body.order_dir),
        durationFormat: parseDurationFormat(body.duration_format),
      });
    }),
  );

  const summary = async (req: Request, res: Response) => {
    const { ws, body, filter } = await v3Filter(req, res);
    const [groupingName, grouping] = parseGrouping(body.grouping, 'projects', 'grouping');
    const [subName, sub] = parseGrouping(body.sub_grouping, 'time_entries', 'sub_grouping');
    if (grouping === sub) throw invalidInput('grouping and sub_grouping must differ');
    res.set('X-Range-Start', filter.startDate);
    res.set('X-Range-End', filter.endDate);
    res.set('X-Grouping', groupingName);
    res.set('X-Sub-Grouping', subName);
    return { ws, body, filter, grouping, sub };
  };

  api.post(
    '/workspace/:wid/summary/time_entries',
    queued(deps, async (req, res, slot) => {
      const { ws, body, filter, grouping, sub } = await summary(req, res);
      await send(slot, res, ws, {
        kind: 'v3-summary',
        filter,
        grouping,
        sub,
        includeIds: body.include_time_entry_ids === true,
      });
    }),
  );

  api.post(
    '/workspace/:wid/summary/time_entries.csv',
    queued(deps, async (req, res, slot) => {
      const { ws, body, filter, grouping, sub } = await summary(req, res);
      await send(slot, res, ws, {
        kind: 'v3-summary-csv',
        filter,
        grouping,
        sub,
        durationFormat: parseDurationFormat(body.duration_format),
      });
    }),
  );

  api.post(
    '/workspace/:wid/weekly/time_entries',
    queued(deps, async (req, res, slot) => {
      const ws = await workspaceFor(deps, req, res);
      const body = readJson(req);
      const start = typeof body.start_date === 'string' ? body.start_date : '';
      const range = parseReportFilter(
        { ...body, end_date: body.end_date ?? (start ? calendarInput(() => addDays(start, 6)) : undefined) },
        ws,
        TOGGL_MAX_DAYS,
      );
      const { filter, weekStart } = v3WeeklyFilter(range);
      await send(slot, res, ws, { kind: 'v3-weekly', filter, weekStart });
    }),
  );

  return api;
}

/** The web app's detailed report page size when none is sent, and the largest it may request. */
const APP_DEFAULT_PAGE_SIZE = 100;
const APP_MAX_PAGE_SIZE = 500;

/** Report endpoint for the web app: totals, a time series and groupings in one response. */
export function appReportRoutes(deps: ReportRouteDeps): Router {
  const api = createRouter();

  /** The account's workspace, the request body and its filter, with the app's range allowance. */
  const appFilter = async (req: Request, res: Response) => {
    const user = res.locals.auth.user;
    // PUT /me accepts only a workspace the user belongs to, but a membership can end after that.
    const ws = await deps.readFor(res.locals.auth, queries => queries.workspace(user.id, user.defaultWorkspaceId));
    const body = readJson(req);
    // The web app always applies the workspace rounding setting; the request can still override it.
    const filter = parseReportFilter({ rounding: ws.rounding, rounding_minutes: ws.roundingMinutes, ...body }, ws);
    return { user, ws, body, filter };
  };

  api.post(
    '/report/weekly',
    deps.auth.requireAuth,
    queued(deps, async (req, res, slot) => {
      const { ws, body, filter } = await appFilter(req, res);
      const rows = body.rows ?? 'projects';
      if (rows !== 'projects' && rows !== 'clients')
        throw invalidInput("Invalid 'rows' value, allowed values are: 'projects, clients'");
      await send(slot, res, ws, { kind: 'app-weekly', filter, rows });
    }),
  );

  api.post(
    '/report',
    deps.auth.requireAuth,
    queued(deps, async (req, res, slot) => {
      const { ws, body, filter } = await appFilter(req, res);
      const [, grouping] = parseGrouping(body.grouping, 'projects', 'grouping');
      const [, sub] = parseGrouping(body.sub_grouping, 'time_entries', 'sub_grouping');
      await send(slot, res, ws, { kind: 'app-report', filter, grouping, sub });
    }),
  );

  api.post(
    '/report/entries',
    deps.auth.requireAuth,
    queued(deps, async (req, res, slot) => {
      const { ws, body, filter } = await appFilter(req, res);
      const { sort, dir } = parseDetailedOrder(body);
      const pageSize = parsePositiveInt(body.page_size, APP_DEFAULT_PAGE_SIZE, 'page_size');
      if (pageSize > APP_MAX_PAGE_SIZE) throw invalidInput(`'page_size' must be at most ${APP_MAX_PAGE_SIZE}`);
      const page = parsePositiveInt(body.page, 1, 'page');
      await send(slot, res, ws, { kind: 'app-entries', filter, sort, dir, pageSize, page });
    }),
  );

  // CSV exports of the report the web app shows: its range allowance, filters and rounding.
  api.post(
    '/report/detailed.csv',
    deps.auth.requireAuth,
    queued(deps, async (req, res, slot) => {
      const { ws, body, filter } = await appFilter(req, res);
      const { sort, dir } = parseDetailedOrder(body);
      await send(slot, res, ws, {
        kind: 'app-detailed-csv',
        filter,
        sort,
        dir,
        durationFormat: parseDurationFormat(body.duration_format),
      });
    }),
  );

  api.post(
    '/report/summary.csv',
    deps.auth.requireAuth,
    queued(deps, async (req, res, slot) => {
      const { ws, body, filter } = await appFilter(req, res);
      const [, grouping] = parseGrouping(body.grouping, 'projects', 'grouping');
      const [, sub] = parseGrouping(body.sub_grouping, 'time_entries', 'sub_grouping');
      await send(slot, res, ws, {
        kind: 'app-summary-csv',
        filter,
        grouping,
        sub,
        durationFormat: parseDurationFormat(body.duration_format),
      });
    }),
  );

  return api;
}
