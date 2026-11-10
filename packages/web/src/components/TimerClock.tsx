import { formatDuration } from '@tokkl/common/duration';
import { useServerNow } from '../api/timerHooks.ts';
import type { TimeEntry, TimerPause } from '@tokkl/types';
import { barSeconds } from './pauseView.ts';
import { t } from '../i18n/messages.ts';

/** The only ticking part of the bar, so the per-second re-render stays here. */
export function TimerClock({
  running,
  chain,
  onEdit,
}: {
  running: TimeEntry | null;
  chain: TimerPause | null;
  onEdit: () => void;
}) {
  const serverNow = useServerNow(1000);
  // The chain total while paused or while its clone runs, otherwise the running entry's own time.
  const elapsed = formatDuration(barSeconds(running, chain, serverNow.getTime()));
  if (!running) {
    return (
      <span className="timer-clock is-paused" role="timer" aria-label={t('timer.clockPaused', { elapsed })}>
        {elapsed}
      </span>
    );
  }
  return (
    <button
      type="button"
      className="timer-clock"
      onClick={onEdit}
      title={t('timer.editStartTime')}
      aria-label={t('timer.clockEdit', { elapsed })}
    >
      {elapsed}
    </button>
  );
}
