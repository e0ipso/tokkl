import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type RefObject } from 'react';
import {
  useCreateEntry, useDeleteEntry, usePreferences, useRestoreEntry, useSavePreferences, useStopEntry, useUpdateEntry,
} from '../api/hooks.ts';
import { useDiscardPause, usePauseTimer, useResumeTimer, useServerNow, useTimerState } from '../api/timerHooks.ts';
import type { TimeEntry, TimeEntryInput } from '../api/types.ts';
import { formatDuration, parseDuration } from '@tokkl/common/duration';
import { localDay, resolveRange, unreadableTime } from '../lib/entryTime.ts';
import { entrySeconds, formatTime, minutesOfDay, snappedSeconds, today, useNow, useSettings } from '../lib/settings.ts';
import { EntryFields, type EntryFieldsHandle } from './EntryFields.tsx';
import { useFieldErrors } from './FieldError.tsx';
import { Icon } from './Icon.tsx';
import { useToast } from './Toast.tsx';
import { EntryEditor } from './EntryEditor.tsx';
import { barSeconds, pauseDraft } from './pauseView.ts';
import { EMPTY_DRAFT as EMPTY, type EntryDraft as Draft } from './useEntryFields.ts';

/**
 * Writes the bar's height to --timer-bar-height on <html> while the bar is mounted. The bulk bar
 * is not inside the timer bar, so it reads the height from there to stick right under it.
 */
function useHeightProperty(ref: RefObject<HTMLElement | null>, property: string) {
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const root = document.documentElement;
    const observer = new ResizeObserver(() => root.style.setProperty(property, `${element.offsetHeight}px`));
    observer.observe(element);
    return () => {
      observer.disconnect();
      root.style.removeProperty(property);
    };
  }, [ref, property]);
}

function draftOf(entry: TimeEntry): Draft {
  return { description: entry.description, project_id: entry.project_id, task_id: entry.task_id, tags: entry.tags, billable: entry.billable };
}

/** The fields of `draft` that differ from `base`. */
function editsSince(base: Draft, draft: Draft): Partial<Draft> {
  const edits: Partial<Draft> = {};
  if (draft.description !== base.description) edits.description = draft.description;
  if (draft.project_id !== base.project_id || draft.task_id !== base.task_id) {
    edits.project_id = draft.project_id;
    edits.task_id = draft.task_id;
  }
  if (draft.tags.join('\u0000') !== base.tags.join('\u0000')) edits.tags = draft.tags;
  if (draft.billable !== base.billable) edits.billable = draft.billable;
  return edits;
}

export interface TimerBarHandle {
  startNew: () => void;
  stop: () => void;
  toggleManual: () => void;
  startFrom: (draft: Draft) => void;
}

