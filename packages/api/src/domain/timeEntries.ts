/**
 * Time entry writes: create, edit, stop, delete, restore and purge. Each runs in the transaction its
 * caller opened (`services/entryOperations.ts`) and never opens one. Every write guards the user's
 * timer and settles it before commit, because the running entry is part of the timer.
 */
import { MAX_DURATION_SECONDS } from '@tokkl/common/duration';
import { snapInstant } from '@tokkl/common/snap';
import { dateKey, startOfDay } from '@tokkl/common/time';
import type { EntriesRepository, EntryInput, SettingsRepository } from './ports.ts';
import type { EntryDetails, Id, TimeEntry, User } from './model.ts';
import { ApplicationError, conflict, invalidInput } from '../lib/errors.ts';
import { isoSeconds } from '../lib/values.ts';
import { entryResolution, getEntryIn, getTimeEntry, protectEntryOperation, type EntryContext } from './entryAccess.ts';
import type { EntryChanges, EntryFields, EntryPatchStep, EntrySplit, NewEntry } from './entryCommands.ts';
import {
  applyTagAction,
  currentTagIds,
  entryReferences,
  resolveProjectAndTask,
  resolveTagIds,
  type EntryReferences,
} from './entryReferences.ts';
import {
  assertConsistentDuration,
  newNoTimeSpan,
  seconds,
  settleSpan,
  snapToResolution,
  timedStart,
  updatedNoTimeSpan,
  wholeSeconds,
  type Span,
} from './entrySpans.ts';
import { memberWorkspace } from './membership.ts';
import { touchTimer, type TimerPublication } from './timerSettlement.ts';

function assertWorkspace(sent: EntryFields, wid: Id): void {
  if (sent.workspaceId && sent.workspaceId !== wid)
    throw invalidInput('Workspace ID in the body does not match the URL');
}

const stored = (date: Date) => new Date(isoSeconds(date)).toISOString();

/** Caller holds the user's guard. This helper does not acquire a workspace guard. */
export async function reanchorNoTimeEntries(
  ctx: { entries: Pick<EntriesRepository, 'listAllDay' | 'update'> },
  userId: Id,
  fromZone: string,
  toZone: string,
) {
  for (const row of await ctx.entries.listAllDay(userId)) {
    const old = new Date(row.start),
      duration = seconds(new Date(row.stop!)) - seconds(old);
    const start = startOfDay(dateKey(old, fromZone), toZone);
    if (seconds(start) === seconds(old)) continue;
    await ctx.entries.update(userId, row.workspaceId, row.id, {
      start: start.toISOString(),
      stop: new Date(start.getTime() + duration * 1000).toISOString(),
    });
  }
}

/** Stops `entry` at `at` on the resolution grid. One too short to keep is discarded: false. */
async function stopEntryAt(
  ctx: { settings: Pick<SettingsRepository, 'read'>; entries: Pick<EntriesRepository, 'update'> },
  user: User,
  entry: TimeEntry,
  at: Date,
): Promise<boolean> {
  const resolution = await entryResolution(ctx),
    start = new Date(entry.start);
  const snapped = snapToResolution(resolution, user, start, at < start ? start : at);
  if (!snapped) {
    const point = stored(snapInstant(wholeSeconds(start), resolution, user.timezone));
    await ctx.entries.update(user.id, entry.workspaceId, entry.id, {
      start: point,
      stop: point,
      deletedAt: new Date().toISOString(),
    });
    return false;
  }
  await ctx.entries.update(user.id, entry.workspaceId, entry.id, {
    start: snapped.start.toISOString(),
    stop: new Date(
      Math.min(snapped.stop.getTime(), snapped.start.getTime() + MAX_DURATION_SECONDS * 1000),
    ).toISOString(),
  });
  return true;
}

/**
 * Stops `entry`, the user's running entry, at `at`, the way every timer path stops it: only a member
 * of the entry's workspace may, as for a v9 stop. Anyone else gets 403 and, because the refusal
 * throws, the caller's whole transaction rolls back. Answers what `stopEntryAt` answers.
 */
