/**
 * Report request bodies of Toggl's Reports API v3 and of the web app, parsed into the filter and
 * options of a report job. Every refusal happens here, before any entry is read.
 */
import { daysBetween, parseDateKey } from '@tokkl/common/time';
import type { DurationFormat } from '@tokkl/types';
import { isRoundingMinutes, ROUNDING_MINUTES } from '../domain/workspaceValues.ts';
import { invalidInput } from '../lib/errors.ts';
import type { JsonBody } from '../lib/values.ts';
import type { Dimension, IdFilter, OrderBy, ReportFilter, SortDirection } from '../domain/reportCommands.ts';
import type { Workspace } from '../storage/domain.ts';

const MAX_RANGE_DAYS = 3660;

function validateRange(
  startDate: unknown,
  endDate: unknown,
  maxDays = MAX_RANGE_DAYS,
): { startDate: string; endDate: string } {
  if (typeof startDate !== 'string' || !parseDateKey(startDate))
    throw invalidInput('Invalid start_date: expected YYYY-MM-DD');
  if (typeof endDate !== 'string' || !parseDateKey(endDate))
    throw invalidInput('Invalid end_date: expected YYYY-MM-DD');
  const days = daysBetween(startDate, endDate);
  if (days < 0) throw invalidInput('end_date must not be earlier than start_date');
  if (days + 1 > maxDays) throw invalidInput(`Maximum allowed date range is ${maxDays} days`);
  return { startDate, endDate };
}

function parseIdFilter(value: unknown, field: string): IdFilter | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw invalidInput(`Invalid '${field}' value: expected an array`);
  if (value.length > 1000) throw invalidInput(`'${field}' accepts at most 1000 ids`);
  return value.map(item => {
    if (item === null) return null;
    if (typeof item === 'number' && Number.isSafeInteger(item) && item > 0) return item;
    throw invalidInput(`Invalid '${field}' value`);
  });
}

function durationBound(body: JsonBody, field: string): number | undefined {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw invalidInput(`Invalid '${field}' value`);
  return value;
}

/** The filter fields shared by Toggl's Reports API v3 bodies and the app's report endpoints. */
export function parseReportFilter(body: JsonBody, workspace: Workspace, maxDays?: number): ReportFilter {
  const range = validateRange(body.start_date, body.end_date ?? body.start_date, maxDays);
  if (body.billable !== undefined && body.billable !== null && typeof body.billable !== 'boolean') {
    throw invalidInput("Invalid 'billable' value");
  }
  const timeEntryIds = parseIdFilter(body.time_entry_ids, 'time_entry_ids')?.filter((id): id is number => id !== null);
  const minDurationSeconds = durationBound(body, 'min_duration_seconds');
  const maxDurationSeconds = durationBound(body, 'max_duration_seconds');
  if (
    minDurationSeconds !== undefined &&
    maxDurationSeconds !== undefined &&
    minDurationSeconds >= maxDurationSeconds
  ) {
    throw invalidInput('max_duration_seconds must be greater than min_duration_seconds');
  }
  const rounding = body.rounding === undefined ? undefined : Number(body.rounding);
  const roundingMinutes = body.rounding_minutes === undefined ? undefined : Number(body.rounding_minutes);
  if (roundingMinutes !== undefined && !isRoundingMinutes(roundingMinutes)) {
    throw invalidInput(`Invalid 'rounding_minutes' value, allowed values are: '${ROUNDING_MINUTES.join(', ')}'`);
  }
  // Toggl applies the workspace rounding only when the request asks for rounding.
  const applyWorkspaceRounding = rounding !== undefined && roundingMinutes === undefined;
  return {
    ...range,
    projectIds: parseIdFilter(body.project_ids, 'project_ids'),
    clientIds: parseIdFilter(body.client_ids, 'client_ids'),
    tagIds: parseIdFilter(body.tag_ids, 'tag_ids'),
    taskIds: parseIdFilter(body.task_ids, 'task_ids'),
    userIds: parseIdFilter(body.user_ids, 'user_ids'),
    minDurationSeconds,
    maxDurationSeconds,
    excludeProjectIds: parseIdFilter(body.exclude_project_ids, 'exclude_project_ids'),
    excludeClientIds: parseIdFilter(body.exclude_client_ids, 'exclude_client_ids'),
    excludeTagIds: parseIdFilter(body.exclude_tag_ids, 'exclude_tag_ids'),
    timeEntryIds,
    billable: typeof body.billable === 'boolean' ? body.billable : undefined,
    description: typeof body.description === 'string' && body.description !== '' ? body.description : undefined,
    rounding: rounding ?? workspace.rounding,
    roundingMinutes: roundingMinutes ?? (applyWorkspaceRounding ? workspace.roundingMinutes : 0),
  };
}

/** A request's `duration_format`; anything unknown is the improved format. */
export function parseDurationFormat(value: unknown): DurationFormat {
  return value === 'classic' || value === 'decimal' ? value : 'improved';
}

const ORDER_BY = ['date', 'user', 'duration', 'description', 'last_update'] as const satisfies readonly OrderBy[];

/** A request's `order_by`, `date` when absent; the Toggl error otherwise. */
export function parseOrderBy(value: unknown): OrderBy {
  const orderBy = value ?? 'date';
  if (!(ORDER_BY as readonly unknown[]).includes(orderBy))
    throw invalidInput(
      "Invalid 'order_by' value, allowed values are: 'date, user, duration, description, last_update'",
    );
  return orderBy as OrderBy;
}

/** A request's sort direction in any letter case. Anything but `asc` sorts descending, as in Toggl. */
export function parseSortDirection(value: unknown): SortDirection {
  return String(value ?? 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
}

const GROUPINGS: Readonly<Record<string, Dimension>> = {
  projects: 'project',
  clients: 'client',
  tags: 'tag',
  tasks: 'task',
  time_entries: 'description',
  users: 'none',
};

/** A grouping by its request name, `fallback` when absent or empty; the name and the dimension. */
export function parseGrouping(value: unknown, fallback: string, field: string): [string, Dimension] {
  const name = value === undefined || value === null || value === '' ? fallback : String(value);
  const dim = GROUPINGS[name];
  if (!dim) throw invalidInput(`Invalid '${field}' value, allowed values are: '${Object.keys(GROUPINGS).join(', ')}'`);
  return [name, dim];
}

/** A positive integer, `fallback` when absent. */
export function parsePositiveInt(value: unknown, fallback: number, field: string): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    throw invalidInput(`Invalid '${field}' value`);
  return value;
}

/** The web app's detailed report order. */
export function parseDetailedOrder(body: JsonBody) {
  const sort = body.sort ?? 'date';
  if (sort !== 'date' && sort !== 'duration' && sort !== 'description') {
    throw invalidInput("Invalid 'sort' value, allowed values are: 'date, duration, description'");
  }
  const dir = body.dir ?? 'desc';
  if (dir !== 'asc' && dir !== 'desc') throw invalidInput("Invalid 'dir' value, allowed values are: 'asc, desc'");
  return { sort, dir } as const;
}
