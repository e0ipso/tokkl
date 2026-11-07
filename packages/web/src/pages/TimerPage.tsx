import { useEffect, useRef, useState } from 'react';
import { usePreferences, useSavePreferences } from '../api/account.ts';
import { useEntries, useEntryBounds } from '../api/entries.ts';
import { useProjects } from '../api/projects.ts';
import type { Favorite, TimeEntry } from '../api/types.ts';
import { addDays, startOfWeek } from '@tokkl/common/time';
import { EntryList } from '../components/EntryList.tsx';
import { Icon } from '../components/Icon.tsx';
import { BusyRegion, LoadError, Loading } from '../components/PageState.tsx';
import { ProjectDot } from '../components/Pickers.tsx';
import { ShortcutHelp, useShortcuts } from '../components/Shortcuts.tsx';
import { TimerBar, type TimerBarHandle } from '../components/TimerBar.tsx';
import { WeekCalendar } from '../components/WeekCalendar.tsx';
import { useSettings } from '../api/settings.ts';
import { useNow } from '../lib/clock.ts';
import { duration, today } from '../lib/format.ts';
import { periodTotals } from '../lib/entryRows.ts';
import { draftOf } from '../components/useEntryFields.ts';

const PAGE_DAYS = 14;

/** Today's and this week's tracked time. It ticks on its own, so running time does not re-render the page. */
function PeriodTotals({ entries }: { entries: TimeEntry[] }) {
  const settings = useSettings();
  const now = useNow(30_000);
  const todayKey = today(settings.timeZone);
  const weekStart = startOfWeek(todayKey, settings.beginningOfWeek);
  const totals = periodTotals(entries, now, { todayKey, weekStart, timeZone: settings.timeZone });
  return (
    <>
      <span>
        Today <strong>{duration(totals.todaySeconds, settings)}</strong>
      </span>
      <span>
        This week <strong>{duration(totals.weekSeconds, settings)}</strong>
      </span>
    </>
  );
}

export function TimerPage() {
  const settings = useSettings();
  const { data: prefs } = usePreferences();
  const savePrefs = useSavePreferences();
  const [days, setDays] = useState(PAGE_DAYS);
  const [help, setHelp] = useState(false);
  const view = prefs?.timerView === 'calendar' ? 'calendar' : 'list';
  const setView = (next: 'list' | 'calendar') => savePrefs.mutate({ timerView: next });
  const todayKey = today(settings.timeZone);
  const startDate = addDays(todayKey, -days + 1);
  const {
    data: entries = [],
    isLoading,
    isFetching,
    isPlaceholderData,
    error,
    refetch,
  } = useEntries(startDate, addDays(todayKey, 2));
  const { data: bounds } = useEntryBounds();
  const hasOlderEntries = Boolean(bounds?.first_date && bounds.first_date < startDate);
  const { data: projects = [] } = useProjects();
  const timer = useRef<TimerBarHandle>(null);
  const favorites = prefs?.favorites ?? [];

  const continueEntry = (entry: TimeEntry) => timer.current?.startFrom(draftOf(entry));
  const startFavorite = (favorite: Favorite) => timer.current?.startFrom(draftOf(favorite));

  const handlers: Record<string, () => void> = {
    n: () => timer.current?.startNew(),
    s: () => timer.current?.stop(),
    m: () => timer.current?.toggleManual(),
    // Like the Continue button: a running timer is stopped at the new entry's start.
    c: () => {
      const last = entries.find(entry => entry.stop);
      if (last) continueEntry(last);
    },
    '?': () => setHelp(true),
  };
  favorites.forEach((favorite, index) => {
    handlers[String(index + 1)] = () => startFavorite(favorite);
  });
  useShortcuts(settings.shortcuts, handlers);

  // The empty list's "Manual mode" button goes away once manual mode is on, so focus moves to the
  // description field instead of dropping to the page.
  const focusAfterManual = useRef(false);
  const switchToManual = () => {
    focusAfterManual.current = true;
    timer.current?.toggleManual();
  };
  const manualMode = prefs?.manualMode ?? false;
  useEffect(() => {
    if (!manualMode || !focusAfterManual.current) return;
    focusAfterManual.current = false;
    timer.current?.focus();
  }, [manualMode]);

  const removeFavorite = (index: number) => savePrefs.mutate({ favorites: favorites.filter((_, i) => i !== index) });

  return (
    <div className="page">
      <TimerBar ref={timer} recentEntries={entries} />
      <div className="timer-summary">
        <PeriodTotals entries={entries} />
        <div className="segmented view-switch" role="group" aria-label="View">
          <button
            type="button"
            className={view === 'list' ? 'active' : ''}
            aria-pressed={view === 'list'}
            onClick={() => setView('list')}
          >
            List
          </button>
          <button
            type="button"
            className={view === 'calendar' ? 'active' : ''}
            aria-pressed={view === 'calendar'}
            onClick={() => setView('calendar')}
          >
            Calendar
          </button>
        </div>
        <button type="button" className="link-button" onClick={() => setHelp(true)} title="Keyboard shortcuts">
          <kbd>?</kbd> Shortcuts
        </button>
      </div>
      {favorites.length > 0 ? (
        <div className="favorites" aria-label="Favorites">
          {favorites.map((favorite, index) => {
            const project = projects.find(p => p.id === favorite.project_id);
            const name = favorite.description || project?.name || 'Untitled';
            const projectName = favorite.description ? project?.name : undefined;
            return (
              <div key={index} className="favorite">
                <button
                  type="button"
                  className="favorite-start"
                  onClick={() => startFavorite(favorite)}
                  title={`Start (${index + 1})`}
                  aria-label={projectName ? `${name}, ${projectName}` : name}
                >
                  <kbd>{index + 1}</kbd>
                  {project ? <ProjectDot color={project.color} /> : null}
                  <span className="favorite-name">{name}</span>
                  {projectName ? <span className="favorite-project">{projectName}</span> : null}
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Remove favorite"
                  onClick={() => removeFavorite(index)}
                >
                  <Icon name="x" size={12} />
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
      {view === 'calendar' ? (
        <WeekCalendar />
      ) : (
        <>
          {isLoading ? (
            <Loading label="Loading entries…" />
          ) : error && !entries.length ? (
            <LoadError message={`Could not load time entries: ${error.message}`} onRetry={() => void refetch()} />
          ) : (
            <BusyRegion busy={isFetching}>
              <EntryList
                entries={entries}
                onContinue={continueEntry}
                onStartTimer={() => timer.current?.startNew()}
                onManualMode={prefs?.manualMode ? undefined : switchToManual}
              />
            </BusyRegion>
          )}
          {hasOlderEntries || isPlaceholderData ? (
            <div className="load-more">
              <button
                type="button"
                className="button button-ghost"
                disabled={isFetching}
                onClick={() => setDays(days + PAGE_DAYS)}
              >
                {isFetching ? 'Loading…' : `Show ${PAGE_DAYS} more days`}
              </button>
            </div>
          ) : null}
        </>
      )}
      {help ? <ShortcutHelp onClose={() => setHelp(false)} /> : null}
    </div>
  );
}
