import { useRef } from 'react';
import { PROJECT_COLORS } from '../../../../shared/colors.ts';
import { Icon } from '../../components/Icon.tsx';

/** Spoken names for the palette swatches; a colour missing here is read as "Color n". */
const COLOR_NAMES: Record<string, string> = {
  '#0b83d9': 'Blue',
  '#9e5bd9': 'Purple',
  '#d94182': 'Pink',
  '#e36a00': 'Orange',
  '#bf7000': 'Amber',
  '#c7af14': 'Yellow',
  '#d92b2b': 'Red',
  '#2da608': 'Green',
  '#06a893': 'Teal',
  '#c9806b': 'Salmon',
  '#465bb3': 'Indigo',
  '#990099': 'Magenta',
  '#566614': 'Olive',
  '#525266': 'Slate',
};

/** WCAG 2 relative luminance of a #rrggbb color. */
function luminance(hex: string): number {
  const channel = (offset: number) => {
    const c = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

// The values of --swatch-check-light and --swatch-check-dark in styles.css; change them together.
const CHECK_LIGHT = luminance('#ffffff');
const CHECK_DARK = luminance('#0b1026');

/**
 * The check token with the higher contrast against the swatch. The swatch is the raw hex in both
 * themes, so the choice depends on the hex alone.
 */
function checkColor(hex: string): string {
  const l = luminance(hex);
  const onDark = (CHECK_LIGHT + 0.05) / (l + 0.05);
  const onLight = (l + 0.05) / (CHECK_DARK + 0.05);
  return onLight >= onDark ? 'var(--swatch-check-dark)' : 'var(--swatch-check-light)';
}

/**
 * Toggl's palette as swatches, plus a Custom option backed by a native picker for any other color.
 * Every option in the radiogroup is a radio. The color input sits after the group, so the group
 * holds radios only; choosing Custom opens that input's picker.
 */
export function ColorField({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  const current = value.toLowerCase();
  const custom = !PROJECT_COLORS.some((color) => color === current);
  const input = useRef<HTMLInputElement>(null);
  const openPicker = () => {
    try {
      input.current?.showPicker();
    } catch {
      input.current?.click();
    }
  };
  return (
    <div className="color-field">
      <div className="color-options" role="radiogroup" aria-label="Color">
        {PROJECT_COLORS.map((color, index) => (
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={color === current}
            aria-label={COLOR_NAMES[color] ?? `Color ${index + 1}`}
            title={COLOR_NAMES[color]}
            className={`color-swatch${color === current ? ' selected' : ''}`}
            style={{ background: color, ['--swatch-check' as string]: checkColor(color) }}
            onClick={() => onChange(color)}
          >
            {color === current ? <Icon name="check" size={16} /> : null}
          </button>
        ))}
        <button
          type="button"
          role="radio"
          aria-checked={custom}
          className={`color-custom${custom ? ' selected' : ''}`}
          onClick={openPicker}
        >
          <span className="color-custom-check" aria-hidden="true">{custom ? <Icon name="check" size={14} /> : null}</span>
          Custom
        </button>
      </div>
      <input
        ref={input}
        type="color"
        className="color-custom-input"
        value={current}
        onChange={(event) => onChange(event.target.value)}
        aria-label="Custom color"
      />
    </div>
  );
}
