import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from './client.ts';
import { keys } from './hooks.ts';
import { getClockOffset, setClockOffset } from './serverClock.ts';
import { TimerActionError, explainTimerActionError, planTimerUpdate } from './timerState.ts';
import { useTimerStreaming } from './timerStreaming.ts';
import type { TimeEntryInput, TimerState } from './types.ts';
import { useNow } from '../lib/settings.ts';

const POLL_MS = 30_000;
const timerPath = '/api/app/timer';
const pomodoroPath = '/api/app/pomodoro';

/**
 * Takes a state into the caches: the timer, the running entry and the clock offset. A state older
 * than the cached one is dropped and the cached state is returned. When the state moved past the
 * cached one, lists built from entries refetch, because the change started, stopped or discarded
 * entries. Every source of states (stream, poll, action reply, conflict) goes through here.
 */
export function acceptTimerState(qc: QueryClient, state: TimerState): TimerState {
  const cached = qc.getQueryData<TimerState>(keys.timer);
  const update = planTimerUpdate(cached, state, Date.now());
  if (!update) return cached ?? state;
  qc.setQueryData(keys.timer, update.state);
  qc.setQueryData(keys.current, update.current);
  if (update.offset !== null) setClockOffset(update.offset);
  if (update.changed) {
    void qc.invalidateQueries({ queryKey: keys.entries });
    void qc.invalidateQueries({ queryKey: keys.report });
    void qc.invalidateQueries({ queryKey: keys.trash });
  }
  return update.state;
}

async function readTimerState(qc: QueryClient): Promise<TimerState> {
  return acceptTimerState(qc, await api.get<TimerState>(timerPath));
}

/**
 * The server-owned timer state. It polls every 30 s only while the stream is down, and refetches
 * on window focus. The stream, the poll and every action write through `acceptTimerState`.
 */
export function useTimerState() {
  const qc = useQueryClient();
  const streaming = useTimerStreaming();
  return useQuery({
    queryKey: keys.timer,
    queryFn: () => readTimerState(qc),
    refetchInterval: streaming ? false : POLL_MS,
    // Views mounting together share one read; focus still refetches once a second has passed.
    staleTime: 1000,
  });
}

/** The server's time, corrected by the offset taken with the latest state. Re-renders every `intervalMs` like `useNow`. */
export function useServerNow(intervalMs = 1000): Date {
  useNow(intervalMs);
  return new Date(Date.now() + getClockOffset());
}

/** The revision actions send: the cached one, read first if the state has not loaded yet. */
async function currentRevision(qc: QueryClient): Promise<number> {
  const state = await qc.ensureQueryData({ queryKey: keys.timer, queryFn: () => readTimerState(qc) });
  return state.revision;
}

/**
 * Posts a timer action. The reply is the new state. A 409 replaces the cached state with the one in
 * its body and fails with a `TimerActionError` of kind `conflict`; no reply at all fails with kind
 * `offline`. Both carry the message to show. Other failures keep their `ApiError`.
 */
async function postAction(qc: QueryClient, path: string, body: Record<string, unknown> | undefined): Promise<TimerState> {
  try {
    return acceptTimerState(qc, await api.post<TimerState>(path, body));
  } catch (error) {
    const explained = explainTimerActionError(error);
    if (explained instanceof TimerActionError && explained.state) acceptTimerState(qc, explained.state);
    throw explained;
  }
}

function useRevisionAction(path: string) {
  const qc = useQueryClient();
  return useMutation<TimerState, Error, void>({
    mutationFn: async () => postAction(qc, path, { revision: await currentRevision(qc) }),
  });
}

/** Fields of a Pomodoro start: the entry's fields and the session lengths, in minutes, for this session only. */
export interface StartPomodoroInput extends Pick<TimeEntryInput, 'description' | 'project_id' | 'task_id' | 'billable' | 'tag_ids'> {
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
    mutationFn: (input) => postAction(qc, pomodoroPath, { created_with: 'tokkl-web', ...input }),
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