export async function stopRunningEntry(ctx: EntryContext, user: User, entry: TimeEntry, at: Date): Promise<boolean> {
  await memberWorkspace(ctx, user.id, entry.workspaceId);
  return stopEntryAt(ctx, user, entry, at);
}

/** Stops the running entry, unless it is `exceptId`, before another entry starts running. */
async function stopRunning(ctx: EntryContext, user: User, at: Date, exceptId?: Id): Promise<void> {
  const running = await ctx.entries.running(user.id);
  if (!running || running.id === exceptId) return;
  await stopRunningEntry(ctx, user, running, at < new Date(running.start) ? new Date() : at);
}

/** A new timed entry's span: `stop`, else `start + duration` for a non-negative one, else running. */
function newTimedSpan(entry: NewEntry): Span {
  const { times } = entry;
  const start = timedStart(times, new Date());
  let stop: Date | null = null;
  if (times.stop) stop = times.stop;
  else if (times.duration !== undefined && times.duration >= 0)
    stop = new Date(start.getTime() + times.duration * 1000);
  assertConsistentDuration(start, times.stop, times.duration);
  return { start, stop };
}

export interface CreateOptions {
  exact?: boolean;
}

/** Validates a new entry for live writes and exact imports, and returns what to store. */
export async function prepareEntry(
  ctx: EntryContext,
  user: User,
  wid: Id,
  entry: NewEntry,
  exact: boolean,
  refs: EntryReferences = entryReferences(ctx),
): Promise<EntryInput> {
  assertWorkspace(entry, wid);
  // Exact spans never use the grid, including no-time imports.
  const resolution = exact ? 1 : await entryResolution(ctx);
  let span: Span = entry.allDay ? newNoTimeSpan(resolution, user, entry.times, exact) : newTimedSpan(entry);
  const { projectId, taskId, project } = await resolveProjectAndTask(refs, wid, entry, {
    projectId: null,
    taskId: null,
  });
  const tagIds = (await resolveTagIds(refs, wid, entry)) ?? [];
  if (!entry.allDay) span = settleSpan(resolution, user, span, { exact });
  return {
    userId: user.id,
    workspaceId: wid,
    projectId,
    taskId,
    description: entry.description ?? '',
    start: stored(span.start),
    stop: span.stop ? stored(span.stop) : null,
    billable: entry.billable ?? project?.billable ?? false,
    allDay: entry.allDay,
    durationOnly: true,
    createdWith: entry.createdWith ?? 'api',
    deletedAt: null,
    tagIds,
  };
}

/** Guards the user and the workspace, and settles the timer before commit. */
async function entryWrite(ctx: EntryContext, userId: Id, wid: Id, publish: TimerPublication): Promise<User> {
  const user = await protectEntryOperation(ctx, userId, [wid]);
  await memberWorkspace(ctx, user.id, wid);
  touchTimer(ctx, user.id, publish);
  return user;
}

export async function createTimeEntry(
  ctx: EntryContext,
  seen: User,
  wid: Id,
  entry: NewEntry,
  publish: TimerPublication,
  options: CreateOptions = {},
): Promise<EntryDetails> {
  const user = await entryWrite(ctx, seen.id, wid, publish);
  const input = await prepareEntry(ctx, user, wid, entry, options.exact === true);
  if (!input.stop) await stopRunning(ctx, user, new Date(input.start));
  return ctx.entries.create(input);
}

export async function updateTimeEntry(
  ctx: EntryContext,
  seen: User,
  wid: Id,
  id: Id,
  changes: EntryChanges,
  publish: TimerPublication,
): Promise<EntryDetails> {
  const user = await entryWrite(ctx, seen.id, wid, publish);
  return applyEntryUpdate(ctx, user, wid, id, changes);
}

/** A timed entry's span after an update. Times the edit left alone are `unchanged`. */
function updatedTimedSpan(current: TimeEntry, changes: EntryChanges): Span & { unchanged: boolean } {
  const { times } = changes;
  const currentStart = new Date(current.start),
    currentStop = current.stop ? new Date(current.stop) : null;
  if (current.allDay && (!times.start || !times.stop))
    throw invalidInput('Turning off all_day needs a start and a stop');
  const start = timedStart(times, currentStart);
  let stop = currentStop;
  if (times.stop) stop = times.stop;
  else if (times.duration !== undefined)
    stop = times.duration >= 0 ? new Date(start.getTime() + times.duration * 1000) : null;
  assertConsistentDuration(start, times.stop, times.duration);
  const unchanged =
    !current.allDay && seconds(start) === seconds(currentStart) && stop?.getTime() === currentStop?.getTime();
  return { start, stop, unchanged };
}

