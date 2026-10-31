import { nextPhase, plannedEnd, POMODORO_SESSION_CONFIG_RANGES, startSession, transitionKind, type PomodoroSessionConfig } from '@tokkl/common/pomodoroSession';
import type { TimerState, TimeEntry as HttpTimeEntry } from '@tokkl/types';
import type { OperationContext } from '../storage/contracts.ts';
import type { EntryDetails, Id, PauseChain, PomodoroSession, TimerSnapshot, User } from '../storage/domain.ts';
import { badRequest, ConflictWithBody } from '../lib/errors.ts';
import { optionalId } from '../lib/values.ts';
import { getPomodoroSessionConfig } from './accountValues.ts';
import type { AccountEntryEffects, AccountRepositories } from './accounts.ts';
import type { CatalogTimerEffects } from './catalogs.ts';
import { createTimeEntry, entryDurationSeconds, getTimeEntry, memberWorkspace, protectEntryOperation, reanchorNoTimeEntries, serializeTimeEntry, stopEntryAt, type EntryContext, type EntryRepositories } from './timeEntries.ts';

/** One local application instance owns this callback. No connection or database identity is exposed. */
export type TimerPublication = (userId: Id, state: TimerState) => Promise<void>;
export type LocalTimerPublication = TimerPublication & { forgetUser(userId: Id): void };
/** Serialize deliveries per user after release. Drop overtaken revisions; a failed delivery is
 * reported by the runner and never retried as a write. Later deliveries still run. */
