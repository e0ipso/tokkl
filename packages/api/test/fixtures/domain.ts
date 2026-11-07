import { generateApiToken } from '../../src/lib/crypto.ts';
import { createAccountOperations } from '../../src/domain/accounts.ts';
import { createTimerOperations } from '../../src/domain/timers.ts';
import { settleTimer as settle } from '../../src/domain/timerSettlement.ts';
import { createTimerPublication } from '../../src/services/timerPublication.ts';
import { presentTimerOperations } from '../../src/services/timerReplies.ts';
import * as entries from '../../src/domain/timeEntries.ts';
import type { User } from '../../src/storage/domain.ts';
import { storageFor, servicesFor, transaction, currentContext, type FixtureDatabase } from './database.ts';
export type { UserRole, User } from '../../src/storage/domain.ts';
export { MAX_FAVORITES } from '../../src/domain/accountValues.ts';
export { serializeTimeEntry } from '../../src/presenters/toggl.ts';
const silent = createTimerPublication(async () => {});
const publication = (db: FixtureDatabase) => servicesFor(db)?.publish ?? silent;
export function createFirstAdmin(db: FixtureDatabase, body: Record<string, unknown>) {
  return createAccountOperations(storageFor(db), { recheckUser: async () => {} }).createFirstAdmin(body);
}
export function insertAccount(
  db: FixtureDatabase,
  input: { email: string; fullname: string; timezone: string; passwordHash: string; role: 'admin' | 'user' },
) {
  return transaction(db, ctx =>
    ctx.users.createAccount({
      email: input.email,
      fullName: input.fullname,
      timezone: input.timezone,
      passwordHash: input.passwordHash,
      role: input.role,
      apiToken: generateApiToken(),
      preferences: { pg_time_zone_name: input.timezone },
    }),
  );
}
export const getUser = (db: FixtureDatabase, id: number) => (currentContext(db) ?? storageFor(db)).users.get(id);
export const createWorkspace = (db: FixtureDatabase, name: string) =>
  transaction(db, ctx => ctx.workspaces.create(name));
export const getWorkspace = (db: FixtureDatabase, id: number) => storageFor(db).workspaces.get(id);
export const addWorkspaceMember = (db: FixtureDatabase, wid: number, uid: number, role: 'owner' | 'member') =>
  transaction(db, ctx => ctx.workspaces.addMember({ workspaceId: wid, userId: uid, role }));
export const isWorkspaceMember = async (db: FixtureDatabase, uid: number, wid: number) =>
  !!(await storageFor(db).workspaces.forMember(uid, wid));
export const getWorkspaceRole = (db: FixtureDatabase, uid: number, wid: number) =>
  storageFor(db).workspaces.getRole(uid, wid);
export const countWorkspaceMembers = (db: FixtureDatabase, wid: number) => storageFor(db).workspaces.countMembers(wid);
export const listTimeEntries = (db: FixtureDatabase, uid: number) => storageFor(db).entries.list(uid);
export const listDeletedEntries = (db: FixtureDatabase, uid: number) => storageFor(db).entries.listDeleted(uid);
export const createTimeEntry = (db: FixtureDatabase, user: User, wid: number, body: Record<string, unknown>) =>
  transaction(db, ctx => entries.createTimeEntry(ctx, user, wid, body, publication(db)));
export const stopTimeEntry = (db: FixtureDatabase, user: User, wid: number, id: number, stop?: unknown) =>
  transaction(db, ctx => entries.stopTimeEntry(ctx, user, wid, id, publication(db), stop));
export const settleTimer = (db: FixtureDatabase, uid: number) =>
  transaction(db, async ctx => {
    await entries.protectEntryOperation(ctx, uid);
    return settle(ctx, uid, publication(db));
  });
function timers(db: FixtureDatabase) {
  const ctx = currentContext(db);
  return presentTimerOperations(
    createTimerOperations(
      ctx ? { transaction: ctx.transaction, readSnapshot: storageFor(db).readSnapshot } : storageFor(db),
      publication(db),
    ),
  );
}
export const getTimerState = (db: FixtureDatabase, user: User, now?: Date) => timers(db).getTimerState(user.id, now);
export const pauseTimer = (db: FixtureDatabase, user: User, now?: Date) => timers(db).pauseTimer(user.id, now);
export const resumeTimer = (db: FixtureDatabase, user: User, revision: unknown, now?: Date) =>
  timers(db).resumeTimer(user.id, revision, now);
export const discardPause = (db: FixtureDatabase, user: User, revision: unknown, now?: Date) =>
  timers(db).discardPause(user.id, revision, now);
export const startPomodoro = (db: FixtureDatabase, user: User, body: Record<string, unknown>, now?: Date) =>
  timers(db).startPomodoro(user.id, body, now);
export const nextPomodoroPhase = (db: FixtureDatabase, user: User, revision: unknown, now?: Date) =>
  timers(db).nextPomodoroPhase(user.id, revision, now);
export const endPomodoro = (db: FixtureDatabase, user: User, revision: unknown, now?: Date) =>
  timers(db).endPomodoro(user.id, revision, now);

type TimerListener = () => unknown;
const timerListeners = new WeakMap<object, Map<number, Set<TimerListener>>>();
/**
 * Calls `listener` after each timer state the app delivers to `uid`'s streams, and returns the
 * unsubscribe function. A failing listener is reported on the console and does not stop the others.
 */
export function subscribeTimer(db: FixtureDatabase, uid: number, listener: TimerListener): () => void {
  const streams = servicesFor(db).timerStreams;
  let users = timerListeners.get(streams);
  if (!users) {
    const listening = new Map<number, Set<TimerListener>>();
    users = listening;
    timerListeners.set(streams, listening);
    const deliver = streams.publish.bind(streams);
    streams.publish = async (id, state) => {
      await deliver(id, state);
      const results = await Promise.allSettled([...(listening.get(id) ?? [])].map(async each => each()));
      for (const result of results) if (result.status === 'rejected') console.error('Timer subscriber failed');
    };
  }
  const listeners = users.get(uid) ?? new Set();
  users.set(uid, listeners);
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const listWorkspacesForUser = (db: FixtureDatabase, uid: number) => storageFor(db).workspaces.listForUser(uid);
export const createSession = (db: FixtureDatabase, uid: number, days: number, agent: string) =>
  storageFor(db)
    .users.get(uid)
    .then(user =>
      createAccountOperations(storageFor(db), { recheckUser: async () => {} }).createSession(user!, agent, days),
    );