/** The bar at the top of the timer page: running timer, new timer, or manual entry form. */
export const TimerBar = forwardRef<TimerBarHandle, { recentEntries: TimeEntry[] }>(function TimerBar({ recentEntries }, ref) {
  const settings = useSettings();
  const now = useNow(1000);
  const serverNow = useServerNow(1000);
  // The server owns the running entry, the pause chain and the Pomodoro session; the bar reads them
  // from the timer state and every change goes through an action or a v9 write. A Pomodoro
  // session's open pomodoro is the running entry. The bar leaves it to the Pomodoro page and shows
  // its idle form; a timer started there stops the pomodoro, which ends the session.
  const { data: timer } = useTimerState();
  const inSession = (timer?.pomodoro ?? null) !== null;
  const current = inSession ? null : (timer?.running_entry ?? null);
  const chain = timer?.pause ?? null;
  const paused = !current && chain?.paused === true;
  const { data: prefs } = usePreferences();
  const savePrefs = useSavePreferences();
  const create = useCreateEntry();
  const update = useUpdateEntry();
  const stopEntry = useStopEntry();
  const remove = useDeleteEntry();
  const restore = useRestoreEntry();
  const pauseTimer = usePauseTimer();
  const resumeTimer = useResumeTimer();
  const discardPause = useDiscardPause();
  const toast = useToast();
  // Pause, Resume and Stop while paused wait for the server's answer, and nothing else starts or
  // stops an entry until it arrives, so two writes never race.
  const chainBusy = pauseTimer.isPending || resumeTimer.isPending || discardPause.isPending;

  const manual = !current && !paused && (prefs?.manualMode ?? false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  // While paused the bar shows the fields Resume will start. The server holds them, so they are not editable.
  const held = useMemo(() => (paused && chain ? pauseDraft(chain) : null), [
    paused, chain?.description, chain?.project_id, chain?.task_id, chain?.billable, chain?.tags.join('\u0000'),
  ]);
  const [editing, setEditing] = useState(false);
  const [manualDay, setManualDay] = useState(() => today(settings.timeZone));
  const [manualStart, setManualStart] = useState('');
  const [manualEnd, setManualEnd] = useState('');
  const manualErrors = useFieldErrors<'start' | 'end'>();
  const [timerDuration, setTimerDuration] = useState('');
  const timerErrors = useFieldErrors<'duration'>();
  const fields = useRef<EntryFieldsHandle>(null);
  const barRef = useRef<HTMLElement>(null);
  useHeightProperty(barRef, '--timer-bar-height');

  // While a timer runs, the bar mirrors that entry. When it stops (here or on another device),
  // the bar goes back to an empty draft. Only this effect resets the draft after start/stop, so a
  // refetch that lands before the mutation settles cannot wipe what the user typed. It keys on the
  // mirrored fields, not only `at`: `at` has whole seconds, so a write in the same second as the
  // previous one leaves it unchanged.
  const shownEntryId = useRef<number | null>(null);
  // A timer this bar started that has not loaded as `current` yet, with the draft at Start. It is
  // matched by its start second: the current-entry refetch can land before the create call
  // resolves, so the new id may not be known yet.
  const ownStart = useRef<{ startMs: number; base: Draft } | null>(null);
  useEffect(() => {
    if (current) {
      const own = ownStart.current;
      if (own && current.id !== shownEntryId.current) {
        ownStart.current = null;
        if (Date.parse(current.start) === own.startMs) {
          // Edits made between Start and this first load belong to the new entry: keep and save them.
          shownEntryId.current = current.id;
          const edits = editsSince(own.base, draft);
          setDraft({ ...draftOf(current), ...edits });
          if (Object.keys(edits).length > 0) update.mutate({ id: current.id, ...edits }, { onError: toast.error });
          return;
        }
      }
      // A refetch of the same entry must not wipe a description that is still being typed.
      const typing = shownEntryId.current === current.id && (fields.current?.hasFocus() ?? false);
      shownEntryId.current = current.id;
      setDraft((previous) => ({
        description: typing ? previous.description : current.description,
        project_id: current.project_id, task_id: current.task_id, tags: current.tags, billable: current.billable,
      }));
    } else if (shownEntryId.current !== null) {
      shownEntryId.current = null;
      ownStart.current = null;
      setDraft(EMPTY);
    }
  }, [current?.id, current?.at, current?.description, current?.project_id, current?.task_id, current?.billable, current?.tags.join('\u0000')]);

  const patchRunning = (changes: TimeEntryInput) => {
    // While a start is loading, `current` is missing or the entry being replaced; the sync effect
    // saves the edits to the new entry once it loads.
    if (!current || ownStart.current) return;
    update.mutate({ id: current.id, ...changes }, { onError: toast.error });
  };

  // Set synchronously, so a second click in the same frame sees it before `create.isPending` does.
  const starting = useRef(false);

  /**
   * Starts `from` and returns the created entry, or null when nothing was created. Continue and
   * favorites pass `replace`: the server then stops the running entry at the new entry's start,
   * keeping exactly one running entry.
   */
  const start = async (from: Draft = draft, { replace = false } = {}): Promise<TimeEntry | null> => {
    // A double click or key repeat must not start two entries before the first one shows up.
    if (starting.current || create.isPending || chainBusy) return null;
    if (current && (!replace || stopEntry.isPending || remove.isPending)) return null;
    // An empty duration starts a running timer; text that does not parse is an error, not empty.
    const typed = !current && timerDuration.trim() !== '';
    const seconds = typed ? parseDuration(timerDuration) : null;
    if (!timerErrors.validate([['duration', typed && seconds === null && 'Check the duration']])) {
      fields.current?.hideSuggestions();
      return null;
    }
    starting.current = true;
    try {
      fields.current?.hideSuggestions();
      let saved: TimeEntry;
      if (seconds !== null && seconds > 0) {
        // A duration typed into the idle timer saves a finished entry that ends now.
        const stop = new Date();
        saved = await create.mutateAsync({ ...from, start: new Date(stop.getTime() - seconds * 1000).toISOString(), stop: stop.toISOString() });
        // The server snaps the entry to the time resolution, so the toast shows what it stored.
        toast.show(`Added ${formatDuration(entrySeconds(saved, stop))}`);
        setDraft(EMPTY);
      } else {
        const startAt = new Date();
        ownStart.current = { startMs: Math.floor(startAt.getTime() / 1000) * 1000, base: draft };
        saved = await create.mutateAsync({ ...from, start: startAt.toISOString(), duration: -1 });
      }
      setTimerDuration('');
      return saved;
    } catch (error) {
      ownStart.current = null;
      toast.error(error);
      return null;
    } finally {
      starting.current = false;
    }
  };

  /** Saves a changed description, so the entry stops or pauses with it. Returns false when saving failed. */
  const saveDescription = async (): Promise<boolean> => {
    if (!current || draft.description === current.description) return true;
    try {
      await update.mutateAsync({ id: current.id, description: draft.description });
      return true;
    } catch (error) {
      toast.error(error);
      return false;
    }
  };

  /** Saves a changed description, then stops the running entry. Returns the stopped entry, or null. */
  const stopRunning = async (): Promise<TimeEntry | null> => {
    if (!current || !(await saveDescription())) return null;
    try {
      return await stopEntry.mutateAsync(current.id);
    } catch (error) {
      toast.error(error);
      return null;
    }
  };

  /**
   * Stop on a running entry is a v9 stop; the server ends the pause chain when the stopped entry
   * is its clone. Stop while paused ends the chain on the server: every entry is already stopped.
   */
  const stop = async () => {
    if (chainBusy) return;
    if (!current) {
      if (!paused) return;
      try {
        await discardPause.mutateAsync();
      } catch (error) {
        toast.error(error);
      }
      return;
    }
    const stopped = await stopRunning();
    if (!stopped) return;
    // The server keeps no entry that rounds to zero at the time resolution: it went to the trash.
    if (stopped.server_deleted_at) {
      toast.show('Too short to keep, so the entry went to the trash', { action: { label: 'Undo', run: () => restore.mutate(stopped.id) } });
    }
  };

  /** Pauses the running entry on the server. A failure leaves the entry running; the toast says why. */
  const pause = async () => {
    if (!current || chainBusy || stopEntry.isPending || remove.isPending) return;
    try {
      if (!(await saveDescription())) return;
      await pauseTimer.mutateAsync();
      setTimerDuration('');
    } catch (error) {
      toast.error(error);
    }
  };

  /** Starts a clone of the paused chain on the server. */
  const resume = async () => {
    if (!paused || chainBusy) return;
    try {
      await resumeTimer.mutateAsync();
    } catch (error) {
      toast.error(error);
    }
  };

  const discard = async () => {
    if (!current) return;
    try {
      await remove.mutateAsync(current.id);
      toast.show('Running entry discarded', { action: { label: 'Undo', run: () => restore.mutate(current.id) } });
    } catch (error) {
      toast.error(error);
    }
  };

  const addManual = async () => {
    const options = { timeZone: settings.timeZone, twelveHour: settings.twelveHour, nowMinutes: minutesOfDay(new Date(), settings.timeZone) };
    const range = resolveRange(manualDay, manualStart, manualEnd, options);
    const unreadable = !range && unreadableTime(manualStart, options);
    const message = 'Enter a start and end time, like 9:00 and 10:30';
    manualErrors.validate([['start', unreadable === 'start' && message], ['end', unreadable === 'end' && message]]);
    if (!range) return;
    try {
      const saved = await create.mutateAsync({ ...draft, start: range.start.toISOString(), stop: range.stop.toISOString() });
      toast.show(`Added ${formatDuration(entrySeconds(saved, range.stop))}`);
      setDraft(EMPTY);
      // The next entry starts where the stored one stopped, which is the next day after midnight.
      // The server snaps the times, so starting at the typed end could overlap the stored entry.
      const stop = saved.stop ? new Date(saved.stop) : range.stop;
      setManualDay(localDay(stop, settings.timeZone));
      setManualStart(formatTime(stop, settings));
      setManualEnd('');
      fields.current?.focus();
    } catch (error) {
      toast.error(error);
    }
  };

  const toggleManual = () => {
    if (current || paused) return;
    savePrefs.mutate({ manualMode: !manual });
  };

  useImperativeHandle(ref, () => ({
    startNew: () => {
      if (manual) savePrefs.mutate({ manualMode: false });
      if (!current) void start(EMPTY);
      setTimeout(() => fields.current?.focus(), 50);
    },
    stop: () => void stop(),
    toggleManual,
    startFrom: (from) => {
      if (manual) {
        setDraft(from);
        fields.current?.focus();
      } else {
        void start(from, { replace: true });
      }
    },
  }));

  // The chain total while paused or while its clone runs, otherwise the running entry's own time.
  const elapsed = barSeconds(current, chain, serverNow.getTime());
  const announcement = paused ? 'Timer paused' : chain && current && chain.clone_entry_id === current.id ? 'Timer resumed' : '';
  const manualRange = manual ? resolveRange(manualDay, manualStart, manualEnd, {
    timeZone: settings.timeZone, twelveHour: settings.twelveHour, nowMinutes: minutesOfDay(now, settings.timeZone),
  }) : null;

  return (
    <section ref={barRef} className={`timer-bar${current ? ' is-running' : paused ? ' is-paused' : ''}`} aria-label="Timer">
      <EntryFields
        ref={fields}
        draft={held ?? draft}
        readOnly={paused}
        recentEntries={recentEntries}
        placeholder={manual ? 'What did you work on?' : current || paused ? 'Add a description' : 'What are you working on?'}
        onType={(description) => setDraft((d) => ({ ...d, description }))}
        onEdit={(changes) => {
          setDraft((d) => ({ ...d, ...changes }));
          if (current) patchRunning(changes);
        }}
        onDescriptionBlur={() => {
          if (current && draft.description !== current.description) patchRunning({ description: draft.description });
        }}
        onEnter={(event) => {
          if (current || paused) {
            event.currentTarget.blur();
          } else if (manual) {
            void addManual();
          } else {
            fields.current?.hideSuggestions();
            void start();
          }
        }}
      >
        {manual ? (
          <div className="manual-fields">
            <input type="date" aria-label="Date" value={manualDay} onChange={(event) => event.target.value && setManualDay(event.target.value)} />
            <input
              {...manualErrors.field('start')}
              className="time-field"
              aria-label="Start time"
              placeholder="Start"
              value={manualStart}
              onChange={(event) => setManualStart(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') void addManual(); }}
            />
            <span className="muted">–</span>
            <input
              {...manualErrors.field('end')}
              className="time-field"
              aria-label="End time"
              placeholder="End"
              value={manualEnd}
              onChange={(event) => setManualEnd(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') void addManual(); }}
            />
            <span className="manual-duration">
              {manualRange ? formatDuration(snappedSeconds(manualRange.start, manualRange.stop, settings)) : '0:00:00'}
            </span>
            {manualRange && localDay(manualRange.stop, settings.timeZone) !== manualDay ? <span className="hint">+1 day</span> : null}
            {manualErrors.message('start')}
            {manualErrors.message('end')}
          </div>
        ) : current ? (
          <>
            <span className="timer-running"><span className="timer-running-dot" aria-hidden="true" />Running</span>
            <button
              type="button"
              className="timer-clock"
              onClick={() => setEditing(true)}
              title="Edit start time"
              aria-label={`${formatDuration(elapsed)} elapsed, edit start time`}
            >
              {formatDuration(elapsed)}
            </button>
          </>
        ) : paused ? (
          <>
            <span className="timer-paused">Paused</span>
            <span className="timer-clock is-paused" role="timer" aria-label={`${formatDuration(elapsed)} elapsed, paused`}>
              {formatDuration(elapsed)}
            </span>
          </>
        ) : (
          <input
            {...timerErrors.field('duration')}
            className="timer-clock timer-clock-input"
            aria-label="Duration"
            placeholder="0:00:00"
            value={timerDuration}
            onChange={(event) => setTimerDuration(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') void start(); }}
          />
        )}

        {manual ? (
          <button type="button" className="timer-button add" onClick={() => void addManual()} aria-label="Add entry" title="Add entry">
            <Icon name="plus" size={22} />
            <span className="timer-button-label">Add</span>
          </button>
        ) : current || paused ? (
          <>
            {current ? (
              <button type="button" className="timer-button pause" onClick={() => void pause()} disabled={chainBusy} aria-label="Pause timer" title="Pause">
                <Icon name="pause" size={22} />
                <span className="timer-button-label">Pause</span>
              </button>
            ) : (
              <button type="button" className="timer-button start" onClick={() => void resume()} disabled={chainBusy} aria-label="Resume timer" title="Resume">
                <Icon name="play" size={22} />
                <span className="timer-button-label">Resume</span>
              </button>
            )}
            <button type="button" className="timer-button stop" onClick={() => void stop()} disabled={chainBusy} aria-label="Stop timer" title="Stop (S)">
              <Icon name="stop" size={22} />
              <span className="timer-button-label">Stop</span>
            </button>
          </>
        ) : (
          <button
            type="button"
            className="timer-button start"
            onClick={() => void start()}
            aria-label={timerDuration && parseDuration(timerDuration) ? 'Save entry' : 'Start timer'}
            title="Start (N)"
          >
            <Icon name={timerDuration && parseDuration(timerDuration) ? 'check' : 'play'} size={22} />
            <span className="timer-button-label">{timerDuration && parseDuration(timerDuration) ? 'Save' : 'Start'}</span>
          </button>
        )}

        {paused ? null : (
          <div className="mode-switch" role={current ? undefined : 'group'} aria-label={current ? undefined : 'Entry mode'}>
            {current ? (
              <button type="button" className="icon-button" title="Discard running entry" aria-label="Discard running entry" onClick={() => void discard()}>
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
                  onClick={() => manual && toggleManual()}
                >
                  <Icon name="timer" size={16} />
                </button>
                <button
                  type="button"
                  className={`icon-button${manual ? ' active' : ''}`}
                  title="Manual mode (M)"
                  aria-label="Manual mode"
                  aria-pressed={manual}
                  onClick={() => !manual && toggleManual()}
                >
                  <Icon name="list" size={16} />
                </button>
              </>
            )}
          </div>
        )}
        {!manual && !current && !paused ? timerErrors.message('duration') : null}
      </EntryFields>
      <span className="visually-hidden" aria-live="polite">{announcement}</span>

      {editing && current ? <EntryEditor entry={current} onClose={() => setEditing(false)} /> : null}
    </section>
  );
});

export type { Draft as TimerDraft };
