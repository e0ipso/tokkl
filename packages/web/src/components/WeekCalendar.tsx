import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { addDays, startOfWeek } from '@tokkl/common/time';
import { useEntries } from '../api/entries.ts';
import { useSettings } from '../api/settings.ts';
import type { TimeEntry } from '@tokkl/types';
import { DAY_MODE_QUERY, classifySwipe, splitAllDay, stepDay, type SwipeDirection } from '../lib/calendarDay.ts';
import { HOUR_HEIGHT, dayTotals, layoutBlocks, minuteToPx, rangeTotal } from '../lib/calendarLayout.ts';
import { useNow } from '../lib/clock.ts';
import { instantAt } from '../lib/entryTime.ts';
import { dayLabel, duration, formatTime, minutesOfDay, today } from '../lib/format.ts';
import { useMediaQuery } from '../lib/useMediaQuery.ts';
import { AllDayEntryDialog } from './AllDayEntryDialog.tsx';
import { AllDayRow, CalendarToolbar, DayStrip } from './CalendarHeader.tsx';
import { CalendarBlockView } from './CalendarBlockView.tsx';
import { EntryEditor } from './EntryEditor.tsx';
import { useOverlayStack } from './overlayStack.tsx';
import { LoadError, Loading } from './PageState.tsx';
import { useCalendarDrag } from './useCalendarDrag.ts';
import { t } from '../i18n/messages.ts';

