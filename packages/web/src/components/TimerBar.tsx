import { useImperativeHandle, useRef, useState, type Ref } from 'react';
import { parseDuration } from '@tokkl/common/duration';
import { usePreferences, useSavePreferences } from '../api/account.ts';
import { useSettings } from '../api/settings.ts';
import { useTimerState } from '../api/timerHooks.ts';
import type { TimeEntry } from '../api/types.ts';
import { EntryEditor } from './EntryEditor.tsx';
import { EntryFields, type EntryFieldsHandle } from './EntryFields.tsx';
import { Icon } from './Icon.tsx';
import { ManualEntryFields, useManualEntry } from './ManualEntryFields.tsx';
import { pauseDraft } from './pauseView.ts';
import { TimerClock } from './TimerClock.tsx';
import { EMPTY_DRAFT, type EntryDraft } from './useEntryFields.ts';
import { useHeightProperty } from './useHeightProperty.ts';
import { useRunningDraft } from './useRunningDraft.ts';
import { useTimerBarActions } from './useTimerBarActions.ts';

export interface TimerBarHandle {
  startNew: () => void;
  stop: () => void;
  toggleManual: () => void;
  startFrom: (draft: EntryDraft) => void;
  /** Moves focus to the description field. */
  focus: () => void;
}

/** The bar's modes: a running timer, a paused chain, the manual form, or the idle timer. */
type Mode = 'running' | 'paused' | 'manual' | 'idle';

/** The bar at the top of the timer page: running timer, new timer, or manual entry form. */
export function TimerBar({ recentEntries, ref }: { recentEntries: TimeEntry[]; ref?: Ref<TimerBarHandle> }) {
  const settings = useSettings();
  // A Pomodoro session's open pomodoro is the running entry. The bar leaves it to the Pomodoro page
  // and shows its idle form; a timer started there stops the pomodoro, which ends the session.
  const { data: timer } = useTimerState();
  const inSession = (timer?.pomodoro ?? null) !== null;
  const current = inSession ? null : (timer?.running_entry ?? null);
  const chain = timer?.pause ?? null;
  const paused = !current && chain?.paused === true;
  const { data: prefs } = usePreferences();
  const savePrefs = useSavePreferences();
  const manualMode = !current && !paused && (prefs?.manualMode ?? false);
  const mode: Mode = current ? 'running' : paused ? 'paused' : manualMode ? 'manual' : 'idle';
  const fields = useRef<EntryFieldsHandle>(null);
  const barRef = useRef<HTMLElement>(null);
  useHeightProperty(barRef, '--timer-bar-height');
  const running = useRunningDraft(current, fields);
  const { draft, setDraft, patchRunning } = running;
  const actions = useTimerBarActions({ current, paused, running, fields });
  const manual = useManualEntry(settings, {
    onAdded: () => {
      setDraft(EMPTY_DRAFT);
      fields.current?.focus();
    },
  });
  const [editing, setEditing] = useState(false);
  // While paused the bar shows the fields Resume will start. The server holds them, so they are not editable.
  const held = paused && chain ? pauseDraft(chain) : null;

  const toggleManual = () => {
    if (current || paused) return;
    savePrefs.mutate({ manualMode: !manualMode });
  };

  useImperativeHandle(ref, () => ({
    startNew: () => {
      if (manualMode) savePrefs.mutate({ manualMode: false });
      // start() hides the suggestions before its first await; focusing after it opens them again,
      // as a description the user is about to type into should.
      if (!current) void actions.start(EMPTY_DRAFT);
      fields.current?.focus();
    },
    stop: () => void actions.stop(),
    toggleManual,
    startFrom: from => {
      if (manualMode) {
        setDraft(from);
        fields.current?.focus();
      } else {
        void actions.start(from, { replace: true });
      }
    },
    focus: () => fields.current?.focus(),
  }));

  const announcement =
    mode === 'paused' ? 'Timer paused' : chain && current && chain.clone_entry_id === current.id ? 'Timer resumed' : '';
  const typedSeconds = actions.timerDuration ? parseDuration(actions.timerDuration) : null;

  return (
    <section
      ref={barRef}
      className={`timer-bar${mode === 'running' ? ' is-running' : mode === 'paused' ? ' is-paused' : ''}`}
      aria-label="Timer"
    >
      <EntryFields
        ref={fields}
        draft={held ?? draft}
        readOnly={paused}
        recentEntries={recentEntries}
        placeholder={
          mode === 'manual'
            ? 'What did you work on?'
            : mode === 'idle'
              ? 'What are you working on?'
              : 'Add a description'
        }
        onType={description => setDraft(d => ({ ...d, description }))}
        onEdit={changes => {
          setDraft(d => ({ ...d, ...changes }));
          if (current) patchRunning(changes);
        }}
        onDescriptionBlur={() => {
          if (current && draft.description !== current.description) patchRunning({ description: draft.description });
        }}
        onEnter={event => {
          if (mode === 'running' || mode === 'paused') {
            event.currentTarget.blur();
          } else if (mode === 'manual') {
            void manual.add(draft);
          } else {
            fields.current?.hideSuggestions();
            void actions.start();
          }
        }}
      >
        {mode === 'manual' ? (
          <ManualEntryFields manual={manual} settings={settings} onEnter={() => void manual.add(draft)} />
        ) : mode === 'running' ? (
          <>
            <span className="timer-running">
              <span className="timer-running-dot" aria-hidden="true" />
              Running
            </span>
            <TimerClock running={current} chain={chain} onEdit={() => setEditing(true)} />
          </>
        ) : mode === 'paused' ? (
          <>
            <span className="timer-paused">Paused</span>
            <TimerClock running={null} chain={chain} onEdit={() => setEditing(true)} />
          </>
        ) : (
          <input
            {...actions.timerErrors.field('duration')}
            className="timer-clock timer-clock-input"
            aria-label="Duration"
            placeholder="0:00:00"
            value={actions.timerDuration}
            onChange={event => actions.setTimerDuration(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') void actions.start();
            }}
          />
        )}

        <TimerButtons
          mode={mode}
          busy={actions.chainBusy}
          saving={Boolean(typedSeconds)}
          onAdd={() => void manual.add(draft)}
          onStart={() => void actions.start()}
          onPause={() => void actions.pause()}
          onResume={() => void actions.resume()}
          onStop={() => void actions.stop()}
        />

        {mode === 'paused' ? null : (
          <ModeSwitch
            mode={mode}
            onDiscard={() => void actions.discard()}
            onTimer={() => mode === 'manual' && toggleManual()}
            onManual={() => mode !== 'manual' && toggleManual()}
          />
        )}
        {mode === 'idle' ? actions.timerErrors.message('duration') : null}
      </EntryFields>
      <span className="visually-hidden" aria-live="polite">
        {announcement}
      </span>

      {editing && current ? <EntryEditor entry={current} onClose={() => setEditing(false)} /> : null}
    </section>
  );
}

/** The bar's main button: Add in manual mode, Pause or Resume and Stop for a timer, else Start or Save. */
function TimerButtons({
  mode,
  busy,
  saving,
  onAdd,
  onStart,
  onPause,
  onResume,
  onStop,
}: {
  mode: Mode;
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
function ModeSwitch({
  mode,
  onDiscard,
  onTimer,
  onManual,
}: {
  mode: Exclude<Mode, 'paused'>;
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
