import type { SessionPhaseKind } from '@tokkl/common/pomodoroSession';
import { afterCommit, beforeCommit, transaction, type Db } from '../db/index.ts';
import { publishTimer } from '../services/timerHub.ts';

/** A user's Pomodoro session. Its open pomodoro is the running entry `entry_id`. */
export interface PomodoroSessionRow {
  user_id: number;
  entry_id: number;
  work_minutes: number;
  short_rest_minutes: number;
  long_rest_minutes: number;
  long_rest_every: number;
  phase_kind: SessionPhaseKind;
  phase_start: string;
  completed: number;
}

/** A user's pause chain: the fields a resumed clone copies, and the seconds stored so far. */
export interface PauseChainRow {
  user_id: number;
  workspace_id: number;
  project_id: number | null;
  task_id: number | null;
  description: string;
  /** A JSON array of tag ids. */
  tag_ids_json: string;
  billable: number;
  seconds: number;
  /** The clone that runs, or null while paused. */
  clone_entry_id: number | null;
}

/** A user's revision, the fingerprint of the state it numbers, and the pomodoro the change that produced it discarded. */
export interface TimerStateRow {
  user_id: number;
  revision: number;
  fingerprint: string;
  discarded_entry_id: number | null;
  discarded_start: string | null;
  discarded_stop: string | null;
}

/** The running entry's fields that the timer state shows. */
interface RunningFields {
  id: number;
  workspace_id: number;
  project_id: number | null;
  task_id: number | null;
  description: string;
  start: string;
  billable: number;
  /** A JSON array of tag ids, in id order. */
  tag_ids_json: string;
}

/** What a revision numbers. Its JSON is the fingerprint stored with the revision. */
interface SettledState {
  running: RunningFields | null;
  session: PomodoroSessionRow | null;
  chain: PauseChainRow | null;
}

/** A pomodoro entry that a stop sent to the trash at zero length. */
interface DiscardedPomodoro {
  id: number;
  start: string;
  stop: string;
}

/** The fingerprint of revision 0: nothing runs, no session, no chain. A user has no row until it changes. */
const IDLE_FINGERPRINT = JSON.stringify({ running: null, session: null, chain: null } satisfies SettledState);

export function getPomodoroSession(db: Db, userId: number): PomodoroSessionRow | undefined {
  return db.prepare('SELECT * FROM pomodoro_sessions WHERE user_id = ?').get(userId) as PomodoroSessionRow | undefined;
}

export function getPauseChain(db: Db, userId: number): PauseChainRow | undefined {
  return db.prepare('SELECT * FROM pause_chains WHERE user_id = ?').get(userId) as PauseChainRow | undefined;
}

/** The stored revision, or undefined while the user has never had anything but the idle state (revision 0). */
export function getTimerStateRow(db: Db, userId: number): TimerStateRow | undefined {
  return db.prepare('SELECT * FROM timer_states WHERE user_id = ?').get(userId) as TimerStateRow | undefined;
}

/**
 * Settles `userId` when the transaction() in progress commits, and publishes after the commit if
 * the state changed. Call it from every write that can change the user's running entry. Calls
 * after the first in one transaction do nothing, and a rollback publishes nothing.
 */
export function touchTimer(db: Db, userId: number): void {
  beforeCommit(db, `timer:${userId}`, () => settleTimer(db, userId));
}

/**
 * Touches every user whose running entry or pause chain is in workspace `wid`, for writes that
 * change other users' entries, such as deleting a project, task or tag. Call it before the write:
 * deleting a project with its entries trashes the running entries this looks for.
 */
export function touchWorkspaceTimers(db: Db, wid: number): void {
  const users = db.prepare(`
    SELECT user_id FROM time_entries WHERE workspace_id = ? AND stop IS NULL AND deleted_at IS NULL
    UNION SELECT user_id FROM pause_chains WHERE workspace_id = ?
  `).all(wid, wid) as Array<{ user_id: number }>;
  for (const { user_id: userId } of users) touchTimer(db, userId);
}

