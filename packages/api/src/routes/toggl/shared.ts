import type { Request, Response } from 'express';
import { startOfDay } from '@tokkl/common/time';
import type { Deps } from '../context.ts';
import { changedSince, query, queryFlag } from '../../http/params.ts';
import { calendarInput, invalidInput } from '../../lib/errors.ts';
import { parseDateOrInstant, parseId } from '../../lib/values.ts';
import { recentEntriesStart } from '../../domain/queries.ts';
import type { TimeEntryPresentation } from '../../presenters/toggl.ts';
import type { EntryFilter } from '../../domain/ports.ts';
import type { User, Workspace } from '../../domain/model.ts';

/** Write routes check this before reading the body; the write rechecks under its locks. */
export function authorizedWorkspace(deps: Pick<Deps, 'readFor'>, req: Request, res: Response): Promise<Workspace> {
  return deps.readFor(res.locals.auth, queries => queries.workspace(res.locals.auth.user.id, parseId(req.params.wid)));
}

/** Toggl's `meta=true` adds names to each entry. */
export function entryPresentation(req: Request, res: Response): TimeEntryPresentation {
  return { meta: queryFlag(req, 'meta'), user: res.locals.auth.user };
}

/** A `YYYY-MM-DD` day starts at the user's midnight. */
function boundary(value: string, field: string, user: User): string {
  const parsed = parseDateOrInstant(value, field);
  return (
    'instant' in parsed ? parsed.instant : calendarInput(() => startOfDay(parsed.date, user.timezone))
  ).toISOString();
}

/** Without any, the last nine days. */
export function timeEntryFilter(req: Request, user: User): EntryFilter {
  const filter: EntryFilter = {};
  const since = changedSince(req),
    before = query(req, 'before'),
    start = query(req, 'start_date'),
    end = query(req, 'end_date');
  if (since !== undefined) filter.changedSince = since;
  if ((start === undefined) !== (end === undefined))
    throw invalidInput('start_date and end_date must be used together');
  if (start !== undefined && end !== undefined) {
    filter.from = boundary(start, 'start_date', user);
    filter.to = boundary(end, 'end_date', user);
    if (filter.to < filter.from) throw invalidInput('end_date must not be earlier than start_date');
  }
  if (before !== undefined) filter.to = boundary(before, 'before', user);
  if (!filter.changedSince && !filter.from && !filter.to) filter.from = recentEntriesStart();
  return filter;
}
