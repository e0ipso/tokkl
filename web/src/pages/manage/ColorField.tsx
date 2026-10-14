import { PROJECT_COLORS } from '../../../../shared/colors.ts';
import { Icon } from '../../components/Icon.tsx';

/** Toggl's palette as swatches, plus a native picker for any other color. */
export function ColorField({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  const current = value.toLowerCase();
  const custom = !PROJECT_COLORS.some((color) => color === current);
  return (
    <div className="color-field" role="radiogroup" aria-label="Color">
      {PROJECT_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          role="radio"
          aria-checked={color === current}
          aria-label={color}
          className={`color-swatch${color === current ? ' selected' : ''}`}
          style={{ background: color }}
          onClick={() => onChange(color)}
        >
          {color === current ? <Icon name="check" size={14} /> : null}
        </button>
      ))}
      <label className={`color-custom${custom ? ' selected' : ''}`} title="Custom color">
        <input type="color" value={current} onChange={(event) => onChange(event.target.value)} aria-label="Custom color" />
        <span>Custom</span>
      </label>
    </div>
  );
}
