/** Both ends included. */
export interface StepperRange {
  min: number;
  max: number;
}

type StepperStatus = 'valid' | 'empty' | 'notWhole' | 'belowMin' | 'aboveMax';

export function stepperStatus(text: string, { min, max }: StepperRange): StepperStatus {
  const trimmed = text.trim();
  if (trimmed === '') return 'empty';
  if (!/^\d+$/.test(trimmed)) return 'notWhole';
  const value = Number(trimmed);
  if (value < min) return 'belowMin';
  if (value > max) return 'aboveMax';
  return 'valid';
}

/** Clamped to the range. Text that is not a number steps to the minimum. */
export function stepValue(text: string, direction: 1 | -1, { min, max }: StepperRange): number {
  const trimmed = text.trim();
  const value = Number(trimmed);
  if (trimmed === '' || !Number.isFinite(value)) return min;
  const next = direction > 0 ? Math.floor(value) + 1 : Math.ceil(value) - 1;
  return Math.min(max, Math.max(min, next));
}

/** So the button at a limit does nothing. */
export function canStep(text: string, direction: 1 | -1, range: StepperRange): boolean {
  return String(stepValue(text, direction, range)) !== text.trim();
}
