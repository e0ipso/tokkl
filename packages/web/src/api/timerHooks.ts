import { queryOptions, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from './client.ts';
import { invalidate } from './invalidate.ts';
import { keys, stale } from './keys.ts';
import { getClockOffset, serverNow, setClockOffset } from './serverClock.ts';
import {
  TimerActionError,
  clearTimerUnknown,
  explainTimerActionError,
  explainTimerConflict,
  isOutcomeUnknown,
  isTimerUnknown,
  markTimerUnknown,
  timerStateOf,
  planTimerUpdate,
  revisionToSend,
  settleOtherWrites,
} from './timerState.ts';
import { useTimerStreaming } from './timerStreaming.ts';
import type { TimeEntry, TimeEntryInput, TimerState } from './types.ts';
import { useNow } from '../lib/clock.ts';

const POLL_MS = 30_000;
const timerPath = '/api/app/timer';
const pomodoroPath = '/api/app/pomodoro';

/**
 * Takes a state into the caches: the timer, which carries the running entry, and the clock offset.
 * A state older than the cached one is dropped and the cached state is returned. When the state moved past the
 * cached one, everything derived from entries refetches (`stale.timerChanged`), project and task
 * totals included, because the change started, stopped or discarded entries. Every source of
 * states (stream, poll, action reply, conflict) goes through here.
 */
export function acceptTimerState(qc: QueryClient, state: TimerState): TimerState {
  const cached = qc.getQueryData<TimerState>(keys.timer);
  const update = planTimerUpdate(cached, state, Date.now());
  if (!update) return cached ?? state;
  qc.setQueryData(keys.timer, update.state);
  if (update.offset !== null) setClockOffset(update.offset);
  if (update.changed) void invalidate(qc, stale.timerChanged);
  return update.state;
}

async function readTimerState(qc: QueryClient, signal?: AbortSignal): Promise<TimerState> {
  return acceptTimerState(qc, await api.get(timerPath, { signal, decode: timerStateOf }));
}

/**
 * The server-owned timer state. It polls every 30 s only while the stream is down, and refetches
 * on window focus. The stream, the poll and every action write through `acceptTimerState`.
 */
function timerQuery(qc: QueryClient, streaming: boolean) {
  return queryOptions({
    queryKey: keys.timer,
    queryFn: ({ signal }) => readTimerState(qc, signal),
    refetchInterval: streaming ? false : POLL_MS,
    // Views mounting together share one read; focus still refetches once a second has passed.
    staleTime: 1000,
    // A 403 here means the credential is gone; /me decides what the app shows then.
    meta: { sessionProbe: true },
  });
}

export function useTimerState() {
  const qc = useQueryClient();
  return useQuery(timerQuery(qc, useTimerStreaming()));
}

const runningEntryOf = (state: TimerState): TimeEntry | null => state.running_entry;

/**
 * The running entry, read from the timer state. It has no query of its own, so a slow reply from
 * another endpoint can never put back an entry that a newer state replaced.
 */
export function useCurrentEntry() {
  const qc = useQueryClient();
  return useQuery({ ...timerQuery(qc, useTimerStreaming()), select: runningEntryOf });
}

/**
 * The server's time at the latest tick, corrected by the offset taken with the latest state.
 * Re-renders every `intervalMs` like `useNow`.
 */
export function useServerNow(intervalMs = 1000): Date {
  return serverNow(useNow(intervalMs).getTime(), getClockOffset());
}

/** The cached state, read first if it has not loaded yet. */
function seenState(qc: QueryClient): Promise<TimerState> {
  return qc.ensureQueryData({ queryKey: keys.timer, queryFn: ({ signal }) => readTimerState(qc, signal) });
}

/**
 * The revision actions send: the cached one, read first if the state has not loaded yet. An edit
 * still in flight, such as the running entry's description saved as the user clicks Next phase,
 * moves the revision, so the action waits for it and reads the state again (see `revisionToSend`).
 */
async function currentRevision(qc: QueryClient): Promise<number> {
  const seen = await seenState(qc);
  if (!(await settleOtherWrites(qc))) return seen.revision;
  return revisionToSend(seen, await readTimerState(qc));
}

/**
 * Brings the timer state up to date after a timer write whose outcome is unknown, before the next
 * one goes out. If the state moved past the one cached, the lost write may have landed: the read
 * state is adopted and the write fails with a conflict, as a Start or Stop at a stale revision
 * does. A read that fails leaves the outcome unknown, and the write does not go out.
 */
async function reconcileTimer(qc: QueryClient): Promise<void> {
  if (!isTimerUnknown(qc)) return;
  const seen = qc.getQueryData<TimerState>(keys.timer);
  const fresh = await readTimerState(qc);
  clearTimerUnknown(qc);
  if (seen && fresh.revision !== seen.revision) throw new TimerActionError('conflict', fresh);
}

/**
 * Sends a write that can start, stop or change what the timer shows: a timer action, the finished
 * entry typed into the idle bar, an edit of the running entry or its discard. A write that fails
 * with an unknown outcome (`isOutcomeUnknown`), such as a 502 or an unreadable reply, marks the
 * timer unknown, and the next such write reads the state first (`reconcileTimer`). The v9 writes
 * carry no revision, so without that read a retry after a write that landed would apply twice.
 * Errors pass through as they are.
 */
export async function timerWrite<T>(qc: QueryClient, request: () => Promise<T>): Promise<T> {
  await reconcileTimer(qc);
  try {
    return await request();
  } catch (error) {
    if (isOutcomeUnknown(error)) markTimerUnknown(qc);
    throw error;
  }
}

/**
 * A `timerWrite` whose failure goes through `explain`. A conflict that carries a state hands that
 * state to the caches.
 */
async function explainedTimerWrite<T>(
  qc: QueryClient,
  request: () => Promise<T>,
  explain: (error: unknown) => unknown,
): Promise<T> {
  try {
    return await timerWrite(qc, request);
  } catch (error) {
    const explained = explain(error);
    if (explained instanceof TimerActionError && explained.state) acceptTimerState(qc, explained.state);
    throw explained;
  }
}

/**
 * A `timerWrite` whose failure is explained as a timer action's is (`explainTimerActionError`): a
 * request that got no reply fails with the offline `TimerActionError`, and a 409 carrying a state
 * hands that state to the caches. Other failures keep their error.
 */
export function attemptTimerRequest<T>(qc: QueryClient, request: () => Promise<T>): Promise<T> {
  return explainedTimerWrite(qc, request, explainTimerActionError);
}

/**
 * Timer actions run even while the browser reports being offline. TanStack's default would hold
 * them until the connection returns and then send them late; they fail at once instead, with the
 * offline message.
 */
const actionOptions = { networkMode: 'always' } as const;

/**
 * Posts a timer action through `attemptTimerRequest`, building its body only once the state is
 * reconciled. The reply is the new state; a reply that is not a whole state fails the action with
 * the unreadable-state message and leaves the caches alone. A 409 replaces the cached state with
 * the one in its body and fails with a `TimerActionError` of kind `conflict`; no reply at all fails
 * with kind `offline`. Both carry the message to show. Other failures, a 409 without a whole state
 * among them, keep their `ApiError`.
 */
async function postAction(
  qc: QueryClient,
  path: string,
  body: () => Promise<Record<string, unknown> | undefined>,
): Promise<TimerState> {
  return attemptTimerRequest(qc, async () =>
    acceptTimerState(qc, await api.post(path, await body(), { decode: timerStateOf })),
  );
}

function useRevisionAction(path: string) {
  const qc = useQueryClient();
  return useMutation<TimerState, Error, void>({
    ...actionOptions,
    mutationFn: () => postAction(qc, path, async () => ({ revision: await currentRevision(qc) })),
  });
}

/** What an edit of the running entry can change. Its start and workspace never change this way. */
export type RunningEntryChanges = Pick<
  TimeEntryInput,
  'description' | 'project_id' | 'task_id' | 'billable' | 'tags' | 'tag_ids'
>;

/**
 * Edits the running entry at the cached revision, and takes the reply, the new state, into the
 * caches. Tags sent replace the entry's tags, and a null project or task clears it. The server
 * answers with a conflict when the timer moved on, so an edit never lands on an entry the user did
 * not see; the conflict's state replaces the cached one. A request that got no reply keeps its own
 * error, as an edit of a stopped entry does.
 *
 * Unlike an action it does not wait for other writes that move the timer: callers send it as one
 * of them (`MOVES_TIMER`), in the running entry's scope (`updateRunningEntry` in entries.ts), so it
 * would wait for itself, and the edit before it in that scope has already moved the cached revision.
 */
export function editRunningEntry(qc: QueryClient, changes: RunningEntryChanges): Promise<TimerState> {
  return explainedTimerWrite(
    qc,
    async () =>
      acceptTimerState(
        qc,
        await api.post(
          `${timerPath}/edit`,
          { ...changes, revision: (await seenState(qc)).revision },
          { decode: timerStateOf },
        ),
      ),
    explainTimerConflict,
  );
}

/** Fields of a timer start: the new entry's fields and when it starts (now if left out). */
export interface StartTimerInput extends Pick<TimeEntryInput, 'description' | 'project_id' | 'task_id' | 'billable'> {
  tags?: string[];
  tag_ids?: number[];
  workspace_id?: number;
  start?: string;
  created_with?: string;
}

/**
 * Starts the timer at the cached revision, and takes the reply into the caches. A running entry
 * stops at the new start, as Continue and favorites want, and a pause chain or Pomodoro session
 * ends. A start after a write that got no reply cannot add a second entry: if that write landed,
 * the revision moved, and the server answers with a conflict carrying its state.
 */
export async function startTimer(qc: QueryClient, input: StartTimerInput): Promise<TimerState> {
  return postAction(qc, `${timerPath}/start`, async () => ({
    created_with: 'tokkl-web',
    ...input,
    revision: await currentRevision(qc),
  }));
}

/**
 * Stops the running entry at `stop` (now if left out), at the cached revision, and takes the reply
 * into the caches. The server answers with a conflict when the timer moved on, to nothing running
 * among others.
 */
export async function stopTimer(qc: QueryClient, stop?: string): Promise<TimerState> {
  return postAction(qc, `${timerPath}/stop`, async () => ({ revision: await currentRevision(qc), stop }));
}

export function useStartTimer() {
  const qc = useQueryClient();
  return useMutation<TimerState, Error, StartTimerInput>({
    ...actionOptions,
    mutationFn: input => startTimer(qc, input),
  });
}

export function useStopTimer() {
  const qc = useQueryClient();
  return useMutation<TimerState, Error, { stop?: string }>({
    ...actionOptions,
    mutationFn: ({ stop }) => stopTimer(qc, stop),
  });
}

/** Fields of a Pomodoro start: the entry's fields and the session lengths, in minutes, for this session only. */
export interface StartPomodoroInput extends Pick<
  TimeEntryInput,
  'description' | 'project_id' | 'task_id' | 'billable' | 'tag_ids'
> {
  tags?: string[];
  workspace_id?: number;
  created_with?: string;
  work_minutes?: number;
  short_rest_minutes?: number;
  long_rest_minutes?: number;
  long_rest_every?: number;
}

/**
 * Starts a Pomodoro session at the cached revision, and takes the reply into the caches. Fails with
 * the conflict message while another device runs one, and when the timer moved on since this tab
 * saw it; the conflict's state then replaces the cached one, as for Start.
 */
export async function startPomodoro(qc: QueryClient, input: StartPomodoroInput): Promise<TimerState> {
  return postAction(qc, pomodoroPath, async () => ({
    created_with: 'tokkl-web',
    ...input,
    revision: await currentRevision(qc),
  }));
}

export function useStartPomodoro() {
  const qc = useQueryClient();
  return useMutation<TimerState, Error, StartPomodoroInput>({
    ...actionOptions,
    mutationFn: input => startPomodoro(qc, input),
  });
}

/** Confirms the next phase of the session, at the cached revision. */
export function useNextPhase() {
  return useRevisionAction(`${pomodoroPath}/next`);
}

/** Ends the session, at the cached revision. */
export function useEndPomodoro() {
  return useRevisionAction(`${pomodoroPath}/end`);
}

/** Pauses the running timer. Pause needs no revision: the server pauses whatever runs. */
export function usePauseTimer() {
  const qc = useQueryClient();
  return useMutation<TimerState, Error, void>({
    ...actionOptions,
    mutationFn: () => postAction(qc, `${timerPath}/pause`, async () => undefined),
  });
}

/** Resumes the paused chain, at the cached revision. */
export function useResumeTimer() {
  return useRevisionAction(`${timerPath}/resume`);
}

/** Ends the paused chain without resuming (Stop while paused), at the cached revision. */
export function useDiscardPause() {
  return useRevisionAction(`${timerPath}/discard`);
}