export function createTimerPublication(deliver: TimerPublication, forgotten: (userId: Id) => void = () => {}): LocalTimerPublication {
  const queues = new Map<Id, Promise<void>>(), delivered = new Map<Id, number>();
  const generations = new Map<Id, object>();
  const publication: LocalTimerPublication = Object.assign(async (id: Id, state: TimerState) => {
    let generation = generations.get(id);
    if (!generation) { generation = {}; generations.set(id, generation); }
    const next = (queues.get(id) ?? Promise.resolve()).catch(() => {}).then(async () => {
      if (generations.get(id) !== generation || state.revision <= (delivered.get(id) ?? -1)) return;
      delivered.set(id, state.revision);
      await deliver(id, structuredClone(state));
    });
    queues.set(id, next);
    try { await next; } finally { if (queues.get(id) === next) queues.delete(id); }
  }, { forgetUser(id: Id) { generations.delete(id); delivered.delete(id); forgotten(id); } });
  return publication;
}
// Returned objects are updated by every settlement in their operation, including later hooks.
// Only response holders live here. Hooks and publication decisions remain rollback-owned by ctx.
const responses = new WeakMap<EntryContext, Map<Id, Array<{ state: TimerState; now: Date }>>>();
const upcoming = { workToShortRest: 'shortRest', workToLongRest: 'longRest', shortRestToWork: 'work', longRestToWork: 'work' } as const;
const orderedTags = (tags: Array<{ id: number; name: string }>) => [...tags].sort((a,b) => a.id-b.id).map(t => ({ id: t.id, name: t.name }));
/** Canonical domain fields only. Audit/driver JSON representations never number visible state. */
export function timerFingerprint(snapshot: TimerSnapshot, chainTags: Array<{ id: number; name: string }>): string {
  const e = snapshot.running, c = snapshot.pauseChain, s = snapshot.session;
  return JSON.stringify({ running: e && { id: e.id, workspaceId: e.workspaceId, projectId: e.projectId, taskId: e.taskId,
    description: e.description, start: e.start, billable: e.billable, tags: orderedTags(e.tags),
    project: e.project && { name: e.project.name, color: e.project.color, active: e.project.active, billable: e.project.billable },
    client: e.client && { id: e.client.id, name: e.client.name }, task: e.task && { name: e.task.name, active: e.task.active } },
    session: s && { userId: s.userId, entryId: s.entryId, config: { workMinutes: s.config.workMinutes, shortRestMinutes: s.config.shortRestMinutes, longRestMinutes: s.config.longRestMinutes, longRestEvery: s.config.longRestEvery },
      phase: { kind: s.phase.kind, startedAt: s.phase.startedAt, completed: s.phase.completed } },
    chain: c && { userId: c.userId, workspaceId: c.workspaceId, projectId: c.projectId, taskId: c.taskId, description: c.description,
      tagIds: [...c.tagIds].sort((a,b) => a-b), billable: c.billable, seconds: c.seconds, cloneEntryId: c.cloneEntryId, tags: orderedTags(chainTags) } });
}
const idleFingerprint = timerFingerprint({ running: null, pauseChain: null, session: null, revision: null }, []);
export async function buildTimerState(ctx: EntryRepositories, user: User, now = new Date(), snapshot?: TimerSnapshot): Promise<TimerState> {
  const data = snapshot ?? await ctx.timers.read(user.id), c = data.pauseChain, s = data.session, e = data.running;
  const tags = c ? await ctx.tags.findByIds(c.workspaceId, c.tagIds) : [];
  const phase = s && { kind: s.phase.kind, startedAt: new Date(s.phase.startedAt), completed: s.phase.completed };
  const transition = s && phase ? transitionKind(phase, s.config) : null;
  return { revision: data.revision?.revision ?? 0, server_time: now.toISOString(),
    running_entry: e ? serializeTimeEntry(e, { meta: true, user }) as unknown as HttpTimeEntry : null,
    pause: c && { paused: c.cloneEntryId === null, seconds: c.seconds, workspace_id: c.workspaceId, description: c.description,
      project_id: c.projectId, task_id: c.taskId, tag_ids: tags.map(t => t.id), tags: tags.map(t => t.name), billable: c.billable, clone_entry_id: c.cloneEntryId },
    pomodoro: s && phase && e && transition ? { work_minutes: s.config.workMinutes, short_rest_minutes: s.config.shortRestMinutes,
      long_rest_minutes: s.config.longRestMinutes, long_rest_every: s.config.longRestEvery,
      phase: { kind: phase.kind, start: phase.startedAt.toISOString(), completed: phase.completed, planned_end: plannedEnd(phase, s.config).toISOString() },
      upcoming_phase: upcoming[transition], transition, number: phase.kind === 'work' ? phase.completed + 1 : phase.completed,
      entry_id: s.entryId, pomodoro_start: e.start } : null,
    discarded_pomodoro: data.revision?.discardedPomodoro ? { entry_id: data.revision.discardedPomodoro.entryId, start: data.revision.discardedPomodoro.start, stop: data.revision.discardedPomodoro.stop } : null };
}
/** The caller acquired the stable user parent before reading state, including absent state. */
export async function settleTimer(ctx: EntryContext, userId: Id, publish: TimerPublication): Promise<boolean> {
  const user = await ctx.users.get(userId); if (!user) return false;
  const data = await ctx.timers.read(userId), runningId = data.running?.id ?? null;
  const left = new Set<number>();
  if (data.session && data.session.entryId !== runningId) { left.add(data.session.entryId); await ctx.timers.deleteSession(userId); data.session = null; }
  if (data.pauseChain && data.pauseChain.cloneEntryId !== runningId) { await ctx.timers.deletePauseChain(userId); data.pauseChain = null; }
  const tags = data.pauseChain ? await ctx.tags.findByIds(data.pauseChain.workspaceId, data.pauseChain.tagIds) : [];
  const fingerprint = timerFingerprint(data, tags);
  const changed = fingerprint !== (data.revision?.fingerprint ?? idleFingerprint);
  if (changed) {
    const prior = data.revision ? (JSON.parse(data.revision.fingerprint) as { session: { entryId: Id } | null }).session?.entryId : undefined;
    if (prior !== undefined && prior !== data.session?.entryId) left.add(prior);
    let discarded = null;
    for (const id of left) { const entry = await ctx.entries.get(userId, id, true);
      if (entry?.deletedAt && entry.start === entry.stop) { discarded = { entryId: id, start: entry.start, stop: entry.stop }; break; } }
    data.revision = { userId, revision: (data.revision?.revision ?? 0) + 1, fingerprint, discardedPomodoro: discarded };
    await ctx.timers.saveRevision(data.revision);
    const state = await buildTimerState(ctx, user, new Date(), data);
    ctx.afterCommit(() => publish(userId, state));
  }
  for (const response of responses.get(ctx)?.get(userId) ?? []) Object.assign(response.state, await buildTimerState(ctx, user, response.now, data));
  return changed;
}
export function touchTimer(ctx: EntryContext, userId: Id, publish: TimerPublication): void {
  ctx.beforeCommit(`timer:${userId}`, async () => { await settleTimer(ctx, userId, publish); });
}
async function responseState(ctx: EntryContext, user: User, now: Date, publish: TimerPublication): Promise<TimerState> {
  const state = await buildTimerState(ctx, user, now);
  let users = responses.get(ctx); if (!users) { users = new Map(); responses.set(ctx, users); }
  const holders = users.get(user.id) ?? []; holders.push({ state, now }); users.set(user.id, holders);
  touchTimer(ctx, user.id, publish); return state;
}
const lengthFields = { workMinutes: 'work_minutes', shortRestMinutes: 'short_rest_minutes', longRestMinutes: 'long_rest_minutes', longRestEvery: 'long_rest_every' } as const;
function readConfig(body: Record<string, unknown>, user: User): PomodoroSessionConfig {
  const config = getPomodoroSessionConfig(user);
  for (const key of Object.keys(lengthFields) as Array<keyof PomodoroSessionConfig>) {
    const field = lengthFields[key], value = body[field]; if (value == null) continue;
    const { min, max } = POMODORO_SESSION_CONFIG_RANGES[key];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw badRequest(`Invalid ${field}: expected an integer from ${min} to ${max}`);
    config[key] = value;
  }
  return config;
}
function readRevision(value: unknown): number { if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw badRequest('Invalid revision: expected an integer'); return value; }
async function refusal(ctx: EntryContext, user: User, now: Date, message: string): Promise<never> { throw new ConflictWithBody(message, await buildTimerState(ctx, user, now)); }
async function checkRevision(ctx: EntryContext, user: User, seen: number, now: Date) {
  const current = (await ctx.timers.getRevision(user.id))?.revision ?? 0;
  if (seen !== current) return refusal(ctx, user, now, `The timer changed: it is at revision ${current}, not ${seen}`);
}
async function sessionAt(ctx: EntryContext, user: User, revision: number, now: Date): Promise<PomodoroSession> {
  await checkRevision(ctx, user, revision, now); const s = await ctx.timers.getSession(user.id);
  if (!s) return refusal(ctx, user, now, 'No Pomodoro session is running'); return s;
}
async function pausedAt(ctx: EntryContext, user: User, revision: number, now: Date): Promise<PauseChain> {
  await checkRevision(ctx, user, revision, now); const c = await ctx.timers.getPauseChain(user.id);
  if (!c || c.cloneEntryId !== null) return refusal(ctx, user, now, 'The timer is not paused'); return c;
}
const copiedFields = (e: EntryDetails) => ({ description: e.description, project_id: e.projectId, task_id: e.taskId,
  tag_ids: e.tags.map(t => t.id), billable: e.billable, created_with: e.createdWith });
