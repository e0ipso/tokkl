import { ApiError, api } from '../api/client.ts';
import type { TimeEntry } from '../api/types.ts';
import type { UnsavedPomodoro } from './pomodoroSessionState.ts';

export const pomodoroRetryDelay = (attempts: number): number =>
  Math.min(300_000, 5_000 * 2 ** Math.min(6, Math.max(0, attempts - 1)));

export const irrecoverablePomodoroError = (error: unknown): error is ApiError =>
  error instanceof ApiError && error.status >= 400 && error.status < 500
  && ![401, 408, 429].includes(error.status);

/** Query the actual entries, bypassing the cached list and its usual date window. */
export async function hasSavedPomodoro(entry: UnsavedPomodoro['entry']): Promise<boolean> {
  const query = new URLSearchParams({ start_date: entry.start, end_date: entry.stop });
  const entries = await api.get<TimeEntry[]>(`/api/v9/me/time_entries?${query}`);
  return entries.some((saved) => Date.parse(saved.start) === Date.parse(entry.start)
    && saved.stop !== null && Date.parse(saved.stop) === Date.parse(entry.stop));
}

/** One scheduled wake-up per tab. The controller rechecks the queue under the account save lock. */
export function watchPomodoroRetries(
  read: () => UnsavedPomodoro[], retry: (force: boolean) => Promise<void>, onError: (error: unknown) => void,
) {
  let stopped = false;
  let running = false;
  let requested = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    clearTimeout(timer);
    if (stopped || running) return;
    const pending = read();
    if (pending.length) timer = setTimeout(() => { void run(false); },
      Math.max(5_000, Math.min(...pending.map(({ retryAt }) => retryAt)) - Date.now()));
  };
  const run = async (force: boolean) => {
    if (stopped) return;
    if (running) { requested ||= force; return; }
    running = true;
    clearTimeout(timer);
    try { await retry(force); } catch (error) { onError(error); }
    finally {
      running = false;
      if (requested && !stopped) { requested = false; void run(true); }
      else schedule();
    }
  };
  const wake = () => { void run(true); };
  window.addEventListener('focus', wake);
  window.addEventListener('online', wake);
  schedule();
  return {
    schedule,
    stop() {
      stopped = true;
      clearTimeout(timer);
      window.removeEventListener('focus', wake);
      window.removeEventListener('online', wake);
    },
  };
}
