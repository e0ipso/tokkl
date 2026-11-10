import { queryOptions, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from './client.ts';
import { postCreate } from './idempotency.ts';
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
import type { TimeEntry, TimeEntryInput, TimerState } from '@tokkl/types';
import { useNow } from '../lib/clock.ts';

const POLL_MS = 30_000;
const timerPath = '/api/app/timer';
const pomodoroPath = '/api/app/pomodoro';

/** Every state source goes through here. Older states are dropped; a newer one refetches all entry-derived data. */
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

/** Polls every 30 s only while the stream is down. Writes go through `acceptTimerState`. */
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

/** No query of its own, so a slow reply elsewhere can never restore an entry a newer state replaced. */
export function useCurrentEntry() {
  const qc = useQueryClient();
  return useQuery({ ...timerQuery(qc, useTimerStreaming()), select: runningEntryOf });
}

/** Corrected by the offset taken with the latest state; re-renders every `intervalMs`. */
export function useServerNow(intervalMs = 1000): Date {
  return serverNow(useNow(intervalMs).getTime(), getClockOffset());
}

function seenState(qc: QueryClient): Promise<TimerState> {
  return qc.ensureQueryData({ queryKey: keys.timer, queryFn: ({ signal }) => readTimerState(qc, signal) });
}

/** Waits for an in-flight edit that moves the revision, then reads the state again (see `revisionToSend`). */
async function currentRevision(qc: QueryClient): Promise<number> {
  const seen = await seenState(qc);
  if (!(await settleOtherWrites(qc))) return seen.revision;
  return revisionToSend(seen, await readTimerState(qc));
}

/** After an unknown outcome: `refuse` fails a write on a moved state; `adopt` takes it, for edits naming an entry. */
type TimerWriteGuard = 'refuse' | 'adopt';

/** Reads the state after an unknown-outcome write; a failed read keeps the next write from going out. */
async function reconcileTimer(qc: QueryClient, guard: TimerWriteGuard): Promise<void> {
  if (!isTimerUnknown(qc)) return;
  const seen = qc.getQueryData<TimerState>(keys.timer);
  const fresh = await readTimerState(qc);
  clearTimerUnknown(qc);
  if (guard === 'refuse' && seen && fresh.revision !== seen.revision) throw new TimerActionError('conflict', fresh);
}

/**
 * After an unknown outcome (502, unreadable reply) the next write reads the state first: v9 writes carry no
 * revision, so a retry after a landed write would apply twice.
 */
export async function timerWrite<T>(
  qc: QueryClient,
  request: () => Promise<T>,
  guard: TimerWriteGuard = 'refuse',
): Promise<T> {
  await reconcileTimer(qc, guard);
  try {
    return await request();
  } catch (error) {
    if (isOutcomeUnknown(error)) markTimerUnknown(qc);
    throw error;
  }
}

/** A conflict that carries a state hands it to the caches. */
async function explainedTimerWrite<T>(
  qc: QueryClient,
  request: () => Promise<T>,
  explain: (error: unknown) => unknown,
  guard: TimerWriteGuard = 'refuse',
): Promise<T> {
  try {
    return await timerWrite(qc, request, guard);
  } catch (error) {
    const explained = explain(error);
    if (explained instanceof TimerActionError && explained.state) acceptTimerState(qc, explained.state);
    throw explained;
  }
}

/** No reply fails with the offline `TimerActionError`; a 409 with a state hands it to the caches. */
export function attemptTimerRequest<T>(qc: QueryClient, request: () => Promise<T>): Promise<T> {
  return explainedTimerWrite(qc, request, explainTimerActionError);
}

/** Fail at once while offline instead of TanStack's default of holding the action and sending it late. */
const actionOptions = { networkMode: 'always' } as const;

/** Builds the body once the state is reconciled. A reply that is not a whole state fails without touching caches. */
async function postAction(
  qc: QueryClient,
  path: string,
  body: () => Promise<Record<string, unknown>>,
): Promise<TimerState> {
  return attemptTimerRequest(qc, async () =>
    acceptTimerState(qc, await api.post(path, await body(), { decode: timerStateOf })),
  );
}

/** Sent with an `Idempotency-Key`, so a start whose reply was lost is retried without a second entry. */
async function postStart(qc: QueryClient, path: string, body: () => Promise<Record<string, unknown>>) {
  return attemptTimerRequest(qc, async () =>
    acceptTimerState(qc, await postCreate(path, await body(), { decode: timerStateOf })),
  );
}

function useRevisionAction(path: string) {
  const qc = useQueryClient();
  return useMutation<TimerState, Error, void>({
    ...actionOptions,
    mutationFn: () => postAction(qc, path, async () => ({ revision: await currentRevision(qc) })),
  });
}

/** Its workspace never changes this way. */
export type RunningEntryChanges = Pick<
  TimeEntryInput,
  'description' | 'project_id' | 'task_id' | 'billable' | 'tags' | 'tag_ids' | 'start'
>;

/**
 * Names the entry, not a revision, so another device's tag does not refuse it; once `id` stops running the
 * server answers a conflict. Sent as a `MOVES_TIMER` write, so it does not wait for those.
 */
export function editRunningEntry(qc: QueryClient, id: number, changes: RunningEntryChanges): Promise<TimerState> {
  return explainedTimerWrite(
    qc,
    async () =>
      acceptTimerState(qc, await api.post(`${timerPath}/edit`, { ...changes, entry_id: id }, { decode: timerStateOf })),
    explainTimerConflict,
    'adopt',
  );
}

interface StartTimerInput extends Pick<TimeEntryInput, 'description' | 'project_id' | 'task_id' | 'billable'> {
  tags?: string[];
  tag_ids?: number[];
  workspace_id?: number;
  start?: string;
  created_with?: string;
}

/** A running entry stops at the new start; a pause chain or Pomodoro session ends. */
export async function startTimer(qc: QueryClient, input: StartTimerInput): Promise<TimerState> {
  return postStart(qc, `${timerPath}/start`, async () => ({
    created_with: 'tokkl-web',
    ...input,
    revision: await currentRevision(qc),
  }));
}

/** Conflicts when the timer moved on. */
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

/** Session lengths in minutes, for this session only. */
interface StartPomodoroInput extends Pick<
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

/** Conflicts while another device runs one or the timer moved on. Carries an `Idempotency-Key`. */
export async function startPomodoro(qc: QueryClient, input: StartPomodoroInput): Promise<TimerState> {
  return postStart(qc, pomodoroPath, async () => ({
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

export function useNextPhase() {
  return useRevisionAction(`${pomodoroPath}/next`);
}

export function useEndPomodoro() {
  return useRevisionAction(`${pomodoroPath}/end`);
}

/** When the timer moved on, the server answers a conflict instead of pausing what the user did not see. */
export function pauseTimer(qc: QueryClient): Promise<TimerState> {
  return postAction(qc, `${timerPath}/pause`, async () => ({ revision: await currentRevision(qc) }));
}

export function usePauseTimer() {
  const qc = useQueryClient();
  return useMutation<TimerState, Error, void>({ ...actionOptions, mutationFn: () => pauseTimer(qc) });
}

export function useResumeTimer() {
  return useRevisionAction(`${timerPath}/resume`);
}

/** Stop while paused. */
export function useDiscardPause() {
  return useRevisionAction(`${timerPath}/discard`);
}
