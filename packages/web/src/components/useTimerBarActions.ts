import { useRef, useState, type RefObject } from 'react';
import { formatDuration, parseDuration } from '@tokkl/common/duration';
import { useCreateEntry, useDeleteEntry, useRestoreEntry, useStopEntry, useUpdateEntry } from '../api/entries.ts';
import { useDiscardPause, usePauseTimer, useResumeTimer } from '../api/timerHooks.ts';
import type { TimeEntry } from '../api/types.ts';
import { entrySeconds } from '../lib/snapping.ts';
import type { EntryFieldsHandle } from './EntryFields.tsx';
import { useFieldErrors } from './FieldError.tsx';
import { useToast } from './Toast.tsx';
import { EMPTY_DRAFT, type EntryDraft } from './useEntryFields.ts';
import type { useRunningDraft } from './useRunningDraft.ts';

/**
 * Start, Stop, Pause, Resume and Discard for the timer bar, and the idle bar's duration field.
 *
 * The server owns the running entry, the pause chain and the Pomodoro session: every action goes
 * through a v9 write or a timer action. Pause, Resume and Stop while paused wait for the server's
 * answer, and nothing else starts or stops an entry until it arrives, so two writes never race.
 */
export function useTimerBarActions({
  current,
  paused,
  running,
  fields,
}: {
  current: TimeEntry | null;
  paused: boolean;
  running: ReturnType<typeof useRunningDraft>;
  fields: RefObject<EntryFieldsHandle | null>;
}) {
  const create = useCreateEntry();
  const update = useUpdateEntry();
  const stopEntry = useStopEntry();
  const remove = useDeleteEntry();
  const restore = useRestoreEntry();
  const pauseTimer = usePauseTimer();
  const resumeTimer = useResumeTimer();
  const discardPause = useDiscardPause();
  const toast = useToast();
  const [timerDuration, setTimerDuration] = useState('');
  const timerErrors = useFieldErrors<'duration'>();
  const chainBusy = pauseTimer.isPending || resumeTimer.isPending || discardPause.isPending;
  // Set synchronously, so a second click in the same frame sees it before `create.isPending` does.
  const starting = useRef(false);
  const { draft, setDraft } = running;

  /**
   * Starts `from` and returns the created entry, or null when nothing was created. Continue and
   * favorites pass `replace`: the server then stops the running entry at the new entry's start,
   * keeping exactly one running entry. A duration typed into the idle bar saves a finished entry
   * that ends now instead.
   */
  const start = async (from: EntryDraft = draft, { replace = false } = {}): Promise<TimeEntry | null> => {
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
        const stop = new Date();
        saved = await create.mutateAsync({
          ...from,
          start: new Date(stop.getTime() - seconds * 1000).toISOString(),
          stop: stop.toISOString(),
        });
        // The server snaps the entry to the time resolution, so the toast shows what it stored.
        toast.show(`Added ${formatDuration(entrySeconds(saved, stop))}`);
        setDraft(EMPTY_DRAFT);
      } else {
        const startAt = new Date();
        running.markOwnStart(startAt, draft);
        saved = await create.mutateAsync({ ...from, start: startAt.toISOString(), duration: -1 });
      }
      setTimerDuration('');
      return saved;
    } catch (error) {
      running.forgetOwnStart();
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
    if (!(await saveDescription())) return;
    let stopped: TimeEntry;
    try {
      stopped = await stopEntry.mutateAsync(current.id);
    } catch (error) {
      toast.error(error);
      return;
    }
    // The server keeps no entry that rounds to zero at the time resolution: it went to the trash.
    if (stopped.server_deleted_at) {
      toast.show('Too short to keep, so the entry went to the trash', {
        action: { label: 'Undo', run: () => restore.mutate(stopped.id) },
      });
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

  return { start, stop, pause, resume, discard, chainBusy, timerDuration, setTimerDuration, timerErrors };
}
