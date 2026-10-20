import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type RefObject } from 'react';
import {
  useCreateEntry, useCurrentEntry, useDeleteEntry, useMe, usePreferences, useProjects, useRestoreEntry, useSavePreferences,
  useStopEntry, useUpdateEntry,
} from '../api/hooks.ts';
import type { TimeEntry, TimeEntryInput } from '../api/types.ts';
import { formatDuration, parseDuration } from '@tokkl/common/duration';
import { localDay, resolveRange, unreadableTime } from '../lib/entryTime.ts';
import { entrySeconds, formatTime, minutesOfDay, snappedSeconds, today, useNow, useSettings } from '../lib/settings.ts';
import { useFieldErrors } from './FieldError.tsx';
import { Icon } from './Icon.tsx';
import { ProjectDot, ProjectLabel, ProjectPicker, TagPicker, projectColorStyle } from './Pickers.tsx';
import { useToast } from './Toast.tsx';
import { EntryEditor } from './EntryEditor.tsx';
import {
  chainKey, chainSeconds, isPaused, pause as pauseChain, reconcile, resume as resumeChain, sameSnapshot,
  withSnapshot, type PauseChain,
} from './pauseChain.ts';
import { countdownText, type PhaseEnd } from './pomodoroCycle.ts';
import { usePauseCoordination } from './PauseCoordination.tsx';
import { PomodoroBanner, useTimerCoordination } from './PomodoroProvider.tsx';
import { readTabChain, subscribeTabChain, writeTabChain } from './tabChain.ts';

interface Draft {
  description: string;
  project_id: number | null;
  task_id: number | null;
  tags: string[];
  billable: boolean;
}

const EMPTY: Draft = { description: '', project_id: null, task_id: null, tags: [], billable: false };

const PHASE_NAMES: Record<PhaseEnd, string> = { work: 'Work', short: 'Short break', long: 'Long break' };

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

interface Suggestion extends Draft {
  key: string;
  project_name: string | null;
  project_color: string | null;
}

function suggestionsFrom(entries: TimeEntry[], query: string): Suggestion[] {
  const seen = new Set<string>();
  const out: Suggestion[] = [];
  const q = query.trim().toLowerCase();
  for (const entry of entries) {
    if (!entry.description && !entry.project_id) continue;
    const key = `${entry.description}\u0000${entry.project_id ?? ''}\u0000${entry.task_id ?? ''}`;
    if (seen.has(key)) continue;
    const haystack = `${entry.description} ${entry.project_name ?? ''} ${entry.client_name ?? ''}`.toLowerCase();
    if (q && !haystack.includes(q)) continue;
    seen.add(key);
    out.push({
      key, description: entry.description, project_id: entry.project_id, task_id: entry.task_id, tags: entry.tags,
      billable: entry.billable, project_name: entry.project_name ?? null, project_color: entry.project_color ?? null,
    });
    if (out.length >= 8) break;
  }
  return out;
}

