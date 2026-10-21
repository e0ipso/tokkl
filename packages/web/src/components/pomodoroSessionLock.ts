/** Exclusive across same-origin tabs, and held until the save settles. Never run an unlocked save. */
export async function withPomodoroSessionLock<T>(accountId: number, run: () => Promise<T>): Promise<T> {
  if (typeof navigator === 'undefined' || !navigator.locks) {
    return Promise.reject(new Error('Pomodoro sessions need HTTPS or localhost to coordinate saves between tabs.'));
  }
  return navigator.locks.request(`tokkl.pomodoroSession.${accountId}`, { mode: 'exclusive' }, run);
}
