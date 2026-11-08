import { queryOptions, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from './client.ts';
import { invalidate } from './invalidate.ts';
import { keys, stale } from './keys.ts';
import { getClockOffset, serverNow, setClockOffset } from './serverClock.ts';
import {
  TIMER_ACTION_KEY,
  TimerActionError,
  explainTimerActionError,
  timerStateOf,
  planTimerUpdate,
  revisionToSend,
  settleOtherWrites,
} from './timerState.ts';
import { createTimerOutcome, type TimerOutcome } from './timerOutcome.ts';
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

async function readTimerState(qc: QueryClient): Promise<TimerState> {
  return acceptTimerState(qc, await api.get(timerPath, { decode: timerStateOf }));
}

const outcomes = new WeakMap<QueryClient, TimerOutcome>();

/**
 * Whether the last Start, Continue or Stop left the timer unknown, shared by every view on this
 * client so a remounted timer bar still reads the state before its next start.
 */
export function useTimerOutcome(): TimerOutcome {
  const qc = useQueryClient();
  let outcome = outcomes.get(qc);
  if (!outcome) {
    outcome = createTimerOutcome(() => readTimerState(qc));
    outcomes.set(qc, outcome);
  }
  return outcome;
}

/**
 * The server-owned timer state. It polls every 30 s only while the stream is down, and refetches
 * on window focus. The stream, the poll and every action write through `acceptTimerState`.
 */
function timerQuery(qc: QueryClient, streaming: boolean) {
  return queryOptions({
    queryKey: keys.timer,
    queryFn: () => readTimerState(qc),
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

/**
 * The revision actions send: the cached one, read first if the state has not loaded yet. An edit
 * still in flight, such as the running entry's description saved as the user clicks Next phase,
 * moves the revision, so the action waits for it and reads the state again (see `revisionToSend`).
 */
async function currentRevision(qc: QueryClient): Promise<number> {
  const seen = await qc.ensureQueryData({ queryKey: keys.timer, queryFn: () => readTimerState(qc) });
  if (!(await settleOtherWrites(qc))) return seen.revision;
  return revisionToSend(seen, await readTimerState(qc));
}

/**
 * Timer actions run even while the browser reports being offline. TanStack's default would hold
 * them until the connection returns and then send them late; they fail at once instead, with the
 * offline message.
 */
const actionOptions = { mutationKey: TIMER_ACTION_KEY, networkMode: 'always' } as const;

/**
 * Posts a timer action. The reply is the new state; a reply that is not a whole state fails the
 * action with the unreadable-state message and leaves the caches alone. A 409 replaces the cached
 * state with the one in its body and fails with a `TimerActionError` of kind `conflict`; no reply
 * at all fails with kind `offline`. Both carry the message to show. Other failures, a 409 without a
 * whole state among them, keep their `ApiError`.
 */
async function postAction(
  qc: QueryClient,
  path: string,
  body: Record<string, unknown> | undefined,
): Promise<TimerState> {
  try {
    return acceptTimerState(qc, await api.post(path, body, { decode: timerStateOf }));
  } catch (error) {
    const explained = explainTimerActionError(error);
    if (explained instanceof TimerActionError && explained.state) acceptTimerState(qc, explained.state);
    throw explained;
  }
}

function useRevisionAction(path: string) {
  const qc = useQueryClient();
  return useMutation<TimerState, Error, void>({
    ...actionOptions,
    mutationFn: async () => postAction(qc, path, { revision: await currentRevision(qc) }),
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

/** Starts a Pomodoro session. Fails with the conflict message while another device runs one. */
export function useStartPomodoro() {
  const qc = useQueryClient();
  return useMutation<TimerState, Error, StartPomodoroInput>({
    ...actionOptions,
    mutationFn: input => postAction(qc, pomodoroPath, { created_with: 'tokkl-web', ...input }),
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
    mutationFn: () => postAction(qc, `${timerPath}/pause`, undefined),
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