/** The bar at the top of the timer page: running timer, new timer, or manual entry form. */
export const TimerBar = forwardRef<TimerBarHandle, { recentEntries: TimeEntry[] }>(function TimerBar({ recentEntries }, ref) {
  const settings = useSettings();
  const now = useNow(1000);
  const { data: me } = useMe();
  const accountId = me?.id ?? 0;
  const { data: current, dataUpdatedAt: currentFetchedAt } = useCurrentEntry();
  const { data: prefs } = usePreferences();
  const savePrefs = useSavePreferences();
  const { data: projects = [] } = useProjects();
  const create = useCreateEntry();
  const update = useUpdateEntry();
  const stopEntry = useStopEntry();
  const remove = useDeleteEntry();
  const restore = useRestoreEntry();
  const toast = useToast();

  // Pause stops the running entry and Resume starts a clone of it; the chain keeps what to clone
  // and the total, in localStorage per account so a reload keeps it. `chainRef` is set at once, so
  // code after an await reads the chain as it is now.
  const [chain, setChainState] = useState<PauseChain | null>(() => readTabChain(accountId));
  const chainRef = useRef(chain);
  const setChain = (next: PauseChain | null) => {
    chainRef.current = next;
    setChainState(next);
    writeTabChain(accountId, next);
  };
  const endChain = () => {
    if (chainRef.current) setChain(null);
  };
  // Another tab of this account, or the Pomodoro in this one, paused, resumed or stopped.
  useEffect(() => {
    if (!accountId) return;
    const adopt = (next: PauseChain | null) => {
      chainRef.current = next;
      setChainState(next);
      // With no running entry shown here, the bar shows what Resume will start: the other
      // writer's snapshot, before any edit made here is saved into it.
      if (isPaused(next) && shownEntryId.current === null) setDraft(next.snapshot);
    };
    const key = chainKey(accountId);
    const onStorage = (event: StorageEvent) => {
      if (event.key === key || event.key === null) adopt(readTabChain(accountId));
    };
    const unsubscribe = subscribeTabChain((written, next) => {
      if (written === accountId && next !== chainRef.current) adopt(next);
    });
    window.addEventListener('storage', onStorage);
    return () => {
      unsubscribe();
      window.removeEventListener('storage', onStorage);
    };
  }, [accountId]);
  const paused = !current && isPaused(chain);

  const manual = !current && !paused && (prefs?.manualMode ?? false);
  const [draft, setDraft] = useState<Draft>(() => (isPaused(chain) ? chain.snapshot : EMPTY));
  const [picker, setPicker] = useState<'project' | 'tags' | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [editing, setEditing] = useState(false);
  const [manualDay, setManualDay] = useState(() => today(settings.timeZone));
  const [manualStart, setManualStart] = useState('');
  const [manualEnd, setManualEnd] = useState('');
  const manualErrors = useFieldErrors<'start' | 'end'>();
  const [timerDuration, setTimerDuration] = useState('');
  const timerErrors = useFieldErrors<'duration'>();
  const descriptionRef = useRef<HTMLInputElement>(null);
  // The description's blur hides the suggestions after a delay, so a click on one still lands.
  // A later focus cancels that pending hide, and a focus that comes from a closing picker does not
  // open the suggestions: the user did not ask for them.
  const hideSuggestionsTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const quietFocus = useRef(false);
  const focusDescriptionQuietly = () => {
    quietFocus.current = true;
    descriptionRef.current?.focus();
    quietFocus.current = false;
  };
  const projectButton = useRef<HTMLButtonElement>(null);
  const tagButton = useRef<HTMLButtonElement>(null);
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
      const typing = shownEntryId.current === current.id && document.activeElement === descriptionRef.current;
      shownEntryId.current = current.id;
      setDraft((previous) => ({
        description: typing ? previous.description : current.description,
        project_id: current.project_id, task_id: current.task_id, tags: current.tags, billable: current.billable,
      }));
    } else if (shownEntryId.current !== null) {
      shownEntryId.current = null;
      ownStart.current = null;
      // A paused bar keeps showing what Resume will start.
      const held = chainRef.current;
      setDraft(isPaused(held) ? held.snapshot : EMPTY);
    }
  }, [current?.id, current?.at, current?.description, current?.project_id, current?.task_id, current?.billable, current?.tags.join('\u0000')]);

  // Set while this bar pauses or resumes. The current entry refetches in the middle of both, and
  // that answer must not end the chain before the bar records the change.
  // Shared with the Pomodoro, which pauses the entry at the end of a work phase.
  const { busy: chainBusy, pausing } = usePauseCoordination();
  const { barPause, pausedAt, pomodoro } = useTimerCoordination();
  // Set while Resume's start request is pending, and whether Stop was pressed in that time.
  const resumePending = useRef(false);
  const stopAfterResume = useRef(false);

  // The chain ends when the current entry shows another client started a timer, or stopped or
  // replaced the clone.
  useEffect(() => {
    if (chainBusy.current) return;
    const next = reconcile(chainRef.current, current, currentFetchedAt);
    if (next !== chainRef.current) setChain(next);
  }, [chain, current, currentFetchedAt]);

  // Edits made while paused go into the snapshot, so Resume and a reload use them.
  useEffect(() => {
    const held = chainRef.current;
    if (current || !isPaused(held) || sameSnapshot(held.snapshot, draft)) return;
    setChain(withSnapshot(held, draft));
  }, [draft]);

  const suggestions = useMemo(
    () => (showSuggestions ? suggestionsFrom(recentEntries, draft.description) : []),
    [showSuggestions, recentEntries, draft.description],
  );

  const patchRunning = (changes: TimeEntryInput) => {
    // While a start is loading, `current` is missing or the entry being replaced; the sync effect
    // saves the edits to the new entry once it loads.
    if (!current || ownStart.current) return;
    update.mutate({ id: current.id, ...changes }, { onError: toast.error });
  };

  const setField = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    if (current && key !== 'description') patchRunning({ [key]: value } as TimeEntryInput);
  };

  // Set synchronously, so a second click in the same frame sees it before `create.isPending` does.
  const starting = useRef(false);

  /**
   * Starts `from` and returns the created entry, or null when nothing was created. Continue and
   * favorites pass `replace`: the server then stops the running entry at the new entry's start,
   * keeping exactly one running entry. Any start but Resume's (`resuming`) ends the pause chain.
   */
  const start = async (from: Draft = draft, { replace = false, resuming = false } = {}): Promise<TimeEntry | null> => {
    // A double click or key repeat must not start two entries before the first one shows up.
    if (starting.current || create.isPending) return null;
    if (current && (!replace || stopEntry.isPending || remove.isPending)) return null;
    // An empty duration starts a running timer; text that does not parse is an error, not empty.
    const typed = !current && timerDuration.trim() !== '';
    const seconds = typed ? parseDuration(timerDuration) : null;
    if (!timerErrors.validate([['duration', typed && seconds === null && 'Check the duration']])) {
      setShowSuggestions(false);
      return null;
    }
    starting.current = true;
    try {
      setShowSuggestions(false);
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
      if (!resuming) endChain();
      return saved;
    } catch (error) {
      ownStart.current = null;
      toast.error(error);
      return null;
    } finally {
      starting.current = false;
    }
  };

  /** Saves a changed description, then stops the running entry. Returns the stopped entry, or null. */
  const stopRunning = async (): Promise<TimeEntry | null> => {
    if (!current) return null;
    try {
      if (draft.description !== current.description) {
        await update.mutateAsync({ id: current.id, description: draft.description });
      }
      return await stopEntry.mutateAsync(current.id);
    } catch (error) {
      toast.error(error);
      return null;
    }
  };

  /**
   * Stop ends the pause chain. While paused every entry is already stopped, so nothing is sent.
   * While a pause is stopping the entry, Stop leaves the request to it and the pause ends the chain.
   */
  const stop = async () => {
    if (pausing.current) {
      pausing.current.stopAfter = true;
      return;
    }
    if (!current) {
      // The clone does not exist yet; Resume stops it once its start returns.
      if (resumePending.current) stopAfterResume.current = true;
      if (isPaused(chainRef.current)) {
        setChain(null);
        setDraft(EMPTY);
      }
      return;
    }
    const stopped = await stopRunning();
    if (!stopped) return;
    endChain();
    // The server keeps no entry that rounds to zero at the time resolution: it went to the trash.
    if (stopped.server_deleted_at) {
      toast.show('Too short to keep, so the entry went to the trash', { action: { label: 'Undo', run: () => restore.mutate(stopped.id) } });
    }
  };

  const pause = async () => {
    if (!current || chainBusy.current) return;
    chainBusy.current = true;
    const pending = { stopAfter: false, at: Date.now() };
    pausing.current = pending;
    try {
      // A failed stop leaves the entry running, and a Stop pressed meanwhile with it; the error
      // toast says so.
      const stopped = await stopRunning();
      if (!stopped) return;
      setTimerDuration('');
      if (pending.stopAfter) {
        endChain();
        setDraft(EMPTY);
        return;
      }
      const next = pauseChain(chainRef.current, stopped, Date.now());
      pausedAt.current = pending.at;
      setChain(next);
      setDraft(next.snapshot);
    } finally {
      pausing.current = null;
      chainBusy.current = false;
    }
  };

  /** Starts a clone of the paused entry, the call Continue makes. */
  const resume = async () => {
    const held = chainRef.current;
    if (!isPaused(held) || chainBusy.current) return;
    chainBusy.current = true;
    resumePending.current = true;
    stopAfterResume.current = false;
    try {
      const clone = await start(held.snapshot, { replace: true, resuming: true });
      resumePending.current = false;
      if (clone && stopAfterResume.current) {
        // Stop was pressed while the clone was starting. That Stop ended the chain; stop the clone
        // now that it exists, after its start, so the two writes never overlap.
        ownStart.current = null;
        try {
          await stopEntry.mutateAsync(clone.id);
        } catch (error) {
          toast.error(error);
        }
        return;
      }
      const latest = chainRef.current;
      if (clone && isPaused(latest)) setChain(resumeChain(latest, clone.id, Date.now()));
    } finally {
      resumePending.current = false;
      stopAfterResume.current = false;
      chainBusy.current = false;
    }
  };

  const discard = async () => {
    if (!current) return;
    try {
      await remove.mutateAsync(current.id);
      endChain();
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
      descriptionRef.current?.focus();
    } catch (error) {
      toast.error(error);
    }
  };

  const toggleManual = () => {
    if (current || isPaused(chainRef.current)) return;
    savePrefs.mutate({ manualMode: !manual });
  };

  const pickSuggestion = (s: Suggestion) => {
    const next = { description: s.description, project_id: s.project_id, task_id: s.task_id, tags: s.tags, billable: s.billable };
    setShowSuggestions(false);
    setHighlight(-1);
    if (current) {
      setDraft(next);
      patchRunning(next);
    } else {
      setDraft(next);
    }
  };

  useImperativeHandle(ref, () => ({
    startNew: () => {
      if (manual) savePrefs.mutate({ manualMode: false });
      if (!current) void start(EMPTY);
      setTimeout(() => descriptionRef.current?.focus(), 50);
    },
    stop: () => void stop(),
    toggleManual,
    startFrom: (from) => {
      if (manual) {
        setDraft(from);
        descriptionRef.current?.focus();
      } else {
        void start(from, { replace: true });
      }
    },
  }));

  // While the bar is mounted, the Pomodoro pauses the entry at the end of a work phase through
  // this Pause, the one the button runs.
  useEffect(() => {
    barPause.current = pause;
    return () => {
      barPause.current = null;
    };
  });
  const phaseLeft = pomodoro.countdown(now.getTime());

  const project = projects.find((p) => p.id === draft.project_id);
  // The chain total while paused or while its clone runs, otherwise the running entry's own time.
  const elapsed = chainSeconds(chain, current, now.getTime());
  const announcement = paused ? 'Timer paused' : chain && current && chain.runningId === current.id ? 'Timer resumed' : '';
  const manualRange = manual ? resolveRange(manualDay, manualStart, manualEnd, {
    timeZone: settings.timeZone, twelveHour: settings.twelveHour, nowMinutes: minutesOfDay(now, settings.timeZone),
  }) : null;

  return (
    <section ref={barRef} className={`timer-bar${current ? ' is-running' : paused ? ' is-paused' : ''}`} aria-label="Timer">
      <div className="timer-description">
        <input
          ref={descriptionRef}
          value={draft.description}
          placeholder={manual ? 'What did you work on?' : current || paused ? 'Add a description' : 'What are you working on?'}
          aria-label="Description"
          maxLength={3000}
          onChange={(event) => {
            setDraft((d) => ({ ...d, description: event.target.value }));
            setShowSuggestions(true);
            setHighlight(-1);
          }}
          onFocus={() => {
            clearTimeout(hideSuggestionsTimer.current);
            setShowSuggestions(!quietFocus.current);
          }}
          onBlur={() => {
            hideSuggestionsTimer.current = setTimeout(() => setShowSuggestions(false), 150);
            if (current && draft.description !== current.description) patchRunning({ description: draft.description });
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' && suggestions.length) {
              event.preventDefault();
              setHighlight((h) => (h + 1) % suggestions.length);
            } else if (event.key === 'ArrowUp' && suggestions.length) {
              event.preventDefault();
              setHighlight((h) => (h <= 0 ? suggestions.length - 1 : h - 1));
            } else if (event.key === 'Enter') {
              event.preventDefault();
              if (highlight >= 0 && suggestions[highlight]) {
                pickSuggestion(suggestions[highlight]!);
              } else if (current || paused) {
                (event.target as HTMLInputElement).blur();
              } else if (manual) {
                void addManual();
              } else {
                setShowSuggestions(false);
                void start();
              }
            } else if (event.key === 'Escape') {
              setShowSuggestions(false);
            } else if (event.key === '@' && draft.description === '') {
              event.preventDefault();
              setPicker('project');
            } else if (event.key === '#' && draft.description === '') {
              event.preventDefault();
              setPicker('tags');
            }
          }}
        />
        {suggestions.length > 0 ? (
          <ul className="suggestions" role="listbox">
            {suggestions.map((s, i) => (
              <li key={s.key} role="option" aria-selected={i === highlight}>
                <button
                  type="button"
                  className={`suggestion${i === highlight ? ' highlighted' : ''}`}
                  onMouseDown={(event) => { event.preventDefault(); pickSuggestion(s); }}
                >
                  <span>{s.description || <em className="muted">(no description)</em>}</span>
                  {s.project_id ? (
                    <span className="suggestion-project">
                      <ProjectDot color={s.project_color} /> {s.project_name}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="timer-controls">
        <button
          ref={projectButton}
          type="button"
          className={`icon-button timer-attr timer-project${project ? ' active' : ''}`}
          style={projectColorStyle(project?.color)}
          title="Project (@)"
          aria-label="Project"
          onClick={() => setPicker('project')}
        >
          {project ? <ProjectLabel projectId={project.id} taskId={draft.task_id} /> : <Icon name="folder" />}
        </button>
        <button
          ref={tagButton}
          type="button"
          className={`icon-button timer-attr${draft.tags.length ? ' active' : ''}`}
          title={draft.tags.length ? draft.tags.join(', ') : 'Tags (#)'}
          aria-label="Tags"
          onClick={() => setPicker('tags')}
        >
          <Icon name="tag" />
          {draft.tags.length ? <span className="badge">{draft.tags.length}</span> : null}
        </button>
        <button
          type="button"
          className={`icon-button timer-attr billable-toggle${draft.billable ? ' active billable' : ''}`}
          title="Billable"
          aria-label="Billable"
          aria-pressed={draft.billable}
          onClick={() => setField('billable', !draft.billable)}
        >
          <Icon name="dollar" />
        </button>

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
        {phaseLeft ? (
          <span
            className="pomodoro-countdown"
            role="timer"
            aria-label={`${PHASE_NAMES[phaseLeft.phase]}, ${countdownText(phaseLeft.seconds)} left`}
          >
            <span className="pomodoro-phase" aria-hidden="true">{PHASE_NAMES[phaseLeft.phase]}</span>
            <span className="pomodoro-time" aria-hidden="true">{countdownText(phaseLeft.seconds)}</span>
          </span>
        ) : null}

        {manual ? (
          <button type="button" className="timer-button add" onClick={() => void addManual()} aria-label="Add entry" title="Add entry">
            <Icon name="plus" size={22} />
            <span className="timer-button-label">Add</span>
          </button>
        ) : current || paused ? (
          <>
            {current ? (
              <button type="button" className="timer-button pause" onClick={() => void pause()} aria-label="Pause timer" title="Pause">
                <Icon name="pause" size={22} />
                <span className="timer-button-label">Pause</span>
              </button>
            ) : (
              <button type="button" className="timer-button start" onClick={() => void resume()} aria-label="Resume timer" title="Resume">
                <Icon name="play" size={22} />
                <span className="timer-button-label">Resume</span>
              </button>
            )}
            <button type="button" className="timer-button stop" onClick={() => void stop()} aria-label="Stop timer" title="Stop (S)">
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
      </div>
      <PomodoroBanner />
      <span className="visually-hidden" aria-live="polite">{announcement}</span>

      {picker === 'project' ? (
        <ProjectPicker
          anchor={projectButton.current}
          projectId={draft.project_id}
          taskId={draft.task_id}
          onChange={(pid, tid) => {
            const picked = projects.find((p) => p.id === pid);
            const billable = picked?.billable ? true : draft.billable;
            setDraft((d) => ({ ...d, project_id: pid, task_id: tid, billable }));
            if (current) patchRunning({ project_id: pid, task_id: tid, billable });
          }}
          onClose={() => { setPicker(null); focusDescriptionQuietly(); }}
        />
      ) : null}
      {picker === 'tags' ? (
        <TagPicker
          anchor={tagButton.current}
          value={draft.tags}
          onChange={(tags) => setField('tags', tags)}
          onClose={() => { setPicker(null); focusDescriptionQuietly(); }}
        />
      ) : null}
      {editing && current ? <EntryEditor entry={current} onClose={() => setEditing(false)} /> : null}
    </section>
  );
});

export type { Draft as TimerDraft };
