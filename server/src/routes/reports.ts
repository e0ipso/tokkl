import express, { type Request, type Response, type Router } from 'express';
import type { Db } from '../db/index.ts';
import { requireAuth } from '../auth/middleware.ts';
import type { Deps } from '../http/context.ts';
import { readJson } from '../http/context.ts';
import { toCsv } from '../lib/csv.ts';
import { badRequest, forbidden } from '../lib/errors.ts';
import { parseId, togglTime } from '../lib/values.ts';
import { formatDuration, type DurationFormat } from '../../../shared/duration.ts';
import { addDays, daysBetween, startOfWeek } from '../../../shared/time.ts';
import { getWorkspace, type WorkspaceRow } from '../models/workspaces.ts';
import {
  collectEntries, filterFromBody, groupEntries, resolutionFor, timeSeries, totalsOf, weeklyGrid,
  type Dimension, type Group, type ReportEntry,
} from '../services/reports.ts';
import { toTogglCsv } from '../services/export.ts';

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

function durationFormatOf(value: unknown): DurationFormat {
  return value === 'classic' || value === 'decimal' ? value : 'improved';
}

function centsOrNull(entry: ReportEntry): number | null {
  return entry.amountCents;
}

function detailedRow(entry: ReportEntry, rowNumber: number, user: { id: number; fullname: string; email: string }) {
  return {
    user_id: user.id,
    username: user.fullname,
    email: user.email,
    project_id: entry.projectId,
    project_name: entry.projectName,
    project_color: entry.projectColor,
    project_hex: entry.projectColor,
    client_name: entry.clientName,
    task_id: entry.taskId,
    task_name: entry.taskName,
    description: entry.description,
    billable: entry.billable,
    tag_ids: entry.tags.map((tag) => tag.id),
    tag_names: entry.tags.map((tag) => tag.name),
    hourly_rate_in_cents: entry.hourlyRateCents,
    billable_amount_in_cents: centsOrNull(entry),
    currency: entry.currency,
    row_number: rowNumber,
    time_entries: [{
      id: entry.id,
      seconds: entry.seconds,
      start: togglTime(entry.start),
      stop: togglTime(entry.stop),
      at: togglTime(entry.at),
    }],
  };
}

function sortDetailed(entries: ReportEntry[], orderBy: unknown, orderDir: unknown): ReportEntry[] {
  const dir = String(orderDir ?? 'DESC').toUpperCase() === 'ASC' ? 1 : -1;
  const sorted = [...entries];
  switch (orderBy ?? 'date') {
    case 'date':
    case 'user':
      sorted.sort((a, b) => dir * (a.start.localeCompare(b.start) || a.id - b.id));
      break;
    case 'duration':
      sorted.sort((a, b) => dir * (a.seconds - b.seconds || a.id - b.id));
      break;
    case 'description':
      sorted.sort((a, b) => dir * (a.description.localeCompare(b.description) || a.id - b.id));
      break;
    case 'last_update':
      sorted.sort((a, b) => dir * (a.at.localeCompare(b.at) || a.id - b.id));
      break;
    default:
      throw badRequest("Invalid 'order_by' value, allowed values are: 'date, user, duration, description, last_update'");
  }
  return sorted;
}

function summaryGroup(group: Group, groupingDimension: Dimension, includeIds: boolean) {
  return {
    id: groupingDimension === 'description' ? null : group.id,
    ...(groupingDimension === 'project' ? { project_color: group.color, project_hex_color: group.color } : {}),
    sub_groups: group.subGroups.map((sub) => ({
      id: sub.id,
      title: sub.title,
      seconds: sub.seconds,
      ...(includeIds ? { ids: sub.entryIds } : {}),
    })),
    ...(group.subGroups.length === 0 ? { seconds: group.seconds } : {}),
  };
}

function rangeHeaders(res: Response, startDate: string, endDate: string): void {
  res.set('X-Range-Start', startDate);
  res.set('X-Range-End', endDate);
}

/**
 * The parts of Toggl's Reports API v3 that make sense for one person: detailed (with paging),
 * totals, summary, weekly, and CSV exports.
 */