/** The edit itself. The caller has protected the user, checked the workspace and touched the timer. */
async function applyEntryUpdate(
  ctx: EntryContext,
  user: User,
  wid: Id,
  id: Id,
  changes: EntryChanges,
): Promise<EntryDetails> {
  assertWorkspace(changes, wid);
  const current = await getEntryIn(ctx, user.id, wid, id);
  const resolution = await entryResolution(ctx);
  const allDay = changes.allDay ?? current.allDay;
  const timed = allDay ? undefined : updatedTimedSpan(current, changes);
  let span: Span = timed ?? updatedNoTimeSpan(resolution, user, current, changes.times);
  const refs = entryReferences(ctx);
  const { projectId, taskId, project, projectChanged } = await resolveProjectAndTask(refs, wid, changes, current);
  const tagIds = applyTagAction(currentTagIds(current), await resolveTagIds(refs, wid, changes), changes.tagAction);
  if (timed) span = settleSpan(resolution, user, span, { unchanged: timed.unchanged });
  if (!span.stop && current.stop) await stopRunning(ctx, user, new Date(), id);
  return ctx.entries.update(user.id, wid, id, {
    projectId,
    taskId,
    description: changes.description ?? current.description,
    start: stored(span.start),
    stop: span.stop ? stored(span.stop) : null,
    billable: changes.billable ?? (projectChanged && project ? project.billable : current.billable),
    allDay,
    tagIds,
  });
}

/** The two entries a split leaves: the original, cut short, and the new one after it. */
interface SplitEntries {
  first: EntryDetails;
  second: EntryDetails;
}

/**
 * Splits a stopped, timed entry at the grid point nearest `split.at`. The entry keeps the first
 * half and a new entry with its fields takes the second. The halves come from the entry's snapped
 * span, so they add up to it. The edit and the create make the same checks as any other, in one
 * transaction: a refusal leaves the entry as it was.
 */
export async function splitTimeEntry(
  ctx: EntryContext,
  seen: User,
  id: Id,
  split: EntrySplit,
  publish: TimerPublication,
): Promise<SplitEntries> {
  const wid = (await getTimeEntry(ctx, seen.id, id)).workspaceId;
  const user = await entryWrite(ctx, seen.id, wid, publish);
  const current = await getEntryIn(ctx, user.id, wid, id);
  if (current.allDay) throw invalidInput('No-time entries have no start or end time');
  if (!current.stop) throw conflict('A running time entry can not be split');
  const resolution = await entryResolution(ctx);
  const whole = snapToResolution(resolution, user, new Date(current.start), new Date(current.stop));
  const cut = snapInstant(wholeSeconds(split.at), resolution, user.timezone);
  if (!whole || cut <= whole.start || cut >= whole.stop)
    throw invalidInput('The split time must fall inside the entry');
  const rest: NewEntry = {
    allDay: false,
    times: { start: cut, stop: whole.stop },
    description: current.description,
    projectId: current.projectId,
    taskId: current.taskId,
    tagIds: currentTagIds(current),
    billable: current.billable,
    createdWith: split.createdWith,
  };
  const second = await ctx.entries.create(await prepareEntry(ctx, user, wid, rest, false));
  const first = await applyEntryUpdate(ctx, user, wid, id, {
    times: { start: whole.start, stop: cut },
    tagAction: 'replace',
  });
  return { first, second };
}

export async function stopTimeEntry(
  ctx: EntryContext,
  seen: User,
  wid: Id,
  id: Id,
  publish: TimerPublication,
  stop = new Date(),
): Promise<EntryDetails> {
  const user = await entryWrite(ctx, seen.id, wid, publish);
  const current = await getEntryIn(ctx, user.id, wid, id);
  if (current.stop) throw conflict('Time entry already stopped');
  await stopEntryAt(ctx, user, current, stop);
  return getTimeEntry(ctx, user.id, id, { includeDeleted: true });
}

