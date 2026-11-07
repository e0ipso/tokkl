import { formatDuration } from '@tokkl/common/duration';
import { useServerNow } from '../api/timerHooks.ts';
import type { TimeEntry, TimerPause } from '../api/types.ts';
import { barSeconds } from './pauseView.ts';

/**
 * The timer bar's clock. It is the only part of the bar that ticks, so the second-by-second
 * re-render stays here. While paused it shows the chain's frozen total.
 */
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
      <span className="timer-clock is-paused" role="timer" aria-label={`${elapsed} elapsed, paused`}>
        {elapsed}
      </span>
    );
  }
  return (
    <button
      type="button"
      className="timer-clock"
      onClick={onEdit}
      title="Edit start time"
      aria-label={`${elapsed} elapsed, edit start time`}
    >
      {elapsed}
    </button>
  );
}
