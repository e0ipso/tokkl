import { useLayoutEffect, useRef, useState } from 'react';
import { addDays } from '@tokkl/common/time';
import {
  DEFAULT_POMODORO_SESSION_CONFIG, POMODORO_SESSION_CONFIG_RANGES,
  type PomodoroSessionConfig, type SessionPhaseKind, type TransitionKind,
} from '@tokkl/common/pomodoroSession';
import { useEntries, usePreferences } from '../api/hooks.ts';
import type { Preferences, TimeEntry } from '../api/types.ts';
import { EntryFields } from '../components/EntryFields.tsx';
import { useFieldErrors } from '../components/FieldError.tsx';
import { LoadError, Loading } from '../components/PageState.tsx';
import { usePomodoroSession } from '../components/PomodoroSessionProvider.tsx';
import { EMPTY_DRAFT, type EntryDraft } from '../components/useEntryFields.ts';
import { today, useSettings } from '../lib/settings.ts';
import { AllowNotifications } from './manage/settings/AllowNotifications.tsx';
import './PomodoroPage.css';

const LENGTH_FIELDS = [
  { key: 'workMinutes', preference: 'pomodoro_focus_interval_in_minutes', label: 'Work (minutes)' },
  { key: 'shortRestMinutes', preference: 'pomodoro_break_interval_in_minutes', label: 'Short rest (minutes)' },
  { key: 'longRestMinutes', preference: 'pomodoro_long_break_interval_in_minutes', label: 'Long rest (minutes)' },
  { key: 'longRestEvery', preference: 'pomodoro_long_break_every', label: 'Long rest every (pomodoros)' },
] as const;
type LengthKey = keyof PomodoroSessionConfig;

const PHASE_LABEL: Record<SessionPhaseKind, string> = { work: 'Work', shortRest: 'Short rest', longRest: 'Long rest' };
const NEXT_LABEL: Record<TransitionKind, string> = {
  workToShortRest: 'Short rest', workToLongRest: 'Long rest', shortRestToWork: 'Work', longRestToWork: 'Work',
};

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function StartForm({ preferences, recentEntries }: { preferences: Preferences; recentEntries: TimeEntry[] }) {
  const { start, busy, unlockAudio } = usePomodoroSession();
  const [lengthEdits, setLengthEdits] = useState<Partial<Record<LengthKey, string>>>({});
  const [draft, setDraft] = useState<EntryDraft>(EMPTY_DRAFT);
  const fields = useFieldErrors<LengthKey>();
  const form = useRef<HTMLFormElement>(null);
  const value = (key: LengthKey, preference: typeof LENGTH_FIELDS[number]['preference']) =>
    lengthEdits[key] ?? String(preferences[preference] ?? DEFAULT_POMODORO_SESSION_CONFIG[key]);

  const startSession = () => {
    if (busy) return;
    const config = { ...DEFAULT_POMODORO_SESSION_CONFIG };
    const checks = LENGTH_FIELDS.map(({ key, preference }) => {
      const text = value(key, preference).trim();
      config[key] = Number(text);
      const { min, max } = POMODORO_SESSION_CONFIG_RANGES[key];
      const valid = /^\d+$/.test(text) && Number(text) >= min && Number(text) <= max;
      return [key, valid ? null : `Enter a whole number from ${min} to ${max}.`] as const;
    });
    if (!fields.validate(checks)) return;
    unlockAudio();
    void start(config, draft);
  };

  return (
    <form ref={form} className="card pomodoro-card" aria-label="Start a Pomodoro session" noValidate onSubmit={(event) => { event.preventDefault(); startSession(); }}>
      <h2>Start a session</h2>
      <p className="hint">These lengths apply to this session. Your saved preferences stay the same.</p>
      <div className="form-grid">
        {LENGTH_FIELDS.map(({ key, preference, label }) => (
          <div className="field" key={key}>
            <label htmlFor={fields.id(key)}>{label}</label>
            <input
              {...fields.field(key)}
              type="number" min={POMODORO_SESSION_CONFIG_RANGES[key].min} max={POMODORO_SESSION_CONFIG_RANGES[key].max} step={1}
              value={value(key, preference)}
              onChange={(event) => setLengthEdits((current) => ({ ...current, [key]: event.target.value }))}
            />
            {fields.message(key)}
          </div>
        ))}
      </div>
      <fieldset className="pomodoro-entry-fields">
        <legend>Entry details</legend>
        <EntryFields
          draft={draft} recentEntries={recentEntries} placeholder="What will you work on?"
          onType={(description) => setDraft((current) => ({ ...current, description }))}
          onEdit={(changes) => setDraft((current) => ({ ...current, ...changes }))}
          onDescriptionBlur={() => {}}
          onEnter={() => form.current?.requestSubmit()}
        />
      </fieldset>
      <button type="submit" className="button button-primary" disabled={busy}>Start</button>
    </form>
  );
}

