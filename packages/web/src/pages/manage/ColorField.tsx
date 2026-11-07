import { useRef, useState, type KeyboardEvent } from 'react';
import { PROJECT_COLORS } from '@tokkl/common/colors';
import { arrowTarget } from '../../components/arrowKeys.ts';
import { Icon } from '../../components/Icon.tsx';
import { checkColor } from './swatchCheck.ts';
import { t, type MessageKey } from '../../i18n/messages.ts';

/** Spoken names for the palette swatches; a colour missing here is read as "Color n". */
const COLOR_NAMES: Partial<Record<string, MessageKey>> = {
  '#0b83d9': 'manage.colorBlue',
  '#9e5bd9': 'manage.colorPurple',
  '#d94182': 'manage.colorPink',
  '#e36a00': 'manage.colorOrange',
  '#bf7000': 'manage.colorAmber',
  '#c7af14': 'manage.colorYellow',
  '#d92b2b': 'manage.colorRed',
  '#2da608': 'manage.colorGreen',
  '#06a893': 'manage.colorTeal',
  '#c9806b': 'manage.colorSalmon',
  '#465bb3': 'manage.colorIndigo',
  '#990099': 'manage.colorMagenta',
  '#566614': 'manage.colorOlive',
  '#525266': 'manage.colorSlate',
};

/** A swatch's spoken name, or its place in the palette when it has none. */
function colorName(color: string, index: number): string {
  const key = COLOR_NAMES[color];
  return key ? t(key) : t('manage.colorNumbered', { number: index + 1 });
}

/**
 * Toggl's palette as swatches, plus a Custom option backed by a native picker for any other color.
 * Every option in the radiogroup is a radio. The color input sits after the group, so the group
 * holds radios only; choosing Custom opens that input's picker.
 *
 * The group is one Tab stop (roving tabindex). Arrow keys, Home and End move focus and check the
 * swatch they land on. Landing on Custom only focuses it: the native picker opens on Space, Enter
 * or a click.
 */
export function ColorField({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  const current = value.toLowerCase();
  const custom = !PROJECT_COLORS.some(color => color === current);
  const input = useRef<HTMLInputElement>(null);
  const radios = useRef<(HTMLButtonElement | null)[]>([]);
  // The radio that last had focus while focus is inside the group; null once focus leaves.
  const [focused, setFocused] = useState<number | null>(null);
  const count = PROJECT_COLORS.length + 1;
  const customIndex = PROJECT_COLORS.length;
  const checked = custom ? customIndex : PROJECT_COLORS.findIndex(color => color === current);
  const tabStop = focused ?? checked;
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = arrowTarget(event.key, index, count);
    if (next === null) return;
    event.preventDefault();
    radios.current[next]?.focus();
    const color = PROJECT_COLORS[next];
    if (color) onChange(color);
  };
  const openPicker = () => {
    try {
      input.current?.showPicker();
    } catch {
      input.current?.click();
    }
  };
  return (
    <div className="color-field">
      <div
        className="color-options"
        role="radiogroup"
        aria-label={t('manage.color')}
        onBlur={event => {
          if (!event.currentTarget.contains(event.relatedTarget)) setFocused(null);
        }}
      >
        {PROJECT_COLORS.map((color, index) => (
          <button
            key={color}
            ref={element => {
              radios.current[index] = element;
            }}
            type="button"
            role="radio"
            tabIndex={index === tabStop ? 0 : -1}
            aria-checked={color === current}
            aria-label={colorName(color, index)}
            title={COLOR_NAMES[color] ? t(COLOR_NAMES[color]) : undefined}
            className={`color-swatch${color === current ? ' selected' : ''}`}
            style={{ background: color, '--swatch-check': checkColor(color) }}
            onClick={() => onChange(color)}
            onFocus={() => setFocused(index)}
            onKeyDown={event => onKeyDown(event, index)}
          >
            {color === current ? <Icon name="check" size={20} /> : null}
          </button>
        ))}
        <button
          ref={element => {
            radios.current[customIndex] = element;
          }}
          type="button"
          role="radio"
          tabIndex={tabStop === customIndex ? 0 : -1}
          aria-checked={custom}
          className={`color-custom${custom ? ' selected' : ''}`}
          onClick={openPicker}
          onFocus={() => setFocused(customIndex)}
          onKeyDown={event => onKeyDown(event, customIndex)}
        >
          <span className="color-custom-check" aria-hidden="true">
            {custom ? <Icon name="check" size={16} /> : null}
          </span>
          {t('manage.custom')}
        </button>
      </div>
      <input
        ref={input}
        type="color"
        className="color-custom-input"
        value={current}
        onChange={event => onChange(event.target.value)}
        aria-label={t('manage.customColor')}
      />
    </div>
  );
}
