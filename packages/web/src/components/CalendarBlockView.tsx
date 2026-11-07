import type { PointerEvent } from 'react';
import { droppedMinute } from '../lib/calendarDay.ts';
import { MIN_BLOCK_HEIGHT, minuteToPx, type CalendarBlock } from '../lib/calendarLayout.ts';
import { duration, formatTime } from '../lib/format.ts';
import type { Settings } from '../lib/settings.ts';
import { entrySeconds } from '../lib/snapping.ts';
import { projectColorStyle } from './ProjectLabel.tsx';
import type { CalendarDrag } from './useCalendarDrag.ts';
import { t } from '../i18n/messages.ts';

/** One entry's part of a day column, drawn where a move or resize in progress would drop it. */
export function CalendarBlockView({
  block,
  drag,
  stepMinutes,
  now,
  settings,
  onPointerDown,
  onOpen,
}: {
  block: CalendarBlock;
  drag: CalendarDrag | null;
  stepMinutes: number;
  now: Date;
  settings: Settings;
  onPointerDown: (event: PointerEvent<HTMLDivElement>, kind: 'move' | 'resize') => void;
  /** Opens the entry in the editor, as a click on the block does through the drag gesture. */
  onOpen: () => void;
}) {
  const active = drag !== null && drag.kind !== 'create' && drag.entry.id === block.entry.id;
  let top = block.top;
  let bottom = block.bottom;
  if (active && drag.kind === 'move') {
    top = droppedMinute(block.top, drag.deltaMinutes, settings.timeResolution);
    bottom += top - block.top;
  } else if (active && drag.kind === 'resize') {
    bottom = Math.max(top + stepMinutes, droppedMinute(bottom, drag.deltaMinutes, settings.timeResolution));
  }
  const width = 100 / block.lanes;
  const storedHeight = minuteToPx(bottom - top);
  const { description, project_name: projectName } = block.entry;
  const elapsed = duration(entrySeconds(block.entry, now), settings);
  const label = [description || t('entries.noDescription'), projectName, elapsed].filter(Boolean).join(', ');
  const heading = description || projectName || t('entries.noDescription');
  const classes = [
    'calendar-block',
    block.entry.stop ? '' : 'running',
    storedHeight < MIN_BLOCK_HEIGHT ? 'thin' : '',
    storedHeight === 0 ? 'marker' : '',
    active ? 'dragging' : '',
  ];
  return (
    <div
      className={classes.filter(Boolean).join(' ')}
      style={{
        top: minuteToPx(top),
        height: Math.max(storedHeight, active ? MIN_BLOCK_HEIGHT : block.minHeight),
        left: `calc(${block.lane * width}% + 2px)`,
        width: `calc(${width}% - 4px)`,
        ...projectColorStyle(block.entry.project_color ?? 'var(--muted)'),
      }}
      role="group"
      aria-label={label}
      title={t('calendar.blockTitle', {
        label,
        range: t('dates.timeRange', {
          start: formatTime(block.entry.start, settings),
          end: block.entry.stop ? formatTime(block.entry.stop, settings) : t('calendar.now'),
        }),
      })}
      onPointerDown={event => {
        if (event.button !== 0) return;
        event.stopPropagation();
        const resize = event.target instanceof Element && event.target.classList.contains('calendar-resize');
        onPointerDown(event, resize ? 'resize' : 'move');
      }}
    >
      {bottom - top >= 45 ? (
        <>
          <strong>{heading}</strong>
          <span>
            {projectName ? t('calendar.projectPrefix', { project: projectName }) : null}
            <span className="calendar-block-duration">{elapsed}</span>
          </span>
        </>
      ) : (
        <div className="calendar-block-line">
          <strong>{heading}</strong>
          {description && projectName ? <span>{t('calendar.projectSuffix', { project: projectName })}</span> : null}
        </div>
      )}
      {/* The block's keyboard and screen reader control, laid over it. A pointer press is the drag
          gesture's, which opens the editor itself on a click or tap; this button opens it only for a
          click without a pointer (detail 0): Enter, Space or a screen reader's activation. */}
      <button
        type="button"
        className="calendar-block-open"
        aria-label={t('calendar.editBlock', { label })}
        onClick={event => {
          if (event.detail === 0) onOpen();
        }}
      />
      {block.entry.stop ? <span className="calendar-resize" aria-hidden /> : null}
    </div>
  );
}