export async function deleteTimeEntry(
  ctx: EntryContext,
  userId: Id,
  wid: Id,
  id: Id,
  publish: TimerPublication,
): Promise<void> {
  await entryWrite(ctx, userId, wid, publish);
  await getEntryIn(ctx, userId, wid, id);
  await ctx.entries.softDelete(userId, wid, id, new Date().toISOString());
}

export async function restoreTimeEntry(
  ctx: EntryContext,
  seen: User,
  id: Id,
  publish: TimerPublication,
): Promise<EntryDetails> {
  const candidate = await getTimeEntry(ctx, seen.id, id, { includeDeleted: true });
  const user = await protectEntryOperation(ctx, seen.id, [candidate.workspaceId]);
  const current = await getTimeEntry(ctx, user.id, id, { includeDeleted: true });
  await memberWorkspace(ctx, user.id, current.workspaceId);
  touchTimer(ctx, user.id, publish);
  if (!current.deletedAt) return current;
  if (!current.stop && (await ctx.entries.running(user.id)) && !(await stopEntryAt(ctx, user, current, new Date())))
    return getTimeEntry(ctx, user.id, id, { includeDeleted: true });
  return ctx.entries.restore(user.id, id);
}

/**
 * Deletes trashed entries for good, as many as it deleted. Purging one entry of a workspace the
 * user left is refused with the 403 a restore gets, and one not in the trash deletes nothing.
 * Emptying the trash deletes the entries of the user's workspaces and keeps those of workspaces
 * the user left, since no change may touch them.
 */
export async function purgeDeletedEntries(
  ctx: EntryContext,
  userId: Id,
  publish: TimerPublication,
  id?: Id,
): Promise<number> {
  const workspaceIds =
    id === undefined
      ? await ctx.entries.trashedWorkspaceIds(userId)
      : [await ctx.entries.get(userId, id, true)].flatMap(entry => (entry?.deletedAt ? [entry.workspaceId] : []));
  const user = await protectEntryOperation(ctx, userId, workspaceIds);
  const member: Id[] = [];
  for (const wid of workspaceIds)
    if (id !== undefined) member.push((await memberWorkspace(ctx, user.id, wid)).id);
    else if (await ctx.workspaces.forMember(user.id, wid)) member.push(wid);
  touchTimer(ctx, user.id, publish);
  return ctx.entries.purgeDeleted(user.id, { workspaceIds: member, id });
}

/** One operation on one entry. See `EntryPatchStep` for when each refusal is reported. */
async function applyPatchStep(ctx: EntryContext, user: User, wid: Id, id: Id, step: EntryPatchStep) {
  if (step.touchesTimes && (await getTimeEntry(ctx, user.id, id)).allDay)
    throw invalidInput('No-time entries have no start or end time');
  const { edit } = step;
  if (edit.ok) return applyEntryUpdate(ctx, user, wid, id, edit.changes);
  if (edit.afterLookup) await getEntryIn(ctx, user.id, wid, id);
  throw edit.error;
}

/** Applies every step to each entry in its own savepoint; a refused entry is reported, not fatal. */
export async function patchTimeEntries(
  ctx: EntryContext,
  seen: User,
  wid: Id,
  ids: Id[],
  steps: EntryPatchStep[],
  publish: TimerPublication,
) {
  const user = await entryWrite(ctx, seen.id, wid, publish);
  const success: Id[] = [],
    failure: Array<{ id: Id; message: string }> = [];
  for (const id of ids) {
    try {
      await ctx.savepoint(async sp => {
        for (const step of steps) await applyPatchStep(sp, user, wid, id, step);
      });
      success.push(id);
    } catch (error) {
      // A refused edit fails only its id. Storage conflicts and bugs fail the whole request, so a
      // retryable conflict retries the transaction and no internal message reaches the client.
      if (!(error instanceof ApplicationError)) throw error;
      failure.push({ id, message: error.message });
    }
  }
  return { success, failure };
}