export interface TimerRunner<R extends EntryRepositories> {
  transaction<T>(work: (context: OperationContext<R>) => Promise<T>): Promise<T>;
  readSnapshot<T>(work: (repositories: R) => Promise<T>): Promise<T>;
}
export function createTimerOperations<R extends EntryRepositories>(runner: TimerRunner<R>, publish: TimerPublication) {
  async function action(userId: Id, now: Date, work: (ctx: EntryContext, user: User) => Promise<void>, wids: Id[] = [], includeDefault = false) {
    return runner.transaction(async ctx => {
      const user = await protectEntryOperation(ctx, userId, wids, includeDefault);
      await settleTimer(ctx, userId, publish);
      await work(ctx, user);
      return responseState(ctx, user, now, publish);
    });
  }
  return {
    async getTimerState(userId: Id, now = new Date()): Promise<TimerState> { return action(userId, now, async () => {}); },
    async startPomodoro(userId: Id, body: Record<string, unknown>, now = new Date()): Promise<TimerState> {
      const explicit = optionalId(body.workspace_id, 'workspace_id');
      return action(userId, now, async (ctx, user) => {
        const config = readConfig(body, user);
        if (await ctx.timers.getSession(user.id)) return refusal(ctx, user, now, 'A Pomodoro session is already running');
        const wid = explicit ?? user.defaultWorkspaceId; await memberWorkspace(ctx, user.id, wid);
        await ctx.timers.deletePauseChain(user.id);
        const entry = await createTimeEntry(ctx, user, wid, { description: body.description, project_id: body.project_id,
          task_id: body.task_id, tag_ids: body.tag_ids, tags: body.tags, billable: body.billable, created_with: body.created_with, start: now.toISOString() }, publish);
        const phase = startSession(now);
        await ctx.timers.saveSession({ userId, entryId: entry.id, config, phase: { kind: phase.kind, startedAt: phase.startedAt.toISOString(), completed: phase.completed } });
      }, explicit ? [explicit] : [], !explicit);
    },
    async nextPomodoroPhase(userId: Id, revision: unknown, now = new Date()): Promise<TimerState> {
      const seen = readRevision(revision);
      return action(userId, now, async (ctx, user) => {
        const s = await sessionAt(ctx, user, seen, now);
        const { next } = nextPhase({ kind: s.phase.kind, startedAt: new Date(s.phase.startedAt), completed: s.phase.completed }, now, s.config);
        let entryId = s.entryId;
        if (next.kind === 'work') {
          const ended = await getTimeEntry(ctx, user.id, s.entryId); await stopEntryAt(ctx, user, ended, now);
          entryId = (await createTimeEntry(ctx, user, ended.workspaceId, { ...copiedFields(ended), start: now.toISOString() }, publish)).id;
        }
        await ctx.timers.saveSession({ ...s, entryId, phase: { kind: next.kind, startedAt: next.startedAt.toISOString(), completed: next.completed } });
      });
    },
    async endPomodoro(userId: Id, revision: unknown, now = new Date()): Promise<TimerState> {
      const seen = readRevision(revision);
      return action(userId, now, async (ctx, user) => { const s = await sessionAt(ctx, user, seen, now);
        await stopEntryAt(ctx, user, await getTimeEntry(ctx, user.id, s.entryId), now); await ctx.timers.deleteSession(userId); });
    },
    async pauseTimer(userId: Id, now = new Date()): Promise<TimerState> {
      return action(userId, now, async (ctx, user) => {
        if (await ctx.timers.getSession(userId)) return refusal(ctx, user, now, 'A Pomodoro session cannot be paused');
        const e = await ctx.entries.running(userId); if (!e) return refusal(ctx, user, now, 'No timer is running');
        await stopEntryAt(ctx, user, e, now);
        const stored = entryDurationSeconds(await getTimeEntry(ctx, userId, e.id, { includeDeleted: true }));
        const c = await ctx.timers.getPauseChain(userId);
        await ctx.timers.savePauseChain({ userId, workspaceId: e.workspaceId, projectId: e.projectId, taskId: e.taskId, description: e.description,
          tagIds: e.tags.map(t => t.id), billable: e.billable, seconds: (c?.cloneEntryId === e.id ? c.seconds : 0) + stored, cloneEntryId: null });
      });
    },
    async resumeTimer(userId: Id, revision: unknown, now = new Date()): Promise<TimerState> {
      const seen = readRevision(revision);
      return action(userId, now, async (ctx, user) => { const c = await pausedAt(ctx, user, seen, now), tags = await ctx.tags.findByIds(c.workspaceId, c.tagIds);
        const clone = await createTimeEntry(ctx, user, c.workspaceId, { description: c.description, project_id: c.projectId, task_id: c.taskId,
          tag_ids: tags.map(t => t.id), billable: c.billable, start: now.toISOString() }, publish);
        await ctx.timers.savePauseChain({ ...c, cloneEntryId: clone.id }); });
    },
    async discardPause(userId: Id, revision: unknown, now = new Date()): Promise<TimerState> {
      const seen = readRevision(revision);
      return action(userId, now, async (ctx, user) => { await pausedAt(ctx, user, seen, now); await ctx.timers.deletePauseChain(userId); });
    },
  };
}
/** Bind inside the full transaction callback. The catalog port must receive that exact context. */
export function createCatalogTimerEffects(full: EntryContext, publish: TimerPublication): CatalogTimerEffects {
  function same(ctx: object) { if (ctx !== full) throw new Error('Timer effects require the same operation context'); }
  const prepared = new Map<Id, { users: Set<Id>; retain: TimerPublication; settle(): Promise<void>; publish(): Promise<void> }>();
  return {
    async prepare(ctx, wid) {
      same(ctx);
      const users = await full.timers.affectedUsers(wid);
      await full.lockUsers(users);
      let pending = prepared.get(wid);
      if (!pending) {
        const captured = new Set<Id>(), committed: Array<{ id: Id; state: TimerState }> = [];
        const retain: TimerPublication = async (id, state) => { committed.push({ id, state }); };
        pending = { users: captured, retain,
          async settle() { for (const id of [...captured].sort((a,b) => a-b)) await settleTimer(full, id, retain); },
          async publish() {
            let failed = false;
            for (const event of committed.splice(0)) {
              try { await publish(event.id, event.state); } catch { failed = true; }
            }
            if (failed) throw new Error('Timer publication failed');
          } };
        prepared.set(wid, pending);
      }
      for (const id of users) pending.users.add(id);
      // Retain initial owners even when a later preparation follows a destructive edit.
      for (const id of pending.users) touchTimer(full, id, pending.retain);
      return pending;
    },
    async removeTagFromPauseChains(ctx, tagId) { same(ctx); await full.timers.removeTagFromPauseChains(tagId); },
  };
}
export function createAccountEntryEffects<R extends AccountRepositories & EntryRepositories>(publish: LocalTimerPublication): AccountEntryEffects<R> {
  return {
    async reanchorTimezone(ctx, id, from, to) { await reanchorNoTimeEntries(ctx, id, from, to); touchTimer(ctx, id, publish); },
    async affectedDeletionUsers(ctx, _id, workspaces) { return [...new Set((await Promise.all(workspaces.map(w => ctx.timers.affectedUsers(w.id)))).flat())].sort((a,b) => a-b); },
    async beforeDelete(ctx, user, workspaces) {
      const owners = [...new Set((await Promise.all(workspaces.map(w => ctx.timers.affectedUsers(w.id)))).flat())];
      for (const id of owners) if (id !== user.id) touchTimer(ctx, id, publish);
      ctx.afterCommit(async () => { publish.forgetUser(user.id); });
    },
  };
}