export function reportsV3Routes(deps: Deps): Router {
  const { db } = deps;
  const api = express.Router();
  api.use(requireAuth(deps));

  const detailed = (req: Request, res: Response) => {
    const ws = workspaceFor(db, req);
    const body = readJson(req);
    const filter = filterFromBody(body, ws, TOGGL_MAX_DAYS);
    const entries = sortDetailed(collectEntries(db, res.locals.user, ws, filter), body.order_by, body.order_dir);
    return { body, filter, entries };
  };

  api.post('/workspace/:wid/search/time_entries', async (req, res) => {
    const { body, filter, entries } = detailed(req, res);
    const pageSize = Math.min(Math.max(Number(body.page_size ?? 50) || 50, 1), 1000);
    const firstRow = Math.max(Number(body.first_row_number ?? 1) || 1, 1);
    const page = entries.slice(firstRow - 1, firstRow - 1 + pageSize);
    rangeHeaders(res, filter.startDate, filter.endDate);
    if (firstRow - 1 + pageSize < entries.length) {
      res.set('X-Next-ID', String(entries[firstRow - 1 + pageSize]!.id));
      res.set('X-Next-Row-Number', String(firstRow + pageSize));
    }
    const user = res.locals.user;
    return res.json(page.map((entry, i) => detailedRow(entry, firstRow + i, user)));
  });

  api.post('/workspace/:wid/search/time_entries/totals', async (req, res) => {
    const ws = workspaceFor(db, req);
    const body = readJson(req);
    const filter = filterFromBody(body, ws, TOGGL_MAX_DAYS);
    const entries = collectEntries(db, res.locals.user, ws, filter);
    const totals = totalsOf(entries);
    const granularity = body.granularity === 'week' || body.granularity === 'month' ? body.granularity
      : resolutionFor(filter.startDate, filter.endDate);
    const series = timeSeries(entries, filter.startDate, filter.endDate, granularity, res.locals.user.beginning_of_week);
    rangeHeaders(res, filter.startDate, filter.endDate);
    return res.json({
      seconds: totals.seconds,
      tracked_days: new Set(entries.map((e) => e.date)).size,
      billable_amount_in_cents: totals.amounts.reduce((sum, a) => sum + a.cents, 0),
      labour_cost_in_cents: 0,
      resolution: granularity,
      rates: [],
      graph: body.with_graph ? series.map((point) => ({ seconds: point.seconds, billable_amount_in_cents: 0, labour_cost_in_cents: 0, by_rate: {} })) : [],
    });
  });

  api.post('/workspace/:wid/search/time_entries.csv', async (req, res) => {
    const { body, entries } = detailed(req, res);
    const csv = toTogglCsv(entries.map((entry) => ({
      ...entry, tags: entry.tags.map((tag) => tag.name),
    })), res.locals.user, durationFormatOf(body.duration_format));
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="Toggl_time_entries.csv"');
    return res.send(csv);
  });

  const summary = (req: Request, res: Response) => {
    const ws = workspaceFor(db, req);
    const body = readJson(req);
    const filter = filterFromBody(body, ws, TOGGL_MAX_DAYS);
    const [groupingName, grouping] = dimension(body.grouping, 'projects', 'grouping');
    const [subName, sub] = dimension(body.sub_grouping, 'time_entries', 'sub_grouping');
    if (grouping === sub) throw badRequest('grouping and sub_grouping must differ');
    const entries = collectEntries(db, res.locals.user, ws, filter);
    rangeHeaders(res, filter.startDate, filter.endDate);
    res.set('X-Grouping', groupingName);
    res.set('X-Sub-Grouping', subName);
    return { body, grouping, groups: groupEntries(entries, grouping, sub), entries };
  };

  api.post('/workspace/:wid/summary/time_entries', async (req, res) => {
    const { body, grouping, groups } = summary(req, res);
    return res.json({ groups: groups.map((group) => summaryGroup(group, grouping, body.include_time_entry_ids === true)) });
  });

  api.post('/workspace/:wid/summary/time_entries.csv', async (req, res) => {
    const { body, groups } = summary(req, res);
    const durationFormat = durationFormatOf(body.duration_format);
    const rows: Array<Array<string | number | null>> = [['Group', 'Sub group', 'Duration']];
    for (const group of groups) {
      if (group.subGroups.length === 0) rows.push([group.title || '(none)', '', formatDuration(group.seconds, durationFormat)]);
      for (const subGroup of group.subGroups) {
        rows.push([group.title || '(none)', subGroup.title || '(none)', formatDuration(subGroup.seconds, durationFormat)]);
      }
    }
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="Toggl_summary.csv"');
    return res.send(toCsv(rows));
  });

  api.post('/workspace/:wid/weekly/time_entries', async (req, res) => {
    const ws = workspaceFor(db, req);
    const body = readJson(req);
    const user = res.locals.user;
    const start = typeof body.start_date === 'string' ? body.start_date : '';
    const filter = filterFromBody({ ...body, end_date: body.end_date ?? (start ? addDays(start, 6) : undefined) }, ws, TOGGL_MAX_DAYS);
    const weekStart = filter.startDate;
    const days = Math.min(daysBetween(weekStart, filter.endDate) + 1, 7);
    const entries = collectEntries(db, user, ws, { ...filter, endDate: addDays(weekStart, days - 1) });
    const rows = new Map<string, ReturnType<typeof emptyWeeklyRow>>();
    function emptyWeeklyRow(entry: ReportEntry) {
      return {
        user_id: user.id, user_name: user.fullname, project_id: entry.projectId, project_name: entry.projectName,
        project_color: entry.projectColor, project_hex_color: entry.projectColor, client_name: entry.clientName,
        planned_task_id: null, seconds: Array<number>(7).fill(0), billable_seconds: Array<number>(7).fill(0),
        billable_amounts_in_cents: Array<number>(7).fill(0), hourly_rate_in_cents: entry.hourlyRateCents, currency: entry.currency,
      };
    }
    for (const entry of entries) {
      const key = String(entry.projectId ?? 'none');
      let row = rows.get(key);
      if (!row) rows.set(key, (row = emptyWeeklyRow(entry)));
      const day = daysBetween(weekStart, entry.date);
      if (day < 0 || day > 6) continue;
      row.seconds[day]! += entry.seconds;
      if (entry.billable) row.billable_seconds[day]! += entry.seconds;
      row.billable_amounts_in_cents[day]! += entry.amountCents ?? 0;
    }
    rangeHeaders(res, weekStart, addDays(weekStart, days - 1));
    return res.json([...rows.values()]);
  });

  return api;
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

  api.post('/report/weekly', requireAuth(deps), (req, res) => {
    const { user, ws, body, filter } = appFilter(req, res);
    const by = body.rows ?? 'projects';
    if (by !== 'projects' && by !== 'clients') throw badRequest("Invalid 'rows' value, allowed values are: 'projects, clients'");
    const grid = weeklyGrid(collectEntries(db, user, ws, filter), filter.startDate, filter.endDate, by, user.beginning_of_week);
    return res.json({
      start_date: filter.startDate,
      end_date: filter.endDate,
      mode: grid.mode,
      columns: grid.columns,
      rows: grid.rows,
      column_totals: grid.columnTotals,
      total: grid.total,
    });
  });

  api.post('/report', requireAuth(deps), (req, res) => {
    const { user, ws, body, filter } = appFilter(req, res);
    const [, grouping] = dimension(body.grouping, 'projects', 'grouping');
    const [, sub] = dimension(body.sub_grouping, 'time_entries', 'sub_grouping');
    const entries = collectEntries(db, user, ws, filter);
    const resolution = resolutionFor(filter.startDate, filter.endDate);
    const totals = totalsOf(entries);
    return res.json({
      start_date: filter.startDate,
      end_date: filter.endDate,
      resolution,
      week_start: startOfWeek(filter.startDate, user.beginning_of_week),
      totals: {
        seconds: totals.seconds,
        billable_seconds: totals.billableSeconds,
        entry_count: totals.entryCount,
        amounts: totals.amounts,
      },
      series: timeSeries(entries, filter.startDate, filter.endDate, resolution, user.beginning_of_week)
        .map((point) => ({ start: point.start, seconds: point.seconds, billable_seconds: point.billableSeconds })),
      groups: groupEntries(entries, grouping, grouping === sub ? 'none' : sub).map(function toJson(group): unknown {
        return {
          id: group.id, title: group.title, color: group.color, seconds: group.seconds,
          billable_seconds: group.billableSeconds, amount_cents: group.amountCents,
          sub_groups: group.subGroups.map(toJson),
        };
      }),
      entries: body.include_entries === false ? [] : entries.slice().reverse().slice(0, 5000).map((entry) => ({
        id: entry.id, description: entry.description, start: entry.start, stop: entry.stop, seconds: entry.seconds,
        billable: entry.billable, project_id: entry.projectId, project_name: entry.projectName, project_color: entry.projectColor,
        client_name: entry.clientName, task_name: entry.taskName, tags: entry.tags.map((tag) => tag.name),
        amount_cents: entry.amountCents, currency: entry.currency,
      })),
    });
  });

  return api;
}
