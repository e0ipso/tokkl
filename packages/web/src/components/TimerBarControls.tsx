import { Icon } from './Icon.tsx';
import type { TimerBarMode } from './timerBarView.ts';

/** The bar's main button: Add in manual mode, Pause or Resume and Stop for a timer, else Start or Save. */
export function TimerButtons({
  mode,
  busy,
  saving,
  onAdd,
  onStart,
  onPause,
  onResume,
  onStop,
}: {
  mode: TimerBarMode;
  busy: boolean;
  /** The idle bar holds a typed duration, so the button saves a finished entry. */
  saving: boolean;
  onAdd: () => void;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}) {
  if (mode === 'manual') {
    return (
      <button type="button" className="timer-button add" onClick={onAdd} aria-label="Add entry" title="Add entry">
        <Icon name="plus" size={22} />
        <span className="timer-button-label">Add</span>
      </button>
    );
  }
  if (mode === 'idle') {
    return (
      <button
        type="button"
        className="timer-button start"
        onClick={onStart}
        aria-label={saving ? 'Save entry' : 'Start timer'}
        title="Start (N)"
      >
        <Icon name={saving ? 'check' : 'play'} size={22} />
        <span className="timer-button-label">{saving ? 'Save' : 'Start'}</span>
      </button>
    );
  }
  return (
    <>
      {mode === 'running' ? (
        <button
          type="button"
          className="timer-button pause"
          onClick={onPause}
          disabled={busy}
          aria-label="Pause timer"
          title="Pause"
        >
          <Icon name="pause" size={22} />
          <span className="timer-button-label">Pause</span>
        </button>
      ) : (
        <button
          type="button"
          className="timer-button start"
          onClick={onResume}
          disabled={busy}
          aria-label="Resume timer"
          title="Resume"
        >
          <Icon name="play" size={22} />
          <span className="timer-button-label">Resume</span>
        </button>
      )}
      <button
        type="button"
        className="timer-button stop"
        onClick={onStop}
        disabled={busy}
        aria-label="Stop timer"
        title="Stop (S)"
      >
        <Icon name="stop" size={22} />
        <span className="timer-button-label">Stop</span>
      </button>
    </>
  );
}

/** Discard for a running entry, otherwise the timer and manual mode buttons. */
export function ModeSwitch({
  mode,
  onDiscard,
  onTimer,
  onManual,
}: {
  mode: Exclude<TimerBarMode, 'paused'>;
  onDiscard: () => void;
  onTimer: () => void;
  onManual: () => void;
}) {
  const running = mode === 'running';
  const manual = mode === 'manual';
  return (
    <div className="mode-switch" role={running ? undefined : 'group'} aria-label={running ? undefined : 'Entry mode'}>
      {running ? (
        <button
          type="button"
          className="icon-button"
          title="Discard running entry"
          aria-label="Discard running entry"
          onClick={onDiscard}
        >
          <Icon name="trash" size={16} />
        </button>
      ) : (
        <>
          <button
            type="button"
            className={`icon-button${!manual ? ' active' : ''}`}
            title="Timer mode"
            aria-label="Timer mode"
            aria-pressed={!manual}
            onClick={onTimer}
          >
            <Icon name="timer" size={16} />
          </button>
          <button
            type="button"
            className={`icon-button${manual ? ' active' : ''}`}
            title="Manual mode (M)"
            aria-label="Manual mode"
            aria-pressed={manual}
            onClick={onManual}
          >
            <Icon name="list" size={16} />
          </button>
        </>
      )}
    </div>
  );
}
