import { Icon } from './Icon.tsx';
import type { TimerBarMode } from './timerBarView.ts';
import { t } from '../i18n/messages.ts';

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
      <button
        type="button"
        className="timer-button add"
        onClick={onAdd}
        aria-label={t('timer.addEntry')}
        title={t('timer.addEntry')}
      >
        <Icon name="plus" size={22} />
        <span className="timer-button-label">{t('timer.add')}</span>
      </button>
    );
  }
  if (mode === 'idle') {
    return (
      <button
        type="button"
        className="timer-button start"
        onClick={onStart}
        aria-label={saving ? t('timer.saveEntry') : t('timer.startTimer')}
        title={t('timer.startTitle')}
      >
        <Icon name={saving ? 'check' : 'play'} size={22} />
        <span className="timer-button-label">{saving ? t('common.save') : t('timer.start')}</span>
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
          aria-label={t('timer.pauseTimer')}
          title={t('timer.pause')}
        >
          <Icon name="pause" size={22} />
          <span className="timer-button-label">{t('timer.pause')}</span>
        </button>
      ) : (
        <button
          type="button"
          className="timer-button start"
          onClick={onResume}
          disabled={busy}
          aria-label={t('timer.resumeTimer')}
          title={t('timer.resume')}
        >
          <Icon name="play" size={22} />
          <span className="timer-button-label">{t('timer.resume')}</span>
        </button>
      )}
      <button
        type="button"
        className="timer-button stop"
        onClick={onStop}
        disabled={busy}
        aria-label={t('timer.stopTimer')}
        title={t('timer.stopTitle')}
      >
        <Icon name="stop" size={22} />
        <span className="timer-button-label">{t('timer.stop')}</span>
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
    <div
      className="mode-switch"
      role={running ? undefined : 'group'}
      aria-label={running ? undefined : t('timer.entryMode')}
    >
      {running ? (
        <button
          type="button"
          className="icon-button"
          title={t('timer.discardRunning')}
          aria-label={t('timer.discardRunning')}
          onClick={onDiscard}
        >
          <Icon name="trash" size={16} />
        </button>
      ) : (
        <>
          <button
            type="button"
            className={`icon-button${!manual ? ' active' : ''}`}
            title={t('timer.timerMode')}
            aria-label={t('timer.timerMode')}
            aria-pressed={!manual}
            onClick={onTimer}
          >
            <Icon name="timer" size={16} />
          </button>
          <button
            type="button"
            className={`icon-button${manual ? ' active' : ''}`}
            title={t('timer.manualModeTitle')}
            aria-label={t('timer.manualMode')}
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
