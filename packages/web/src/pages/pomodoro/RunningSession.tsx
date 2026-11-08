import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { useCurrentEntry, useServerNow } from '../../api/timerHooks.ts';
import type { TimeEntry } from '../../api/types.ts';
import { EntryFields, type EntryFieldsHandle } from '../../components/EntryFields.tsx';
import { Loading } from '../../components/PageState.tsx';
import { usePomodoroSession } from '../../components/PomodoroSessionProvider.tsx';
import { clock, countdown, phaseLabel } from '../../components/pomodoroSessionPresentation.ts';
import { EMPTY_DRAFT, draftOf, draftSignature, type EntryDraft } from '../../components/useEntryFields.ts';
import { useRunningEntryEdits } from './useRunningEntryEdits.ts';
import { t } from '../../i18n/messages.ts';

/** The phase's countdown on the server's clock, then the overtime. It is the only part that ticks. */
function SessionCountdown({ plannedEnd }: { plannedEnd: string }) {
  const { overtime, seconds } = countdown(plannedEnd, useServerNow(1000));
  return (
    <div
      className="pomodoro-session-countdown"
      role="timer"
      aria-label={overtime ? t('pomodoro.overtime') : t('pomodoro.timeRemaining')}
    >
      <span className="pomodoro-clock">
        {overtime ? '+' : ''}
        {clock(seconds)}
      </span>
      <span className="muted">{overtime ? t('pomodoro.overtime') : t('pomodoro.timeRemaining')}</span>
    </div>
  );
}

/** The open session: its phase, countdown and actions, and the fields of its running entry. */
export function RunningSession({ recentEntries }: { recentEntries: TimeEntry[] }) {
  const { session, phase, plannedEnd, transitionKind, busy, nextPhase, end } = usePomodoroSession();
  const { data: entry } = useCurrentEntry();
  const open = entry && session && entry.id === session.entry_id ? entry : null;
  const [draft, setDraft] = useState<EntryDraft>(open ? draftOf(open) : EMPTY_DRAFT);
  const fieldsRef = useRef<EntryFieldsHandle>(null);
  const edits = useRunningEntryEdits(session?.entry_id ?? null);

  // Follow the running entry, which another device or the next pomodoro may change, but keep a
  // description that is still being typed or waiting to save.
  const follow = useEffectEvent(() => {
    if (!open) return;
    const typing = (fieldsRef.current?.hasFocus() ?? false) || edits.pending();
    setDraft(previous => ({ ...draftOf(open), description: typing ? previous.description : open.description }));
  });
  const signature = open ? `${open.id}\u0002${draftSignature(open)}` : null;
  useEffect(() => follow(), [signature]);

  const settleThen = (action: () => Promise<void>) => () => {
    void edits.settle();
    void action();
  };

  if (!session || !phase || !plannedEnd || !transitionKind) return <Loading label={t('pomodoro.ending')} />;

  return (
    <section className="card pomodoro-card" aria-label={t('pomodoro.runningLabel')}>
      <div role="status">
        <h2>{phaseLabel(phase.kind)}</h2>
        <p>{t('pomodoro.pomodoroOf', { number: session.number, total: session.long_rest_every })}</p>
      </div>
      <SessionCountdown plannedEnd={phase.planned_end} />
      <div className="pomodoro-actions">
        <button type="button" className="button button-primary" disabled={busy} onClick={settleThen(nextPhase)}>
          {t('pomodoro.nextPhaseNamed', { phase: phaseLabel(session.upcoming_phase) })}
        </button>
        <button type="button" className="button button-ghost" disabled={busy} onClick={settleThen(end)}>
          {t('pomodoro.endSession')}
        </button>
      </div>
      <p className="hint">{t('pomodoro.nextPhaseHint')}</p>
      <fieldset className="pomodoro-entry-fields">
        <legend>{t('pomodoro.entryDetails')}</legend>
        <EntryFields
          ref={fieldsRef}
          draft={draft}
          recentEntries={recentEntries}
          placeholder={t('pomodoro.runningPlaceholder')}
          onType={description => {
            setDraft(current => ({ ...current, description }));
            edits.type(description);
          }}
          onEdit={changes => {
            setDraft(current => ({ ...current, ...changes }));
            edits.edit(changes);
          }}
          onDescriptionBlur={() => void edits.settle()}
          onEnter={event => event.currentTarget.blur()}
        />
      </fieldset>
      <p className="hint">{t('pomodoro.editsApply')}</p>
    </section>
  );
}
