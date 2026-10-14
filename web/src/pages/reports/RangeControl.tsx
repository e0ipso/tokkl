import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../components/Icon.tsx';
import { Popover } from '../../components/Overlay.tsx';
import {
  PRESETS, PRESET_LABELS, formatRange, isDateKey, matchingPreset, presetRange, shiftRange, type DateRange, type Preset,
} from './range.ts';
import type { ReportPatch } from './urlState.ts';

function isTyping(target: EventTarget | null): boolean {
  const element = target instanceof HTMLElement ? target : null;
  if (!element) return false;
  return element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)
    || element.closest('[data-own-arrows]') !== null;
}

/** Preset list plus a custom range, with arrows that move the range by its own length. */
export function RangeControl({ range, preset, todayKey, beginningOfWeek, firstDay, update }: {
  range: DateRange;
  preset: Preset | null;
  todayKey: string;
  firstDay?: string | null;
  beginningOfWeek: number;
  update: (patch: ReportPatch) => void;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(range);
  const button = useRef<HTMLButtonElement>(null);
  const active = preset ?? matchingPreset(range, todayKey, beginningOfWeek, firstDay);

  const shift = (direction: 1 | -1) => update({ range: shiftRange(range, direction) });
  const shiftRef = useRef(shift);
  shiftRef.current = shift;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || isTyping(event.target)) return;
      if (document.querySelector('.modal, .popover')) return;
      event.preventDefault();
      shiftRef.current(event.key === 'ArrowLeft' ? -1 : 1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const choose = (next: Preset) => {
    update({ preset: next, range: presetRange(next, todayKey, beginningOfWeek, firstDay) });
    setOpen(false);
  };
  const applyCustom = () => {
    if (!isDateKey(custom.from) || !isDateKey(custom.to)) return;
    const ordered = custom.from <= custom.to ? custom : { from: custom.to, to: custom.from };
    update({ range: ordered, preset: null });
    setOpen(false);
  };

  return (
    <div className="range-control">
      <button type="button" className="icon-button" aria-label="Previous period" title="Previous period (Left arrow)" onClick={() => shift(-1)}>
        <Icon name="chevronLeft" />
      </button>
      <button
        ref={button}
        type="button"
        className="select-button range-button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setCustom(range);
          setOpen((v) => !v);
        }}
      >
        <Icon name="calendar" size={16} />
        {active ? <strong>{PRESET_LABELS[active]}</strong> : null}
        <span className={active ? 'muted' : undefined}>{formatRange(range, todayKey)}</span>
      </button>
      <button type="button" className="icon-button" aria-label="Next period" title="Next period (Right arrow)" onClick={() => shift(1)}>
        <Icon name="chevronRight" />
      </button>
      {open ? (
        <Popover anchor={button.current} onClose={() => setOpen(false)} width={300}>
          <div className="range-presets" role="listbox" aria-label="Date range">
            {PRESETS.map((name) => (
              <button
                key={name}
                type="button"
                role="option"
                aria-selected={active === name}
                className={`range-preset${active === name ? ' selected' : ''}`}
                onClick={() => choose(name)}
              >
                <span className="range-check" aria-hidden="true">{active === name ? <Icon name="check" size={16} /> : null}</span>
                {PRESET_LABELS[name]}
              </button>
            ))}
          </div>
          <form
            className="range-custom"
            onSubmit={(event) => {
              event.preventDefault();
              applyCustom();
            }}
          >
            <span className="range-custom-title">Custom</span>
            <label className="field">
              <span>From</span>
              <input type="date" value={custom.from} required onChange={(event) => setCustom({ ...custom, from: event.target.value })} />
            </label>
            <label className="field">
              <span>To</span>
              <input type="date" value={custom.to} required onChange={(event) => setCustom({ ...custom, to: event.target.value })} />
            </label>
            <button type="submit" className="button button-primary">Apply</button>
          </form>
        </Popover>
      ) : null}
    </div>
  );
}
