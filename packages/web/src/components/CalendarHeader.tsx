import { useRef } from 'react';
import type { TimeEntry } from '../api/types.ts';
import { duration, shortDate, weekdayName } from '../lib/format.ts';
import type { Settings } from '../lib/settings.ts';
import { entrySeconds } from '../lib/snapping.ts';
import { arrowTarget } from './arrowKeys.ts';
import { Icon } from './Icon.tsx';
import { projectColorStyle } from './ProjectLabel.tsx';
import { t } from '../i18n/messages.ts';

/** The parts of the week calendar above the hour grid. */

/** Previous, current and next buttons with the shown day or week. */
export function CalendarToolbar({
  dayMode,
  selectedDay,
  weekDays,
  weekTotal,
  settings,
  onStep,
  onToday,
}: {
  dayMode: boolean;
  selectedDay: string;
  weekDays: readonly string[];
  weekTotal: number;
  settings: Settings;
  onStep: (direction: 1 | -1) => void;
  onToday: () => void;
}) {
  return (
    <div className="calendar-toolbar">
      <button
        type="button"
        className="icon-button"
        aria-label={dayMode ? t('calendar.previousDay') : t('calendar.previousWeek')}
        onClick={() => onStep(-1)}
      >
        <Icon name="chevronLeft" />
      </button>
      <button
        type="button"
        className="button button-ghost"
        onClick={onToday}
        title={dayMode ? t('calendar.currentDayTitle') : t('calendar.thisWeekTitle')}
      >
        {dayMode ? t('calendar.currentDay') : t('calendar.thisWeek')}
      </button>
      <button
        type="button"
        className="icon-button"
        aria-label={dayMode ? t('calendar.nextDay') : t('calendar.nextWeek')}
        onClick={() => onStep(1)}
      >
        <Icon name="chevronRight" />
      </button>
      <span className="calendar-range">
        {dayMode
          ? t('dates.dayLabel', { weekday: weekdayName(selectedDay), date: shortDate(selectedDay) })
          : t('calendar.weekRange', { from: shortDate(weekDays[0]!), to: shortDate(weekDays[6]!) })}
      </span>
      <span className="spacer" />
      <span className="muted">
        {t('calendar.weekTotal')} <strong>{duration(weekTotal, settings)}</strong>
      </span>
    </div>
  );
}

/** The week's days as one Tab stop in day mode: arrows, Home and End move between them and select. */
export function DayStrip({
  weekDays,
  selectedDay,
  todayKey,
  totals,
  settings,
  onSelect,
}: {
  weekDays: readonly string[];
  selectedDay: string;
  todayKey: string;
  totals: ReadonlyMap<string, number>;
  settings: Settings;
  onSelect: (day: string) => void;
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div className="calendar-strip" role="group" aria-label={t('calendar.daysOfWeek')}>
      {weekDays.map((day, index) => {
        const total = duration(totals.get(day) ?? 0, settings);
        return (
          <button
            key={day}
            ref={element => {
              buttons.current[index] = element;
            }}
            type="button"
            className={`calendar-strip-day${day === todayKey ? ' today' : ''}`}
            aria-pressed={day === selectedDay}
            aria-label={t('calendar.stripDay', { weekday: weekdayName(day), date: shortDate(day), total })}
            tabIndex={day === selectedDay ? 0 : -1}
            onClick={() => onSelect(day)}
            onKeyDown={event => {
              const next = arrowTarget(event.key, index, weekDays.length);
              if (next === null) return;
              event.preventDefault();
              onSelect(weekDays[next]!);
              buttons.current[next]?.focus();
            }}
          >
            <span className="calendar-strip-weekday">{weekdayName(day)}</span>
            <span className="calendar-strip-date">{shortDate(day)}</span>
            <small>{total}</small>
          </button>
        );
      })}
    </div>
  );
}

/** One cell per shown day, outside the hour scroller. Add controls and chips are siblings. */
export function AllDayRow({
  days,
  entries,
  now,
  settings,
  onAdd,
  onOpen,
}: {
  days: readonly string[];
  entries: ReadonlyMap<string, TimeEntry[]>;
  now: Date;
  settings: Settings;
  onAdd: (day: string) => void;
  onOpen: (entry: TimeEntry) => void;
}) {
  return (
    <div className="calendar-all-day" role="group" aria-label={t('calendar.allDayEntries')}>
      <div className="calendar-all-day-label">{t('calendar.allDay')}</div>
      {days.map(day => (
        <div key={day} className="calendar-all-day-cell">
          <button
            type="button"
            className="calendar-all-day-add"
            aria-label={t('calendar.addAllDayFor', { day })}
            title={t('calendar.addAllDayFor', { day })}
            onClick={event => {
              event.currentTarget.focus();
              onAdd(day);
            }}
          >
            <Icon name="plus" size={14} />
          </button>
          {(entries.get(day) ?? []).map(entry => {
            const elapsed = duration(entrySeconds(entry, now), settings);
            const label = [entry.description || t('entries.noDescription'), entry.project_name, elapsed]
              .filter(Boolean)
              .join(', ');
            return (
              <button
                key={entry.id}
                type="button"
                className="calendar-chip"
                style={projectColorStyle(entry.project_color ?? 'var(--muted)')}
                aria-label={label}
                title={label}
                onClick={() => onOpen(entry)}
              >
                <strong>{entry.description || entry.project_name || t('entries.noDescription')}</strong>
                <span className="calendar-block-duration">{elapsed}</span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
