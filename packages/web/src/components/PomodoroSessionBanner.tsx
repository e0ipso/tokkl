import { usePomodoroSession } from './PomodoroSessionProvider.tsx';
import { SESSION_PHASE_LABEL } from './pomodoroSessionPresentation.ts';

/** Every signed-in page offers the actions that stop the transition alarm. */
export function PomodoroSessionBanner() {
  const { phase, ringing, audioBlocked, retryAudio, busy, nextPhase, end } = usePomodoroSession();
  if (!ringing || !phase) return null;
  return (
    <section className="pomodoro-banner pomodoro-session-banner" aria-label="Pomodoro phase ended">
      <span role="status">{SESSION_PHASE_LABEL[phase.kind]} phase over. Choose the next phase or end the session.</span>
      {audioBlocked ? (
        <div role="alert">
          Sound could not play in this tab.{' '}
          <button type="button" className="button button-ghost" onClick={retryAudio}>Retry sound</button>
        </div>
      ) : null}
      <button type="button" className="button button-primary" disabled={busy} onClick={() => void nextPhase()}>Next phase</button>
      <button type="button" className="button button-ghost" disabled={busy} onClick={() => void end()}>End session</button>
    </section>
  );
}