function RunningSession({ recentEntries }: { recentEntries: TimeEntry[] }) {
  const { session, phase, plannedEnd, transitionKind, now, busy, updateFields, nextPhase, end } = usePomodoroSession();
  const [draft, setDraft] = useState<EntryDraft>(session?.fields ?? EMPTY_DRAFT);
  // Keep typing immediate while writes take the account lock. Once they settle, accept shared edits.
  const storedFields = session?.fields;
  const fieldsText = JSON.stringify(storedFields);
  useLayoutEffect(() => {
    if (!busy && storedFields) setDraft(storedFields);
  }, [busy, fieldsText]);
  const edit = (changes: Partial<EntryDraft>) => {
    setDraft((current) => ({ ...current, ...changes }));
    void updateFields(changes);
  };

  if (!session || !phase || !plannedEnd || !transitionKind) return <Loading label="Ending session…" />;
  const remaining = plannedEnd.getTime() - now.getTime();
  const overtime = remaining < 0;
  const seconds = overtime ? Math.floor(-remaining / 1000) : Math.ceil(remaining / 1000);
  const number = phase.kind === 'work' ? phase.completed + 1 : phase.completed;

  return (
    <section className="card pomodoro-card" aria-label="Running Pomodoro session">
      <div role="status">
        <h2>{PHASE_LABEL[phase.kind]}</h2>
        <p>Pomodoro {number} of {session.config.longRestEvery}</p>
      </div>
      <div className="pomodoro-session-countdown" role="timer" aria-label={overtime ? 'Overtime' : 'Time remaining'}>
        <span className="pomodoro-clock">{overtime ? '+' : ''}{clock(seconds)}</span>
        <span className="muted">{overtime ? 'Overtime' : 'Time remaining'}</span>
      </div>
      <div className="pomodoro-actions">
        <button type="button" className="button button-primary" disabled={busy} onClick={() => void nextPhase()}>
          Next phase: {NEXT_LABEL[transitionKind]}
        </button>
        <button type="button" className="button button-ghost" disabled={busy} onClick={() => void end()}>End session</button>
      </div>
      <p className="hint">Next phase starts immediately, skipping any time remaining in this phase.</p>
      <fieldset className="pomodoro-entry-fields">
        <legend>Entry details</legend>
        <EntryFields
          draft={draft} recentEntries={recentEntries} placeholder="What are you working on?"
          onType={(description) => edit({ description })} onEdit={edit}
          onDescriptionBlur={() => {}} onEnter={() => {}}
        />
      </fieldset>
      <p className="hint">Edits apply to this pomodoro and the ones that follow.</p>
    </section>
  );
}

export function PomodoroPage() {
  const { session, unsavedCount } = usePomodoroSession();
  const { data: preferences, error, refetch } = usePreferences();
  const settings = useSettings();
  const day = today(settings.timeZone);
  const { data: recentEntries = [] } = useEntries(addDays(day, -13), addDays(day, 2));

  return (
    <div className="page pomodoro-page">
      <header className="page-header"><h1>Pomodoro</h1></header>
      {unsavedCount > 0 && <p role="status">{unsavedCount} unsaved {unsavedCount === 1 ? 'pomodoro' : 'pomodoros'}. Retrying automatically.</p>}
      {session ? <RunningSession key={session.id} recentEntries={recentEntries} /> : preferences ? (
        <StartForm preferences={preferences} recentEntries={recentEntries} />
      ) : error ? (
        <LoadError message={`Could not load preferences: ${error.message}`} onRetry={() => void refetch()} />
      ) : <Loading label="Loading preferences…" />}
      <div className="pomodoro-notifications"><AllowNotifications /></div>
    </div>
  );
}
