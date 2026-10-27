import type { PomodoroTransition, TimerState } from '../api/types.ts';

/** Same-origin WAV phrases have no MP3 encoder padding at the loop boundary. */
const SOUNDS: Record<PomodoroTransition, string> = {
  workToShortRest: '/sounds/pomodoro-work-to-short-rest.wav',
  shortRestToWork: '/sounds/pomodoro-short-rest-to-work.wav',
  workToLongRest: '/sounds/pomodoro-work-to-long-rest.wav',
  longRestToWork: '/sounds/pomodoro-long-rest-to-work.wav',
};

export interface SessionAlarm {
  key: string;
  transition: PomodoroTransition;
}

/**
 * What should ring at `serverNow` (ms, on the server's clock): nothing before the phase's planned
 * end, then the server's transition under the phase start. A state with another phase start or no
 * session gives another key or none, which stops the alarm whichever device made the change.
 */
export function phaseAlarm(pomodoro: TimerState['pomodoro'] | undefined, serverNow: number): SessionAlarm | null {
  if (!pomodoro || serverNow < Date.parse(pomodoro.phase.planned_end)) return null;
  return { key: pomodoro.phase.start, transition: pomodoro.transition };
}

/** Owns only audio: one tab of the account plays it, under its own Web Lock. */
export function createPomodoroSessionAlarm(accountId: number, options: {
  current: () => SessionAlarm | null;
  onError: (blocked: boolean) => void;
}) {
  let audio: HTMLAudioElement | null = null;
  let priming: Promise<void> = Promise.resolve();
  let target: SessionAlarm | null = null;
  let cancel: (() => void) | null = null;
  let channel: BroadcastChannel | null = null;
  let active = false;

  const element = () => {
    if (!audio) {
      audio = new Audio(SOUNDS.workToShortRest);
      audio.preload = 'auto';
    }
    return audio;
  };
  const stop = () => {
    cancel?.();
    cancel = null;
    audio?.pause();
  };

  const acquire = () => {
    if (!active || !target || cancel) return;
    if (!navigator.locks) { options.onError(true); return; }
    const alarm = target;
    const abort = new AbortController();
    let cancelled = false;
    let release = () => {};
    const stillCurrent = () => !cancelled && active && options.current()?.key === alarm.key;
    const cancelRequest = () => {
      cancelled = true;
      // Stop before releasing ownership: the next tab must never overlap this loop.
      audio?.pause();
      abort.abort();
      release();
    };
    cancel = cancelRequest;
    void navigator.locks.request(`tokkl.pomodoroAudio.${accountId}`, { signal: abort.signal }, async () => {
      try {
        await priming;
        if (!stillCurrent()) return;
        const sound = element();
        sound.src = SOUNDS[alarm.transition];
        sound.loop = true;
        sound.volume = 1;
        sound.currentTime = 0;
        // MDN: play() can reject under autoplay policy even after earlier interaction.
        // https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay
        await sound.play();
        if (!stillCurrent()) { sound.pause(); return; }
        options.onError(false);
        channel?.postMessage({ playing: alarm.key });
        await new Promise<void>((resolve) => { release = resolve; });
      } catch {
        if (stillCurrent()) options.onError(true);
      } finally {
        audio?.pause();
      }
    }).catch(() => {
      if (stillCurrent()) options.onError(true);
    }).finally(() => {
      if (cancel === cancelRequest) cancel = null;
    });
  };

  return {
    activate() {
      if (active) return;
      active = true;
      try {
        channel = new BroadcastChannel(`tokkl.pomodoroAudio.${accountId}`);
        channel.onmessage = (event: MessageEvent<unknown>) => {
          const data = event.data as { playing?: unknown } | null;
          if (target && data?.playing === target.key) {
            options.onError(false);
            // A tab that previously failed can queue again for handover when the owner closes.
            acquire();
          }
        };
      } catch { /* Audio ownership still uses Web Locks when messaging is unavailable. */ }
    },
    /** Call synchronously from Start or Retry, before awaiting any state operation. */
    unlock() {
      if (cancel) return;
      try {
        const sound = element();
        sound.loop = false;
        sound.volume = 0;
        // Prime this same element in the gesture. Browsers may still block a later audible play;
        // the rejected-play path above keeps Retry available rather than assuming permission.
        priming = Promise.resolve(sound.play()).then(() => { sound.pause(); }, () => { sound.pause(); });
      } catch { priming = Promise.resolve(); }
    },
    update(next: SessionAlarm | null) {
      if (target?.key === next?.key) return;
      stop();
      target = next;
      options.onError(false);
      acquire();
    },
    retry() {
      // Failed requests release their lock, so this tab can retry after its gesture unlock.
      options.onError(false);
      acquire();
    },
    dispose() {
      active = false;
      stop();
      target = null;
      channel?.close();
      channel = null;
    },
  };
}