/** The timer page's calendar view: a week of day columns, or one day on narrow screens. */
export function WeekCalendar() {
  const settings = useSettings();
  const now = useNow(60_000);
  const todayKey = today(settings.timeZone);
  // Below 760px the grid shows one day; the week it belongs to still loads, for the strip's totals.
  const dayMode = useMediaQuery(DAY_MODE_QUERY);
  const [selectedDay, setSelectedDay] = useState(todayKey);
  // The side the shown day came in from; the grid remounts per day, so the slide plays once.
  const [slide, setSlide] = useState<SwipeDirection | null>(null);
  const weekStart = startOfWeek(selectedDay, settings.beginningOfWeek);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const days = useMemo(() => (dayMode ? [selectedDay] : weekDays), [dayMode, selectedDay, weekDays]);
  // A week that has not loaded shows the Loading state over the grid, not an empty week.
  const { data, isLoading, error, refetch } = useEntries(addDays(weekStart, -1), addDays(weekStart, 7));
  const entries = useMemo(() => data ?? [], [data]);
  const [editing, setEditing] = useState<TimeEntry | null>(null);
  const [creatingDay, setCreatingDay] = useState<string | null>(null);
  const overlays = useOverlayStack();
  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  // Where a day-mode gesture on the grid began, until pointer up decides whether it was a swipe.
  const swipeStart = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const gesture = useCalendarDrag({
    root,
    settings,
    dayMode,
    // The held finger is dragging now, so its travel must not count as a swipe on pointer up.
    onHold: () => {
      swipeStart.current = null;
    },
    onOpen: setEditing,
  });
  const { drag } = gesture;
  // No-time entries have no place on the clock, so only timed ones reach the lane layout.
  const { timed, allDay } = useMemo(
    () => splitAllDay(entries, days, settings.timeZone),
    [entries, days, settings.timeZone],
  );
  const blocks = useMemo(
    () => layoutBlocks(timed, days, settings.timeZone, now),
    [timed, days, settings.timeZone, now],
  );
  const totals = useMemo(() => dayTotals(entries, settings.timeZone, now), [entries, settings.timeZone, now]);
  const weekTotal = rangeTotal(totals, weekStart, weekDays[6]!);

  useEffect(() => {
    scroller.current?.scrollTo({ top: 7 * HOUR_HEIGHT });
  }, []);

  const selectDay = (day: string) => {
    if (day !== selectedDay) setSlide(day > selectedDay ? 'next' : 'previous');
    setSelectedDay(day);
  };
  // The arrows step one day in day mode and one week otherwise; stepping the selected day by seven
  // keeps the derived week start on the same weekday, so the week view moves a whole week.
  const step = (direction: 1 | -1) => selectDay(stepDay(selectedDay, dayMode ? direction : direction * 7));

  // T jumps to today, unless the user is typing or an overlay is open.
  const onKey = useEffectEvent((event: KeyboardEvent) => {
    const target = event.target;
    const typing = target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
    if (typing || overlays.isOpen()) return;
    if (event.key.toLowerCase() === 't' && !event.ctrlKey && !event.metaKey) selectDay(todayKey);
  });
  useEffect(() => {
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const nowMinute = minutesOfDay(now, settings.timeZone);
  // A gesture that edits nothing (no drag, or a create drag that never grew) can still be a swipe.
  const gestureEditsNothing = !drag || (drag.kind === 'create' && drag.fromMinute === drag.toMinute);

  return (
    <div
      ref={root}
      className={`calendar${dayMode ? ' day-mode' : ''}`}
      onPointerMove={gesture.wander}
      onPointerUp={() => void gesture.finish()}
      onPointerLeave={() => void gesture.finish()}
      onPointerCancel={gesture.cancel}
    >
      <CalendarToolbar
        dayMode={dayMode}
        selectedDay={selectedDay}
        weekDays={weekDays}
        weekTotal={weekTotal}
        settings={settings}
        onStep={step}
        onToday={() => selectDay(todayKey)}
      />
      {dayMode ? (
        <DayStrip
          weekDays={weekDays}
          selectedDay={selectedDay}
          todayKey={todayKey}
          totals={totals}
          settings={settings}
          onSelect={selectDay}
        />
      ) : (
        <div className="calendar-head">
          <div className="calendar-gutter" />
          {weekDays.map(day => (
            <div key={day} className={`calendar-day-head${day === todayKey ? ' today' : ''}`}>
              <span>{dayLabel(day, todayKey)}</span>
              <small>{duration(totals.get(day) ?? 0, settings)}</small>
            </div>
          ))}
        </div>
      )}
      <AllDayRow
        days={days}
        entries={allDay}
        now={now}
        settings={settings}
        onAdd={setCreatingDay}
        onOpen={setEditing}
      />
      <div className="calendar-frame">
        <div
          className="calendar-body"
          ref={scroller}
          // Capture phase: a block stops its pointer down from bubbling, but a swipe may start on it.
          onPointerDownCapture={event => {
            if (dayMode && event.isPrimary)
              swipeStart.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
          }}
          onPointerUp={event => {
            const start = swipeStart.current;
            swipeStart.current = null;
            if (!dayMode || !start || start.pointerId !== event.pointerId || !gestureEditsNothing) return;
            const direction = classifySwipe(event.clientX - start.x, event.clientY - start.y);
            if (direction) step(direction === 'next' ? 1 : -1);
          }}
          onPointerCancel={() => {
            swipeStart.current = null;
          }}
        >
          <div
            key={dayMode ? selectedDay : 'week'}
            className="calendar-grid"
            style={{ height: 24 * HOUR_HEIGHT }}
            data-slide={dayMode && slide ? slide : undefined}
            // Android Chrome opens a context menu on a long press; a right-click still gets one.
            onContextMenu={event => {
              if (gesture.holding()) event.preventDefault();
            }}
          >
            <div className="calendar-gutter">
              {Array.from({ length: 24 }, (_, hour) => (
                <span key={hour} style={{ top: hour * HOUR_HEIGHT }}>
                  {formatTime(instantAt(todayKey, hour * 60, settings.timeZone), settings)}
                </span>
              ))}
            </div>
            {days.map(day => (
              <div
                key={day}
                className={`calendar-column${day === todayKey ? ' today' : ''}`}
                onPointerDown={event => {
                  if (event.button !== 0) return;
                  if (event.target instanceof Element && event.target.closest('.calendar-block')) return;
                  gesture.beginCreate(event, day);
                }}
                onPointerMove={event => gesture.moveOver(event, day)}
              >
                {day === todayKey ? <div className="calendar-now" style={{ top: minuteToPx(nowMinute) }} /> : null}
                {(blocks.get(day) ?? []).map(block => (
                  <CalendarBlockView
                    key={`${block.entry.id}-${day}`}
                    block={block}
                    drag={drag}
                    stepMinutes={gesture.stepMinutes}
                    now={now}
                    settings={settings}
                    onPointerDown={(event, kind) => gesture.beginBlock(event, kind, block)}
                    onOpen={() => setEditing(block.entry)}
                  />
                ))}
                {drag?.kind === 'create' && drag.day === day ? (
                  <div
                    className="calendar-block calendar-ghost"
                    style={{
                      top: minuteToPx(Math.min(drag.fromMinute, drag.toMinute)),
                      height: minuteToPx(Math.abs(drag.toMinute - drag.fromMinute)),
                      left: 2,
                      width: 'calc(100% - 4px)',
                    }}
                  />
                ) : null}
              </div>
            ))}
          </div>
        </div>
        {isLoading ? (
          <Loading label={t('calendar.loadingWeek')} className="calendar-state" />
        ) : error && !data ? (
          <LoadError
            className="calendar-state"
            message={t('calendar.loadFailed', { message: error.message })}
            onRetry={() => void refetch()}
          />
        ) : null}
      </div>
      <p className="hint">{t('calendar.hint')}</p>
      {creatingDay ? (
        <AllDayEntryDialog
          key={creatingDay}
          date={creatingDay}
          recentEntries={entries}
          onClose={() => setCreatingDay(null)}
        />
      ) : null}
      {editing ? <EntryEditor entry={editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}
