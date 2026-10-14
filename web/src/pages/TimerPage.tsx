import { useMemo, useRef, useState } from 'react';
import { useCurrentEntry, useEntries, usePreferences, useSavePreferences, useProjects } from '../api/hooks.ts';
import type { Favorite, TimeEntry } from '../api/types.ts';
import { addDays, startOfWeek } from '../../../shared/time.ts';
import { EntryList } from '../components/EntryList.tsx';
import { Icon } from '../components/Icon.tsx';
import { ProjectDot } from '../components/Pickers.tsx';
import { ShortcutHelp, useShortcuts } from '../components/Shortcuts.tsx';
import { TimerBar, type TimerBarHandle } from '../components/TimerBar.tsx';
import { WeekCalendar } from '../components/WeekCalendar.tsx';
import { localDay } from '../lib/entryTime.ts';
import { duration, entrySeconds, today, useNow, useSettings } from '../lib/settings.ts';

const PAGE_DAYS = 14;

export function TimerPage() {
  const settings = useSettings();
  const now = useNow(30_000);
  const { data: prefs } = usePreferences();
  const savePrefs = useSavePreferences();
  const [days, setDays] = useState(PAGE_DAYS);
  const [help, setHelp] = useState(false);
  const view = prefs?.timerView === 'calendar' ? 'calendar' : 'list';
  const setView = (next: 'list' | 'calendar') => savePrefs.mutate({ timerView: next });
  const todayKey = today(settings.timeZone);
  const { data: entries = [], isLoading, isFetching } = useEntries(addDays(todayKey, -days + 1), addDays(todayKey, 2));
  const { data: current } = useCurrentEntry();
  const { data: projects = [] } = useProjects();
  const timer = useRef<TimerBarHandle>(null);
  const favorites = prefs?.favorites ?? [];

  const weekStart = startOfWeek(todayKey, settings.beginningOfWeek);
  const totals = useMemo(() => {
    let todaySeconds = 0;
    let weekSeconds = 0;
    for (const entry of entries) {
      const day = localDay(entry.start, settings.timeZone);
      const seconds = entrySeconds(entry, now);
      if (day === todayKey) todaySeconds += seconds;
      if (day >= weekStart && day <= todayKey) weekSeconds += seconds;
    }
    return { todaySeconds, weekSeconds };
  }, [entries, now, todayKey, weekStart, settings.timeZone]);

  const continueEntry = (entry: TimeEntry) => timer.current?.startFrom({
    description: entry.description, project_id: entry.project_id, task_id: entry.task_id, tags: entry.tags, billable: entry.billable,
  });
  const startFavorite = (favorite: Favorite) => timer.current?.startFrom({ ...favorite });

  const handlers = useMemo(() => {
    const map: Record<string, () => void> = {
      n: () => timer.current?.startNew(),
      s: () => timer.current?.stop(),
      m: () => timer.current?.toggleManual(),
      c: () => {
        const last = entries.find((entry) => entry.stop);
        if (last && !current) continueEntry(last);
      },
      '?': () => setHelp(true),
    };
    favorites.forEach((favorite, index) => {
      map[String(index + 1)] = () => startFavorite(favorite);
    });
    return map;
  }, [entries, current, favorites]);
  useShortcuts(settings.shortcuts, handlers);

  const removeFavorite = (index: number) => savePrefs.mutate({ favorites: favorites.filter((_, i) => i !== index) });

  return (
    <div className="page timer-page">
      <TimerBar ref={timer} recentEntries={entries} />
      <div className="timer-summary">
        <span>Today <strong>{duration(totals.todaySeconds, settings)}</strong></span>
        <span>This week <strong>{duration(totals.weekSeconds, settings)}</strong></span>
        <div className="segmented view-switch" role="group" aria-label="View">
          <button type="button" className={view === 'list' ? 'active' : ''} aria-pressed={view === 'list'} onClick={() => setView('list')}>
            List
          </button>
          <button type="button" className={view === 'calendar' ? 'active' : ''} aria-pressed={view === 'calendar'} onClick={() => setView('calendar')}>
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
            const project = projects.find((p) => p.id === favorite.project_id);
            return (
              <div key={index} className="favorite">
                <button type="button" className="favorite-start" onClick={() => startFavorite(favorite)} title={`Start (${index + 1})`}>
                  <kbd>{index + 1}</kbd>
                  {project ? <ProjectDot color={project.color} /> : null}
                  <span>{favorite.description || project?.name || 'Untitled'}</span>
                </button>
                <button type="button" className="icon-button" aria-label="Remove favorite" onClick={() => removeFavorite(index)}>
                  <Icon name="x" size={12} />
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
      {view === 'calendar' ? <WeekCalendar /> : (
        <>
          {isLoading ? <p className="muted">Loading…</p> : <EntryList entries={entries} onContinue={continueEntry} />}
          <div className="load-more">
            <button type="button" className="button button-ghost" disabled={isFetching} onClick={() => setDays(days + PAGE_DAYS)}>
              {isFetching ? 'Loading…' : `Show ${PAGE_DAYS} more days`}
            </button>
          </div>
        </>
      )}
      {help ? <ShortcutHelp onClose={() => setHelp(false)} /> : null}
    </div>
  );
}
