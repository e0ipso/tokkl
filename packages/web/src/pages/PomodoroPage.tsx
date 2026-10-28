import { useEffect, useRef, useState } from 'react';
import { addDays } from '@tokkl/common/time';
import {
  DEFAULT_POMODORO_SESSION_CONFIG, POMODORO_SESSION_CONFIG_RANGES, type PomodoroSessionConfig,
} from '@tokkl/common/pomodoroSession';
import { useCurrentEntry, useEntries, usePreferences, useUpdateEntry } from '../api/hooks.ts';
import type { Preferences, TimeEntry, TimeEntryInput } from '../api/types.ts';
import { EntryFields, type EntryFieldsHandle } from '../components/EntryFields.tsx';
import { useFieldErrors } from '../components/FieldError.tsx';
import { LoadError, Loading } from '../components/PageState.tsx';
import { usePomodoroSession } from '../components/PomodoroSessionProvider.tsx';
import { SESSION_PHASE_LABEL, clock, countdown } from '../components/pomodoroSessionPresentation.ts';
import { useToast } from '../components/Toast.tsx';
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

/** How long typing in the description waits before saving it to the running entry. */
const DESCRIPTION_SAVE_DELAY_MS = 800;

function draftOf(entry: TimeEntry): EntryDraft {
  return { description: entry.description, project_id: entry.project_id, task_id: entry.task_id, tags: entry.tags, billable: entry.billable };
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

/**
 * Saves edits of the open pomodoro to its running entry with v9 updates. Typing waits a moment and
 * saves on blur; other fields save at once. `settle` sends a waiting description now. Next phase and
 * End session call it first, and the actions wait for the edit, so the next pomodoro copies it.
 */
function useRunningEntryEdits(entryId: number | null) {
  const update = useUpdateEntry();
  const toast = useToast();
  const waiting = useRef<{ id: number; description: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const send = (id: number, changes: TimeEntryInput) =>
    update.mutateAsync({ id, ...changes }).then(() => {}, toast.error);
  const settle = (): Promise<void> => {
    const pending = waiting.current;
    if (!pending) return Promise.resolve();
    clearTimeout(pending.timer);
    waiting.current = null;
    return send(pending.id, { description: pending.description });
  };
  // Leaving the page or the session ending elsewhere still saves what was typed.
  const latest = useRef(settle);
  latest.current = settle;
  useEffect(() => () => void latest.current(), []);
  return {
    pending: () => waiting.current !== null,
    settle,
    type(description: string) {
      if (entryId === null) return;
      if (waiting.current) clearTimeout(waiting.current.timer);
      waiting.current = { id: entryId, description, timer: setTimeout(() => void latest.current(), DESCRIPTION_SAVE_DELAY_MS) };
    },
    edit(changes: Partial<EntryDraft>) {
      if (entryId === null) return;
      if ('description' in changes && waiting.current) {
        clearTimeout(waiting.current.timer);
        waiting.current = null;
      }
      void send(entryId, changes);
    },
  };
}

function RunningSession({ recentEntries }: { recentEntries: TimeEntry[] }) {
  const { session, phase, plannedEnd, transitionKind, now, busy, nextPhase, end } = usePomodoroSession();
  const { data: entry } = useCurrentEntry();
  const open = entry && session && entry.id === session.entry_id ? entry : null;
  const [draft, setDraft] = useState<EntryDraft>(open ? draftOf(open) : EMPTY_DRAFT);
  const fieldsRef = useRef<EntryFieldsHandle>(null);
  const edits = useRunningEntryEdits(session?.entry_id ?? null);

  // Follow the running entry, which another device or the next pomodoro may change, but keep a
  // description that is still being typed or waiting to save.
  useEffect(() => {
    if (!open) return;
    const typing = (fieldsRef.current?.hasFocus() ?? false) || edits.pending();
    setDraft((previous) => ({ ...draftOf(open), description: typing ? previous.description : open.description }));
  }, [open?.id, open?.description, open?.project_id, open?.task_id, open?.billable, open?.tags.join('\u0000')]);

  const settleThen = (action: () => Promise<void>) => () => {
    void edits.settle();
    void action();
  };

  if (!session || !phase || !plannedEnd || !transitionKind) return <Loading label="Ending session…" />;
  const { overtime, seconds } = countdown(phase.planned_end, now);

  return (
    <section className="card pomodoro-card" aria-label="Running Pomodoro session">
      <div role="status">
        <h2>{SESSION_PHASE_LABEL[phase.kind]}</h2>
        <p>Pomodoro {session.number} of {session.long_rest_every}</p>
      </div>
      <div className="pomodoro-session-countdown" role="timer" aria-label={overtime ? 'Overtime' : 'Time remaining'}>
        <span className="pomodoro-clock">{overtime ? '+' : ''}{clock(seconds)}</span>
        <span className="muted">{overtime ? 'Overtime' : 'Time remaining'}</span>
      </div>
      <div className="pomodoro-actions">
        <button type="button" className="button button-primary" disabled={busy} onClick={settleThen(nextPhase)}>
          Next phase: {SESSION_PHASE_LABEL[session.upcoming_phase]}
        </button>
        <button type="button" className="button button-ghost" disabled={busy} onClick={settleThen(end)}>End session</button>
      </div>
      <p className="hint">Next phase starts immediately, skipping any time remaining in this phase.</p>
      <fieldset className="pomodoro-entry-fields">
        <legend>Entry details</legend>
        <EntryFields
          ref={fieldsRef}
          draft={draft} recentEntries={recentEntries} placeholder="What are you working on?"
          onType={(description) => { setDraft((current) => ({ ...current, description })); edits.type(description); }}
          onEdit={(changes) => { setDraft((current) => ({ ...current, ...changes })); edits.edit(changes); }}
          onDescriptionBlur={() => void edits.settle()}
          onEnter={(event) => event.currentTarget.blur()}
        />
      </fieldset>
      <p className="hint">Edits apply to this pomodoro and the ones that follow.</p>
    </section>
  );
}

export function PomodoroPage() {
  const { session } = usePomodoroSession();
  const { data: preferences, error, refetch } = usePreferences();
  const settings = useSettings();
  const day = today(settings.timeZone);
  const { data: recentEntries = [] } = useEntries(addDays(day, -13), addDays(day, 2));

  return (
    <div className="page pomodoro-page">
      <header className="page-header"><h1>Pomodoro</h1></header>
      {session ? <RunningSession recentEntries={recentEntries} /> : preferences ? (
        <StartForm preferences={preferences} recentEntries={recentEntries} />
      ) : error ? (
        <LoadError message={`Could not load preferences: ${error.message}`} onRetry={() => void refetch()} />
      ) : <Loading label="Loading preferences…" />}
      <div className="pomodoro-notifications"><AllowNotifications /></div>
    </div>
  );
}
