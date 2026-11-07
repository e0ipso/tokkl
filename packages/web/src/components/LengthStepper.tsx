import { useId, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import { Icon } from './Icon.tsx';
import { canStep, stepValue, stepperStatus, type StepperRange } from './lengthStepper.ts';
import { t } from '../i18n/messages.ts';

/** Props a form passes to the value field, such as the ones useFieldErrors().field returns. */
export interface StepperInputProps {
  id?: string;
  ref?: Ref<HTMLInputElement>;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
  onInput?: () => void;
}

/**
 * One length as a card: the label, the value in large figures, the unit with its range, and minus
 * and plus buttons that step by one and clamp to the range. The value is a text field, so typing
 * works, and the arrow keys step it like the buttons. The buttons stay out of the tab order: the
 * field does the same with the arrow keys, and four cards would add eight tab stops.
 *
 * A value out of range, empty or not whole turns the card danger and marks the field invalid; above
 * or below the range the unit line names the limit it breaks. The form still decides what blocks a
 * submit. `error` is for a message the card cannot know, such as a refusal from the server.
 */
export function LengthStepper({
  label,
  unit,
  spokenUnit,
  range,
  value,
  onChange,
  inputProps,
  error,
}: {
  /** The caption above the value, which is also the field's accessible name. */
  label: string;
  /** The short unit shown under the value, such as "min". */
  unit: string;
  /** The unit as a screen reader reads it, such as "minutes". */
  spokenUnit: string;
  range: StepperRange;
  value: string;
  onChange: (value: string) => void;
  inputProps?: StepperInputProps;
  error?: ReactNode;
}) {
  const ownId = useId();
  const inputId = inputProps?.id ?? `${ownId}-value`;
  const descriptionId = `${ownId}-description`;
  const status = stepperStatus(value, range);
  const valid = status === 'valid';
  const { min, max } = range;
  const limit =
    status === 'aboveMax'
      ? t('pomodoro.stepperMax', { max })
      : status === 'belowMin'
        ? t('pomodoro.stepperMin', { min })
        : t('pomodoro.stepperRange', { unit, min, max });
  const spoken = valid
    ? t('pomodoro.stepperSpoken', { unit: spokenUnit, min, max })
    : t('pomodoro.stepperSpokenInvalid', { unit: spokenUnit, min, max });

  const step = (direction: 1 | -1) => {
    if (canStep(value, direction, range)) onChange(String(stepValue(value, direction, range)));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    step(event.key === 'ArrowUp' ? 1 : -1);
  };
  const button = (direction: 1 | -1) => {
    const allowed = canStep(value, direction, range);
    return (
      <button
        type="button"
        className="length-stepper-step"
        tabIndex={-1}
        aria-label={direction > 0 ? t('pomodoro.increase', { label }) : t('pomodoro.decrease', { label })}
        aria-controls={inputId}
        aria-disabled={allowed ? undefined : true}
        onClick={() => step(direction)}
      >
        <Icon name={direction > 0 ? 'plus' : 'minus'} size={20} />
      </button>
    );
  };

  return (
    <div className="length-stepper" data-invalid={valid ? undefined : true}>
      <label className="length-stepper-label" htmlFor={inputId}>
        {label}
      </label>
      <input
        {...inputProps}
        id={inputId}
        className="length-stepper-value"
        type="text"
        inputMode="numeric"
        autoComplete="off"
        role="spinbutton"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={valid ? Number(value.trim()) : undefined}
        aria-invalid={inputProps?.['aria-invalid'] || !valid || undefined}
        aria-describedby={[inputProps?.['aria-describedby'], descriptionId].filter(Boolean).join(' ')}
        value={value}
        onChange={event => onChange(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <p className="length-stepper-unit" aria-hidden="true">
        {limit}
      </p>
      <span id={descriptionId} className="visually-hidden">
        {spoken}
      </span>
      <div className="length-stepper-steps">
        {button(-1)}
        {button(1)}
      </div>
      {error}
    </div>
  );
}

/**
 * The cards in four columns when four fit, otherwise two, or one on the narrowest screens. The
 * outer element is the size container the column count queries; the inner one is the grid.
 */
export function LengthStepperGrid({ children, ...group }: { children: ReactNode; 'aria-labelledby'?: string }) {
  return (
    <div className="length-stepper-grid" role={group['aria-labelledby'] ? 'group' : undefined} {...group}>
      <div className="length-stepper-cards">{children}</div>
    </div>
  );
}