/**
 * Brings `userId`'s session and pause chain in line with the running entry, then numbers the
 * result:
 * - a session ends once its entry is not the running one;
 * - a chain stays only while its clone is the running entry, so a paused chain stays only while
 *   nothing runs;
 * - when the running entry, the session or the chain differ from the last settled state, the
 *   revision goes up by one and the hub hears of it after the commit. The new revision records the
 *   pomodoro its change sent to the trash for rounding to zero, or none, which clears the one an
 *   earlier change recorded.
 *
 * Writes reach it through touchTimer. Call it before reading the state too, so a write that
 * missed it is settled by the next read. Returns true when the revision went up.
 */
export function settleTimer(db: Db, userId: number): boolean {
  return transaction(db, () => {
    const running = getRunningFields(db, userId);
    const runningId = running?.id ?? null;
    const { session, ended } = settleSession(db, userId, runningId);
    const state: SettledState = { running, session, chain: settleChain(db, userId, runningId) };
    const fingerprint = JSON.stringify(state);
    const stored = getTimerStateRow(db, userId);
    if (fingerprint === (stored?.fingerprint ?? IDLE_FINGERPRINT)) return false;

    // The pomodoros the session has left since the last settled state: the entry of a session
    // that ended here, and the settled session's entry when the session has since moved on to a
    // new pomodoro or was deleted by the action that ended it.
    const left = new Set<number>();
    if (ended !== null) left.add(ended);
    const settledEntry = stored ? (JSON.parse(stored.fingerprint) as SettledState).session?.entry_id : undefined;
    if (settledEntry !== undefined && settledEntry !== session?.entry_id) left.add(settledEntry);
    saveTimerState(db, userId, (stored?.revision ?? 0) + 1, fingerprint, findDiscarded(db, userId, left));
    afterCommit(db, () => publishTimer(db, userId));
    return true;
  });
}

function getRunningFields(db: Db, userId: number): RunningFields | null {
  const row = db.prepare(`
    SELECT id, workspace_id, project_id, task_id, description, start, billable,
      (SELECT json_group_array(tag_id ORDER BY tag_id) FROM time_entry_tags WHERE time_entry_id = te.id) AS tag_ids_json
    FROM time_entries te WHERE user_id = ? AND stop IS NULL AND deleted_at IS NULL
  `).get(userId) as RunningFields | undefined;
  return row ?? null;
}

/** Ends the session when its entry is not the running one. Returns the session that stays, and the entry of one that ended. */
function settleSession(
  db: Db, userId: number, runningId: number | null,
): { session: PomodoroSessionRow | null; ended: number | null } {
  const session = getPomodoroSession(db, userId);
  if (!session) return { session: null, ended: null };
  if (session.entry_id === runningId) return { session, ended: null };
  db.prepare('DELETE FROM pomodoro_sessions WHERE user_id = ?').run(userId);
  return { session: null, ended: session.entry_id };
}

/**
 * Ends the chain unless its clone is the running entry. A paused chain has no clone, so it stays
 * only while nothing runs. Returns the chain that stays.
 */
function settleChain(db: Db, userId: number, runningId: number | null): PauseChainRow | null {
  const chain = getPauseChain(db, userId);
  if (!chain) return null;
  if (chain.clone_entry_id === runningId) return chain;
  db.prepare('DELETE FROM pause_chains WHERE user_id = ?').run(userId);
  return null;
}

/**
 * The first of `entryIds` in the trash at zero length. The timer stop rule leaves a pomodoro too
 * short to keep there, with start and stop on its snapped start.
 */
function findDiscarded(db: Db, userId: number, entryIds: Iterable<number>): DiscardedPomodoro | null {
  const trashedAtZero = db.prepare(
    'SELECT id, start, stop FROM time_entries WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL AND stop = start',
  );
  for (const id of entryIds) {
    const entry = trashedAtZero.get(id, userId) as DiscardedPomodoro | undefined;
    if (entry) return entry;
  }
  return null;
}

function saveTimerState(
  db: Db, userId: number, revision: number, fingerprint: string, discarded: DiscardedPomodoro | null,
): void {
  db.prepare(`
    INSERT INTO timer_states (user_id, revision, fingerprint, discarded_entry_id, discarded_start, discarded_stop)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (user_id) DO UPDATE SET revision = excluded.revision, fingerprint = excluded.fingerprint,
      discarded_entry_id = excluded.discarded_entry_id, discarded_start = excluded.discarded_start,
      discarded_stop = excluded.discarded_stop
  `).run(userId, revision, fingerprint, discarded?.id ?? null, discarded?.start ?? null, discarded?.stop ?? null);
}
