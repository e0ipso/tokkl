import { useEffect, useImperativeHandle, useRef, useState, type Ref, type RefObject } from 'react';
import { parseDuration } from '@tokkl/common/duration';
import { usePreferences, useSavePreferences } from '../api/account.ts';
import { useSettings } from '../api/settings.ts';
import { useTimerState } from '../api/timerHooks.ts';
import type { TimeEntry } from '@tokkl/types';
import { EntryEditor } from './EntryEditor.tsx';
import { EntryFields, type EntryFieldsHandle } from './EntryFields.tsx';
import { ManualEntryFields, useManualEntry } from './ManualEntryFields.tsx';
import { pauseDraft } from './pauseView.ts';
import { ModeSwitch, TimerButtons } from './TimerBarControls.tsx';
import { descriptionPlaceholder, pauseAnnouncement, timerBarClass, timerBarView } from './timerBarView.ts';
import { TimerClock } from './TimerClock.tsx';
import { EMPTY_DRAFT, type EntryDraft } from './useEntryFields.ts';
import { useRunningDraft } from './useRunningDraft.ts';
import { useTimerBarActions } from './useTimerBarActions.ts';
import { t } from '../i18n/messages.ts';

export interface TimerBarHandle {
  startNew: () => void;
  stop: () => void;
  toggleManual: () => void;
  startFrom: (draft: EntryDraft) => void;
  /** Moves focus to the description field. */
  focus: () => void;
}

/** The bar at the top of the timer page: running timer, new timer, or manual entry form. */
export function TimerBar({ recentEntries, ref }: { recentEntries: TimeEntry[]; ref?: Ref<TimerBarHandle> }) {
  const settings = useSettings();
  const { data: timer } = useTimerState();
  const { data: prefs } = usePreferences();
  const savePrefs = useSavePreferences();
  const view = timerBarView(timer, prefs?.manualMode ?? false);
  const { mode, current, chain, paused, manualMode } = view;
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

  const typedSeconds = actions.timerDuration ? parseDuration(actions.timerDuration) : null;

  return (
    <section ref={barRef} className={timerBarClass(mode)} aria-label={t('timer.region')}>
      <EntryFields
        ref={fields}
        draft={held ?? draft}
        readOnly={paused}
        recentEntries={recentEntries}
        placeholder={descriptionPlaceholder(mode)}
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
              {t('timer.running')}
            </span>
            <TimerClock running={current} chain={chain} onEdit={() => setEditing(true)} />
          </>
        ) : mode === 'paused' ? (
          <>
            <span className="timer-paused">{t('timer.paused')}</span>
            <TimerClock running={null} chain={chain} onEdit={() => setEditing(true)} />
          </>
        ) : (
          <input
            {...actions.timerErrors.field('duration')}
            className="timer-clock timer-clock-input"
            aria-label={t('timer.duration')}
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
        {pauseAnnouncement(view)}
      </span>

      {editing && current ? <EntryEditor entry={current} onClose={() => setEditing(false)} /> : null}
    </section>
  );
}

/**
 * Writes the element's height to a custom property on <html> while it is mounted, such as the
 * timer bar's --timer-bar-height: the bulk bar is not inside the timer bar, so it reads the height
 * from there to stick right under it.
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
