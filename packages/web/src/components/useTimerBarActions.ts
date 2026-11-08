import { useRef, useState, type RefObject } from 'react';
import { formatDuration, parseDuration } from '@tokkl/common/duration';
import { useAddTypedEntry, useDiscardRunningEntry, useRestoreEntry, useUpdateRunningEntry } from '../api/entries.ts';
import { getClockOffset, serverNow } from '../api/serverClock.ts';
import { useSettings } from '../api/settings.ts';
import { useDiscardPause, usePauseTimer, useResumeTimer, useStartTimer, useStopTimer } from '../api/timerHooks.ts';
import type { TimeEntry } from '../api/types.ts';
import { entrySeconds, snappedSeconds } from '../lib/snapping.ts';
import type { EntryFieldsHandle } from './EntryFields.tsx';
import { useFieldErrors } from './FieldError.tsx';
import { useToast } from './Toast.tsx';
import { EMPTY_DRAFT, type EntryDraft } from './useEntryFields.ts';
import type { useRunningDraft } from './useRunningDraft.ts';
import { t } from '../i18n/messages.ts';

/**
 * Start, Stop, Pause, Resume and Discard for the timer bar, and the idle bar's duration field.
 *
 * The server owns the running entry, the pause chain and the Pomodoro session: Start, Stop, Pause,
 * Resume and Stop while paused are timer actions, and Discard and a typed duration are v9 writes.
 * The timer actions wait for the server's answer, and nothing else starts or stops an entry until
 * it arrives, so two writes never race. Start and Stop send the revision the bar shows, so one
 * after a write that got no reply is refused with the server's state if that write landed.
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
  const settings = useSettings();
  const startTimer = useStartTimer();
  const addTyped = useAddTypedEntry();
  const update = useUpdateRunningEntry();
  const stopTimer = useStopTimer();
  const remove = useDiscardRunningEntry();
  const restore = useRestoreEntry();
  const pauseTimer = usePauseTimer();
  const resumeTimer = useResumeTimer();
  const discardPause = useDiscardPause();
  const toast = useToast();
  const [timerDuration, setTimerDuration] = useState('');
  const timerErrors = useFieldErrors<'duration'>();
  const chainBusy = pauseTimer.isPending || resumeTimer.isPending || discardPause.isPending;
  // Set synchronously, so a second click in the same frame sees it before `isPending` does.
  const starting = useRef(false);
  const { draft, setDraft } = running;

  /**
   * Starts `from` and returns the started or saved entry, or null when nothing was. Continue and
   * favorites pass `replace`: the server then stops the running entry at the new entry's start,
   * keeping exactly one running entry. A duration typed into the idle bar saves a finished entry
   * that ends now instead.
   */
  const start = async (from: EntryDraft = draft, { replace = false } = {}): Promise<TimeEntry | null> => {
    // A double click or key repeat must not start two entries before the first one shows up.
    if (starting.current || startTimer.isPending || addTyped.isPending || chainBusy) return null;
    if (current && (!replace || stopTimer.isPending || remove.isPending)) return null;
    // An empty duration starts a running timer; text that does not parse is an error, not empty.
    const typed = !current && timerDuration.trim() !== '';
    const seconds = typed ? parseDuration(timerDuration) : null;
    if (!timerErrors.validate([['duration', typed && seconds === null && t('timer.checkDuration')]])) {
      fields.current?.hideSuggestions();
      return null;
    }
    starting.current = true;
    try {
      fields.current?.hideSuggestions();
      let saved: TimeEntry | null;
      if (seconds !== null && seconds > 0) {
        const stop = new Date();
        const entry = await addTyped.mutateAsync({
          ...from,
          start: new Date(stop.getTime() - seconds * 1000).toISOString(),
          stop: stop.toISOString(),
        });
        // The server snaps the entry to the time resolution, so the toast shows what it stored.
        toast.show(t('entries.added', { duration: formatDuration(entrySeconds(entry, stop)) }));
        setDraft(EMPTY_DRAFT);
        saved = entry;
      } else {
        const startAt = new Date();
        running.markOwnStart(startAt, draft);
        saved = (await startTimer.mutateAsync({ ...from, start: startAt.toISOString() })).running_entry;
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
   * Stop on a running entry stops it at the server's current time, as this tab's clock knows it;
   * the server ends the pause chain when the stopped entry is its clone. Stop while paused ends the
   * chain on the server: every entry is already stopped.
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
    const stoppedAt = serverNow(Date.now(), getClockOffset());
    try {
      await stopTimer.mutateAsync({ stop: stoppedAt.toISOString() });
    } catch (error) {
      toast.error(error);
      return;
    }
    // The server keeps no entry that rounds to zero at the time resolution: it goes to the trash.
    // The reply is the timer state, so the bar works that out from the start it showed, which the
    // revision vouches for, and the stop it sent.
    if (snappedSeconds(new Date(current.start), stoppedAt, settings) === 0) {
      const { id } = current;
      toast.show(t('timer.tooShort'), {
        action: { label: t('common.undo'), run: () => restore.mutate(id) },
      });
    }
  };

  /** Pauses the running entry on the server. A failure leaves the entry running; the toast says why. */
  const pause = async () => {
    if (!current || chainBusy || stopTimer.isPending || remove.isPending) return;
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
      toast.show(t('timer.runningDiscarded'), {
        action: { label: t('common.undo'), run: () => restore.mutate(current.id) },
      });
    } catch (error) {
      toast.error(error);
    }
  };

  return { start, stop, pause, resume, discard, chainBusy, timerDuration, setTimerDuration, timerErrors };
}
