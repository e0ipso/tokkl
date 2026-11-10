import { usePomodoroSession } from './PomodoroSessionProvider.tsx';
import { phaseLabel } from './pomodoroSessionPresentation.ts';
import { t } from '../i18n/messages.ts';

/** Every signed-in page offers the actions that stop the transition alarm. */
export function PomodoroSessionBanner() {
  const { phase, ringing, audioBlocked, retryAudio, busy, nextPhase, end } = usePomodoroSession();
  if (!ringing || !phase) return null;
  return (
    <section className="pomodoro-banner pomodoro-session-banner" aria-label={t('pomodoro.bannerLabel')}>
      <span role="status">{t('pomodoro.bannerPhaseOver', { phase: phaseLabel(phase.kind) })}</span>
      {audioBlocked ? (
        <div role="alert">
          {t('pomodoro.soundBlocked')}{' '}
          <button type="button" className="button button-ghost" onClick={retryAudio}>
            {t('pomodoro.retrySound')}
          </button>
        </div>
      ) : null}
      <button type="button" className="button button-primary" disabled={busy} onClick={() => void nextPhase()}>
        {t('pomodoro.nextPhase')}
      </button>
      <button type="button" className="button button-ghost" disabled={busy} onClick={() => void end()}>
        {t('pomodoro.endSession')}
      </button>
    </section>
  );
}
